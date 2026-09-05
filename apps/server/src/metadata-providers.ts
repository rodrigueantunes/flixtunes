import type { MetadataProviderStatus, MetadataSearchCandidate } from "@flixtunes/contracts";
import type { ParsedMedia } from "./media-parser.js";
import { fetchMetadataBundle, resetTmdbRuntimeCaches, searchMetadata, titleMatchScore, tmdbBreaker, type EntityMetadata, type MetadataBundle } from "./tmdb.js";
import { MATCH_THRESHOLDS, rankMetadataMatches, scoreMetadataMatch } from "./match-engine.js";
import { searchAnilist } from "./anilist.js";
import { CircuitBreaker, fetchWithTimeout, LimiteDeDebit } from "./resilience.js";
import { getProviderConfiguration, type ProviderConfiguration } from "./provider-settings.js";
import { fetchTvmazeBundle, fetchWikidataBundle, resetOpenMetadataCaches, searchTvmaze, searchWikidata } from "./open-metadata.js";

type RemoteProvider = "tvmaze" | "wikidata" | "anilist" | "tmdb" | "tvdb" | "imdb" | "allocine" | "fanart" | "youtube";
interface ProviderHealth { health: "idle" | "healthy" | "degraded"; lastSuccessAt: string | null; lastError: string | null; latencyMs: number | null }
const providerHealth = new Map<RemoteProvider, ProviderHealth>();

async function observe<T>(provider: RemoteProvider, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await operation();
    providerHealth.set(provider, { health: "healthy", lastSuccessAt: new Date().toISOString(), lastError: null,
      latencyMs: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    providerHealth.set(provider, { health: "degraded", lastSuccessAt: providerHealth.get(provider)?.lastSuccessAt ?? null,
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 180), latencyMs: Math.round(performance.now() - started) });
    throw error;
  }
}

export function buildProviderStatuses(settings: ProviderConfiguration): MetadataProviderStatus[] {
  return [
    { id: "local", name: "Métadonnées locales / NFO", role: "local", configured: true, enabled: true,
      legalMode: "local", message: "Prioritaire, hors ligne et sans modifier les fichiers." },
    { id: "tvmaze", name: "TVmaze", role: "metadata", configured: true, enabled: true,
      legalMode: "open-api", message: "Séries et affiches automatiques, sans clé utilisateur." },
    { id: "anilist", name: "AniList", role: "metadata", configured: true, enabled: true,
      legalMode: "open-api", message: "Anime et titres japonais, sans clé utilisateur." },
    { id: "wikidata", name: "Wikidata / Wikimedia", role: "metadata", configured: true, enabled: true,
      legalMode: "open-api", message: "Films, identifiants et images libres, sans clé utilisateur." },
    { id: "tmdb", name: "The Movie Database", role: "metadata", configured: Boolean(settings.tmdbToken), enabled: Boolean(settings.tmdbToken),
      legalMode: "open-api", message: settings.tmdbToken ? "API active en français et anglais." : "Ajoutez TMDB_ACCESS_TOKEN." },
    { id: "tvdb", name: "TheTVDB", role: "metadata", configured: Boolean(settings.tvdbApiKey), enabled: Boolean(settings.tvdbApiKey),
      legalMode: "licensed-api", message: settings.tvdbApiKey ? "API v4 active." : "Ajoutez TVDB_API_KEY si votre abonnement l'autorise." },
    { id: "fanart", name: "Fanart.tv", role: "artwork", configured: Boolean(settings.fanartApiKey), enabled: Boolean(settings.fanartApiKey),
      legalMode: "open-api", message: settings.fanartApiKey ? "Complément d'illustrations actif." : "Ajoutez FANART_API_KEY." },
    { id: "imdb", name: "IMDb", role: "metadata", configured: Boolean(settings.imdbApiUrl && settings.imdbApiToken),
      enabled: Boolean(settings.imdbApiUrl && settings.imdbApiToken), legalMode: "licensed-api",
      message: settings.imdbApiUrl && settings.imdbApiToken ? "Connecteur licencié actif." : "Nécessite un accès API IMDb licencié." },
    // YouTube ne sert que les bibliotheques web, et n'est jamais interroge pour un film ou une serie.
    { id: "youtube", name: "YouTube Data API", role: "web", configured: Boolean(settings.youtubeApiKey),
      enabled: Boolean(settings.youtubeApiKey), legalMode: "open-api",
      message: settings.youtubeApiKey
        ? "Titres, dates et vignettes des bibliothèques web."
        : "Ajoutez YOUTUBE_API_KEY pour dater et illustrer les vidéos web." },
    { id: "allocine", name: "Allociné", role: "metadata", configured: Boolean(settings.allocineApiUrl && settings.allocineApiToken),
      enabled: Boolean(settings.allocineApiUrl && settings.allocineApiToken), legalMode: "licensed-api",
      message: settings.allocineApiUrl && settings.allocineApiToken ? "Connecteur licencié actif." : "Pas de scraping : activez uniquement une API officielle/licenciée." },
  ];
}

