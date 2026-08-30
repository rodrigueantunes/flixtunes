import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La version du produit ne se déclare qu'à un seul endroit.
 *
 * Elle vivait à sept, et ils avaient divergé sans que rien ne le signale : le produit annonçait
 * 0.5.6, les contrats 0.5.3, l'image Compose et le titre du README 0.2.0. Un écran de diagnostic ne
 * veut plus rien dire dans ces conditions — on ne sait plus quel correctif porte la machine qu'on
 * interroge — et une matrice de compatibilité encore moins.
 *
 * Le client WPF en déclarait une huitième ; il a été retiré, remplacé par le client de bureau qui
 * porte l'interface du Web au lieu de la réécrire.
 *
 * `tools/Sync-Version.ps1` propage la version depuis le `package.json` de la racine. Ce cas-ci vérifie
 * qu'elle l'a bien été : la cohérence ne dépend donc pas de la mémoire de celui qui livre.
 */
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// Même précaution : la première ligne d'un fichier extrait en CRLF garderait son retour chariot, et
// la comparaison échouerait sur un caractère invisible.
const lire = (relatif: string) => readFileSync(path.join(racine, relatif), "utf8").replaceAll("\r\n", "\n");
const manifeste = (relatif: string) => JSON.parse(lire(relatif)) as { version: string; packageManager?: string };

const version = manifeste("package.json").version;

describe("cohérence des versions déclarées", () => {
  it.each([
    ["packages/contracts/package.json"],
    ["apps/server/package.json"],
    ["apps/web/package.json"],
    ["apps/desktop/package.json"],
  ])("%s porte la version du produit", (relatif) => {
    expect(manifeste(relatif).version).toBe(version);
  });

  it("l'image Compose et le titre du README portent la version du produit", () => {
    expect(lire("compose.yaml")).toContain(`image: flixtunes:${version}`);
    expect(lire("README.md").split("\n")[0]).toBe(`# FlixTunes ${version}`);
  });

  it("le pnpm installé par le Dockerfile est celui que le dépôt déclare", () => {
    // Deux versions du gestionnaire de paquets, ce sont deux résolutions de dépendances possibles
    // pour un même verrou — exactement ce qu'un verrou est censé empêcher.
    const declare = (manifeste("package.json").packageManager ?? "").replace(/^pnpm@/, "");
    expect(declare, "le dépôt doit déclarer son gestionnaire de paquets").not.toBe("");
    expect(lire("Dockerfile")).toContain(`--global pnpm@${declare}`);
  });
});
