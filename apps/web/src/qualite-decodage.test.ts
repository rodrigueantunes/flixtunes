import { describe, expect, it } from "vitest";

import {
  decodageDegrade, type EchantillonDecodage, FENETRES_AVANT_REPLI, IMAGES_MINIMUM_PAR_FENETRE,
  pertesDeLaFenetre, SEUIL_IMAGES_PERDUES,
} from "./qualite-decodage";

/**
 * Ce qui distingue une saccade visible d'une perte sans conséquence.
 *
 * L'enjeu est double et symétrique : ne pas laisser une image hachée sans réagir, et ne pas basculer
 * une lecture parfaite en conversion pour quelques images perdues au démarrage. Les deux erreurs se
 * paient, et la seconde se paie plus souvent.
 */
function serie(...parts: Array<{ images: number; perdues: number }>): EchantillonDecodage[] {
  const echantillons: EchantillonDecodage[] = [{ total: 0, perdues: 0 }];
  for (const part of parts) {
    const dernier = echantillons[echantillons.length - 1]!;
    echantillons.push({ total: dernier.total + part.images, perdues: dernier.perdues + part.perdues });
  }
  return echantillons;
}

describe("part d'images perdues sur une fenêtre", () => {
  it("compare un relevé au précédent, pas au début de la lecture", () => {
    // Le cumul dilue : cent images perdues au démarrage disparaissent après dix minutes de lecture
    // parfaite, et suffisent pourtant à condamner une lecture qui vient de commencer.
    expect(pertesDeLaFenetre({ total: 1000, perdues: 100 }, { total: 1100, perdues: 100 })).toBe(0);
    expect(pertesDeLaFenetre({ total: 1000, perdues: 0 }, { total: 1100, perdues: 10 })).toBeCloseTo(0.1);
  });

  it("ne conclut rien sur une fenêtre trop pauvre", () => {
    // Onglet masqué, lecture en pause : deux images perdues sur trois feraient soixante-six pour cent.
    expect(pertesDeLaFenetre({ total: 100, perdues: 0 }, { total: 103, perdues: 2 })).toBeNull();
    expect(pertesDeLaFenetre({ total: 100, perdues: 0 }, { total: 100, perdues: 0 })).toBeNull();
  });

  it("ne conclut rien quand les compteurs repartent de zéro", () => {
    // Un nouvel élément vidéo remet les compteurs à zéro ; la différence deviendrait négative et le
    // rapport, absurde.
    expect(pertesDeLaFenetre({ total: 5000, perdues: 120 }, { total: 40, perdues: 0 })).toBeNull();
  });
});

describe("décrochage du décodeur", () => {
  it("conclut après trois fenêtres consécutives au-dessus du seuil", () => {
    // Plus d'une image perdue par seconde à vingt-quatre images par seconde, tenu trois secondes :
    // c'est une saccade que l'œil voit, et la session convertie devient le moindre mal.
    const echantillons = serie(
      { images: 24, perdues: 3 }, { images: 24, perdues: 3 }, { images: 24, perdues: 3 },
    );
    expect(echantillons).toHaveLength(FENETRES_AVANT_REPLI + 1);
    expect(decodageDegrade(echantillons)).toBe(true);
  });

  it("ne conclut pas sur deux mauvaises fenêtres", () => {
    // Un fichier qui s'ouvre, une scène dense : deux fenêtres ne disent pas encore que le décodeur
    // ne tient pas la cadence.
    expect(decodageDegrade(serie({ images: 24, perdues: 6 }, { images: 24, perdues: 6 }))).toBe(false);
  });

  it("oublie une mauvaise fenêtre dès que la suivante est bonne", () => {
    // La série doit être consécutive. Une saccade isolée au changement de scène ne condamne pas la
    // lecture — sinon toute lecture finirait convertie.
    const echantillons = serie(
      { images: 24, perdues: 6 }, { images: 24, perdues: 6 }, { images: 24, perdues: 0 },
      { images: 24, perdues: 6 },
    );
    expect(decodageDegrade(echantillons)).toBe(false);
  });

  it("laisse passer une perte réelle mais imperceptible", () => {
    // Une image perdue sur cent est une perte ; ce n'est pas une gêne. Basculer coûterait davantage
    // que de la laisser passer.
    const echantillons = serie(
      { images: 100, perdues: 1 }, { images: 100, perdues: 1 }, { images: 100, perdues: 1 },
    );
    expect(1 / 100).toBeLessThan(SEUIL_IMAGES_PERDUES);
    expect(decodageDegrade(echantillons)).toBe(false);
  });

  it("ne conclut rien tant que la mesure est trop courte", () => {
    // Au démarrage, il n'y a pas encore de quoi juger : le silence vaut mieux qu'un verdict hâtif.
    expect(decodageDegrade([])).toBe(false);
    expect(decodageDegrade(serie({ images: 24, perdues: 12 }))).toBe(false);
    expect(decodageDegrade(serie({ images: 24, perdues: 12 }, { images: 24, perdues: 12 }))).toBe(false);
  });

  it("ne se laisse pas convaincre par des fenêtres vides", () => {
    // Un onglet masqué produit des fenêtres où tout est perdu sur presque rien. Elles interrompent la
    // série au lieu de la nourrir.
    const creuse = IMAGES_MINIMUM_PAR_FENETRE - 1;
    const echantillons = serie(
      { images: creuse, perdues: creuse }, { images: creuse, perdues: creuse },
      { images: creuse, perdues: creuse },
    );
    expect(decodageDegrade(echantillons)).toBe(false);
  });

  it("ne juge que sur les fenêtres les plus récentes", () => {
    // Une lecture longue qui décroche à la fin doit basculer, même après des heures de bonne tenue.
    const echantillons = serie(
      { images: 2400, perdues: 0 }, { images: 2400, perdues: 0 },
      { images: 24, perdues: 3 }, { images: 24, perdues: 3 }, { images: 24, perdues: 3 },
    );
    expect(decodageDegrade(echantillons)).toBe(true);
  });
});