export function metadataProviderStatuses(): MetadataProviderStatus[] {
  return buildProviderStatuses(getProviderConfiguration()).map((status) => ({ ...status,
    ...(status.id === "local" ? { health: "healthy" as const, lastSuccessAt: null, lastError: null, latencyMs: 0 }
      : providerHealth.get(status.id as RemoteProvider) ?? { health: "idle" as const, lastSuccessAt: null, lastError: null, latencyMs: null }) }));
}

let tvdbToken: { value: string; expiresAt: number } | null = null;
const tvdbBreaker = new CircuitBreaker(4, 45_000);
const fanartBreaker = new CircuitBreaker(4, 45_000);
const licensedBreakers = {
  imdb: new CircuitBreaker(4, 45_000),
  allocine: new CircuitBreaker(4, 45_000),
};

async function getTvdbToken(): Promise<string> {
  if (tvdbToken && tvdbToken.expiresAt > Date.now()) return tvdbToken.value;
  const settings = getProviderConfiguration();
  if (!settings.tvdbApiKey) throw new Error("Clé TheTVDB absente");
  const response = await tvdbBreaker.run(() => fetchWithTimeout("https://api4.thetvdb.com/v4/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: settings.tvdbApiKey, ...(settings.tvdbPin ? { pin: settings.tvdbPin } : {}) }),
  }));
  if (!response.ok) throw new Error(`TheTVDB ${response.status}`);
  const payload = await response.json() as { data?: { token?: string } };
  if (!payload.data?.token) throw new Error("Jeton TheTVDB absent");
  tvdbToken = { value: payload.data.token, expiresAt: Date.now() + 27 * 24 * 60 * 60 * 1000 };
  return tvdbToken.value;
}

