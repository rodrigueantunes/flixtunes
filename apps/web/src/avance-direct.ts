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
  return Math.max(segment, Math.min(souhaitee, largeurFenetreS - segment));
}

/** La même avance, comptée en segments — l'unité que hls.js attend. */
export function segmentsDAvance(largeurFenetreS: number, segmentS: number, fragile: boolean): number {
  return Math.max(1, Math.floor(avanceVisee(largeurFenetreS, segmentS, fragile) / Math.max(1, segmentS)));
}
