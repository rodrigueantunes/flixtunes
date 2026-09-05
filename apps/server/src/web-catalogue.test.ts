import { describe, expect, it } from "vitest";
import { lireCheminWeb, type CheminWeb } from "./web-chemins.js";
import type { IdentiteWeb } from "./web-identite.js";
import {
  cleDuPalier, episodeDepuisLeWeb, libelleDuPalier, rangDansLePalier, rangLibre,
} from "./web-catalogue.js";

/**
 * Une vidéo web entre dans la forme d'un épisode.
 *
 * L'enjeu de ces cas est la **stabilité** du numérotage. Un numéro d'épisode n'est pas un détail
 * d'affichage : c'est la clé qui rattache une fiche à un fichier, et donc à une progression de
 * lecture. Un numérotage qui se décale à l'ajout d'une vidéo déplacerait des reprises en cours.
 */
const chemin = (relatif: string): CheminWeb => {
  const lu = lireCheminWeb("N:/Web", `N:/Web/${relatif}`);
  if (!lu.valide) throw new Error(`chemin d'essai invalide : ${relatif}`);
  return lu.chemin;
};

const identite = (extra: Partial<IdentiteWeb> = {}): IdentiteWeb => ({
  titre: null, chaine: null, plateforme: null, identifiant: null, url: null,
  publieeLe: null, annee: null, description: null, dureeSecondes: null, vignette: null, playlist: null,
  ...extra,
});

const libre = () => false;

/** Les paliers d'essai sont numerotes dans leur ordre de decouverte, comme en base. */
const numeroteur = () => {
  const connus = new Map<string, number>();
  return (cle: string) => connus.get(cle) ?? (connus.set(cle, connus.size + 1), connus.size);
};

describe("palier d'une video", () => {
  it("est le dossier qui la contient, pas une donnee deduite", () => {
    // C'est ce que la personne voit en ouvrant une chaine, et c'est ce qu'elle a rangee elle-meme.
    expect(cleDuPalier(chemin("YouTube/Arte/Documentaires/Sujet.mp4"))).toBe("Documentaires");
  });

  it("retient la profondeur entiere en une seule cle", () => {
    // Le catalogue ne connait que trois niveaux, une arborescence peut en compter plus. Deux
    // dossiers imbriques differents ne doivent pas se confondre en un seul palier.
    expect(cleDuPalier(chemin("YouTube/Arte/Documentaires/2024/Asie/Sujet.mp4"))).toBe("Documentaires/2024/Asie");
    expect(cleDuPalier(chemin("YouTube/Arte/Documentaires/2024/Sujet.mp4"))).toBe("Documentaires/2024");
  });

  it("laisse vide une video posee a la racine de la chaine", () => {
    // Lui inventer un dossier afficherait un rangement qui n'existe pas.
    expect(cleDuPalier(chemin("YouTube/Arte/Sujet.mp4"))).toBe("");
  });

  it("se lit a l'ecran avec sa profondeur", () => {
    expect(libelleDuPalier("Documentaires/2024/Asie", "fr-FR")).toBe("Documentaires / 2024 / Asie");
    expect(libelleDuPalier("", "fr-FR")).toBe("Hors dossier");
  });
});

