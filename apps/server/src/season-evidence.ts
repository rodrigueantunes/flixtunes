/**
 * Le nombre de saisons présentes sur le disque comme indice d'identification — étape 55.
 *
 * Une médiathèque range généralement chaque saison dans son dossier. Ce compte est une observation
 * directe, pas une supposition : trois dossiers de saisons excluent en pratique une série qui n'en a
 * qu'une. C'est exactement ce qui manquait pour départager « Daredevil : Born Again », une saison, de
 * « Daredevil » 2015, trois saisons, à partir d'un dossier nommé simplement « Daredevil ».
 *
 * Trois précautions, parce qu'une médiathèque incomplète est la norme et non l'exception :
 *
 * 1. **Jamais éliminatoire.** Un candidat n'est pas écarté parce qu'il annonce moins de saisons ; il
 *    est seulement moins bien classé. Quelqu'un qui n'aurait que la saison 2 d'une série de six
 *    verrait sinon sa correspondance refusée.
 * 2. **Sans effet en dessous de deux saisons.** Un dossier d'une seule saison ne prouve rien : toute
 *    série en possède au moins une.
 * 3. **Réservé à l'ambiguïté.** Quand un candidat gagne nettement, on ne touche à rien. L'indice ne
 *    sert qu'à trancher entre des propositions au coude à coude, ce qui limite aussi le coût : il
 *    faut une requête de détail par candidat pour connaître son nombre de saisons.
 */

/** Écart en deçà duquel deux candidats sont considérés au coude à coude. */
export const AMBIGUITY_MARGIN = 0.12;

/** Gain accordé à un candidat dont le nombre de saisons est compatible avec le disque. */
export const CONSISTENT_BONUS = 0.06;

/** Pénalité maximale d'un candidat qui ne peut pas contenir ce que le disque montre. */
export const IMPOSSIBLE_PENALTY = 0.12;

export interface ScoredCandidate {
  externalId: string;
  score: number;
}

/**
 * Y a-t-il matière à départager ?
 *
 * Faux dès que le premier candidat devance nettement le second : inutile alors de payer des requêtes
 * de détail, et surtout inutile de risquer de déclasser une correspondance déjà bonne.
 */
export function needsSeasonEvidence(candidates: ScoredCandidate[], seasonsOnDisk: number): boolean {
  if (seasonsOnDisk < 2) return false;
  if (candidates.length < 2) return false;
  const [first, second] = candidates;
  return first!.score - second!.score < AMBIGUITY_MARGIN;
}

/**
 * Réordonne les candidats à la lumière du nombre de saisons observé.
 *
 * @param candidates Candidats déjà classés par score.
 * @param seasonsOnDisk Nombre de saisons constatées sur le disque.
 * @param seasonsByCandidate Nombre de saisons annoncé par le fournisseur, par identifiant. Un
 *   candidat absent de cette table conserve son score : l'ignorance ne se paie pas.
 */
export function applySeasonEvidence(
  candidates: ScoredCandidate[],
  seasonsOnDisk: number,
  seasonsByCandidate: Map<string, number>,
): ScoredCandidate[] {
  if (seasonsOnDisk < 2) return candidates;
  return candidates
    .map((candidate) => {
      const announced = seasonsByCandidate.get(candidate.externalId);
      if (announced == null) return candidate;
      if (announced >= seasonsOnDisk) {
        return { ...candidate, score: Math.min(1, candidate.score + CONSISTENT_BONUS) };
      }
      // Pénalité proportionnelle à l'écart : une saison manquante pèse moins que quatre. Bornée, et
      // jamais jusqu'à zéro — le fournisseur peut ignorer une saison récente que le disque possède.
      const gap = (seasonsOnDisk - announced) / seasonsOnDisk;
      return { ...candidate, score: Math.max(0, candidate.score - IMPOSSIBLE_PENALTY * Math.min(1, gap)) };
    })
    .sort((left, right) => right.score - left.score);
}
