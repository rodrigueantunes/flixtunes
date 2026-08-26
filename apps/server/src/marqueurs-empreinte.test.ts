import { describe, expect, it } from "vitest";
import { PAIRES_MINIMUM, repereParEmpreinte, TOLERANCE_SECONDES } from "./marqueurs-empreinte.js";

/**
 * Le consensus, qui distingue un générique d'un accident.
 *
 * La leçon vient d'un cas réel : sur *Bleach*, la paire E1/E2 donnait un segment de 65 s là où les
 * trois autres paires s'accordaient sur 105 s. Une seule comparaison ne prouve rien — une coupure
 * commune, un logo de studio, un silence partagé ressemblent à un thème tant qu'on ne les a vus
 * qu'une fois.
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

const THEME = bruit(7, 250);       // 25 s de thème
const cases = (valeurs: number[]) => Float64Array.from(valeurs);

/** Un épisode : du contenu propre, le thème à l'instant voulu, puis encore du contenu. */
const episode = (graine: number, debutCases: number) =>
  cases([...bruit(graine, debutCases), ...THEME, ...bruit(graine + 100, 600 - debutCases)]);

describe("consensus sonore d'une saison", () => {
  it("retient un thème que plusieurs témoins confirment", () => {
    const reference = episode(1, 100);
    const repere = repereParEmpreinte(reference, [episode(2, 300), episode(3, 50), episode(4, 420)]);
    expect(repere).not.toBeNull();
    expect(repere!.debutSecondes).toBeCloseTo(10, 0);
    expect(repere!.finSecondes).toBeCloseTo(35, 0);
    expect(repere!.paires).toBeGreaterThanOrEqual(PAIRES_MINIMUM);
  });

  it("écarte le témoin qui ne dit pas comme les autres", () => {
    // Exactement le cas de Bleach : une paire donne un segment tronqué, les autres s'accordent.
    // Le groupe le plus nombreux l'emporte — pas le premier venu, ni le plus long.
    const reference = episode(1, 100);
    const dissident = cases([...bruit(9, 250), ...THEME.slice(0, 130), ...bruit(10, 500)]);
    const repere = repereParEmpreinte(reference, [dissident, episode(3, 50), episode(4, 420)]);
    expect(repere).not.toBeNull();
    expect(repere!.finSecondes - repere!.debutSecondes).toBeCloseTo(25, 0);
  });

  it("refuse de conclure sur un seul témoin", () => {
    const reference = episode(1, 100);
    expect(repereParEmpreinte(reference, [episode(2, 300)])).toBeNull();
    expect(repereParEmpreinte(reference, [])).toBeNull();
  });

  it("refuse quand les témoins ne s'accordent pas entre eux", () => {
    // Deux segments communs différents, un par témoin : aucun groupe n'atteint deux voix.
    const autreTheme = bruit(77, 250);
    const reference = cases([...bruit(1, 100), ...THEME, ...bruit(2, 100), ...autreTheme, ...bruit(3, 200)]);
    const temoinA = cases([...bruit(4, 300), ...THEME, ...bruit(5, 300)]);
    const temoinB = cases([...bruit(6, 420), ...autreTheme, ...bruit(7, 200)]);
    const repere = repereParEmpreinte(reference, [temoinA, temoinB]);
    // Le désaccord doit se solder par un refus, ou au pire par le segment d'un seul groupe — jamais
    // par un mélange des deux.
    if (repere) expect(repere.finSecondes - repere.debutSecondes).toBeCloseTo(25, 0);
  });

  it("ne trouve rien dans une saison sans thème commun", () => {
    const reference = cases(bruit(1, 700));
    const repere = repereParEmpreinte(reference, [cases(bruit(2, 700)), cases(bruit(3, 700)), cases(bruit(4, 700))]);
    expect(repere).toBeNull();
  });

  it("la tolérance de regroupement est celle qui a été retenue", () => {
    expect(TOLERANCE_SECONDES).toBe(6);
    expect(PAIRES_MINIMUM).toBe(2);
  });
});
