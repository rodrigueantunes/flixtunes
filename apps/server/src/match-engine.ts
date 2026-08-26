import type { MetadataSearchCandidate } from "@flixtunes/contracts";
import { titleMatchScore } from "./tmdb.js";
import { scoreSuite } from "./sequel-match.js";

export const MATCH_THRESHOLDS = { automatic: 0.82, review: 0.58 } as const;
/** Écart minimal entre deux œuvres distinctes avant de laisser l'automate trancher. */
export const MATCH_AMBIGUITY_MARGIN = 0.08;

/**
 * À score égal, la fiche la plus riche doit porter l'identité principale. L'ordre d'arrivée des
 * réponses réseau n'est pas une preuve : Wikidata répond souvent avant TMDB, mais ne fournit ni les
 * affiches localisées ni tous les détails attendus par la médiathèque.
 */
const PROVIDER_PRIORITY: Record<string, number> = {
  tmdb: 0, tvdb: 1, imdb: 2, allocine: 3, anilist: 4, tvmaze: 5, wikidata: 6, local: 7, fanart: 9,
};

/** Compatible avec une installation workspace plus ancienne du contrat pendant sa reconstruction. */
function providerSearchRank(candidate: MetadataSearchCandidate): number | undefined {
  return (candidate as MetadataSearchCandidate & { providerSearchRank?: number }).providerSearchRank;
}

export interface MatchEvidence {
  title: string;
  titleAliases?: string[];
  originalTitle?: string | null;
  year?: number | null;
  externalIds?: Record<string, string | undefined>;
}

export interface MatchDecision {
  score: number;
  status: "automatic" | "review" | "rejected";
  reasons: string[];
}

export interface RankedMatchDecision extends MatchDecision {
  candidate: MetadataSearchCandidate | null;
  runnerUp: MetadataSearchCandidate | null;
  margin: number | null;
  candidates: MetadataSearchCandidate[];
}

export function scoreMetadataMatch(source: MatchEvidence, candidate: MetadataSearchCandidate): MatchDecision {
  // L'année est jugée une seule fois ci-dessous. La faire entrer aussi dans titleMatchScore lui
  // donnait deux poids différents et rendait le seuil impossible à raisonner.
  const titresSource = [source.title, ...(source.titleAliases ?? [])];
  const title = Math.max(...titresSource.map((titre) => titleMatchScore(titre, candidate.title)));
  const original = candidate.originalTitle
    ? Math.max(...titresSource.map((titre) => titleMatchScore(source.originalTitle || titre, candidate.originalTitle!))) : 0;
  const alternatif = Math.max(0, ...(candidate.alternativeTitles ?? [])
    .flatMap((alias) => titresSource.map((titre) => titleMatchScore(titre, alias))));
  /**
   * Une suite nommée par son numéro se reconnaît autrement que par la ressemblance des mots.
   *
   * `Dune 2` et *Dune : Deuxième partie* n'ont presque rien en commun littéralement : la similarité
   * les plaçait à 0,615, sous le seuil, et il fallait corriger à la main. La règle exige une
   * confirmation — le rang exprimé dans le titre, ou l'année exacte — précisément pour ne pas
   * favoriser le premier volet, qui porte le même titre de base.
   */
  const suite = scoreSuite(source.title, candidate, source.year);
  let score = Math.max(title, original, alternatif, suite ?? 0);
  const reasons: string[] = [];
  if (suite !== null && suite >= Math.max(title, original, alternatif)) reasons.push("suite reconnue");
  if (alternatif >= 0.98 && alternatif >= Math.max(title, original, suite ?? 0)) reasons.push("titre alternatif exact");
  // Un score de suite peut atteindre 1 sans égalité littérale (`Iron Man 3 Unmasked`). Ne jamais le
  // présenter comme « titre exact » : cette preuve sémantique sert précisément au départage ci-dessous.
  else if (Math.max(title, original) >= 0.98) reasons.push("titre exact");
  else if (score >= 0.82) reasons.push("titre très proche");
  else if (score >= 0.58) reasons.push("titre partiel");
  if (source.year && candidate.year) {
    const delta = Math.abs(source.year - candidate.year);
    if (delta === 0) { score = Math.min(1, score + 0.04); reasons.push("année exacte"); }
    else if (delta === 1) { score *= 0.96; reasons.push("année voisine"); }
    else if (delta === 2) { score *= 0.86; reasons.push("année décalée de 2 ans"); }
    else { score *= 0.68; reasons.push(`année éloignée (${delta} ans)`); }
  }
  const expectedId = source.externalIds?.[candidate.provider];
  if (expectedId && expectedId === candidate.externalId) { score = 1; reasons.unshift(`identifiant ${candidate.provider.toUpperCase()} exact`); }
  score = Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000;
  return { score, status: score >= MATCH_THRESHOLDS.automatic ? "automatic" : score >= MATCH_THRESHOLDS.review ? "review" : "rejected", reasons };
}

