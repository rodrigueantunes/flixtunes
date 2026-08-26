import { segmentCommun, type Attente, type SegmentCommun } from "./empreinte-sonore.js";

/**
 * Le générique d'une saison, établi par ce que plusieurs paires d'épisodes ont en commun.
 *
 * Comparer **deux** épisodes ne suffit pas, et c'est une leçon payée : sur *Bleach*, la paire E1/E2
 * donnait un segment de 65 s là où les trois autres paires s'accordaient sur 105 s. Un accident —
 * une coupure publicitaire commune, un logo de studio, un silence — ressemble à un thème quand on ne
 * l'a vu qu'une fois. Il ne résiste pas à une seconde paire.
 *
 * La règle est donc celle du **consensus** : un segment n'est retenu que si au moins deux paires
 * indépendantes le trouvent au même endroit et de la même longueur. C'est le même raisonnement que
 * pour les voisins de saison, appliqué au son plutôt qu'aux chapitres.
 *
 * Résultats sur la médiathèque de référence, quatre saisons éprouvées contre leurs chapitres :
 *
 * | série | consensus | chapitres |
 * | --- | --- | --- |
 * | The Office S5 | 45,4 → 66,0 | 45,5 → 65,2 |
 * | Bleach S4 | 15,8 → 120,4 | 20,7 → 120,4 |
 * | Evangelion S1 | 0,3 → 90,4 | 0,0 → 90,4 |
 * | Silo S1 | 131,5 → 224,3 | **aucun chapitre** |
 *
 * La dernière ligne est la raison d'être de ce module : *Silo* ne porte aucun chapitre, et son
 * générique ne commence jamais au même instant d'un épisode à l'autre.
 */

/** Nombre de paires qui doivent s'accorder. Deux suffisent à écarter un accident. */
export const PAIRES_MINIMUM = 2;

/** Écart toléré entre deux paires sur le début comme sur la durée, en secondes. */
export const TOLERANCE_SECONDES = 6;

/** Le repère d'un épisode, tel que le son le donne. */
export interface RepereSonore {
  debutSecondes: number;
  finSecondes: number;
  /** Nombre de paires qui se sont accordées, et ressemblance moyenne. */
  paires: number;
  score: number;
}

function mediane(valeurs: number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  if (triees.length % 2 === 1) return triees[milieu] ?? 0;
  return ((triees[milieu - 1] ?? 0) + (triees[milieu] ?? 0)) / 2;
}

/**
 * Ce que plusieurs épisodes ont en commun avec le premier d'entre eux.
 *
 * `reference` est l'épisode qu'on cherche à repérer ; `temoins` sont ses voisins de saison. Le
 * résultat est exprimé **dans le temps de la référence**, seul repère qui serve au lecteur.
 *
 * Les segments trouvés sont regroupés par ressemblance, et le plus gros groupe l'emporte — pas le
 * segment le plus long, ni le mieux noté. Un groupe, c'est plusieurs témoins qui disent la même
 * chose ; une longueur, c'est une seule mesure qui peut être fausse.
 */
export function repereParEmpreinte(reference: Float64Array, temoins: Float64Array[],
  attente?: Attente | null): RepereSonore | null {
  const trouves: SegmentCommun[] = [];
  for (const temoin of temoins) {
    const segment = segmentCommun(reference, temoin, attente);
    if (segment) trouves.push(segment);
  }
  if (trouves.length < PAIRES_MINIMUM) return null;

  // Groupes de segments qui se recouvrent, au début comme en durée.
  let meilleurGroupe: SegmentCommun[] = [];
  for (const pivot of trouves) {
    const groupe = trouves.filter((autre) =>
      Math.abs(autre.debutA - pivot.debutA) <= TOLERANCE_SECONDES
      && Math.abs(autre.dureeSecondes - pivot.dureeSecondes) <= TOLERANCE_SECONDES);
    if (groupe.length > meilleurGroupe.length) meilleurGroupe = groupe;
  }
  if (meilleurGroupe.length < PAIRES_MINIMUM) return null;

  const debut = mediane(meilleurGroupe.map((segment) => segment.debutA));
  const duree = mediane(meilleurGroupe.map((segment) => segment.dureeSecondes));
  return {
    debutSecondes: debut,
    finSecondes: debut + duree,
    paires: meilleurGroupe.length,
    score: mediane(meilleurGroupe.map((segment) => segment.score)),
  };
}
