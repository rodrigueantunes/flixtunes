/**
 * La relève silencieuse d'un direct : où en est la lecture, et où la reprendre ailleurs.
 *
 * Il y a une panne que la reprise en place ne répare pas : la **session qui expire**. L'hébergeur
 * refuse désormais les playlists de variantes et les segments de la lecture en cours, alors qu'un
 * nouveau chargement du manifeste maître repartirait aussitôt — c'est exactement ce que fait une
 * relance à la main. Or hls.js ne sait pas recharger ce manifeste en place : `loadSource` recrée la
 * `MediaSource` et vide le tampon, l'image coupe ; `startLoad` reprend sans vider, mais sur les mêmes
 * adresses refusées.
 *
 * La relève prépare donc une seconde lecture, cachée, sur la même adresse, pendant que la première
 * joue encore son tampon ; elle la cale sur le segment exact que la première montre, puis on échange les
 * deux. Mesuré le 13 septembre 2026 sur CNews, session expirée simulée : sans relève, la source était
 * abandonnée au bout de 39 s ; avec, l'image n'a jamais été figée plus de 0,1 s, et le raccord tombait à
 * 0,05 s près.
 *
 * Ce fichier ne contient que le calcul du raccord, pour pouvoir l'éprouver sans navigateur.
 */

/** Ce qu'une playlist dit d'un segment, réduit à ce que le raccord utilise. */
export interface SegmentRepere {
  sn: number;
  /** Le début du segment sur la ligne de temps de *cette* lecture, en secondes. */
  start: number;
  duration: number;
  /** L'heure de programme du début du segment, en millisecondes, quand la playlist la publie. */
  programDateTime?: number | null;
}

/** Où en est une lecture : le segment, le décalage dedans, et l'heure de programme si elle est connue. */
export interface Repere {
  sn: number;
  decalage: number;
  pdt: number | null;
}

/** Le repère d'un instant de lecture dans une playlist, ou `null` s'il tombe hors des segments connus. */
export function repereDansLaPlaylist(segments: readonly SegmentRepere[], temps: number): Repere | null {
  const segment = segments.find((candidat) => candidat.start <= temps && temps < candidat.start + candidat.duration);
  if (!segment) return null;
  const decalage = temps - segment.start;
  return { sn: segment.sn, decalage, pdt: segment.programDateTime != null ? segment.programDateTime + decalage * 1000 : null };
}

/**
 * L'instant, sur la ligne de temps d'une autre lecture, qui montre la même image que ce repère.
 *
 * Deux instances hls.js ouvertes à des moments différents n'ont pas la même origine des temps : c'est
 * le numéro de segment qui les relie, ou mieux l'heure de programme quand la chaîne la publie. `null`
 * quand le segment est déjà sorti de la fenêtre de l'autre lecture.
 */
export function tempsPourRepere(segments: readonly SegmentRepere[], repere: Repere, memeSource = true): number | null {
  if (repere.pdt != null) {
    const pdt = repere.pdt;
    const parHeure = segments.find((candidat) => candidat.programDateTime != null
      && candidat.programDateTime <= pdt && pdt < candidat.programDateTime + candidat.duration * 1000);
    if (parHeure) return parHeure.start + (pdt - parHeure.programDateTime!) / 1000;
  }
  if (!memeSource) return null;
  const parNumero = segments.find((candidat) => candidat.sn === repere.sn);
  return parNumero ? parNumero.start + repere.decalage : null;
}

/** L'avance de la lecture `b` sur la lecture `a`, en secondes — négative si elle est en retard. */
export function ecartEntre(a: Repere | null, b: Repere | null, dureeSegment: number): number | null {
  if (!a || !b) return null;
  if (a.pdt != null && b.pdt != null) return (b.pdt - a.pdt) / 1000;
  return (b.sn - a.sn) * dureeSegment + (b.decalage - a.decalage);
}