async function searchTvdb(kind: "movie" | "tv", query: string, language: string, year?: number): Promise<MetadataSearchCandidate[]> {
  if (!getProviderConfiguration().tvdbApiKey) return [];
  const token = await getTvdbToken();
  const params = new URLSearchParams({ query, type: kind === "tv" ? "series" : "movie", lang: language.split("-")[0] || "en" });
  if (year) params.set("year", String(year));
  const response = await tvdbBreaker.run(() => fetchWithTimeout(`https://api4.thetvdb.com/v4/search?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }));
  if (!response.ok) throw new Error(`TheTVDB ${response.status}`);
  const payload = await response.json() as { data?: Array<{ tvdb_id?: string; id?: string; name?: string; year?: string; overview?: string; image_url?: string }> };
  return (payload.data ?? []).slice(0, 12).flatMap((item): MetadataSearchCandidate[] => {
    const id = item.tvdb_id ?? item.id; if (!id || !item.name) return [];
    const candidateYear = item.year ? Number(item.year) || null : null;
    return [{ provider: "tvdb", externalId: String(id), kind, title: item.name, originalTitle: null, year: candidateYear,
      overview: item.overview?.trim() || null, posterUrl: item.image_url || null,
      score: Math.round(titleMatchScore(query, item.name, year, candidateYear) * 1000) / 1000 }];
  });
}

type LicensedProvider = "imdb" | "allocine";
type LicensedItem = Record<string, unknown>;

function firstText(item: LicensedItem, ...names: string[]): string | null {
  for (const name of names) {
    const value = item[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function licensedItems(payload: unknown): LicensedItem[] {
  if (Array.isArray(payload)) return payload.filter((item): item is LicensedItem => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const root = payload as LicensedItem;
  for (const key of ["results", "items", "data"]) {
    const value = root[key];
    if (Array.isArray(value)) return value.filter((item): item is LicensedItem => Boolean(item && typeof item === "object"));
    if (value && typeof value === "object") {
      const nested = value as LicensedItem;
      for (const nestedKey of ["results", "items"]) if (Array.isArray(nested[nestedKey])) {
        return (nested[nestedKey] as unknown[]).filter((item): item is LicensedItem => Boolean(item && typeof item === "object"));
      }
    }
  }
  return [];
}

async function searchLicensedProvider(
  provider: LicensedProvider,
  apiUrl: string | null,
  token: string | null,
  kind: "movie" | "tv",
  query: string,
  language: string,
  year?: number,
): Promise<MetadataSearchCandidate[]> {
  if (!apiUrl || !token) return [];
  const url = new URL(apiUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("kind", kind);
  url.searchParams.set("language", language);
  if (year) url.searchParams.set("year", String(year));
  const response = await licensedBreakers[provider].run(() => fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }));
  if (!response.ok) throw new Error(`${provider === "imdb" ? "IMDb" : "Allociné"} ${response.status}`);
  return licensedItems(await response.json()).slice(0, 12).flatMap((item): MetadataSearchCandidate[] => {
    const externalId = firstText(item, "externalId", "id", provider === "imdb" ? "imdbId" : "allocineId");
    const title = firstText(item, "localizedTitle", "title", "name");
    if (!externalId || !title) return [];
    const rawYear = firstText(item, "year", "releaseYear");
    const candidateYear = rawYear && Number.isInteger(Number(rawYear)) ? Number(rawYear) : null;
    return [{ provider, externalId, kind, title, originalTitle: firstText(item, "originalTitle", "original_name"),
      year: candidateYear, overview: firstText(item, "overview", "plot", "description"),
      posterUrl: firstText(item, "posterUrl", "poster", "imageUrl"),
      score: Math.round(titleMatchScore(query, title, year, candidateYear) * 1000) / 1000 }];
  });
}

/** Nombre de propositions rendues. Assez pour trancher, assez peu pour rester lisible. */
const SEARCH_RESULT_LIMIT = 20;

/**
 * Recherche agrégée.
 *
 * `year` est une année exacte, transmise aux fournisseurs qui filtrent dessus : c'est ce que veut
 * l'analyse automatique. `minYear` est un seuil saisi à la main lors d'une correction ; il n'est
 * jamais transmis aux fournisseurs — sinon il redeviendrait un filtre exact — mais appliqué sur les
 * résultats. Une fiche sans année connue n'est pas écartée : l'ignorer reviendrait à punir un
 * fournisseur avare de métadonnées.
 */
/**
 * Ordre de préférence entre fournisseurs, à score égal.
 *
 * Le tri ne portait que sur le score, et `Array.prototype.sort` est stable : à égalité, c'était donc
 * l'ordre de lancement des requêtes qui tranchait — Wikidata est interrogé avant TMDB, et passait
 * devant lui sur toute correspondance parfaite. Un détail d'implémentation décidait de la fiche.
 *
 * TMDB vient en tête parce qu'il apporte ce que les autres n'ont pas : jaquettes et fonds dans la
 * langue demandée, genres, saga, langue de tournage, durée. Une fiche Wikidata correcte reste une
 * fiche pauvre. Les fournisseurs sous licence suivent, puis les ouverts, qui servent surtout de
 * continuité quand TMDB est indisponible.
 */
const PRIORITE_FOURNISSEUR: Record<string, number> = {
  tmdb: 0, tvdb: 1, imdb: 2, allocine: 3, anilist: 4, tvmaze: 5, wikidata: 6, local: 7, fanart: 9,
};

/** Départage deux candidates : le score d'abord, la richesse du fournisseur ensuite. */
export function comparerCandidates(gauche: MetadataSearchCandidate, droite: MetadataSearchCandidate): number {
  if (droite.score !== gauche.score) return droite.score - gauche.score;
  return (PRIORITE_FOURNISSEUR[gauche.provider] ?? 8) - (PRIORITE_FOURNISSEUR[droite.provider] ?? 8);
}

export async function searchAllMetadata(kind: "movie" | "tv", query: string, language: string, year?: number,
  minYear?: number): Promise<MetadataSearchCandidate[]> {
  const settings = getProviderConfiguration();
  const searches: Array<Promise<MetadataSearchCandidate[]>> = [];
  if (process.env.NODE_ENV !== "test" && kind === "tv") searches.push(observe("tvmaze", () => searchTvmaze(query, language, year)));
  if (process.env.NODE_ENV !== "test" && kind === "movie") searches.push(observe("wikidata", () => searchWikidata(query, language, year)));
  if (settings.tmdbToken) searches.push(observe("tmdb", () => searchMetadata(kind, query, language, year)));
  // AniList ne demande aucune clé et couvre ce que TMDB rend mal : les titres japonais, dont les
  // fiches portent souvent le natif en kanji, illisible depuis un nom de fichier romanisé.
  if (process.env.NODE_ENV !== "test") searches.push(observe("anilist", () => searchAnilist(kind, query, year)));
  if (settings.tvdbApiKey) searches.push(observe("tvdb", () => searchTvdb(kind, query, language, year)));
  if (settings.imdbApiUrl && settings.imdbApiToken) searches.push(observe("imdb", () => searchLicensedProvider("imdb", settings.imdbApiUrl, settings.imdbApiToken, kind, query, language, year)));
  if (settings.allocineApiUrl && settings.allocineApiToken) searches.push(observe("allocine", () => searchLicensedProvider("allocine", settings.allocineApiUrl, settings.allocineApiToken, kind, query, language, year)));
  const settled = await Promise.allSettled(searches);
  const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const unique = new Map<string, MetadataSearchCandidate>();
  for (const candidate of candidates) unique.set(`${candidate.provider}:${candidate.externalId}`, candidate);
  return [...unique.values()].map((candidate) => {
    const decision = scoreMetadataMatch({ title: query, year }, candidate);
    return { ...candidate, score: decision.score, matchReasons: decision.reasons };
  }).filter((candidate) => candidate.score >= 0.25)
    .filter((candidate) => minYear == null || candidate.year == null || candidate.year >= minYear)
    .sort(comparerCandidates).slice(0, SEARCH_RESULT_LIMIT);
}

function candidateEntity(candidate: MetadataSearchCandidate, language: string): EntityMetadata {
  return {
    provider: candidate.provider as Exclude<MetadataSearchCandidate["provider"], "fanart">,
    externalId: candidate.externalId,
    imdbId: candidate.provider === "imdb" || /^tt\d+$/i.test(candidate.externalId) ? candidate.externalId : null,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    overview: candidate.overview,
    year: candidate.year,
    runtimeSeconds: null,
    posterSourceUrl: candidate.posterUrl?.startsWith("http") ? candidate.posterUrl : null,
    backdropSourceUrl: null,
    language,
    confidence: candidate.score,
    tvdbId: candidate.provider === "tvdb" ? candidate.externalId : null,
  };
}

interface FanartAsset { url?: string; lang?: string; likes?: string }
function pickFanart(items: FanartAsset[] | undefined, language: string): string | null {
  if (!items?.length) return null;
  const requested = language.split("-")[0]?.toLowerCase() || "en";
  const order = [requested, "en", "00", ""];
  return [...items].sort((left, right) => {
    const leftLanguage = (left.lang ?? "").toLowerCase(); const rightLanguage = (right.lang ?? "").toLowerCase();
    const languageDelta = (order.indexOf(leftLanguage) < 0 ? 99 : order.indexOf(leftLanguage))
      - (order.indexOf(rightLanguage) < 0 ? 99 : order.indexOf(rightLanguage));
    return languageDelta || Number(right.likes ?? 0) - Number(left.likes ?? 0);
  })[0]?.url ?? null;
}

export async function augmentArtworkWithFanart(
  bundle: MetadataBundle | null,
  kind: "movie" | "tv",
  language: string,
): Promise<MetadataBundle | null> {
  const fanartApiKey = getProviderConfiguration().fanartApiKey;
  if (!bundle || !fanartApiKey) return bundle;
  const entity = kind === "movie" ? bundle.movie : bundle.show;
  if (!entity) return bundle;
  const externalId = kind === "movie" && entity.provider === "tmdb" ? entity.externalId : entity.tvdbId;
  if (!externalId) return bundle;
  try {
    const response = await fanartBreaker.run(() => fetchWithTimeout(
      `https://webservice.fanart.tv/v3/${kind === "movie" ? "movies" : "tv"}/${encodeURIComponent(externalId)}?api_key=${encodeURIComponent(fanartApiKey)}`,
      { headers: { Accept: "application/json" } },
    ));
    if (!response.ok) return bundle;
    const payload = await response.json() as Record<string, FanartAsset[] | undefined>;
    entity.posterSourceUrl ??= pickFanart(kind === "movie" ? payload.movieposter : payload.tvposter, language);
    entity.backdropSourceUrl ??= pickFanart(kind === "movie" ? payload.moviebackground : payload.showbackground, language);
  } catch {
    // Les images TMDB/locales restent disponibles si Fanart.tv est hors ligne.
  }
  return bundle;
}

