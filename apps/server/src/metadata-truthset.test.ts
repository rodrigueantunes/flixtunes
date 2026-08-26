import { describe, expect, it } from "vitest";
import { bestAutomaticMatch, evaluateTruthSet, truthSet } from "./metadata-truthset.js";

describe("jeu de vérité de la fédération", () => {
  it("couvre films, séries et documentaires", () => {
    for (const kind of ["movie", "tv", "documentary"] as const) {
      expect(truthSet.some((entry) => entry.kind === kind), `nature ${kind}`).toBe(true);
    }
    expect(truthSet.length).toBeGreaterThanOrEqual(12);
  });

  it("atteint la couverture attendue sans aucun faux positif", () => {
    const metrics = evaluateTruthSet();
    expect(metrics.coverage).toBe(1);
    expect(metrics.falsePositives).toBe(0);
    expect(metrics.falsePositiveRate).toBe(0);
  });

  it("départage deux homonymes par l'année", () => {
    const homonym = truthSet.find((entry) => entry.id === "film-homonyme-annee-differente")!;
    expect(bestAutomaticMatch(homonym).id).toBe("recent");
  });

  it("fait primer un identifiant croisé sur la ressemblance de titre", () => {
    const crossed = truthSet.find((entry) => entry.id === "film-identifiant-croise")!;
    const best = bestAutomaticMatch(crossed);
    expect(best.id).toBe("550");
    expect(best.score).toBe(1);
  });

  it("s'abstient plutôt que d'accepter une correspondance douteuse", () => {
    for (const id of ["film-annee-eloignee-refusee", "film-titre-sans-rapport-refuse", "aucun-resultat"]) {
      const abstained = truthSet.find((entry) => entry.id === id)!;
      expect(bestAutomaticMatch(abstained).id, id).toBeNull();
    }
  });

  it("tolère accents et casse dans le titre", () => {
    const accented = truthSet.find((entry) => entry.id === "serie-accent-et-casse")!;
    expect(bestAutomaticMatch(accented).id).toBe("9");
  });

  it("documente chaque cas délicat par une note", () => {
    const tricky = truthSet.filter((entry) => entry.expected === null);
    expect(tricky.every((entry) => Boolean(entry.note))).toBe(true);
  });
});
