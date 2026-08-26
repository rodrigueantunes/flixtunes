import { describe, expect, it } from "vitest";
import {
  AMBIGUITY_MARGIN, applySeasonEvidence, needsSeasonEvidence, type ScoredCandidate,
} from "./season-evidence.js";

/**
 * Le cas qui a motivé cet indice : un dossier nommé « Daredevil » contenant trois dossiers de
 * saisons. « Daredevil : Born Again » n'a qu'une saison, « Daredevil » 2015 en a trois — le disque
 * tranche là où les titres se ressemblent trop.
 *
 * La contrainte inverse compte tout autant : une médiathèque incomplète est la norme, et l'indice ne
 * doit jamais faire échouer une correspondance qui fonctionnait.
 */

const bornAgain: ScoredCandidate = { externalId: "born-again", score: 0.88 };
const daredevil2015: ScoredCandidate = { externalId: "daredevil-2015", score: 0.84 };

describe("faut-il consulter le nombre de saisons ?", () => {
  it("oui lorsque deux candidats sont au coude à coude", () => {
    expect(needsSeasonEvidence([bornAgain, daredevil2015], 3)).toBe(true);
  });

  it("non lorsqu'un candidat gagne nettement", () => {
    // On ne paie pas de requêtes de détail, et surtout on ne risque pas de déclasser une bonne
    // correspondance pour un indice dont on n'a pas besoin.
    expect(needsSeasonEvidence([{ ...bornAgain, score: 0.97 }, { ...daredevil2015, score: 0.55 }], 3)).toBe(false);
  });

  it("non lorsque le disque ne montre qu'une saison", () => {
    // Toute série en possède au moins une : l'observation ne distingue rien.
    expect(needsSeasonEvidence([bornAgain, daredevil2015], 1)).toBe(false);
    expect(needsSeasonEvidence([bornAgain, daredevil2015], 0)).toBe(false);
  });

  it("non lorsqu'il n'y a rien à départager", () => {
    expect(needsSeasonEvidence([bornAgain], 3)).toBe(false);
    expect(needsSeasonEvidence([], 3)).toBe(false);
  });

  it("place la bascule sur la marge annoncée", () => {
    const proche: ScoredCandidate = { ...daredevil2015, score: bornAgain.score - AMBIGUITY_MARGIN + 0.001 };
    const loin: ScoredCandidate = { ...daredevil2015, score: bornAgain.score - AMBIGUITY_MARGIN };
    expect(needsSeasonEvidence([bornAgain, proche], 3)).toBe(true);
    expect(needsSeasonEvidence([bornAgain, loin], 3)).toBe(false);
  });
});

describe("classement à la lumière des saisons présentes", () => {
  it("fait passer devant la série qui peut contenir ce que le disque montre", () => {
    const classe = applySeasonEvidence([bornAgain, daredevil2015], 3,
      new Map([["born-again", 1], ["daredevil-2015", 3]]));
    expect(classe[0]?.externalId, "trois dossiers de saisons excluent une série qui n'en a qu'une").toBe("daredevil-2015");
  });

  it("n'écarte jamais un candidat, il le déclasse seulement", () => {
    // Une médiathèque incomplète reste identifiable : le candidat pénalisé garde un score utilisable.
    const classe = applySeasonEvidence([bornAgain, daredevil2015], 3,
      new Map([["born-again", 1], ["daredevil-2015", 3]]));
    const penalise = classe.find((candidate) => candidate.externalId === "born-again");
    expect(penalise?.score).toBeGreaterThan(0.7);
    expect(classe).toHaveLength(2);
  });

  it("ne touche à rien quand le fournisseur ignore le nombre de saisons", () => {
    // L'ignorance ne se paie pas : un fournisseur avare de métadonnées ne doit pas être pénalisé.
    const classe = applySeasonEvidence([bornAgain, daredevil2015], 3, new Map());
    expect(classe.map((candidate) => candidate.externalId)).toEqual(["born-again", "daredevil-2015"]);
    expect(classe[0]?.score).toBe(bornAgain.score);
  });

  it("pénalise d'autant plus que l'écart est grand", () => {
    const uneSaison = applySeasonEvidence([{ externalId: "a", score: 0.8 }], 5, new Map([["a", 1]]));
    const quatreSaisons = applySeasonEvidence([{ externalId: "a", score: 0.8 }], 5, new Map([["a", 4]]));
    expect(uneSaison[0]!.score).toBeLessThan(quatreSaisons[0]!.score);
  });

  it("récompense un fournisseur qui annonce davantage de saisons que le disque", () => {
    // Cas courant : la médiathèque est incomplète, la série existe bel et bien avec plus de saisons.
    const classe = applySeasonEvidence([{ externalId: "a", score: 0.8 }], 2, new Map([["a", 6]]));
    expect(classe[0]!.score).toBeGreaterThan(0.8);
  });

  it("reste sans effet en dessous de deux saisons observées", () => {
    const classe = applySeasonEvidence([bornAgain, daredevil2015], 1,
      new Map([["born-again", 1], ["daredevil-2015", 3]]));
    expect(classe.map((candidate) => candidate.externalId)).toEqual(["born-again", "daredevil-2015"]);
  });

  it("ne dépasse jamais un score de 1", () => {
    const classe = applySeasonEvidence([{ externalId: "a", score: 0.99 }], 2, new Map([["a", 9]]));
    expect(classe[0]!.score).toBeLessThanOrEqual(1);
  });
});

describe("comptage des dossiers de saisons", () => {
  it("reconnaît les formes usuelles et ignore le reste", async () => {
    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { countSeasonFolders } = await import("./scanner.js");
    const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-saisons-"));
    const serie = path.join(racine, "Daredevil");
    for (const nom of ["Saison 1", "Season 02", "S03", "Bonus", "Sous-titres"]) {
      await mkdir(path.join(serie, nom), { recursive: true });
    }
    const episode = path.join(serie, "Saison 1", "episode.mkv");
    await writeFile(episode, "x");
    // Trois dossiers de saisons, malgré deux dossiers voisins qui n'en sont pas.
    expect(await countSeasonFolders(episode)).toBe(3);
  });
});