function comparableTitle(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function comparableTitles(candidate: MetadataSearchCandidate): Set<string> {
  return new Set([candidate.title, candidate.originalTitle ?? "", ...(candidate.alternativeTitles ?? [])]
    .map(comparableTitle).filter(Boolean));
}

/**
 * Deux résultats du même fournisseur restent deux œuvres distinctes tant que leur identifiant
 * diffère. Entre fournisseurs, un même titre à ±1 an est en revanche une corroboration : festival,
 * première mondiale et sortie nationale font couramment diverger l'année d'une même œuvre.
 * « BAC Nord » est ainsi 2020 dans Wikidata et 2021 dans TMDB/Plex.
 */
function sameIdentity(left: MetadataSearchCandidate, right: MetadataSearchCandidate): boolean {
  if (left.provider === right.provider) return left.externalId === right.externalId;
  // Deux fournisseurs localisent souvent différemment la même œuvre. TMDB peut rendre
  // « Ant-Man et la Guêpe » tandis que TVDB rend « Ant-Man and the Wasp » : le titre original du
  // premier est alors exactement le titre principal du second. Ne comparer que les deux titres
  // affichés inventait une seconde œuvre et forçait une revue à égalité parfaite.
  const rightTitles = comparableTitles(right);
  if (![...comparableTitles(left)].some((title) => rightTitles.has(title))) return false;
  if (left.year == null || right.year == null) return true;
  return Math.abs(left.year - right.year) <= 1;
}

/**
 * Classe les propositions et applique la règle que le score seul ne pouvait pas exprimer : une
 * candidate peut être excellente sans être unique. Deux remakes homonymes au coude à coude passent
 * en revue ; deux fournisseurs décrivant la même œuvre se corroborent et ne créent pas d'ambiguïté.
 */
export function rankMetadataMatches(
  source: MatchEvidence,
  candidates: MetadataSearchCandidate[],
): RankedMatchDecision {
  const scored = candidates.map((candidate, index) => {
    const decision = scoreMetadataMatch(source, candidate);
    return { candidate: { ...candidate, score: decision.score, matchReasons: decision.reasons }, decision, index };
  }).sort((left, right) => right.decision.score - left.decision.score
    || (PROVIDER_PRIORITY[left.candidate.provider] ?? 8) - (PROVIDER_PRIORITY[right.candidate.provider] ?? 8)
    // Le rang du fournisseur n'est qu'un ultime départage entre résultats par ailleurs égaux. Il ne
    // peut donc jamais faire gagner une fiche moins ressemblante ni un fournisseur moins riche.
    || (providerSearchRank(left.candidate) ?? Number.MAX_SAFE_INTEGER)
      - (providerSearchRank(right.candidate) ?? Number.MAX_SAFE_INTEGER)
    || left.index - right.index);
  let best = scored[0];
  if (!best) return { candidate: null, runnerUp: null, candidates: [], score: 0, status: "rejected", reasons: ["aucune proposition"], margin: null };

  // Wikidata date parfois un film à sa première en festival, TMDB à sa sortie en salles. Quand les
  // titres comparables prouvent qu'il s'agit de la même œuvre et que le seul écart de score est la
  // pénalité d'une année (4 points au maximum), on conserve la fiche TMDB plus riche en images et
  // métadonnées. Hors de ce corridor étroit, le score reste souverain.
  const sameWork = scored.filter((entry) => sameIdentity(best!.candidate, entry.candidate)
    && entry.decision.reasons.some((reason) => reason === "titre exact" || reason === "titre alternatif exact")
    && best!.decision.score - entry.decision.score <= 0.040_001);
  const richer = [...sameWork].sort((left, right) =>
    (PROVIDER_PRIORITY[left.candidate.provider] ?? 8) - (PROVIDER_PRIORITY[right.candidate.provider] ?? 8))[0];
  if (richer && (PROVIDER_PRIORITY[richer.candidate.provider] ?? 8) < (PROVIDER_PRIORITY[best.candidate.provider] ?? 8)) best = richer;

  const runner = scored.find((entry) => !sameIdentity(best.candidate, entry.candidate));
  const margin = runner ? Math.round((best.decision.score - runner.decision.score) * 1000) / 1000 : null;
  const expectedId = source.externalIds?.[best.candidate.provider];
  const exactId = Boolean(expectedId && expectedId === best.candidate.externalId);
  const isExactTitleAndYear = (entry: (typeof scored)[number] | undefined) => Boolean(entry
    && entry.decision.reasons.some((reason) => reason === "titre exact" || reason === "titre alternatif exact")
    && entry.decision.reasons.includes("année exacte"));
  // Une marge de trois points n'est pas une ambiguïté quand elle oppose `Iron Man 3` (titre et année
  // exacts) à `Iron Man 3 Unmasked` (simple titre proche). L'ancienne règle annulait TMDB pour les
  // suites, puis laissait Wikidata gagner sans jaquette. Deux fiches réellement exactes restent en
  // revanche concurrentes — cas des doublons et remakes mal datés chez un même fournisseur.
  const exactEvidenceWins = isExactTitleAndYear(best) && !isExactTitleAndYear(runner);
  /**
   * Deux fiches TMDB peuvent porter exactement le même titre et la même année. C'est le cas de
   * `Superman (2025)` : le long métrage officiel, premier résultat TMDB, était bloqué par une fiche
   * homonyme secondaire également notée 1,000. Dans ce seul cas très borné, le rang natif départage :
   * titre ET année doivent être exacts, fournisseur identique, et le gagnant doit être le rang zéro.
   * Sans rang explicite, l'ancien comportement prudent (revue) est strictement conservé.
   */
  const providerRankWins = Boolean(runner
    && best.candidate.provider === runner.candidate.provider
    && isExactTitleAndYear(best) && isExactTitleAndYear(runner)
    && providerSearchRank(best.candidate) === 0
    && providerSearchRank(runner.candidate) != null
    && providerSearchRank(runner.candidate)! > 0);
  const ambiguous = !exactId && !exactEvidenceWins && !providerRankWins && best.decision.status === "automatic"
    && margin !== null && margin < MATCH_AMBIGUITY_MARGIN;
  const status = ambiguous ? "review" : best.decision.status;
  const corroborations = scored.filter((entry) => sameIdentity(best.candidate, entry.candidate)).length;
  const reasons = [...best.decision.reasons];
  if (best !== scored[0]) reasons.push("fiche riche retenue malgré une année de sortie voisine");
  if (corroborations > 1) reasons.push(`œuvre confirmée par ${corroborations} fournisseurs`);
  if (ambiguous) reasons.push(`écart insuffisant avec la seconde proposition (${Math.round((margin ?? 0) * 100)} %)`);
  return {
    candidate: { ...best.candidate, matchReasons: reasons },
    runnerUp: runner?.candidate ?? null,
    candidates: scored.map((entry) => entry.candidate),
    score: best.decision.score,
    status,
    reasons,
    margin,
  };
}
