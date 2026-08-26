import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_INTERFACE, AA_LARGE_TEXT, AA_TEXT, contrastRatio, parseColor, readRootTokens } from "./contrast.js";

/**
 * Contraste réel de la feuille de style — étape 55, exigence WCAG 2.2 AA.
 *
 * Ces vérifications portent sur le fichier livré, pas sur des valeurs recopiées : modifier une
 * couleur sans respecter les seuils fait échouer la suite. C'est la seule exigence d'accessibilité
 * entièrement calculable, sans navigateur ni moteur de rendu.
 */

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");
const jetons = readRootTokens(css);

/** Arrondi lisible dans les messages d'échec. */
const rapport = (avant: string, arriere: string) => Math.round((contrastRatio(avant, arriere) ?? 0) * 100) / 100;

describe("calcul du contraste", () => {
  it("suit les valeurs de référence de la norme", () => {
    // Extrêmes connus : le contraste maximal vaut 21, l'identité vaut 1.
    expect(rapport("#ffffff", "#000000")).toBe(21);
    expect(rapport("#080b12", "#080b12")).toBe(1);
  });

  it("compose une couleur translucide sur son fond avant de juger", () => {
    // Un blanc à 10 % sur fond sombre ne contraste pas comme du blanc pur : c'est le mélange qui
    // est perçu, et c'est lui que la norme évalue.
    const opaque = rapport("#ffffff", "#080b12");
    const translucide = rapport("rgba(255, 255, 255, 0.1)", "#080b12");
    expect(translucide).toBeLessThan(opaque);
    expect(translucide).toBeGreaterThan(1);
  });

  it("lit les écritures usuelles et refuse ce qu'il ne comprend pas", () => {
    expect(parseColor("#fff")).toMatchObject({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0b1020dd")?.a).toBeCloseTo(0.867, 2);
    expect(parseColor("rgba(255, 255, 255, 0.1)")).toMatchObject({ a: 0.1 });
    // Rendre `null` plutôt qu'une valeur inventée : un jeton non reconnu doit se voir, pas passer.
    expect(parseColor("var(--blue)")).toBeNull();
    expect(parseColor("linear-gradient(#000, #fff)")).toBeNull();
  });
});

describe("jetons de la feuille de style", () => {
  it("déclare bien les couleurs attendues", () => {
    for (const nom of ["color", "background", "--blue", "--blue-light", "--muted", "--panel"]) {
      expect(jetons[nom], `jeton ${nom} absent de :root`).toBeTruthy();
    }
  });

  it("assure le contraste du texte courant sur le fond de l'application", () => {
    const valeur = rapport(jetons["color"]!, jetons["background"]!);
    expect(valeur, `texte principal sur fond : ${valeur}`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("assure le contraste du texte secondaire, celui des métadonnées", () => {
    // `--muted` porte années, durées et libellés de commandes : il est lu, pas décoratif.
    for (const fond of [jetons["background"]!, jetons["panel"] ?? jetons["--panel"]!]) {
      const valeur = rapport(jetons["--muted"]!, fond);
      expect(valeur, `texte secondaire sur ${fond} : ${valeur}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("assure le contraste du bleu d'accentuation employé comme texte", () => {
    // `--blue-light` sert aux liens et aux libellés d'action sur fond sombre.
    const valeur = rapport(jetons["--blue-light"]!, jetons["background"]!);
    expect(valeur, `bleu clair sur fond : ${valeur}`).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("assure le contraste du bouton principal, texte blanc sur bleu", () => {
    const valeur = rapport("#ffffff", jetons["--blue"]!);
    expect(valeur, `blanc sur bleu : ${valeur}`).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
  });

  it("assure la visibilité de l'indicateur de focus", () => {
    // Sans focus visible, une navigation au clavier se fait à l'aveugle. Le seuil est celui des
    // éléments d'interface, non celui du texte.
    const contour = css.match(/:focus-visible\s*\{[^}]*outline:\s*[^;]*?(#[0-9a-fA-F]{3,8})/)?.[1];
    expect(contour, "couleur de contour de focus introuvable").toBeTruthy();
    const valeur = rapport(contour!, jetons["background"]!);
    expect(valeur, `contour de focus sur fond : ${valeur}`).toBeGreaterThanOrEqual(AA_INTERFACE);
  });

  it("assure la lisibilité du lien d'évitement, affiché sur fond clair", () => {
    // Ce lien est la première chose qu'atteint une navigation au clavier : il doit être lisible.
    const regle = css.match(/\.skip-link\s*\{([^}]*)\}/)?.[1] ?? "";
    const fond = regle.match(/background:\s*([^;]+)/)?.[1]?.trim();
    const texte = regle.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1]?.trim();
    expect(fond && texte, "couleurs du lien d'évitement introuvables").toBeTruthy();
    const valeur = rapport(texte!, fond!);
    expect(valeur, `lien d'évitement : ${valeur}`).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
