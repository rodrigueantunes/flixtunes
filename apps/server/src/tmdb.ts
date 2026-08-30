import type { MetadataSearchCandidate } from "@flixtunes/contracts";
import { config } from "./config.js";
import type { ParsedMedia } from "./media-parser.js";
import { getProviderConfiguration } from "./provider-settings.js";
import { rankMetadataMatches, scoreMetadataMatch } from "./match-engine.js";
import { searchWithRelaxation } from "./query-relaxation.js";
import { Cadence, CircuitBreaker, delaiDemande, fetchWithTimeout, LimiteDeDebit } from "./resilience.js";
import { applySeasonEvidence, needsSeasonEvidence } from "./season-evidence.js";

interface TmdbImage {
  file_path: string;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
}

interface TmdbSearchResult {
  id: number;
  title?: string;
  original_title?: string;
  name?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  original_language?: string;
  popularity?: number;
}

interface TmdbAlternativeTitle {
  title?: string;
}

interface TmdbTranslation {
  iso_3166_1?: string;
  iso_639_1?: string;
  data?: { title?: string; name?: string; overview?: string };
}

type RankedTmdbCandidate = MetadataSearchCandidate & { providerSearchRank?: number };

interface TmdbDetails extends TmdbSearchResult {
  imdb_id?: string | null;
  runtime?: number | null;
  episode_run_time?: number[];
  season_number?: number;
  episode_number?: number;
  number_of_seasons?: number;
  /** Longueur de chaque saison : c'est elle qui permet de lire une numérotation absolue. */
  seasons?: Array<{ season_number?: number; episode_count?: number }>;
  still_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | string | null };
  images?: { posters?: TmdbImage[]; backdrops?: TmdbImage[]; stills?: TmdbImage[] };
  /** Sous-réponse de `/translations`, ajoutée aux détails des épisodes en un seul appel. */
  translations?: { translations?: TmdbTranslation[] };
  genres?: Array<{ id: number; name: string }>;
  belongs_to_collection?: { id: number; name: string } | null;
  credits?: {
    cast?: TmdbCredit[];
    crew?: TmdbCredit[];
  };
  created_by?: TmdbCredit[];
  release_dates?: { results?: Array<{ iso_3166_1?: string; release_dates?: Array<{ certification?: string; type?: number }> }> };
  content_ratings?: { results?: Array<{ iso_3166_1?: string; rating?: string }> };
}

interface TmdbCredit {
  id?: number;
  name?: string;
  profile_path?: string | null;
  known_for_department?: string;
  character?: string;
  order?: number;
  job?: string;
  department?: string;
}

export interface EntityMetadata {
  provider: "local" | "tvmaze" | "wikidata" | "anilist" | "tmdb" | "tvdb" | "imdb" | "allocine";
  externalId: string;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: number | null;
  runtimeSeconds: number | null;
  posterSourceUrl: string | null;
  backdropSourceUrl: string | null;
  language: string;
  /** Langue de tournage, distincte de [language] qui est celle des textes demandés. */
  originalLanguage?: string | null;
  confidence: number;
  tvdbId?: string | null;
  /** Âge minimal normalisé et libellé fournisseur, utilisés par les profils enfant. */
  ageRating?: number | null;
  ratingLabel?: string | null;
  /**
   * Genres tels que TMDB les nomme, dans la langue demandée.
   *
   * Ils n'étaient pas récupérés, alors que la réponse les contenait déjà : c'est la seule raison pour
   * laquelle le catalogue ne pouvait pas se filtrer par genre.
   */
  genres?: string[];
  /**
   * Saga à laquelle le film appartient — « Collection » chez TMDB.
   *
   * C'est ce qui regroupe les épisodes d'une même série de films sans qu'on ait à les nommer. Comme
   * les genres, la donnée était déjà dans la réponse et n'était pas lue.
   */
  collection?: { externalId: string; name: string } | null;
  /** Casting limité et équipe créative principale ; aucun crédit secondaire n'est persisté. */
  people?: Array<{
    externalId: string;
    name: string;
    profileUrl: string | null;
    department: string | null;
    role: "actor" | "director" | "creator" | "writer" | "composer";
    character: string | null;
    job: string | null;
    order: number;
  }>;
}

export interface MetadataBundle {
  movie?: EntityMetadata;
  show?: EntityMetadata;
  season?: EntityMetadata;
  episode?: EntityMetadata;
}

const apiRoot = "https://api.themoviedb.org/3";
const imageRoot = "https://image.tmdb.org/t/p";
export const tmdbBreaker = new CircuitBreaker(4, 45_000);
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