export function resetProviderRuntimeCaches(): void {
  tvdbToken = null;
  resetTmdbRuntimeCaches();
  resetOpenMetadataCaches();
  providerHealth.clear();
}

/**
 * Ramène la confiance d'un repli sous le seuil d'acceptation automatique.
 *
 * Le contenu reste utilisable — mieux vaut une fiche Wikidata qu'aucune fiche — mais elle est
 * présentée pour ce qu'elle est : un pis-aller retenu parce que le fournisseur principal ne répondait
 * pas. Sous le seuil, la reprise ciblée la réexamine d'elle-même au passage suivant, quand TMDB est de
 * nouveau joignable. Au-dessus, elle serait tenue pour acquise et ne bougerait plus jamais.
 */
export function aRevoir(bundle: MetadataBundle): MetadataBundle {
  const abaisser = (entite?: EntityMetadata) => entite
    ? { ...entite, confidence: Math.min(entite.confidence, MATCH_THRESHOLDS.automatic - 0.02) }
    : entite;
  return {
    movie: abaisser(bundle.movie), show: abaisser(bundle.show),
    season: abaisser(bundle.season), episode: abaisser(bundle.episode),
  };
}

/**
 * Autorise un fournisseur à réparer un nom rejeté localement uniquement avec une preuve distante
 * redondante. Un titre exact trouvé par deux fournisseurs indépendants vaut davantage que l'heuristique
 * du nom de fichier ; un résultat isolé, proche ou ambigu reste bloqué comme auparavant.
 */
