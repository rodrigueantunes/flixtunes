import type { ParsedMedia } from "./media-parser.js";
import type { CheminWeb } from "./web-chemins.js";
import type { IdentiteWeb } from "./web-identite.js";

/**
 * Faire entrer une vidéo web dans la forme que le catalogue sait déjà traiter.
 *
 * Une chaîne se comporte comme une série : une identité stable, des contenus ordonnés, une reprise en
 * cours, un enchaînement. Plutôt que d'inventer un quatrième type de fiche — et de réécrire pour lui
 * la reprise, l'enchaînement, Ma liste et l'historique —, une vidéo est convertie ici en **épisode**,
 * et tout ce qui existe fonctionne sans modification.
 *
 * Cela reste invisible : le rayon Web est distinct, et la séparation se fait par le type de la
 * bibliothèque, exactement comme une bibliothèque « films » est déjà tenue hors du rayon des séries.
 *
 * Ce que le lecteur voit — l'arborescence réelle des dossiers — est rendu à part, depuis le chemin du
 * fichier. La saison n'est qu'un palier technique, et n'a pas à lui ressembler.
 */

/** Le jour zéro des numéros d'épisode. Une date de publication devient un entier ordonné. */
const JOUR_ZERO = Date.UTC(1970, 0, 1);
const MILLISECONDES_PAR_JOUR = 86_400_000;

/**
 * Le palier d'une vidéo : son année de publication.
 *
 * Trois raisons de préférer l'année au dossier qui contient le fichier. Elle est **déterministe** —
 * aucune table de correspondance à tenir, donc rien qui puisse dériver entre deux analyses. Elle est
 * **ordonnée**, ce qui est précisément ce qu'on demande d'un tri par date de publication. Et elle
 * n'entre pas en concurrence avec l'arborescence : les dossiers restent affichés tels qu'ils sont,
 * puisqu'ils sont rendus depuis le chemin et non depuis le palier.
 *
 * Une vidéo sans date connue tombe au palier `0`, qui se lit « année inconnue » et se range en tête.
 */
export function paliersDeLaVideo(identite: IdentiteWeb): number {
  return identite.annee ?? 0;
}

/**
 * Le rang d'une vidéo dans son palier : son jour de publication, compté depuis 1970.
 *
 * Le numéro d'épisode ordonne la fiche. Le déduire de la date plutôt que d'un compteur lui donne deux
 * propriétés qu'un compteur n'a pas : il ne dépend **d'aucune** des autres vidéos — donc une analyse
 * n'a pas besoin de les avoir toutes vues pour numéroter celle qu'elle traite — et il ne bouge jamais.
 * Ajouter une vidéo ancienne des mois plus tard ne renumérote rien : elle se glisse à sa place.
 *
 * Un compteur, lui, aurait décalé toutes les suivantes, et le décalage aurait déplacé des fiches déjà
 * rattachées à des progressions de lecture.
 */
export function rangDansLePalier(identite: IdentiteWeb): number {
  if (!identite.publieeLe) return 0;
  const instant = Date.parse(`${identite.publieeLe}T00:00:00Z`);
  if (!Number.isFinite(instant)) return 0;
  return Math.max(0, Math.round((instant - JOUR_ZERO) / MILLISECONDES_PAR_JOUR));
}

/**
 * Ce que l'appelant doit savoir faire : dire si un rang est déjà pris, dans ce palier, par un autre
 * fichier que celui-ci.
 *
 * Deux vidéos publiées le même jour visent le même rang — c'est courant sur une chaîne active. Le
 * conflit ne peut se trancher qu'en base, puisqu'il dépend de ce qui a déjà été analysé ; ce module
 * se contente de décaler jusqu'à la première place libre. Le premier arrivé garde la sienne, ce qui
 * rend l'attribution stable d'une analyse à l'autre.
 */
export type PlaceOccupee = (palier: number, rang: number) => boolean;

/** Le premier rang libre à partir de celui que la date désigne. */
export function rangLibre(palier: number, souhaite: number, occupee: PlaceOccupee, ecartMaximal = 512): number {
  for (let rang = souhaite; rang < souhaite + ecartMaximal; rang += 1) {
    if (!occupee(palier, rang)) return rang;
  }
  // Cinq cents vidéos revendiquant le même jour relèvent du défaut, pas du cas limite : mieux vaut
  // rendre le rang demandé — quitte à partager une place — que boucler indéfiniment.
  return souhaite;
}

/**
 * Convertir une vidéo web en épisode.
 *
 * Le titre de la chaîne vient du **dossier**, pas de la plateforme, et c'est délibéré : le dossier est
 * déjà l'identité de la fiche, il est choisi par la personne, et il ne change pas d'une vidéo à
 * l'autre. Le nom rendu par une API, lui, peut différer d'un enregistrement au suivant et ferait
 * osciller le titre de la chaîne au fil des analyses.
 *
 * Le titre de la vidéo suit la règle inverse : celui de la plateforme d'abord, parce qu'il est exact,
 * et le nom de fichier seulement à défaut.
 */
export function episodeDepuisLeWeb(chemin: CheminWeb, identite: IdentiteWeb, occupee: PlaceOccupee): ParsedMedia {
  const palier = paliersDeLaVideo(identite);
  const rang = rangLibre(palier, rangDansLePalier(identite), occupee);
  return {
    kind: "episode",
    title: identite.titre ?? chemin.titre,
    year: identite.annee,
    showTitle: chemin.chaine,
    showFolder: chemin.chaineDossier,
    seasonNumber: palier,
    episodeNumber: rang,
    episodeNumbers: [rang],
    airDate: identite.publieeLe,
    contentType: "movie",
    edition: null,
    externalIds: {},
    overview: identite.description,
    detection: {
      confidence: 1,
      pattern: "air-date",
      warnings: [],
      // Rien n'est déduit ici : la place de chaque renseignement est fixée par l'arborescence, et la
      // date vient du fichier lui-même. Il n'y a donc pas d'ambiguïté à soumettre à une revue.
      evidence: ["arborescence web", identite.publieeLe ? "date de publication" : "date inconnue"],
    },
  };
}

/**
 * Le nom d'un palier, tel qu'il s'affiche.
 *
 * « Saison 2024 » dirait faux pour une chaîne : ce palier est une année, et rien d'autre. Une vidéo
 * sans date connue est regroupée sous un libellé qui l'avoue.
 */
export function libelleDuPalier(palier: number, langue: string): string {
  if (palier > 0) return String(palier);
  return langue === "fr-FR" ? "Sans date connue" : "Undated";
}

/**
 * Les dossiers traversés, tels que l'écran doit les rendre.
 *
 * Ils ne sont stockés nulle part : ils se relisent du chemin du fichier, qui est déjà en base. C'est
 * ce qui permet d'afficher une arborescence de profondeur quelconque alors que le catalogue, lui,
 * n'en connaît que trois niveaux.
 */
export function cheminDAffichage(chemin: CheminWeb): string {
  return chemin.dossiers.join(" / ");
}
