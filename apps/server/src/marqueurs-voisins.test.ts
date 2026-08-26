import { describe, expect, it } from "vitest";
import { deduireDesVoisins, DISPERSION_MAXIMALE, VOISINS_MINIMUM, type RepereConnu } from "./marqueurs-voisins.js";

/**
 * Déduire les génériques d'un épisode de ceux de ses voisins.
 *
 * Le raisonnement tient à une observation mesurée : dans une saison, la durée du générique de fin
 * varie d'un écart absolu médian de **0,5 seconde** d'un épisode à l'autre. Ce qui vaut pour trois
 * épisodes vaut pour les neuf autres — et cela ne coûte rien, aucun fichier n'étant relu.
 *
 * Ces cas fixent surtout ce que la déduction **refuse** : elle est plus prudente qu'un chapitre
 * nommé, parce qu'un indice n'est pas une affirmation.
 */
const voisin = (extra: Partial<RepereConnu> = {}): RepereConnu => ({
  dureeSecondes: 1500, creditsStartSeconds: 1440, introStartSeconds: 30, introEndSeconds: 110, ...extra,
});

describe("déduction depuis les voisins de saison", () => {
  it("déduit le générique de fin par sa durée, non par sa position", () => {
    // Deux épisodes d'une même saison n'ont pas la même longueur, mais leur carton de fin dure le
    // même temps. Ici les voisins finissent à 1 500 s avec 60 s de générique ; l'épisode visé dure
    // 1 800 s, donc son générique commence à 1 740 s — et non à 1 440.
    const deduction = deduireDesVoisins(1800, [voisin(), voisin(), voisin()]);
    expect(deduction.creditsStartSeconds).toBe(1740);
  });

  it("déduit l'introduction par ses bornes, qui sont alignées", () => {
    const deduction = deduireDesVoisins(1800, [voisin(), voisin(), voisin()]);
    expect(deduction.introStartSeconds).toBe(30);
    expect(deduction.introEndSeconds).toBe(110);
  });

  it("une médiane résiste à un intrus", () => {
    // Un épisode double, ou un chapitre mal nommé, ne doit pas emporter toute la saison. Ce cas a
    // révélé un défaut de conception : mesurée à l'écart-type, la dispersion explosait sur cet unique
    // intrus et la saison entière était rejetée. L'écart absolu médian l'ignore.
    const deduction = deduireDesVoisins(1500, [
      voisin(), voisin(), voisin(),
      voisin({ creditsStartSeconds: 900, introStartSeconds: 400, introEndSeconds: 500 }),
    ]);
    expect(deduction.creditsStartSeconds).toBe(1440);
    expect(deduction.introStartSeconds).toBe(30);
  });

  it("ne conclut rien sur trop peu de voisins", () => {
    // Deux valeurs suffiraient à faire une moyenne, et c'est le problème : elles ne disent rien de
    // leur dispersion.
    for (let nombre = 0; nombre < VOISINS_MINIMUM; nombre += 1) {
      const deduction = deduireDesVoisins(1500, Array.from({ length: nombre }, () => voisin()));
      expect(deduction.creditsStartSeconds, `${nombre} voisin(s)`).toBeNull();
      expect(deduction.introStartSeconds, `${nombre} voisin(s)`).toBeNull();
    }
  });

  it("refuse une saison dispersée : ce n'est pas une saison régulière", () => {
    // Un lot hétéroclite rangé sous un même titre : ici la dispersion est générale, pas ponctuelle.
    // Le 90ᵉ centile mesuré est à 8,2 s ; au-delà de dix, la médiane ne représente plus rien.
    const disperses = [
      voisin({ creditsStartSeconds: 1440 }),
      voisin({ creditsStartSeconds: 1400 }),
      voisin({ creditsStartSeconds: 1350 }),
      voisin({ creditsStartSeconds: 1290 }),
    ];
    expect(deduireDesVoisins(1500, disperses).creditsStartSeconds).toBeNull();
  });

  it("accepte une saison à peine irrégulière", () => {
    const proches = [
      voisin({ creditsStartSeconds: 1440 }),
      voisin({ creditsStartSeconds: 1445 }),
      voisin({ creditsStartSeconds: 1437 }),
    ];
    const deduction = deduireDesVoisins(1500, proches);
    expect(deduction.creditsStartSeconds).not.toBeNull();
    expect(deduction.creditsStartSeconds!).toBeGreaterThan(1430);
  });

  it("applique les mêmes bornes que le repère qu'elle imite", () => {
    // Un générique déduit qui tomberait au milieu du film, ou qui durerait dix secondes, n'est pas
    // plus recevable qu'un chapitre nommé au même endroit.
    const tresLong = [voisin({ creditsStartSeconds: 800 }), voisin({ creditsStartSeconds: 800 }), voisin({ creditsStartSeconds: 800 })];
    expect(deduireDesVoisins(1500, tresLong).creditsStartSeconds, "générique de 700 s").toBeNull();
    const tresCourt = [voisin({ creditsStartSeconds: 1495 }), voisin({ creditsStartSeconds: 1495 }), voisin({ creditsStartSeconds: 1495 })];
    expect(deduireDesVoisins(1500, tresCourt).creditsStartSeconds, "générique de 5 s").toBeNull();
  });

  it("un épisode bien plus court que ses voisins n'hérite pas de leur générique", () => {
    // Le récapitulatif d'une saison, rangé avec les épisodes : 300 s pour un générique de 60 s
    // laisserait un repère à 80 % de sa durée, ce que la borne rattrape.
    expect(deduireDesVoisins(200, [voisin(), voisin(), voisin()]).creditsStartSeconds).toBeNull();
  });

  it("ne déduit rien sans durée", () => {
    for (const duree of [0, -1, Number.NaN]) {
      expect(deduireDesVoisins(duree, [voisin(), voisin(), voisin()]).creditsStartSeconds).toBeNull();
    }
  });

  it("les deux repères sont indépendants", () => {
    // Une saison peut nommer ses introductions sans nommer ses génériques de fin.
    const sansFin = [voisin({ creditsStartSeconds: null }), voisin({ creditsStartSeconds: null }), voisin({ creditsStartSeconds: null })];
    const deduction = deduireDesVoisins(1500, sansFin);
    expect(deduction.creditsStartSeconds).toBeNull();
    expect(deduction.introStartSeconds).toBe(30);
  });

  it("la dispersion tolérée est celle qui a été mesurée", () => {
    expect(DISPERSION_MAXIMALE).toBe(10);
  });
});