describe("rang dans le palier", () => {
  it("suit la date de publication", () => {
    const veille = rangDansLePalier(identite({ publieeLe: "2024-01-14" }));
    const jour = rangDansLePalier(identite({ publieeLe: "2024-01-15" }));
    expect(jour).toBe(veille + 1);
  });

  it("ne depend d'aucune autre video", () => {
    // Une analyse numerote la video qu'elle traite sans avoir vu les autres : l'ordre du parcours du
    // disque n'influe donc sur rien.
    const seule = rangDansLePalier(identite({ publieeLe: "2024-06-01" }));
    expect(rangDansLePalier(identite({ publieeLe: "2024-06-01" }))).toBe(seule);
  });

  it("ne bouge pas quand une video plus ancienne arrive ensuite", () => {
    // Un compteur aurait decale toutes les suivantes — et le decalage aurait deplace des fiches deja
    // rattachees a une progression de lecture.
    const recente = rangDansLePalier(identite({ publieeLe: "2024-12-01" }));
    const ancienne = rangDansLePalier(identite({ publieeLe: "2024-01-05" }));
    expect(ancienne).toBeLessThan(recente);
    expect(rangDansLePalier(identite({ publieeLe: "2024-12-01" }))).toBe(recente);
  });

  it("rend zero pour une date absente ou illisible", () => {
    expect(rangDansLePalier(identite())).toBe(0);
    expect(rangDansLePalier(identite({ publieeLe: "pas une date" }))).toBe(0);
  });
});

describe("conflit de rang", () => {
  it("decale a la premiere place libre", () => {
    // Deux videos publiees le meme jour visent le meme rang : c'est courant sur une chaine active.
    const prises = new Set([`2024:100`, `2024:101`]);
    expect(rangLibre(2024, 100, (palier, rang) => prises.has(`${palier}:${rang}`))).toBe(102);
  });

  it("laisse sa place au premier arrive", () => {
    // C'est ce qui rend l'attribution stable d'une analyse a l'autre : celui qui tient une place la
    // garde, et seul le nouveau venu se decale.
    expect(rangLibre(2024, 100, () => false)).toBe(100);
  });

  it("renonce plutot que de boucler quand tout est pris", () => {
    expect(rangLibre(2024, 100, () => true)).toBe(100);
  });
});

describe("conversion en episode", () => {
  const video = chemin("YouTube/Arte/Documentaires/Le monde en cartes.mp4");

  it("fait de la chaine la serie, et du dossier son identite", () => {
    const episode = episodeDepuisLeWeb(video, identite({ annee: 2024, publieeLe: "2024-01-15" }), numeroteur(), libre);
    expect(episode.kind).toBe("episode");
    expect(episode.showTitle).toBe("Arte");
    expect(episode.showFolder).toBe("N:/Web/YouTube/Arte");
    expect(episode.seasonNumber).toBe(1);
  });

  it("prend le titre de la plateforme, et le nom de fichier a defaut", () => {
    expect(episodeDepuisLeWeb(video, identite({ titre: "Titre exact de la plateforme" }), numeroteur(), libre).title)
      .toBe("Titre exact de la plateforme");
    expect(episodeDepuisLeWeb(video, identite(), numeroteur(), libre).title).toBe("Le monde en cartes");
  });

  it("garde le nom du dossier pour la chaine, meme si la plateforme en donne un autre", () => {
    // Le dossier est deja l'identite de la fiche, il est choisi par la personne, et il ne change pas
    // d'une video a l'autre. Un nom rendu par une API peut differer d'un enregistrement au suivant et
    // ferait osciller le titre de la chaine au fil des analyses.
    const episode = episodeDepuisLeWeb(video, identite({ chaine: "ARTEfr officiel" }), numeroteur(), libre);
    expect(episode.showTitle).toBe("Arte");
  });

  it("reporte la date et le resume", () => {
    const episode = episodeDepuisLeWeb(video, identite({ publieeLe: "2024-01-15", annee: 2024, description: "Une chronique." }), numeroteur(), libre);
    expect(episode.airDate).toBe("2024-01-15");
    expect(episode.overview).toBe("Une chronique.");
    expect(episode.year).toBe(2024);
  });

  it("ne soumet rien a une revue humaine", () => {
    // Chaque renseignement est a une place fixee par l'arborescence, et la date vient du fichier :
    // il n'y a aucune interpretation concurrente a departager.
    const episode = episodeDepuisLeWeb(video, identite(), numeroteur(), libre);
    expect(episode.detection?.decision).toBeUndefined();
    expect(episode.detection?.confidence).toBe(1);
  });
});
