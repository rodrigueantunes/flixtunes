import { describe, expect, it } from "vitest";
import { lireCheminWeb, type CheminWeb } from "./web-chemins.js";
import type { IdentiteWeb } from "./web-identite.js";
import {
  cheminDAffichage, episodeDepuisLeWeb, libelleDuPalier, paliersDeLaVideo, rangDansLePalier, rangLibre,
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

describe("palier d'une video", () => {
  it("est l'annee de publication", () => {
    expect(paliersDeLaVideo(identite({ annee: 2024 }))).toBe(2024);
  });

  it("est zero quand la date est inconnue, et se lit comme tel", () => {
    // Ranger une video sans date dans l'annee en cours lui inventerait une date. Le palier zero
    // l'avoue, et se range en tete.
    expect(paliersDeLaVideo(identite())).toBe(0);
    expect(libelleDuPalier(0, "fr-FR")).toBe("Sans date connue");
    expect(libelleDuPalier(2024, "fr-FR")).toBe("2024");
  });
});

describe("rang dans le palier", () => {
  it("suit la date de publication", () => {
    const veille = rangDansLePalier(identite({ publieeLe: "2024-01-14" }));
    const jour = rangDansLePalier(identite({ publieeLe: "2024-01-15" }));
    expect(jour).toBe(veille + 1);
  });

  it("ne depend d'aucune autre video", () => {
    // C'est la propriete qui compte : une analyse numerote la video qu'elle traite sans avoir vu les
    // autres, donc l'ordre du parcours du disque n'influe sur rien.
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
    const episode = episodeDepuisLeWeb(video, identite({ annee: 2024, publieeLe: "2024-01-15" }), libre);
    expect(episode.kind).toBe("episode");
    expect(episode.showTitle).toBe("Arte");
    expect(episode.showFolder).toBe("N:/Web/YouTube/Arte");
    expect(episode.seasonNumber).toBe(2024);
  });

  it("prend le titre de la plateforme, et le nom de fichier a defaut", () => {
    expect(episodeDepuisLeWeb(video, identite({ titre: "Titre exact de la plateforme" }), libre).title)
      .toBe("Titre exact de la plateforme");
    expect(episodeDepuisLeWeb(video, identite(), libre).title).toBe("Le monde en cartes");
  });

  it("garde le nom du dossier pour la chaine, meme si la plateforme en donne un autre", () => {
    // Le dossier est deja l'identite de la fiche, il est choisi par la personne, et il ne change pas
    // d'une video a l'autre. Un nom rendu par une API peut differer d'un enregistrement au suivant et
    // ferait osciller le titre de la chaine au fil des analyses.
    const episode = episodeDepuisLeWeb(video, identite({ chaine: "ARTEfr officiel" }), libre);
    expect(episode.showTitle).toBe("Arte");
  });

  it("reporte la date et le resume", () => {
    const episode = episodeDepuisLeWeb(video, identite({ publieeLe: "2024-01-15", annee: 2024, description: "Une chronique." }), libre);
    expect(episode.airDate).toBe("2024-01-15");
    expect(episode.overview).toBe("Une chronique.");
    expect(episode.year).toBe(2024);
  });

  it("ne soumet rien a une revue humaine", () => {
    // Chaque renseignement est a une place fixee par l'arborescence, et la date vient du fichier :
    // il n'y a aucune interpretation concurrente a departager.
    const episode = episodeDepuisLeWeb(video, identite(), libre);
    expect(episode.detection?.decision).toBeUndefined();
    expect(episode.detection?.confidence).toBe(1);
  });
});

describe("arborescence rendue a l'ecran", () => {
  it("restitue les dossiers traverses", () => {
    expect(cheminDAffichage(chemin("YouTube/Arte/Documentaires/2024/Asie/Episode.mp4")))
      .toBe("Documentaires / 2024 / Asie");
  });

  it("ne rend rien pour une video posee a la racine de la chaine", () => {
    expect(cheminDAffichage(chemin("YouTube/Arte/Video.mp4"))).toBe("");
  });
});