export function providerEvidenceOverridesRejectedDetection(
  status: "automatic" | "review" | "rejected",
  reasons: string[],
): boolean {
  if (status !== "automatic") return false;
  const exactTitle = reasons.some((reason) => reason === "titre exact" || reason === "titre alternatif exact");
  const corroborated = reasons.some((reason) => /^œuvre confirmée par (?:[2-9]|\d{2,}) fournisseurs$/.test(reason));
  return exactTitle && corroborated;
}

/**
 * Utilise un fournisseur secondaire comme preuve d'identité, jamais comme fiche finale.
 *
 * Une série nommée seulement `Silo` ou `Lucky` possède plusieurs homonymes TMDB et aucune année dans
 * son dossier. TVmaze retrouve pourtant une fiche datée ; si son titre et son année correspondent à
 * une candidate TMDB automatique, cette dernière porte les détails et les traductions. Sans année
 * secondaire, l'ambiguïté reste entière et aucune préférence n'est inventée.
 */
export function tmdbConfirmedByFallback(
  candidates: MetadataSearchCandidate[],
  fallback: EntityMetadata | null | undefined,
): MetadataSearchCandidate | null {
  if (!fallback || fallback.provider === "tmdb" || fallback.year == null) return null;
  const fallbackTitles = [fallback.title, fallback.originalTitle ?? ""].filter(Boolean);
  const compatible = candidates.filter((candidate) => {
    if (candidate.provider !== "tmdb" || candidate.score < MATCH_THRESHOLDS.automatic || candidate.year == null) return false;
    if (Math.abs(candidate.year - fallback.year!) > 1) return false;
    const candidateTitles = [candidate.title, candidate.originalTitle ?? "", ...(candidate.alternativeTitles ?? [])].filter(Boolean);
    return fallbackTitles.some((left) => candidateTitles.some((right) => titleMatchScore(left, right) >= 0.98));
  }) as Array<MetadataSearchCandidate & { providerSearchRank?: number }>;
  return compatible.sort((left, right) =>
    (left.providerSearchRank ?? Number.MAX_SAFE_INTEGER) - (right.providerSearchRank ?? Number.MAX_SAFE_INTEGER)
    || right.score - left.score)[0] ?? null;
}

