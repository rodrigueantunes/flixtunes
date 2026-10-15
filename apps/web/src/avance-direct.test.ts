import { describe, expect, it } from "vitest";
import { avanceVisee, doitReprendreAuBordArriere, repriseAuBordArriere, segmentsDAvance } from "./avance-direct";

/**
 * L'avance a deux devoirs contraires : être la plus grande possible, et ne jamais sortir de ce que la
 * chaîne publie. Les fenêtres ci-dessous sont celles qu'on rencontre dans le corpus.
 */
describe("l'avance derrière le direct", () => {
  it("reste dans une fenêtre incomplète ou un segment de plus d'une minute", () => {
    for (const fenetre of [0, 1, 5, 15, 100, 600]) {
      for (const segment of [1, 8, 20, 90]) {
        const avance = avanceVisee(fenetre, segment, true);
        expect(avance).toBeGreaterThanOrEqual(0);
        expect(avance).toBeLessThanOrEqual(Math.min(60, fenetre));
      }
    }
  });
  it("reste à 40 s pour une source qui n'a jamais calé, et monte à 60 s pour une fragile", () => {
    // Une fenêtre de cinq minutes, en segments de 9 s : CNews, mesurée.
    expect(avanceVisee(300, 9, false)).toBe(40);
    expect(avanceVisee(300, 9, true)).toBe(60);
    expect(segmentsDAvance(300, 9, false)).toBe(4);
    expect(segmentsDAvance(300, 9, true)).toBe(6);
  });

  it("ne dépasse pas ce que permet la fenêtre médiane, même pour une source fragile", () => {
    // 61 s de fenêtre moins 20 s de marge arrière : 41 s, et pas une de plus.
    expect(avanceVisee(61, 8, false)).toBe(40);
    expect(avanceVisee(61, 8, true)).toBe(41);
  });

  it("ne pousse jamais le point de lecture hors d'une fenêtre courte", () => {
    // Le plancher de deux segments ferait 16 s ; la fenêtre n'en laisse que 12 derrière le bord.
    expect(avanceVisee(20, 8, true)).toBe(12);
    expect(avanceVisee(20, 8, true)).toBeLessThan(20);
  });
});

describe("reprise au bord arrière (r12)", () => {
  it("ne bouge que lorsque la fenêtre l'impose, jamais pour un simple retard", () => {
    // CNews : fenêtre de cinq minutes, segments de 8 s. Un retard de deux minutes ne fait plus rien.
    expect(doitReprendreAuBordArriere(180, 313, 8)).toBe(false);
    expect(doitReprendreAuBordArriere(30, 313, 8)).toBe(false);
    expect(doitReprendreAuBordArriere(10, 313, 8)).toBe(true);
    // Fenêtre trop courte pour avoir un bord arrière distinct : on n'y touche pas.
    expect(doitReprendreAuBordArriere(5, 36, 8)).toBe(false);
    expect(doitReprendreAuBordArriere(0, 313, 8)).toBe(false);
  });
  it("reprend au plus près du bord, et non à l'avance visée", () => {
    // Sur cinq minutes de fenêtre : 24 s du bord arrière, et non 40 s du direct — 4 min épargnées.
    expect(repriseAuBordArriere(313, 8)).toBe(24);
    expect(repriseAuBordArriere(61, 8)).toBe(24);
    expect(repriseAuBordArriere(61, 10)).toBe(30);
    expect(repriseAuBordArriere(30, 8)).toBe(22);
  });
});
