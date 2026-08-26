import { describe, expect, it } from "vitest";
import { enveloppe, PAS_MS, segmentCommun, SEUIL_CORRELATION } from "./empreinte-sonore.js";

/**
 * Retrouver le thème que deux épisodes partagent.
 *
 * Ces cas fabriquent leurs signaux plutôt que de lire des fichiers : ce qui se vérifie ici est un
 * raisonnement, pas une médiathèque. Un générateur pseudo-aléatoire reproductible tient lieu de
 * « contenu propre à chaque épisode », et une même suite de valeurs tient lieu de thème commun.
 */

/** Suite reproductible : un banc qui change de résultat d'une exécution à l'autre ne prouve rien. */
function bruit(graine: number, longueur: number): number[] {
  const sortie: number[] = [];
  let etat = graine >>> 0;
  for (let index = 0; index < longueur; index += 1) {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    sortie.push((etat / 4_294_967_296) * 2 - 1);
  }
  return sortie;
}

/** Une enveloppe fabriquée directement, en évitant le détour par des échantillons. */
const cases = (valeurs: number[]): Float64Array => Float64Array.from(valeurs);

const THEME = bruit(7, 300);           // 30 s de « générique »
const secondes = (n: number) => Math.round((n * 1000) / PAS_MS);

describe("segment commun à deux épisodes", () => {
  it("retrouve un thème placé au même instant", () => {
    const a = cases([...bruit(1, 50), ...THEME, ...bruit(2, 200)]);
    const b = cases([...bruit(3, 50), ...THEME, ...bruit(4, 200)]);
    const segment = segmentCommun(a, b);
    expect(segment).not.toBeNull();
    expect(segment!.debutA).toBeCloseTo(5, 0);
    expect(segment!.debutB).toBeCloseTo(5, 0);
    expect(segment!.dureeSecondes).toBeGreaterThanOrEqual(28);
    expect(segment!.score).toBeGreaterThanOrEqual(SEUIL_CORRELATION);
  });

  it("retrouve un thème décalé, ce qui est le cas courant", () => {
    // Un épisode ouvre sur un résumé, l'autre entre directement dans une scène : le thème n'est pas
    // au même instant, et c'est bien pourquoi il faut chercher l'alignement avant de mesurer.
    const a = cases([...bruit(1, 20), ...THEME, ...bruit(2, 250)]);
    const b = cases([...bruit(3, 180), ...THEME, ...bruit(4, 90)]);
    const segment = segmentCommun(a, b);
    expect(segment).not.toBeNull();
    expect(segment!.debutA).toBeCloseTo(2, 0);
    expect(segment!.debutB).toBeCloseTo(18, 0);
    expect(segment!.dureeSecondes).toBeGreaterThanOrEqual(28);
  });

  it("ne trouve rien entre deux épisodes sans thème commun", () => {
    // Le refus est le comportement voulu : proposer de passer une introduction qui n'existe pas
    // couperait une scène. Ne rien proposer ne coûte rien.
    const a = cases(bruit(11, 400));
    const b = cases(bruit(12, 400));
    expect(segmentCommun(a, b)).toBeNull();
  });

  it("ne prend pas un silence partagé pour un générique", () => {
    // Deux épisodes qui commencent par trois secondes de silence se ressemblent parfaitement pendant
    // ces trois secondes. C'est une coïncidence, pas un thème : la longueur minimale l'écarte.
    const silence = new Array(30).fill(-6);
    const a = cases([...silence, ...bruit(21, 400)]);
    const b = cases([...silence, ...bruit(22, 400)]);
    expect(segmentCommun(a, b)).toBeNull();
  });

  it("écarte un segment trop long pour être un générique", () => {
    // Deux copies du même épisode, ou un doublon rangé sous deux noms : le segment couvre tout, et
    // ce n'est pas une introduction.
    const entier = bruit(31, 4000);
    expect(segmentCommun(cases(entier), cases(entier))).toBeNull();
  });

  it("tolère une différence de niveau entre deux épisodes", () => {
    // Un remaster, un autre mixage : le thème est le même à un gain près. La corrélation ne regarde
    // que la forme, pas le volume — c'est précisément pourquoi elle est employée ici.
    const a = cases([...bruit(1, 50), ...THEME, ...bruit(2, 200)]);
    const plusFort = THEME.map((valeur) => valeur * 1.6 + 0.4);
    const b = cases([...bruit(3, 50), ...plusFort, ...bruit(4, 200)]);
    const segment = segmentCommun(a, b);
    expect(segment).not.toBeNull();
    expect(segment!.dureeSecondes).toBeGreaterThanOrEqual(28);
  });

  it("ne conclut rien sur des extraits trop courts", () => {
    expect(segmentCommun(cases(bruit(1, 5)), cases(bruit(2, 5)))).toBeNull();
  });
});

describe("enveloppe du son", () => {
  it("résume l'énergie à dix valeurs par seconde", () => {
    const frequence = 8000;
    const echantillons = new Int16Array(frequence * 3);
    for (let index = 0; index < echantillons.length; index += 1) {
      echantillons[index] = Math.round(Math.sin(index / 12) * 8000);
    }
    const cases_ = enveloppe(echantillons, frequence);
    expect(cases_.length).toBe(secondes(3));
    // Un signal d'amplitude constante donne une enveloppe plate.
    const premier = cases_[5] ?? 0;
    for (const valeur of cases_.slice(5, 25)) expect(valeur).toBeCloseTo(premier, 2);
  });

  it("le silence ne produit pas d'infini", () => {
    // Le logarithme d'un zéro exact vaudrait moins l'infini et empoisonnerait toute corrélation qui
    // le rencontre. Le plancher est là pour ça.
    const cases_ = enveloppe(new Int16Array(8000), 8000);
    for (const valeur of cases_) expect(Number.isFinite(valeur)).toBe(true);
  });

  it("distingue un passage fort d'un passage faible", () => {
    const frequence = 8000;
    const echantillons = new Int16Array(frequence * 2);
    for (let index = 0; index < frequence; index += 1) echantillons[index] = 12_000;
    for (let index = frequence; index < echantillons.length; index += 1) echantillons[index] = 200;
    const cases_ = enveloppe(echantillons, frequence);
    expect(cases_[2] ?? 0).toBeGreaterThan(cases_[15] ?? 0);
  });
});
