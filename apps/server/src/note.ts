/**
 * La note d'un film ou d'une série, ramenée sur cinq étoiles (r14).
 *
 * Chaque fournisseur note à sa façon : TMDB et IMDb sur 10, d'autres sur 100 ou déjà sur 5. On garde
 * une seule échelle, celle de l'écran, en proratisant : une note sur 10 se divise par deux. Le nombre
 * de votes voyage avec elle, parce qu'une moyenne sur un seul avis ne dit rien — elle n'est montrée
 * qu'à partir de `NOTE_VOTES_MIN` votes.
 */

export interface NoteFiche {
  /** Sur 5, au dixième près. */
  surCinq: number;
  votes: number;
  /** Le fournisseur d'où vient la note : `tmdb`, `imdb`… */
  source: string;
}

/** En dessous, la note n'est pas montrée : un film à un seul vote peut afficher 5 sur 5. */
export const NOTE_VOTES_MIN = 10;

/**
 * Ramène une note sur cinq. `null` quand il n'y a rien à dire : pas de note, pas de vote, ou une
 * valeur hors de son échelle.
 */
export function noteSurCinq(valeur: number | null | undefined, echelle: number, votes: number | null | undefined,
  source: string): NoteFiche | null {
  if (valeur == null || !Number.isFinite(valeur) || !(echelle > 0)) return null;
  if (!votes || votes < 1 || valeur <= 0 || valeur > echelle) return null;
  return { surCinq: Math.round(valeur * 50 / echelle) / 10, votes: Math.round(votes), source };
}

/** La note telle qu'on la montre : seulement si assez de personnes l'ont donnée. */
export function noteAffichable(surCinq: number | null | undefined, votes: number | null | undefined,
  source: string | null | undefined): NoteFiche | null {
  if (surCinq == null || votes == null || votes < NOTE_VOTES_MIN || !source) return null;
  return { surCinq, votes, source };
}
