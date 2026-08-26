/**
 * Deviner les génériques d'un épisode d'après ceux de ses voisins de saison.
 *
 * Une saison est fabriquée d'un bloc : même thème d'ouverture, même carton de fin, souvent le même
 * encodage. Quand trois épisodes sur douze portent un chapitre nommé, les neuf autres n'ont pas
 * besoin qu'on les analyse — ils ont la même forme.
 *
 * Ce que la mesure dit de cette régularité, sur 246 saisons portant au moins trois repères : la durée
 * du générique de fin y varie d'un **écart absolu médian de 0,5 seconde**. Au 90ᵉ centile elle monte
 * à 8,2 s — d'où le refus des saisons trop dispersées, qui ne sont pas des saisons régulières mais
 * des lots hétéroclites rangés ensemble.
 *
 * Sur la médiathèque de référence, cette seule déduction porte sur **564 épisodes**, sans décoder un
 * seul octet.
 */

/** Ce qu'on sait d'un épisode déjà repéré. */
export interface RepereConnu {
  /** Durée du média, en secondes. */
  dureeSecondes: number;
  /** Début du générique de fin, ou `null`. */
  creditsStartSeconds: number | null;
  introStartSeconds: number | null;
  introEndSeconds: number | null;
}

export interface DeductionVoisins {
  creditsStartSeconds: number | null;
  introStartSeconds: number | null;
  introEndSeconds: number | null;
}

/**
 * Nombre de voisins repérés en deçà duquel on ne conclut rien.
 *
 * Deux suffiraient à faire une moyenne, et c'est bien le problème : deux valeurs ne disent rien de
 * leur dispersion. Trois permettent une médiane qui résiste à un intrus.
 */
export const VOISINS_MINIMUM = 3;

/**
 * Dispersion au-delà de laquelle la saison n'est pas régulière.
 *
 * **Mesurée par l'écart absolu médian, et non par l'écart-type** : la nuance a été révélée par un
 * test. Une saison régulière où un seul épisode porte un chapitre mal nommé — un « Credits » de dix
 * minutes — a un écart-type énorme, et se voyait rejetée en bloc alors que ses onze autres épisodes
 * s'accordaient à la seconde près. L'écart absolu médian, lui, ignore l'intrus comme le fait la
 * médiane qu'il accompagne.
 *
 * Le seuil vient de la mesure : médiane des saisons à 0,5 s, 90ᵉ centile à 8,2 s, 95ᵉ à 12 s. Dix
 * secondes acceptent 94 % des saisons et écartent la queue franchement irrégulière.
 */
export const DISPERSION_MAXIMALE = 10;

function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  if (triees.length % 2 === 1) return triees[milieu] ?? 0;
  return ((triees[milieu - 1] ?? 0) + (triees[milieu] ?? 0)) / 2;
}

/** L'écart absolu médian : la dispersion vue par la médiane, donc insensible à un intrus. */
function ecartAbsoluMedian(valeurs: number[]): number {
  if (valeurs.length < 2) return 0;
  const centre = mediane(valeurs);
  return mediane(valeurs.map((valeur) => Math.abs(valeur - centre)));
}

/** La valeur médiane d'un ensemble, quand il est assez fourni et assez régulier pour valoir règle. */
function consensus(valeurs: number[]): number | null {
  if (valeurs.length < VOISINS_MINIMUM) return null;
  if (ecartAbsoluMedian(valeurs) > DISPERSION_MAXIMALE) return null;
  return mediane(valeurs);
}

/**
 * Ce qu'on peut déduire pour un épisode, d'après ses voisins déjà repérés.
 *
 * Le générique de fin se déduit **par sa durée**, jamais par sa position absolue : deux épisodes
 * d'une même saison n'ont pas la même longueur, et un carton de fin dure le même temps qu'il
 * commence à 21 ou à 24 minutes. L'introduction, elle, se déduit par ses **bornes absolues** : elle
 * se tient au début, où les épisodes sont alignés.
 */
export function deduireDesVoisins(dureeSecondes: number, voisins: RepereConnu[]): DeductionVoisins {
  const vide: DeductionVoisins = { creditsStartSeconds: null, introStartSeconds: null, introEndSeconds: null };
  if (!Number.isFinite(dureeSecondes) || dureeSecondes <= 0) return vide;

  const restants = voisins
    .filter((voisin) => voisin.creditsStartSeconds != null && voisin.dureeSecondes > voisin.creditsStartSeconds)
    .map((voisin) => voisin.dureeSecondes - (voisin.creditsStartSeconds as number));
  const restant = consensus(restants);
  // La déduction reste soumise aux mêmes bornes que le repère qu'elle imite : un générique commence
  // dans le dernier cinquième et ne dure ni moins de douze secondes ni plus de dix minutes.
  const debutCredits = restant != null && restant >= 12 && restant <= 600
    && (dureeSecondes - restant) / dureeSecondes >= 0.8
    ? dureeSecondes - restant : null;

  const debuts = voisins.filter((voisin) => voisin.introStartSeconds != null).map((voisin) => voisin.introStartSeconds as number);
  const fins = voisins.filter((voisin) => voisin.introEndSeconds != null).map((voisin) => voisin.introEndSeconds as number);
  const introDebut = consensus(debuts);
  const introFin = consensus(fins);
  const introValide = introDebut != null && introFin != null && introFin > introDebut
    && introFin < dureeSecondes && introDebut / dureeSecondes <= 0.5
    && introFin - introDebut >= 8 && introFin - introDebut <= 300;

  return {
    creditsStartSeconds: debutCredits,
    introStartSeconds: introValide ? introDebut : null,
    introEndSeconds: introValide ? introFin : null,
  };
}
