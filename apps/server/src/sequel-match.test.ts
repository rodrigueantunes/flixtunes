import { describe, expect, it } from "vitest";
import { marqueursDeRang, scoreSuite, separerRangSuite } from "./sequel-match.js";
import { MATCH_THRESHOLDS } from "./match-engine.js";

/**
 * Suites nommées par leur numéro — cas relevé sur la médiathèque réelle.
 *
 * `Dune 2 (2024).mkv` et `Ant-Man 2 (2018).mkv` : le titre officiel n'affiche pas ce numéro. Le bon
 * film ressortait à 0,615 et 0,731, sous le seuil d'acceptation, et il fallait corriger à la main.
 * L'erreur inverse guette : en retirant le « 2 », la recherche tombe exactement sur le premier volet.
 */
describe("rang d'une suite", () => {
  it("sépare le titre de base et le numéro", () => {
    expect(separerRangSuite("Dune 2")).toEqual({ base: "Dune", rang: 2 });
    expect(separerRangSuite("Ant-Man 2")).toEqual({ base: "Ant-Man", rang: 2 });
    expect(separerRangSuite("Camping 3")).toEqual({ base: "Camping", rang: 3 });
    expect(separerRangSuite("Jurassic Park II")).toEqual({ base: "Jurassic Park", rang: 2 });
  });

  it("ignore un titre sans numéro", () => {
    expect(separerRangSuite("Dune")).toBeNull();
    expect(separerRangSuite("Batman Begins")).toBeNull();
  });

  it("ignore un « 1 », qui ne se dit pas", () => {
    // Aucun film ne s'appelle « Dune 1 » chez un fournisseur : le retenir ferait chercher une suite
    // là où il n'y en a pas.
    expect(separerRangSuite("Dune 1")).toBeNull();
  });

  it("ignore un nombre trop grand pour être un rang", () => {
    // « Blade Runner 2049 » n'est pas la 2049e suite, et « 1917 » n'est pas une suite du tout.
    expect(separerRangSuite("Blade Runner 2049")).toBeNull();
    expect(separerRangSuite("1917")).toBeNull();
  });

  it("traite un nombre du titre comme un rang, sans dommage", () => {
    // « Ocean's 11 » n'est pas une suite, et pourtant la règle s'y applique. C'est sans conséquence :
    // la confirmation reste exigée, et elle joue même en notre faveur — le titre officiel est
    // « Ocean's Eleven », que l'année vient confirmer. Refuser tout nombre supérieur à dix priverait
    // de cette correspondance sans rien protéger.
    expect(separerRangSuite("Ocean's 11")).toEqual({ base: "Ocean's", rang: 11 });
    expect(scoreSuite("Ocean's 11", { title: "Ocean's Eleven", year: 2001 }, 2001))
      .toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("connaît les façons d'exprimer un rang", () => {
    const marqueurs = marqueursDeRang(2);
    for (const attendu of ["2", "ii", "deuxieme", "two", "second"]) {
      expect(marqueurs, attendu).toContain(attendu);
    }
  });
});

describe("score accordé à une suite", () => {
  it("reconnaît le rang exprimé en toutes lettres", () => {
    // « Dune : Deuxième partie » : rien d'autre ne porte ce titre, la confiance peut être forte.
    const score = scoreSuite("Dune 2", { title: "Dune : Deuxième partie", year: 2024 }, 2024);
    expect(score).toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("reconnaît un rang en chiffres romains", () => {
    expect(scoreSuite("Rocky 2", { title: "Rocky II", year: 1979 }, 1979))
      .toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("se contente de l'année quand le titre n'exprime pas le rang", () => {
    // « Ant-Man et la Guêpe » ne dit nulle part qu'il s'agit du deuxième : l'année exacte confirme.
    const score = scoreSuite("Ant-Man 2", { title: "Ant-Man et la Guêpe", year: 2018 }, 2018);
    expect(score).toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("reconnaît une franchise placée après le sous-titre officiel", () => {
    expect(scoreSuite("Jurassic Park II", {
      title: "Le Monde perdu : Jurassic Park", originalTitle: "The Lost World: Jurassic Park", year: 1997,
    }, 1997)).toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("refuse le premier volet, qui porte exactement le titre de base", () => {
    // C'est l'erreur à éviter avant toutes les autres : sans cette règle, « Dune 2 » privé de son
    // numéro tombe sur « Dune » avec un score parfait.
    expect(scoreSuite("Dune 2", { title: "Dune", year: 2021 }, 2024)).toBeNull();
    expect(scoreSuite("Ant-Man 2", { title: "Ant-Man", year: 2015 }, 2018)).toBeNull();
  });

  it("refuse un titre qui ne commence pas par la base", () => {
    expect(scoreSuite("Dune 2", { title: "Les Enfants de Dune", year: 2003 }, 2024)).toBeNull();
  });

  it("refuse une suite dont l'année ne correspond pas et qui n'exprime pas le rang", () => {
    // Sans confirmation, on ne tranche pas : c'est le rôle de l'écran de correspondance.
    expect(scoreSuite("Ant-Man 2", { title: "Ant-Man et la Guêpe", year: 2018 }, 2015)).toBeNull();
  });

  it("accepte le titre original quand le titre traduit ne dit rien", () => {
    const score = scoreSuite("Dune 2", { title: "Dune, la suite", originalTitle: "Dune: Part Two", year: 2024 }, 2024);
    expect(score).toBeGreaterThan(MATCH_THRESHOLDS.automatic);
  });

  it("ne s'applique pas à un titre sans numéro", () => {
    expect(scoreSuite("Dune", { title: "Dune", year: 2021 }, 2021)).toBeNull();
  });
});