/**
 * Interroger TMDB, et **attendre son retour** plutôt que se contenter d'un autre.
 *
 * TMDB reste le fournisseur de référence : quand la fiche existe chez lui, c'est la sienne qu'on
 * veut. Se rabattre parce qu'il était occupé trente secondes produit une fiche pauvre qu'il faudra
 * reprendre — et jusqu'à r87, une fiche automatique au-dessus du seuil n'était jamais reprise.
 * Trente-neuf films de la médiathèque étaient restés ainsi sur Wikidata.
 *
 * Pendant une analyse automatique, la patience ne coûte rien : personne ne regarde l'écran, et le
 * coupe-circuit dit exactement combien de temps il reste. On attend donc ce délai, puis on
 * recommence — au plus trois fois, soit un peu plus de deux minutes. Passé cela, le service est
 * considéré comme réellement absent et le repli reprend ses droits, marqué « à revoir ».
 *
 * **Une recherche interactive n'attend pas** : quelqu'un est devant l'écran, et une fenêtre figée
 * deux minutes est un défaut, pas une précaution. C'est tout l'objet de `patienter`.
 */
const TOURS_DE_PATIENCE = 3;

async function tmdbEnPatientant(
  patienter: boolean,
  operation: () => Promise<MetadataBundle | null>,
): Promise<{ bundle: MetadataBundle | null; indisponible: boolean }> {
  for (let tour = 0; ; tour += 1) {
    try {
      return { bundle: await operation(), indisponible: false };
    } catch (error) {
      const attente = error instanceof LimiteDeDebit ? error.attendreMs : tmdbBreaker.msAvantReouverture();
      // On n'attend que ce qui a une fin connue. Une panne franche — clé refusée, réseau coupé —
      // n'ouvre aucun délai : elle se constate tout de suite et le repli part sans faire patienter.
      if (!patienter || attente <= 0 || tour >= TOURS_DE_PATIENCE - 1) {
        return { bundle: null, indisponible: true };
      }
      console.info(`[FlixTunes] TMDB indisponible, reprise dans ${Math.round(attente / 1000)} s `
        + `(essai ${tour + 2} sur ${TOURS_DE_PATIENCE})`);
      await new Promise((resolve) => setTimeout(resolve, attente + 250));
    }
  }
}