/**
 * La cadence des appels à TMDB, et pourquoi elle est là.
 *
 * Rien ne bornait le débit : une analyse complète interroge le fournisseur pour chaque fiche, et les
 * requêtes partaient aussi vite que le réseau les portait. On découvrait la limite en la heurtant,
 * et la réponse `429` était comptée comme une panne — d'où un TMDB qui « disparaissait » quarante-
 * cinq secondes en pleine session de correspondance.
 *
 * Vingt par seconde est délibérément en dessous de ce que TMDB tolère : le but n'est pas d'aller au
 * plus près de la limite, c'est de ne jamais la toucher. Une analyse qui dure une minute de plus ne
 * se remarque pas ; une fiche fausse, si.
 */
const cadenceTmdb = new Cadence(20);

/** Combien de fois on réessaie après un « ralentissez », avant de renoncer pour cette fiche. */
const ESSAIS_APRES_LIMITE = 3;

/** À défaut d'en-tête `Retry-After`, l'attente qu'on s'impose — et qui double à chaque essai. */
const ATTENTE_PAR_DEFAUT_MS = 2_000;

async function tmdbRequest<T>(pathname: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const token = getProviderConfiguration().tmdbToken;
  if (!token) throw new Error("Clé TMDB absente du serveur");
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value != null) search.set(key, value);
  const url = `${apiRoot}${pathname}${search.size ? `?${search}` : ""}`;
  const cached = responseCache.get(url); if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  return tmdbBreaker.run(async () => {
    for (let essai = 0; ; essai += 1) {
      await cadenceTmdb.attendreSonTour();
      const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (response.status === 429) {
        /*
         * TMDB nous demande d'attendre. On attend ce qu'il dit, puis on recommence — et si le délai
         * n'est pas tenable, on remonte une `LimiteDeDebit` que le coupe-circuit laissera passer sans
         * la compter. Le service répond : l'isoler serait le punir d'avoir été poli.
         */
        const attente = delaiDemande(response.headers) ?? ATTENTE_PAR_DEFAUT_MS * 2 ** essai;
        if (essai >= ESSAIS_APRES_LIMITE - 1) throw new LimiteDeDebit("TMDB", attente);
        await new Promise((resolve) => setTimeout(resolve, attente));
        continue;
      }
      // Le code HTTP voyage dans le message : sans lui, l'écran ne pouvait pas dire si le
      // fournisseur était tombé, avait refusé la clé, ou ignorait simplement la fiche demandée.
      if (!response.ok) throw new Error(`TMDB ${response.status}`);
      const value = await response.json() as T; responseCache.set(url, { expiresAt: Date.now() + 10 * 60_000, value });
      if (responseCache.size > 1000) responseCache.delete(responseCache.keys().next().value!);
      return value;
    }
  });
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr")
    .replace(/\b(the|a|an|le|la|les|un|une|des)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function bigrams(value: string): string[] {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

export function titleMatchScore(query: string, candidate: string, expectedYear?: number | null, candidateYear?: number | null): number {
  const left = normalizeTitle(query);
  const right = normalizeTitle(candidate);
  if (!left || !right) return 0;
  let titleScore = 0;
  if (left === right) titleScore = 1;
  else if (left.includes(right) || right.includes(left)) {
    /**
     * Une inclusion vaut d'autant moins que le texte en trop est long.
     *
     * Elle valait 0,88 quel que soit l'écart, si bien que « Incontrolable » comptait autant dans
     * « Steve-O - L'incontrolable de jackass » que « Spectre » dans « James Bond - Spectre ». Mesuré
     * sur la médiathèque réelle : le documentaire sur Jackass l'emportait à 0,959 sur le vrai
     * *Incontrôlable* à 0,951, parce que l'inclusion bénéficiait en plus d'une année exacte quand le
     * bon film, daté 2006 chez le fournisseur pour un fichier de 2005, subissait la pénalité d'écart.
     *
     * Le rapport des longueurs remet les choses d'aplomb sans rien casser : une inclusion serrée
     * — « Spectre » dans « James Bond - Spectre » — reste bien au-dessus du seuil d'acceptation.
     */
    const rapport = Math.min(left.length, right.length) / Math.max(left.length, right.length);
    titleScore = 0.72 + 0.28 * rapport;
  }
  else {
    const rightBigrams = bigrams(right);
    const remaining = [...rightBigrams];
    let overlap = 0;
    for (const pair of bigrams(left)) {
      const index = remaining.indexOf(pair);
      if (index >= 0) { overlap += 1; remaining.splice(index, 1); }
    }
    titleScore = (2 * overlap) / Math.max(1, bigrams(left).length + rightBigrams.length);
  }
  if (!expectedYear || !candidateYear) return titleScore;
  const difference = Math.abs(expectedYear - candidateYear);
  const yearFactor = difference === 0 ? 1 : difference === 1 ? 0.94 : difference <= 3 ? 0.82 : 0.58;
  return titleScore * 0.84 + yearFactor * 0.16;
}

function yearOf(item: TmdbSearchResult): number | null {
  const date = item.release_date ?? item.first_air_date;
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(year) ? year : null;
}

function titleOf(item: TmdbSearchResult): string {
  return item.title?.trim() || item.name?.trim() || item.original_title?.trim() || item.original_name?.trim() || "Sans titre";
}

function originalTitleOf(item: TmdbSearchResult): string | null {
  return item.original_title?.trim() || item.original_name?.trim() || null;
}

function languageOrder(language: string, originalLanguage?: string): Array<string | null> {
  const requested = language.split("-")[0];
  return Array.from(new Set<string | null>([requested ?? "en", requested === "en" ? null : "en", originalLanguage || null, null]));
}

function pickImage(images: TmdbImage[] | undefined, language: string, originalLanguage?: string): string | null {
  if (!images?.length) return null;
  const order = languageOrder(language, originalLanguage);
  const languageRank = (value: string | null | undefined) => {
    const rank = order.indexOf(value ?? null);
    return rank < 0 ? order.length + 1 : rank;
  };
  const sorted = [...images].sort((left, right) => {
    const languageDifference = languageRank(left.iso_639_1) - languageRank(right.iso_639_1);
    if (languageDifference !== 0) return languageDifference;
    return (right.vote_average ?? 0) - (left.vote_average ?? 0) || (right.vote_count ?? 0) - (left.vote_count ?? 0);
  });
  return sorted[0]?.file_path ?? null;
}

function sourceImageUrl(filePath: string | null, size: "w500" | "original"): string | null {
  return filePath ? `${imageRoot}/${size}${filePath}` : null;
}

function internalPreviewUrl(filePath: string | null | undefined): string | null {
  return filePath ? `/api/metadata/image/w342${filePath}` : null;
}

function internalProfileUrl(filePath: string | null | undefined): string | null {
  return filePath ? `/api/metadata/image/w185${filePath}` : null;
}

export async function searchMetadata(
  kind: "movie" | "tv",
  query: string,
  language: string,
  year?: number,
): Promise<MetadataSearchCandidate[]> {
  if (!getProviderConfiguration().tmdbToken) return [];
  const interroger = (avecAnnee: boolean) => tmdbRequest<{ results?: TmdbSearchResult[] }>(`/search/${kind}`, {
    query,
    language,
    include_adult: "false",
    ...(avecAnnee && year ? { [kind === "movie" ? "primary_release_year" : "first_air_date_year"]: String(year) } : {}),
  });

  /**
   * L'année filtre d'abord, puis s'efface si elle n'a rien laissé.
   *
   * TMDB traite `primary_release_year` comme un filtre strict, et son année est celle de la sortie
   * *primaire* — festival, sortie nationale, sortie étrangère peuvent différer d'un an. Mesuré sur la
   * médiathèque réelle : « Mandibules » y est daté 2021 pour un fichier de 2020, « Color Out of
   * Space » 2020 pour un fichier de 2019. Dans ces cas, TMDB ne rendait **rien du tout** et un
   * fournisseur plus pauvre l'emportait par forfait — ce qui ressemblait à une égalité mal départagée
   * alors que TMDB n'était même pas en lice.
   *
   * Le filtre est conservé en premier parce qu'il évite les homonymes ; il n'est retiré que devant une
   * réponse vide, où il n'a plus rien à préserver. L'année reste prise en compte par le score, qui
   * pénalise l'écart au lieu d'exclure.
   */
  let payload = await interroger(true);
  if (year && !(payload.results ?? []).length) payload = await interroger(false);

  return (payload.results ?? []).slice(0, 12).map((item, providerSearchRank) => {
    const candidateYear = yearOf(item);
    const title = titleOf(item);
    const originalTitle = originalTitleOf(item);
    const score = Math.max(titleMatchScore(query, title, year, candidateYear), originalTitle ? titleMatchScore(query, originalTitle, year, candidateYear) : 0);
    return {
      provider: "tmdb" as const,
      externalId: String(item.id),
      kind,
      title,
      originalTitle,
      providerSearchRank,
      year: candidateYear,
      overview: item.overview?.trim() || null,
      posterUrl: internalPreviewUrl(item.poster_path),
      score: Math.round(score * 1000) / 1000,
    };
  }).sort((left, right) => right.score - left.score);
}

/**
 * Demande les alias uniquement lorsqu'une recherche TMDB a trouvé une œuvre de la bonne année mais
 * que nos titres officiels ne suffisent pas à la valider.
 *
 * TMDB recherche aussi dans ses titres alternatifs, sans les inclure dans `/search`. FlixTunes
 * recevait donc le bon résultat pour `Jurassic Park II` ou `Hulk`, puis le rejetait en comparant
 * seulement `Le Monde perdu : Jurassic Park` / `L'Incroyable Hulk`. L'alias qui a permis la recherche
 * doit rester une preuve vérifiable, pas être remplacé par la simple position du résultat.
 */
async function withAlternativeTitles(
  kind: "movie" | "tv",
  candidates: MetadataSearchCandidate[],
  expectedYear?: number | null,
): Promise<MetadataSearchCandidate[]> {
  if (!expectedYear) return candidates;
  const eligible = (candidates as RankedTmdbCandidate[])
    .filter((candidate) => candidate.year === expectedYear)
    .sort((left, right) => (left.providerSearchRank ?? 99) - (right.providerSearchRank ?? 99))
    .slice(0, 3);
  if (!eligible.length) return candidates;
  const aliases = new Map<string, string[]>();
  await Promise.all(eligible.map(async (candidate) => {
    try {
      const payload = await tmdbRequest<{ titles?: TmdbAlternativeTitle[]; results?: TmdbAlternativeTitle[] }>(
        `/${kind}/${candidate.externalId}/alternative_titles`,
      );
      const uniques = new Map<string, string>();
      for (const entry of payload.titles ?? payload.results ?? []) {
        const title = entry.title?.trim();
        if (title) uniques.set(normalizeTitle(title), title);
      }
      aliases.set(candidate.externalId, [...uniques.values()]);
    } catch {
      // L'endpoint d'alias est un renfort : son indisponibilité ne doit jamais annuler la recherche.
    }
  }));
  return candidates.map((candidate) => {
    const alternativeTitles = aliases.get(candidate.externalId);
    return alternativeTitles?.length ? { ...candidate, alternativeTitles } : candidate;
  });
}

async function detailsWithFallback(pathname: string, language: string, includeImages = true): Promise<TmdbDetails> {
  const imageLanguages = `${language.split("-")[0]},en,null`;
  const episode = /^\/tv\/\d+\/season\/\d+\/episode\/\d+$/.test(pathname);
  const rootWork = /^\/(?:movie|tv)\/\d+$/.test(pathname);
  const classification = rootWork ? [pathname.startsWith("/movie/") ? "release_dates" : "content_ratings"] : [];
  const append = ["external_ids", ...(includeImages ? ["images"] : []), ...(rootWork ? ["credits"] : []), ...classification,
    ...(episode && !language.toLowerCase().startsWith("en") ? ["translations"] : [])].join(",");
  const primaryResponse = await tmdbRequest<TmdbDetails>(pathname, {
    language,
    append_to_response: append,
    include_image_language: imageLanguages,
  });
  const primary = episode ? applyEpisodeTranslation(primaryResponse, language) : primaryResponse;
  if (language === "en-US" || (titleOf(primary) !== "Sans titre" && primary.overview?.trim())) return primary;
  try {
    const fallback = await tmdbRequest<TmdbDetails>(pathname, {
      language: "en-US",
      append_to_response: ["external_ids", ...(includeImages ? ["images"] : []), ...(rootWork ? ["credits"] : []), ...classification].join(","),
      include_image_language: "en,null",
    });
    const mergeImages = (localized?: TmdbImage[], english?: TmdbImage[]) => {
      const unique = new Map<string, TmdbImage>();
      for (const image of [...(localized ?? []), ...(english ?? [])]) unique.set(image.file_path, image);
      return [...unique.values()];
    };
    return {
      ...fallback,
      ...primary,
      title: primary.title?.trim() || fallback.title,
      name: primary.name?.trim() || fallback.name,
      overview: primary.overview?.trim() || fallback.overview,
      images: includeImages ? {
        posters: mergeImages(primary.images?.posters, fallback.images?.posters),
        backdrops: mergeImages(primary.images?.backdrops, fallback.images?.backdrops),
        stills: mergeImages(primary.images?.stills, fallback.images?.stills),
      } : primary.images,
      external_ids: primary.external_ids ?? fallback.external_ids,
      credits: primary.credits ?? fallback.credits,
      created_by: primary.created_by ?? fallback.created_by,
      release_dates: primary.release_dates ?? fallback.release_dates,
      content_ratings: primary.content_ratings ?? fallback.content_ratings,
    };
  } catch {
    return primary;
  }
}

/**
 * Prend la traduction demandée dans la sous-réponse explicite de TMDB.
 *
 * Le paramètre `language=fr-FR` des détails d'un épisode peut encore rendre son nom original anglais,
 * notamment lorsque le résumé français est vide. L'endpoint `/translations` contient pourtant le
 * titre français. Il est joint par `append_to_response`, puis préféré par langue et par territoire :
 * aucun appel réseau supplémentaire n'est nécessaire pendant l'analyse d'une série entière.
 */
function applyEpisodeTranslation(details: TmdbDetails, language: string): TmdbDetails {
  const [requestedLanguage, requestedRegion] = language.toLowerCase().split("-");
  if (!requestedLanguage || requestedLanguage === "en") return details;
  const translations = details.translations?.translations?.filter(
    (translation) => translation.iso_639_1?.toLowerCase() === requestedLanguage,
  ) ?? [];
  const localized = [...translations].sort((left, right) => {
    const rank = (translation: TmdbTranslation) => {
      const region = translation.iso_3166_1?.toLowerCase();
      if (requestedRegion && region === requestedRegion) return 0;
      if (!region) return 1;
      return 2;
    };
    return rank(left) - rank(right);
  }).find((translation) => translation.data?.name?.trim()
    || translation.data?.title?.trim()
    || translation.data?.overview?.trim());
  if (!localized?.data) return details;
  return {
    ...details,
    title: localized.data.title?.trim() || details.title,
    name: localized.data.name?.trim() || details.name,
    overview: localized.data.overview?.trim() || details.overview,
  };
}

export function resetTmdbRuntimeCaches(): void {
  responseCache.clear();
}

/** Convertit les principales classifications nationales en âge minimal comparable. */
export function classificationAge(value: string): number | null {
  const normalized = value.normalize("NFKD").replace(/\p{M}+/gu, "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized || ["NR", "UNRATED", "NOTRATED", "NC", "N/A"].includes(normalized)) return null;
  const known: Record<string, number> = {
    U: 0, TP: 0, TOUSPUBLICS: 0, G: 0, TVG: 0, TVY: 0,
    PG: 8, TVY7: 7, TVY7FV: 7, TVPG: 10,
    PG13: 13, TV14: 14, R: 17, TVMA: 17, NC17: 18,
    "12A": 12, R18: 18,
  };
  const compact = normalized.replace(/[^A-Z0-9+]/g, "");
  if (known[compact] != null) return known[compact]!;
  const number = compact.match(/(?:FSK|PEGI|TV)?(\d{1,2})\+?$/)?.[1];
  return number == null ? null : Math.max(0, Math.min(18, Number(number)));
}

function classificationOf(details: TmdbDetails, language: string): { ageRating: number | null; ratingLabel: string | null } {
  const requestedRegion = language.split("-")[1]?.toUpperCase();
  const ranks = (region: string | undefined) => region === requestedRegion ? 0 : region === "FR" ? 1 : region === "US" ? 2 : 3;
  const movie = (details.release_dates?.results ?? []).flatMap((country) =>
    (country.release_dates ?? []).filter((release) => release.certification?.trim()).map((release) => ({
      region: country.iso_3166_1, value: release.certification!.trim(), type: release.type ?? 99,
    }))).sort((left, right) => ranks(left.region) - ranks(right.region) || left.type - right.type)[0];
  const show = [...(details.content_ratings?.results ?? [])].filter((entry) => entry.rating?.trim())
    .sort((left, right) => ranks(left.iso_3166_1) - ranks(right.iso_3166_1))[0];
  const label = movie?.value ?? show?.rating?.trim() ?? null;
  return { ageRating: label ? classificationAge(label) : null, ratingLabel: label };
}

function toEntity(details: TmdbDetails, language: string, confidence: number, fallbackPoster?: string | null): EntityMetadata {
  const posterPath = pickImage(details.images?.posters, language, details.original_language) ?? details.poster_path ?? fallbackPoster ?? null;
  const backdropPath = pickImage(details.images?.backdrops ?? details.images?.stills, language, details.original_language)
    ?? details.backdrop_path ?? details.still_path ?? null;
  const runtimeMinutes = details.runtime ?? details.episode_run_time?.[0] ?? null;
  const classification = classificationOf(details, language);
  const people = new Map<string, NonNullable<EntityMetadata["people"]>[number]>();
  for (const credit of (details.credits?.cast ?? []).slice(0, 24)) {
    if (credit.id == null || !credit.name?.trim()) continue;
    const value: NonNullable<EntityMetadata["people"]>[number] = {
      externalId: String(credit.id), name: credit.name.trim(),
      profileUrl: internalProfileUrl(credit.profile_path),
      department: credit.known_for_department?.trim() || null, role: "actor",
      character: credit.character?.trim() || null, job: null, order: credit.order ?? people.size,
    };
    people.set(`actor:${value.externalId}:${value.character ?? ""}`, value);
  }
  const creativeRole = (credit: TmdbCredit): NonNullable<EntityMetadata["people"]>[number]["role"] | null => {
    const job = credit.job?.toLocaleLowerCase("en") ?? "";
    if (job === "director") return "director";
    if (["writer", "screenplay", "teleplay", "story"].includes(job)) return "writer";
    if (job.includes("music") && (job.includes("composer") || job.includes("score"))) return "composer";
    return null;
  };
  for (const credit of details.credits?.crew ?? []) {
    const role = creativeRole(credit);
    if (!role || credit.id == null || !credit.name?.trim()) continue;
    const value: NonNullable<EntityMetadata["people"]>[number] = {
      externalId: String(credit.id), name: credit.name.trim(), profileUrl: internalProfileUrl(credit.profile_path),
      department: credit.department?.trim() || credit.known_for_department?.trim() || null,
      role, character: null, job: credit.job?.trim() || null, order: people.size,
    };
    people.set(`${role}:${value.externalId}:`, value);
    if ([...people.values()].filter((person) => person.role !== "actor").length >= 12) break;
  }
  for (const credit of details.created_by ?? []) {
    if (credit.id == null || !credit.name?.trim()) continue;
    const value: NonNullable<EntityMetadata["people"]>[number] = {
      externalId: String(credit.id), name: credit.name.trim(), profileUrl: internalProfileUrl(credit.profile_path),
      department: credit.known_for_department?.trim() || null, role: "creator", character: null,
      job: "Création", order: people.size,
    };
    people.set(`creator:${value.externalId}:`, value);
  }
  return {
    provider: "tmdb",
    externalId: String(details.id),
    imdbId: details.external_ids?.imdb_id || details.imdb_id || null,
    title: titleOf(details),
    originalTitle: originalTitleOf(details),
    overview: details.overview?.trim() || null,
    year: yearOf(details),
    runtimeSeconds: runtimeMinutes ? runtimeMinutes * 60 : null,
    posterSourceUrl: sourceImageUrl(posterPath, "w500"),
    backdropSourceUrl: sourceImageUrl(backdropPath, "original"),
    language,
    originalLanguage: details.original_language?.trim() || null,
    confidence,
    tvdbId: details.external_ids?.tvdb_id == null ? null : String(details.external_ids.tvdb_id),
    ...classification,
    genres: details.genres?.map((genre) => genre.name.trim()).filter(Boolean) ?? [],
    collection: details.belongs_to_collection
      ? { externalId: String(details.belongs_to_collection.id), name: details.belongs_to_collection.name.trim() }
      : null,
    people: [...people.values()],
  };
}

/**
 * L'identifiant TMDB qui correspond à un identifiant IMDb ou TheTVDB, ou `null`.
 *
 * TMDB tient cette table lui-même : `/find` répond en une requête, sans comparaison de titres et
 * sans score — c'est une résolution, pas une recherche. D'où la confiance de 1 chez l'appelant.
 *
 * Extrait de `fetchMetadataBundle`, où il ne servait qu'aux identifiants trouvés dans un NFO ou un
 * suffixe de nom de fichier. Il sert désormais aussi à un **choix manuel** : coller un `tt…` dans
 * l'écran de correspondance rend ainsi la fiche TMDB complète — résumé, jaquette, distribution —,
 * là où l'identifiant seul n'aurait donné qu'un numéro.
 *
 * Rend `null` quand TMDB ne connaît pas l'identifiant. L'appelant décide alors quoi en faire ; ici,
 * on ne devine jamais un titre approchant pour compenser.
 */
export async function resoudreIdentifiantExterne(
  identifiant: string,
  source: "imdb_id" | "tvdb_id",
  kind: "movie" | "tv",
): Promise<string | null> {
  if (!getProviderConfiguration().tmdbToken) return null;
  const trouve = await tmdbRequest<{ movie_results?: TmdbSearchResult[]; tv_results?: TmdbSearchResult[] }>(
    `/find/${encodeURIComponent(identifiant)}`, { external_source: source },
  );
  const exact = (kind === "movie" ? trouve.movie_results : trouve.tv_results)?.[0];
  return exact ? String(exact.id) : null;
}

export async function fetchMetadataBundle(
  parsed: ParsedMedia,
  language = config.tmdbLanguage,
  forcedExternalId?: string,
): Promise<MetadataBundle | null> {
  if (!getProviderConfiguration().tmdbToken) return null;
  const kind = parsed.kind === "episode" ? "tv" : "movie";
  const query = parsed.kind === "episode" ? parsed.showTitle : parsed.title;
  if (!query && !forcedExternalId) return null;
  let externalId = forcedExternalId;
  let confidence = forcedExternalId ? 1 : 0;
  // Les identifiants présents dans un NFO ou dans un suffixe Jellyfin sont des preuves, pas des mots
  // à comparer. TMDB sait résoudre directement IMDb et TheTVDB via /find : passer par une recherche
  // de titre perdait précisément l'information la plus fiable du fichier.
  if (!externalId && (parsed.externalIds?.imdb || parsed.externalIds?.tvdb)) {
    const source = parsed.externalIds.imdb ? "imdb_id" : "tvdb_id";
    const id = parsed.externalIds.imdb ?? parsed.externalIds.tvdb!;
    const resolu = await resoudreIdentifiantExterne(id, source, kind);
    if (resolu) { externalId = resolu; confidence = 1; }
  }
  if (!externalId) {
    // Recherche élargie par paliers. Une requête unique laissait sans correspondance toute fiche dont
    // le nom de fichier porte un mot parasite ou une faute de frappe — alors que le score l'aurait
    // acceptée si on lui avait présenté la bonne candidate. L'année reste imposée à chaque tentative :
    // c'est elle qui empêche un titre raccourci de ramener une suite ou un homonyme.
    /**
     * Le score est recalculé contre le titre **entier**, jamais contre la requête raccourcie.
     *
     * `searchMetadata` note chaque candidate d'après la requête qu'on lui a passée. Pendant un
     * élargissement, cette requête est tronquée — et une candidate notée contre un fragment obtient un
     * score qu'elle ne mérite pas. Constaté sur une médiathèque réelle : « Camping 3 » élargi en
     * « Camping » a retenu « Julien Courbet fait son show au camping ! » à 0,899, donc en automatique,
     * parce que ce titre *contient* le mot « camping ». Noté contre « Camping 3 », il tombe à 0,370 et
     * se voit écarté.
     *
     * C'est la contrepartie indispensable de la recherche élargie : on cherche large, mais on juge
     * toujours sur le titre complet.
     */
    const preuves = { title: query || "", titleAliases: parsed.titleAliases, year: parsed.year, externalIds: parsed.externalIds };
    const noterSurTitreComplet = (resultats: MetadataSearchCandidate[]): MetadataSearchCandidate[] =>
      resultats.map((candidat) => {
        const decision = scoreMetadataMatch(preuves, candidat);
        return { ...candidat, score: decision.score, matchReasons: decision.reasons };
      });

    const recherche = await searchWithRelaxation(
      query || "",
      async (essai) => {
        let resultats = noterSurTitreComplet(await searchMetadata(kind, essai, language, parsed.year ?? undefined));
        if (rankMetadataMatches(preuves, resultats).status !== "automatic") {
          resultats = noterSurTitreComplet(await withAlternativeTitles(kind, resultats, parsed.year));
        }
        return resultats;
      },
      // Une proposition seulement « à revoir » ne suffit jamais à arrêter l'élargissement : la
      // tentative suivante peut encore trouver l'œuvre exacte avec l'année conservée.
      (resultats) => rankMetadataMatches(
        preuves, resultats,
      ).status === "automatic",
    );
    let candidates = [...recherche.resultats].sort((gauche, droite) => droite.score - gauche.score);
    // Départage par le nombre de saisons présentes sur le disque, et seulement lorsque les deux
    // premiers candidats sont au coude à coude : un dossier « Daredevil » contenant trois saisons ne
    // peut pas désigner une série qui n'en compte qu'une. Le détail n'est demandé que pour les trois
    // premiers, sans quoi on multiplierait les requêtes sur toute une médiathèque.
    const seasonsOnDisk = parsed.seasonsOnDisk ?? 0;
    if (kind === "tv" && needsSeasonEvidence(candidates, seasonsOnDisk)) {
      const seasonsByCandidate = new Map<string, number>();
      await Promise.all(candidates.slice(0, 3).map(async (candidate) => {
        try {
          const details = await detailsWithFallback(`/tv/${candidate.externalId}`, language) as TmdbDetails;
          if (typeof details.number_of_seasons === "number") seasonsByCandidate.set(candidate.externalId, details.number_of_seasons);
        } catch {
          // Un détail indisponible laisse le candidat inchangé : l'ignorance ne se paie pas.
        }
      }));
      candidates = applySeasonEvidence(candidates, seasonsOnDisk, seasonsByCandidate) as typeof candidates;
    }
    const classement = rankMetadataMatches(
      preuves, candidates,
    );
    const match = classement.candidate;
    // Une revue n'est pas une correspondance. Aucun titre, identifiant ni regroupement distant ne
    // doit être appliqué avant qu'une personne ait tranché.
    if (!match || classement.status !== "automatic") return null;
    externalId = match.externalId;
    confidence = classement.score;
  }

  if (kind === "movie") {
    const details = await detailsWithFallback(`/movie/${externalId}`, language);
    return { movie: toEntity(details, language, confidence) };
  }

  const showDetails = await detailsWithFallback(`/tv/${externalId}`, language);
  const show = toEntity(showDetails, language, confidence);
  const bundle: MetadataBundle = { show };
  if (parsed.seasonNumber == null) return bundle;
  try {
    const seasonDetails = await detailsWithFallback(`/tv/${externalId}/season/${parsed.seasonNumber}`, language);
    bundle.season = toEntity(seasonDetails, language, confidence, null);
  } catch {
    // La série reste correctement identifiée si TMDB ne possède pas cette saison.
  }
  if (parsed.episodeNumber == null) return bundle;
  try {
    const episodeDetails = await detailsWithFallback(
      `/tv/${externalId}/season/${parsed.seasonNumber}/episode/${parsed.episodeNumber}`,
      language,
      false,
    );
    bundle.episode = toEntity(episodeDetails, language, confidence, null);
  } catch {
    // Le titre issu du fichier reste disponible si l'épisode n'existe pas chez TMDB.
  }
  // Deuxième lecture, seulement si la première a échoué : le numéro était peut-être absolu.
  if (!bundle.episode) {
    const relatif = numeroRelatif(showDetails.seasons, parsed.episodeNumber);
    if (relatif) {
      try {
        const episodeDetails = await detailsWithFallback(
          `/tv/${externalId}/season/${relatif.season}/episode/${relatif.episode}`, language, false);
        bundle.episode = toEntity(episodeDetails, language, confidence, null);
      } catch {
        // La série et la saison restent correctes ; seul le titre de l'épisode manquera.
      }
    }
  }
  return bundle;
}

/**
 * Convertit un numéro d'épisode absolu en couple saison/épisode, d'après la longueur des saisons.
 *
 * Les séries longues sont très souvent rangées en numérotation continue : `Naruto Shippuden - 078`
 * dans un dossier `Saison 4`. Le fichier annonce alors la saison 4 et l'épisode 78, et le fournisseur
 * est interrogé sur un S04E78 qui n'existe pas — la saison 4 en compte vingt-cinq. Mesuré sur la
 * médiathèque réelle : la saison 1 de Naruto Shippuden était identifiée à trente épisodes sur trente,
 * et **aucun** épisode ne l'était à partir de la saison 4. Mille six cent vingt-six épisodes
 * restaient sans titre ni résumé pour cette seule raison.
 *
 * La conversion n'est tentée qu'après l'échec de la recherche directe : une correspondance qui
 * fonctionne aujourd'hui ne peut donc pas changer. La saison 0 est ignorée — les spéciaux ne comptent
 * pas dans une numérotation continue — et un numéro dépassant le total connu ne rend rien plutôt que
 * de désigner un épisode au hasard.
 */
export function numeroRelatif(
  seasons: Array<{ season_number?: number; episode_count?: number }> | undefined,
  absolu: number,
): { season: number; episode: number } | null {
  if (!seasons?.length || !Number.isInteger(absolu) || absolu < 1) return null;
  const ordonnees = seasons
    .filter((saison) => typeof saison.season_number === "number" && saison.season_number > 0
      && typeof saison.episode_count === "number" && saison.episode_count > 0)
    .sort((gauche, droite) => gauche.season_number! - droite.season_number!);
  if (!ordonnees.length) return null;
  // Un numéro qui tient dans la première saison n'est pas absolu : c'est le cas ordinaire, déjà traité.
  if (absolu <= ordonnees[0]!.episode_count!) return null;
  let cumul = 0;
  for (const saison of ordonnees) {
    if (absolu <= cumul + saison.episode_count!) return { season: saison.season_number!, episode: absolu - cumul };
    cumul += saison.episode_count!;
  }
  return null;
}

export async function fetchTmdbPreview(imagePath: string): Promise<Response> {
  if (!/^\/(?:w\d+|original)\/[a-zA-Z0-9_.\/-]+$/.test(imagePath)) throw new Error("Chemin d'image invalide");
  return fetchWithTimeout(`${imageRoot}${imagePath}`, { headers: { Accept: "image/*" } }, 15_000);
}
