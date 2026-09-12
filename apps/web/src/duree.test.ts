import { describe, expect, it } from "vitest";
import { dureeLisible } from "./duree";

/**
 * La durée d'une vidéo web, au format `hh:mm:ss`.
 *
 * Les valeurs viennent de la médiathèque réelle, où la durée enregistrée est celle du fichier : une
 * émission de 4 994 secondes, une compilation de près de cinq heures.
 */
describe("durée d'une vidéo", () => {
  it("écrit toujours les heures, pour que les durées s'alignent", () => {
    expect(dureeLisible(754)).toBe("00:12:34");
    expect(dureeLisible(4994)).toBe("01:23:14");
    expect(dureeLisible(17584)).toBe("04:53:04");
  });

  it("dépasse vingt-quatre heures sans repartir à zéro", () => {
    expect(dureeLisible(90_000)).toBe("25:00:00");
  });

  it("arrondit la seconde que le sondage rend avec des décimales", () => {
    expect(dureeLisible(59.6)).toBe("00:01:00");
  });

  it("n'affiche rien pour une durée inconnue", () => {
    // Un « 00:00:00 » passerait pour une vraie mesure.
    expect(dureeLisible(null)).toBe("");
    expect(dureeLisible(undefined)).toBe("");
    expect(dureeLisible(0)).toBe("");
    expect(dureeLisible(Number.NaN)).toBe("");
  });
});
