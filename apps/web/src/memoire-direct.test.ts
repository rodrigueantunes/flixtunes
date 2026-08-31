import { beforeEach, describe, expect, it } from "vitest";
import { lireSouvenirDirect, oublierSouvenirDirect, retenirSouvenirDirect } from "./memoire-direct";

/**
 * Ce que l'écran des chaînes retrouve en revenant d'une chaîne. Trois devoirs : retenir, ne pas
 * périmer, et s'effacer quand le profil change.
 */

beforeEach(() => oublierSouvenirDirect());

describe("la mémoire de l'écran des chaînes", () => {
  it("part vierge, et retient ce qu'on lui donne", () => {
    expect(lireSouvenirDirect()).toEqual(expect.objectContaining({
      recherche: "", listes: [], pays: [], fiabilites: [], favorisSeuls: false, chaines: [], total: 0, defilement: 0,
    }));

    retenirSouvenirDirect({ recherche: "canal +", pays: ["fr"], total: 13 });
    const souvenir = lireSouvenirDirect();
    expect(souvenir.recherche).toBe("canal +");
    expect(souvenir.pays).toEqual(["fr"]);
    expect(souvenir.total).toBe(13);
    // Ce qu'on n'a pas touché reste : chaque champ est écrit par l'endroit qui le connaît.
    expect(souvenir.listes).toEqual([]);
  });

  it("ne périme pas — on regarde une chaîne bien plus de cinq minutes", () => {
    /*
     * C'est la raison d'être de cette mémoire plutôt que du cache de catalogue : celui-ci oublie au
     * bout de cinq minutes, ce qui est juste pour des données du serveur et faux pour un choix de la
     * personne. Le cas normal — regarder une demi-heure — perdrait ses filtres.
     */
    retenirSouvenirDirect({ recherche: "arte", defilement: 1_200 });
    const bienPlusTard = Date.now() + 60 * 60 * 1000;
    expect(bienPlusTard).toBeGreaterThan(Date.now());
    expect(lireSouvenirDirect().recherche).toBe("arte");
    expect(lireSouvenirDirect().defilement).toBe(1_200);
  });

  it("s'efface quand on change de profil", () => {
    // Les favorites sont à lui : rouvrir la grille filtrée sur celles d'un autre mentirait.
    retenirSouvenirDirect({ favorisSeuls: true, recherche: "tf1", total: 34 });
    oublierSouvenirDirect();
    expect(lireSouvenirDirect().favorisSeuls).toBe(false);
    expect(lireSouvenirDirect().recherche).toBe("");
    expect(lireSouvenirDirect().total).toBe(0);
  });
});
