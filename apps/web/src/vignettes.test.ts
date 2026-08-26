import { describe, expect, it } from "vitest";

import {
  debutDePlanche, placerVignette, VIGNETTE_COLONNES, VIGNETTE_HAUTEUR, VIGNETTE_INTERVALLE_S,
  VIGNETTE_LARGEUR, VIGNETTE_SECONDES_PAR_PLANCHE,
} from "@flixtunes/contracts";

/**
 * La géométrie des planches de vignettes.
 *
 * Le serveur pose les vignettes, l'interface les découpe : les deux doivent s'accorder au pixel près.
 * Un décalage ne produit aucune erreur — il montre simplement la mauvaise image, ce qui se remarque
 * mal et se diagnostique encore plus mal. D'où ces cas, qui fixent l'accord.
 */
describe("placement d'une vignette", () => {
  it("la première image est en haut à gauche de la première planche", () => {
    expect(placerVignette(0)).toEqual({ planche: 0, decalageX: 0, decalageY: 0 });
  });

  it("avance d'une case toutes les dix secondes", () => {
    expect(placerVignette(VIGNETTE_INTERVALLE_S)).toMatchObject({ planche: 0, decalageX: -VIGNETTE_LARGEUR, decalageY: 0 });
    expect(placerVignette(VIGNETTE_INTERVALLE_S * 2)).toMatchObject({ decalageX: -VIGNETTE_LARGEUR * 2 });
  });

  it("passe à la ligne suivante après une rangée complète", () => {
    const apresUneRangee = VIGNETTE_INTERVALLE_S * VIGNETTE_COLONNES;
    expect(placerVignette(apresUneRangee)).toMatchObject({ planche: 0, decalageX: 0, decalageY: -VIGNETTE_HAUTEUR });
  });

  it("change de planche au bout de mille secondes", () => {
    expect(placerVignette(VIGNETTE_SECONDES_PAR_PLANCHE - 1).planche).toBe(0);
    expect(placerVignette(VIGNETTE_SECONDES_PAR_PLANCHE)).toEqual({ planche: 1, decalageX: 0, decalageY: 0 });
  });

  it("situe un instant quelconque d'un long film", () => {
    // 1 h 05 min 25 s : neuvième seconde de la vingt-troisième case de la quatrième planche.
    const placement = placerVignette(3925);
    expect(placement.planche).toBe(3);
    expect(placement.decalageX).toBe(-2 * VIGNETTE_LARGEUR);
    expect(placement.decalageY).toBe(-9 * VIGNETTE_HAUTEUR);
  });

  it("ramène au début plutôt que de ne rien montrer", () => {
    // Le survol produit des valeurs aberrantes en bord de barre : mieux vaut la première image
    // qu'une case vide.
    for (const aberrant of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(placerVignette(aberrant)).toEqual({ planche: 0, decalageX: 0, decalageY: 0 });
    }
  });
});

describe("début d'une planche", () => {
  it("suit le découpage en milliers de secondes", () => {
    expect(debutDePlanche(0)).toBe(0);
    expect(debutDePlanche(3)).toBe(3 * VIGNETTE_SECONDES_PAR_PLANCHE);
  });

  it("ne recule jamais avant le début du film", () => {
    expect(debutDePlanche(-2)).toBe(0);
  });

  it("s'accorde avec le placement", () => {
    // C'est l'accord qui compte : la planche que l'interface demande doit couvrir l'instant survolé.
    for (const instant of [0, 137, 999, 1000, 5432, 7199]) {
      const { planche } = placerVignette(instant);
      expect(debutDePlanche(planche)).toBeLessThanOrEqual(instant);
      expect(debutDePlanche(planche) + VIGNETTE_SECONDES_PAR_PLANCHE).toBeGreaterThan(instant);
    }
  });
});
