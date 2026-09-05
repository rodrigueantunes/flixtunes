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
 * Ce que la personne voit en ouvrant une chaîne reste **ses dossiers** : ce sont eux qui forment les
 * paliers, et la date de publication ne sert qu'à ordonner les vidéos à l'intérieur.
 */

/** Le jour zéro des numéros d'épisode. Une date de publication devient un entier ordonné. */
const JOUR_ZERO = Date.UTC(1970, 0, 1);
const MILLISECONDES_PAR_JOUR = 86_400_000;

/**
 * Le palier d'une vidéo : le dossier qui la contient, sous sa chaîne.
 *
 * C'est ce que la personne voit en ouvrant une chaîne, et c'est ce qu'elle a rangé elle-même — le
 * plus souvent des playlists, parfois autre chose. Le palier ne peut donc pas être déduit d'une
 * donnée de la vidéo : il **est** le dossier.
 *
 * Le catalogue ne connaît que trois niveaux, alors qu'une arborescence peut en compter plus. La clé
 * retient donc le chemin relatif **entier**, en un seul palier : `Documentaires/2024/Asie` reste
 * distinct de `Documentaires/2024`, et l'écran peut rendre la profondeur réelle en le redécoupant.
 * Rien n'est aplati, rien n'est perdu.
 *
 * Une vidéo posée à la racine de la chaîne a pour clé la chaîne vide : elle n'est dans aucun dossier,
 * et lui en inventer un serait afficher un rangement qui n'existe pas.
 */
export function cleDuPalier(chemin: CheminWeb): string {
  return chemin.dossiers.join("/");
}

/** Le nom d'un palier, tel qu'il s'affiche. L'écran redécoupe la profondeur ; ici on la rend lisible. */
export function libelleDuPalier(cle: string, langue: string): string {
  if (cle) return cle.split("/").join(" / ");
  return langue === "fr-FR" ? "Hors dossier" : "No folder";
}

/**
 * Le rang d'une vidéo dans son palier : son jour de publication, compté depuis 1970.
 *
 * C'est le tri demandé — par date de publication —, et le déduire de la date plutôt que d'un compteur
 * lui donne deux propriétés qu'un compteur n'a pas : il ne dépend **d'aucune** des autres vidéos, donc
 * une analyse n'a pas besoin de les avoir toutes vues pour numéroter celle qu'elle traite ; et il ne
 * bouge jamais, donc ajouter une vidéo ancienne des mois plus tard ne renumérote pas les suivantes.
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
 * Ce que l'appelant doit savoir faire : donner le numéro déjà attribué à un dossier de cette chaîne,
 * ou en attribuer un nouveau.
 *
 * Le catalogue range les saisons par un entier ; les dossiers, eux, ont des noms libres. La
 * correspondance ne peut donc pas se calculer — elle se **retient**, et elle se retient là où vivent
 * déjà les fiches, pas dans une table de plus. Un dossier connu garde son numéro, un dossier nouveau
 * prend le suivant : l'attribution est stable, et l'ordre des paliers suit celui de leur découverte.
 */
export type NumeroDePalier = (cle: string) => number;

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
export function episodeDepuisLeWeb(
  chemin: CheminWeb,
  identite: IdentiteWeb,
  numeroDePalier: NumeroDePalier,
  occupee: PlaceOccupee,
): ParsedMedia {
  const palier = numeroDePalier(cleDuPalier(chemin));
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
