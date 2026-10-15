/**
 * L'avance prise derrière le bord du direct : de quoi traverser une coupure sans que l'image s'arrête.
 *
 * Un direct ne se met en réserve que sur ce que la chaîne a déjà publié : l'avance maximale possible
 * **est** la distance au bord. Elle se prend donc dans la fenêtre, jamais au-delà, en gardant une marge
 * arrière pour ne pas réclamer un segment que l'hébergeur vient de retirer. Android reprend la même
 * règle dans `AvanceDirect.kt`.
 *
 * **Décidé le 13 septembre 2026 : jusqu'à 60 s, selon la fiabilité.** Une source qui n'a jamais calé
 * reste à 40 s du bord — ce qu'on accepte d'écart avec le temps réel. Une source qui a déjà calé depuis
 * qu'on la regarde, ou que le serveur connaît pour ses échecs, prend jusqu'à 60 s. Sur la fenêtre
 * médiane du corpus — 61 s —, cela ne donne pas plus de 41 s : la chaîne ne publie pas davantage.
 */

/** L'avance d'une source qui n'a jamais calé. */
export const AVANCE_NORMALE_S = 40;

/** L'avance d'une source fragile, là où la fenêtre le permet. */
export const AVANCE_FRAGILE_S = 60;

/**
 * Ce qu'on refuse de laisser entre le point de lecture et le bord arrière de la fenêtre : vingt
 * secondes, de quoi absorber un rechargement sans tomber hors de ce que la chaîne publie encore.
 */
export const MARGE_ARRIERE_S = 20;

/**
 * L'avance visée, en secondes.
 *
 * Ce que la fenêtre permet, relevé à deux segments pour ne pas se coller au bord, plafonné selon la
 * fiabilité, puis **rabattu dans la fenêtre** avec un segment de garde : le plancher ne peut jamais
 * pousser le point de lecture dehors.
 */
export function avanceVisee(largeurFenetreS: number, segmentS: number, fragile: boolean): number {
  const segment = Math.max(1, segmentS);
  const plafond = fragile ? AVANCE_FRAGILE_S : AVANCE_NORMALE_S;
  const souhaitee = Math.min(plafond, Math.max(2 * segment, largeurFenetreS - MARGE_ARRIERE_S));
  return Math.max(0, Math.min(plafond, souhaitee, largeurFenetreS - Math.min(segment, largeurFenetreS / 2)));
}

/*
 * r12 — **aucun saut que l'on puisse éviter.**
 *
 * Le direct joue toujours à 1× : la vitesse variable recalait la latence en continu, et le bord du
 * direct avançant par bonds d'un segment à chaque rechargement de playlist, elle basculait entre 0,98×
 * et 1× toutes les trois secondes — mesuré sur CNews, 49 changements en 162 s. Chaque changement
 * désaccorde la cadence des images : des micro-saccades. Sans rattrapage, le retard ne grandit qu'à
 * chaque calage, et l'on ne bouge que lorsque la fenêtre de la chaîne l'impose : au bord arrière. On
 * reprend alors au plus près de ce bord — revenir à l'avance visée faisait sauter jusqu'à quatre
 * minutes de programme sur une fenêtre de cinq. Android applique la même règle (`AvanceDirect.kt`).
 */

/** Sous cette marge au bord arrière, la lecture va tomber hors de ce que la chaîne publie encore. */
export const SEUIL_BORD_ARRIERE_S = 12;

/** La marge où l'on reprend : trois segments ordinaires, de quoi absorber un rechargement de playlist. */
export const MARGE_REPRISE_S = 24;

/** Faut-il reprendre parce que le bord arrière approche ? Jamais sur une fenêtre trop courte pour en avoir un. */
export function doitReprendreAuBordArriere(margeS: number, largeurFenetreS: number, segmentS: number): boolean {
  const segment = Math.max(1, segmentS);
  if (largeurFenetreS <= 2 * segment + MARGE_REPRISE_S) return false;
  return margeS > 0 && margeS < Math.max(SEUIL_BORD_ARRIERE_S, segment * 1.5);
}

/** Le point de reprise, compté depuis le bord arrière : le moins de programme sauté, sans retomber aussitôt. */
export function repriseAuBordArriere(largeurFenetreS: number, segmentS: number): number {
  const segment = Math.max(1, segmentS);
  return Math.max(0, Math.min(Math.max(MARGE_REPRISE_S, 3 * segment), largeurFenetreS - segment));
}

/** La même avance, comptée en segments — l'unité que hls.js attend. */
export function segmentsDAvance(largeurFenetreS: number, segmentS: number, fragile: boolean): number {
  return Math.max(1, Math.floor(avanceVisee(largeurFenetreS, segmentS, fragile) / Math.max(1, segmentS)));
}
