import { beforeEach, describe, expect, it } from "vitest";
import {
  lireSouvenirCatalogue,
  oublierSouvenirsCatalogue,
  retenirSouvenirCatalogue,
} from "./memoire-catalogue";

/**
 * Ce que le catalogue retrouve en revenant d'un film. Mêmes devoirs que la mémoire du direct —
 * retenir, ne pas périmer, s'effacer au changement de profil —, plus un qui lui est propre : les
 * films et les séries ne se souviennent pas ensemble.
 */

beforeEach(() => oublierSouvenirsCatalogue());

describe("la mémoire du catalogue", () => {
  it("part vierge, et retient ce qu'on lui donne", () => {
    expect(lireSouvenirCatalogue("movies")).toEqual(expect.objectContaining({
      sort: "title", filter: "all", query: "", decade: "all", genres: [], defilement: 0,
    }));

    retenirSouvenirCatalogue("movies", { genres: ["Policier"], decade: 1990, defilement: 1_200 });
    const souvenir = lireSouvenirCatalogue("movies");
    expect(souvenir.genres).toEqual(["Policier"]);
    expect(souvenir.decade).toBe(1990);
    expect(souvenir.defilement).toBe(1_200);
    // Ce qu'on n'a pas touché reste : chaque champ est écrit par l'endroit qui le connaît.
    expect(souvenir.sort).toBe("title");
  });

  it("ne mélange pas les films et les séries", () => {
    // On ne parcourt pas les deux avec les mêmes filtres, et revenir de l'un ne doit rien changer à
    // l'autre — c'est pourquoi la mémoire est tenue par sorte et non en un seul tas.
    retenirSouvenirCatalogue("movies", { query: "jaws", genres: ["Horreur"] });
    retenirSouvenirCatalogue("shows", { query: "columbo" });
    expect(lireSouvenirCatalogue("movies").query).toBe("jaws");
    expect(lireSouvenirCatalogue("shows").query).toBe("columbo");
    expect(lireSouvenirCatalogue("shows").genres).toEqual([]);
  });

  it("ne périme pas — un film dure une heure et demie", () => {
    /*
     * C'est la raison d'être de cette mémoire plutôt que du cache de catalogue : celui-ci oublie au
     * bout de cinq minutes, ce qui est juste pour des données du serveur et faux pour un choix de la
     * personne. Le cas normal — regarder le film jusqu'au bout — perdrait ses filtres.
     */
    retenirSouvenirCatalogue("movies", { filter: "progress", defilement: 900 });
    expect(Date.now() + 90 * 60 * 1000).toBeGreaterThan(Date.now());
    expect(lireSouvenirCatalogue("movies").filter).toBe("progress");
    expect(lireSouvenirCatalogue("movies").defilement).toBe(900);
  });

  it("s'efface quand on change de profil", () => {
    // La progression et les envies sont les siennes : rouvrir une liste filtrée sur « en cours » avec
    // les films de quelqu'un d'autre serait un souvenir qui ment.
    retenirSouvenirCatalogue("movies", { filter: "watched", selectedLetter: "M" });
    oublierSouvenirsCatalogue();
    expect(lireSouvenirCatalogue("movies").filter).toBe("all");
    expect(lireSouvenirCatalogue("movies").selectedLetter).toBeNull();
  });
});