export async function fetchMetadataWithProviders(
  parsed: ParsedMedia,
  language: string,
  forced?: { provider: string; id: string },
  options: { patienter?: boolean } = {},
): Promise<MetadataBundle | null> {
  const explicitId = Boolean(forced || parsed.externalIds?.tmdb || parsed.externalIds?.imdb || parsed.externalIds?.tvdb);
  // Une détection « revue » signale plusieurs preuves locales proches ; elle ne doit pas interdire à
  // un fournisseur de les départager par un titre et une année exacts. Seul un nom réellement rejeté
  // reste bloquant. Cela évite que ponctuation intégrée et dossier parent neutralisent une fiche TMDB
  // pourtant parfaite (`Le Cinquième élément`, `Avengers : L'Ère d'Ultron`).
  const detectionAllowsAutomatic = explicitId || !parsed.detection?.decision || parsed.detection.decision !== "rejet";
  /**
   * TMDB a-t-il été empêché de répondre, ou a-t-il répondu « je ne connais pas » ?
   *
   * La distinction décide de tout ce qui suit. Une analyse complète interroge le fournisseur pour
   * chaque film ; au bout de quelques centaines, la limite de débit se déclenche et le coupe-circuit
   * s'ouvre pour quarante-cinq secondes. Pendant ce temps, **toutes** les fiches basculaient sur un
   * fournisseur de secours, et le résultat était figé comme correspondance automatique sûre.
   *
   * Mesuré sur la médiathèque réelle : 39 films restés sur Wikidata alors que TMDB les rend
   * aujourd'hui à un score parfait — « Amistad », « BAC Nord », « Camping 3 ». Rien ne les
   * réexaminait, puisqu'une fiche automatique au-dessus du seuil n'est jamais reprise.
   */
  let tmdbIndisponible = false;
  if (!forced || forced.provider === "tmdb") {
    // Pendant une analyse automatique, on patiente : voir `tmdbEnPatientant`. Un fournisseur
    // secondaire assure ensuite la continuité, mais son résultat ne vaudra jamais certitude.
    const essai = await tmdbEnPatientant(options.patienter === true,
      () => fetchMetadataBundle(parsed, language, forced?.id ?? parsed.externalIds?.tmdb));
    tmdbIndisponible = essai.indisponible;
    if (essai.bundle && detectionAllowsAutomatic) {
      return augmentArtworkWithFanart(essai.bundle, parsed.kind === "episode" ? "tv" : "movie", language);
    }
  }
  const kind = parsed.kind === "episode" ? "tv" : "movie";
  let openFallback: MetadataBundle | null = null;
  if (process.env.NODE_ENV !== "test" && (!forced || forced.provider === (kind === "tv" ? "tvmaze" : "wikidata"))) {
    try {
      const open = kind === "tv"
        ? await observe("tvmaze", () => fetchTvmazeBundle(parsed, language, forced?.provider === "tvmaze" ? forced.id : undefined))
        : await observe("wikidata", () => fetchWikidataBundle(parsed, language, forced?.provider === "wikidata" ? forced.id : undefined));
      const identity = open && (kind === "tv" ? open.show : open.movie);
      if (open && forced) return open;
      if (open && detectionAllowsAutomatic && identity && identity.confidence >= MATCH_THRESHOLDS.automatic) {
        // Ne jamais court-circuiter la recherche agrégée avec la première réponse ouverte. Sur la
        // médiathèque réelle, Iron Man 3 et Spider-Man 2/3 étaient ainsi reconnus par Wikidata avant
        // que TMDB n'apporte pourtant leur fiche complète et leur affiche. Ce résultat reste un bon
        // repli si aucun fournisseur plus riche ne confirme ensuite l'œuvre.
        openFallback = open;
      }
    } catch {
      // Les NFO, autres fournisseurs et miniatures locales restent disponibles.
    }
  }
  const query = parsed.kind === "episode" ? parsed.showTitle : parsed.title;
  if (!query) return null;
  const candidates = await searchAllMetadata(kind, query, language, parsed.year ?? undefined);
  // `searchAllMetadata` is volontairement tolérant : Promise.allSettled conserve les autres agents
  // quand l'un d'eux tombe. Cette tolérance masquait toutefois l'échec TMDB au code appelant. Le
  // meilleur résultat secondaire (TVmaze pour Silo/Lucky, Wikidata pour BAC Nord) retrouvait alors
  // une confiance de 1 et devenait définitif — exactement le défaut que le premier garde-fou ne
  // couvrait que lorsque la recherche agrégée ne rendait aucune candidate.
  if (getProviderConfiguration().tmdbToken && providerHealth.get("tmdb")?.health === "degraded") {
    tmdbIndisponible = true;
  }
  const classement = rankMetadataMatches({ title: query, year: parsed.year, externalIds: parsed.externalIds },
    candidates.filter((item) => item.provider !== "fanart"));
  const providerRescue = parsed.detection?.decision === "rejet"
    && providerEvidenceOverridesRejectedDetection(classement.status, classement.reasons);
  const fallbackIdentity = kind === "tv" ? openFallback?.show : openFallback?.movie;
  const tmdbCorroborated = !forced && detectionAllowsAutomatic
    ? tmdbConfirmedByFallback(candidates, fallbackIdentity) : null;
  const candidate = forced
    ? candidates.find((item) => item.provider === forced.provider && item.externalId === forced.id)
    : classement.status === "automatic" && (detectionAllowsAutomatic || providerRescue)
      ? classement.candidate
      : tmdbCorroborated;
  if (!candidate || candidate.provider === "fanart") {
    return openFallback ? (tmdbIndisponible ? aRevoir(openFallback) : openFallback) : null;
  }
  // Une candidate TMDB issue de la recherche ne contient qu'une URL d'aperçu interne. Recharger sa
  // fiche par identifiant garantit la jaquette originale, le fond, les genres et la durée au lieu de
  // fabriquer une image depuis la vidéo.
  if (candidate.provider === "tmdb") {
    try {
      const detailed = await fetchMetadataBundle(parsed, language, candidate.externalId);
      if (detailed) return augmentArtworkWithFanart(detailed, kind, language);
    } catch {
      // La candidate reste exploitable ci-dessous et sera reprise lors d'une analyse ultérieure.
      tmdbIndisponible = true;
    }
  }
  const entity = candidateEntity(candidate, language);
  const fallback = await augmentArtworkWithFanart(kind === "movie" ? { movie: entity } : { show: entity }, kind, language);
  // Une identité secondaire reste utile pendant l'incident, mais ne doit jamais se figer à 100 %.
  // Sous le seuil automatique, la prochaine analyse réessaie TMDB et remplace d'elle-même la fiche
  // pauvre par ses détails localisés. Une correction manuelle ne passe pas par ce chemin.
  return fallback && tmdbIndisponible ? aRevoir(fallback) : fallback;
}
