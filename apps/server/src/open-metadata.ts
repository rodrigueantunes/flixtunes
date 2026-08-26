import type { MetadataSearchCandidate } from "@flixtunes/contracts";
import type { ParsedMedia } from "./media-parser.js";
import { scoreMetadataMatch } from "./match-engine.js";
import { CircuitBreaker, fetchWithTimeout } from "./resilience.js";
import { titleMatchScore, type EntityMetadata, type MetadataBundle } from "./tmdb.js";
import { db } from "./database.js";

const tvmazeBreaker = new CircuitBreaker(5, 60_000);
const wikidataBreaker = new CircuitBreaker(5, 60_000);
const cache = new Map<string, { expiresAt: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
let nextTvmazeRequestAt = 0;
let nextWikidataRequestAt = 0;
let tvmazeQueue: Promise<void> = Promise.resolve();
let wikidataQueue: Promise<void> = Promise.resolve();

function cleanHtml(value: string | null | undefined): string | null {
  return value?.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
}

async function cachedJson<T>(url: string, provider: "tvmaze" | "wikidata", ttlMs = 7 * 24 * 60 * 60_000): Promise<T> {
  const existing = cache.get(url);
  if (existing && existing.expiresAt > Date.now()) return existing.value as T;
  if (process.env.NODE_ENV !== "test") {
    const stored = db.prepare("SELECT payload_json, expires_at FROM metadata_provider_cache WHERE url = ?").get(url) as
      { payload_json: string; expires_at: number } | undefined;
    if (stored && stored.expires_at > Date.now()) {
      const value = JSON.parse(stored.payload_json) as T;
      cache.set(url, { expiresAt: stored.expires_at, value });
      return value;
    }
  }
  const inFlight = pending.get(url);
  if (inFlight) return inFlight as Promise<T>;
  const operation = (async () => {
    const breaker = provider === "tvmaze" ? tvmazeBreaker : wikidataBreaker;
    const fetchResponse = async () => {
      let response = await breaker.run(() => fetchWithTimeout(url, {
        headers: { Accept: "application/json", "User-Agent": "FlixTunes/0.4.2 (local media server)" },
      }, 20_000));
      if (response.status === 429) {
        const retryAfter = Math.max(1, Math.min(15, Number(response.headers.get("retry-after") ?? 3) || 3));
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        response = await fetchWithTimeout(url, { headers: { Accept: "application/json", "User-Agent": "FlixTunes/0.4.2 (local media server)" } }, 20_000);
      }
      return response;
    };
    const previousQueue = provider === "tvmaze" ? tvmazeQueue : wikidataQueue;
    const scheduled = previousQueue.then(async () => {
      const nextAt = provider === "tvmaze" ? nextTvmazeRequestAt : nextWikidataRequestAt;
      const wait = Math.max(0, nextAt - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (provider === "tvmaze") nextTvmazeRequestAt = Date.now() + 525;
      else nextWikidataRequestAt = Date.now() + 350;
      return fetchResponse();
    });
    const release = scheduled.then(() => undefined, () => undefined);
    if (provider === "tvmaze") tvmazeQueue = release; else wikidataQueue = release;
    const response = await scheduled;
    if (!response.ok) throw new Error(`${provider === "tvmaze" ? "TVmaze" : "Wikidata"} ${response.status}`);
    const value = await response.json() as T;
    cache.set(url, { expiresAt: Date.now() + ttlMs, value });
    if (process.env.NODE_ENV !== "test") {
      db.prepare(`INSERT INTO metadata_provider_cache (url, payload_json, expires_at, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(url) DO UPDATE SET payload_json = excluded.payload_json, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`)
        .run(url, JSON.stringify(value), Date.now() + ttlMs);
      if (Math.random() < .01) db.prepare("DELETE FROM metadata_provider_cache WHERE expires_at <= ?").run(Date.now());
    }
    if (cache.size > 10_000) cache.delete(cache.keys().next().value!);
    return value;
  })();
  pending.set(url, operation);
  try { return await operation; } finally { pending.delete(url); }
}

interface TvmazeShow {
  id: number; name: string; language?: string | null; premiered?: string | null; summary?: string | null;
  image?: { medium?: string | null; original?: string | null } | null;
  externals?: { imdb?: string | null; thetvdb?: number | null };
}
interface TvmazeSearchResult { score: number; show: TvmazeShow }
interface TvmazeSeason { id: number; number: number; name?: string | null; summary?: string | null; image?: { original?: string | null } | null }
interface TvmazeEpisode { id: number; name: string; season: number; number: number | null; summary?: string | null; image?: { original?: string | null } | null }

function yearFromDate(value: string | null | undefined): number | null {
  const year = Number(value?.slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : null;
}

function tvmazeEntity(show: TvmazeShow, language: string, confidence: number, title = show.name): EntityMetadata {
  return {
    provider: "tvmaze", externalId: String(show.id), imdbId: show.externals?.imdb ?? null,
    title, originalTitle: title === show.name ? null : show.name, overview: cleanHtml(show.summary),
    year: yearFromDate(show.premiered), runtimeSeconds: null,
    posterSourceUrl: show.image?.original ?? show.image?.medium ?? null, backdropSourceUrl: null,
    language, confidence, tvdbId: show.externals?.thetvdb == null ? null : String(show.externals.thetvdb),
  };
}

async function localizedTvmazeTitle(show: TvmazeShow, language: string): Promise<string> {
  if (!language.toLowerCase().startsWith("fr")) return show.name;
  try {
    const aliases = await cachedJson<Array<{ name?: string; country?: { code?: string } | null }>>(
      `https://api.tvmaze.com/shows/${show.id}/akas`, "tvmaze",
    );
    return aliases.find((alias) => alias.country?.code === "FR" && alias.name?.trim())?.name?.trim() || show.name;
  } catch { return show.name; }
}

export async function searchTvmaze(query: string, language: string, year?: number): Promise<MetadataSearchCandidate[]> {
  const results = await cachedJson<TvmazeSearchResult[]>(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, "tvmaze");
  return Promise.all(results.slice(0, 12).map(async ({ show }) => {
    const title = await localizedTvmazeTitle(show, language);
    const candidateYear = yearFromDate(show.premiered);
    return {
      provider: "tvmaze" as const, externalId: String(show.id), kind: "tv" as const, title,
      originalTitle: title === show.name ? null : show.name, year: candidateYear, overview: cleanHtml(show.summary),
      posterUrl: show.image?.original ?? show.image?.medium ?? null,
      score: Math.round(Math.max(titleMatchScore(query, title, year, candidateYear), titleMatchScore(query, show.name, year, candidateYear)) * 1000) / 1000,
    };
  }));
}

export async function fetchTvmazeBundle(parsed: ParsedMedia, language: string, forcedId?: string): Promise<MetadataBundle | null> {
  const query = parsed.showTitle?.trim();
  if (!query && !forcedId) return null;
  const candidates = forcedId ? [] : await searchTvmaze(query!, language, parsed.year ?? undefined);
  const match = forcedId ? null : candidates.sort((a, b) => b.score - a.score)[0];
  const decision = match
    ? scoreMetadataMatch({ title: query!, year: parsed.year, externalIds: parsed.externalIds }, match)
    : null;
  if (!forcedId && (!match || !decision || decision.status === "rejected")) return null;
  const id = forcedId ?? match!.externalId;
  const show = await cachedJson<TvmazeShow>(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}`, "tvmaze");
  const localizedTitle = await localizedTvmazeTitle(show, language);
  const confidence = forcedId ? 1 : decision!.score;
  let showEntity = tvmazeEntity(show, language, confidence, localizedTitle);
  if (language.toLowerCase().startsWith("fr")) {
    try {
      const localized = await fetchWikidataShowLocalization(parsed, language);
      if (localized) showEntity = {
        ...showEntity,
        title: localized.title || showEntity.title,
        originalTitle: localized.originalTitle ?? showEntity.originalTitle,
        overview: localized.overview ?? showEntity.overview,
      };
    } catch { /* TVmaze reste la source de repli si Wikipédia est indisponible. */ }
  }
  const bundle: MetadataBundle = { show: showEntity };
  if (parsed.seasonNumber == null) return bundle;
  try {
    const seasons = await cachedJson<TvmazeSeason[]>(`https://api.tvmaze.com/shows/${show.id}/seasons`, "tvmaze");
    const season = seasons.find((item) => item.number === parsed.seasonNumber);
    if (season) bundle.season = {
      ...tvmazeEntity(show, language, confidence, language.startsWith("fr") ? `Saison ${season.number}` : `Season ${season.number}`),
      externalId: String(season.id), overview: language.toLowerCase().startsWith("fr")
        ? showEntity.overview : cleanHtml(season.summary) ?? showEntity.overview, year: null,
      posterSourceUrl: season.image?.original ?? show.image?.original ?? null,
    };
  } catch { /* l'affiche de série reste utilisable */ }

  // Détail de l'épisode. La crainte initiale — des milliers d'appels réseau pendant un premier scan —
  // était fondée pour un appel par épisode ; TVmaze rend la saison entière d'un seul coup, et le
  // cache sert ensuite tous les autres épisodes de la même série. Le coût est donc d'un appel par
  // série, pas par fichier.
  //
  // Sans ce détail, le résumé de la série était repris sur chaque épisode : les neuf épisodes d'une
  // saison affichaient le même texte, qui ne décrivait aucun d'eux.
  if (parsed.episodeNumber != null && parsed.seasonNumber != null) {
    try {
      const episodes = await cachedJson<TvmazeEpisode[]>(`https://api.tvmaze.com/shows/${show.id}/episodes`, "tvmaze");
      const episode = episodes.find((item) => item.season === parsed.seasonNumber && item.number === parsed.episodeNumber);
      if (episode) {
        const requestedFrench = language.toLowerCase().startsWith("fr");
        const sourceEnglish = show.language?.trim().toLowerCase() === "english";
        const hasRequestedText = !(requestedFrench && sourceEnglish);
        const title = hasRequestedText
          ? episode.name || (requestedFrench ? `Épisode ${episode.number ?? parsed.episodeNumber}` : `Episode ${episode.number ?? parsed.episodeNumber}`)
          : parsed.title?.trim() || `Épisode ${episode.number ?? parsed.episodeNumber}`;
        const summary = hasRequestedText ? cleanHtml(episode.summary) : null;
        bundle.episode = {
          ...tvmazeEntity(show, language, confidence, title),
          externalId: String(episode.id),
          // TVmaze ne traduit pas les épisodes. Quand il déclare une série anglophone pour une
          // bibliothèque française, le nom local lu dans le fichier (souvent « Épisode N ») reste
          // affiché et le nom anglais est conservé seulement comme titre original.
          originalTitle: title === episode.name ? null : episode.name?.trim() || null,
          // Le résumé reste nul si TVmaze n'en fournit pas : mieux vaut « non disponible » qu'un
          // texte emprunté à la série — ou un texte anglais présenté comme français.
          overview: summary,
          year: null,
          posterSourceUrl: episode.image?.original ?? null,
        };
      }
    } catch { /* le titre lu depuis le nom de fichier reste utilisable */ }
  }
  return bundle;
}

interface WikidataSearchItem { id: string; label?: string; description?: string; match?: { text?: string }; aliases?: string[] }
interface WikidataSearchPayload { search?: WikidataSearchItem[] }
interface WikidataEntityPayload { entities?: Record<string, { labels?: Record<string, { value?: string }>; descriptions?: Record<string, { value?: string }>;
  sitelinks?: Record<string, { title?: string }>; claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }> }
interface WikipediaSummary { extract?: string; thumbnail?: { source?: string }; originalimage?: { source?: string } }

function claimValue(entity: NonNullable<WikidataEntityPayload["entities"]>[string], property: string): unknown {
  return entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
}

function wikimediaImageUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}?width=780`;
}

async function wikidataEntity(id: string, language: string, confidence: number): Promise<EntityMetadata | null> {
  const lang = language.split("-")[0] || "en";
  const payload = await cachedJson<WikidataEntityPayload>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(id)}&props=labels%7Cdescriptions%7Cclaims%7Csitelinks&sitefilter=${lang}wiki%7Cenwiki&languages=${lang}%7Cen&format=json&origin=*`, "wikidata",
  );
  const entity = payload.entities?.[id]; if (!entity) return null;
  const date = claimValue(entity, "P577") as { time?: string } | undefined;
  const image = claimValue(entity, "P18");
  const imdb = claimValue(entity, "P345");
  const title = entity.labels?.[lang]?.value ?? entity.labels?.en?.value ?? id;
  let wikipedia: WikipediaSummary | null = null;
  const localPage = entity.sitelinks?.[`${lang}wiki`]?.title;
  const englishPage = entity.sitelinks?.enwiki?.title;
  const page = localPage ?? englishPage;
  if (page) {
    try {
      wikipedia = await cachedJson<WikipediaSummary>(
        `https://${localPage ? lang : "en"}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replaceAll(" ", "_"))}`,
        "wikidata",
      );
    } catch { /* Les données Wikidata restent valides sans résumé Wikipédia. */ }
  }
  if (!wikipedia?.originalimage?.source && !wikipedia?.thumbnail?.source && englishPage && englishPage !== localPage) {
    try {
      const english = await cachedJson<WikipediaSummary>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(englishPage.replaceAll(" ", "_"))}`,
        "wikidata",
      );
      wikipedia = { ...english, ...wikipedia, originalimage: english.originalimage, thumbnail: english.thumbnail };
    } catch { /* Le résumé local reste prioritaire. */ }
  }
  return {
    provider: "wikidata", externalId: id, imdbId: typeof imdb === "string" ? imdb : null,
    title, originalTitle: entity.labels?.en?.value && entity.labels.en.value !== title ? entity.labels.en.value : null,
    overview: wikipedia?.extract?.trim() || entity.descriptions?.[lang]?.value || entity.descriptions?.en?.value || null,
    year: date?.time ? yearFromDate(date.time.replace(/^\+/, "")) : null, runtimeSeconds: null,
    posterSourceUrl: typeof image === "string" ? wikimediaImageUrl(image) : wikipedia?.originalimage?.source ?? wikipedia?.thumbnail?.source ?? null,
    backdropSourceUrl: null, language, confidence,
  };
}

async function searchWikidataByKind(query: string, language: string, year: number | undefined, kind: "movie" | "tv"): Promise<MetadataSearchCandidate[]> {
  const lang = language.split("-")[0] || "en";
  const payload = await cachedJson<WikidataSearchPayload>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=${lang}&uselang=${lang}&type=item&limit=12&format=json&origin=*`, "wikidata",
  );
  const likelyDescription = kind === "movie"
    ? /(film|movie|documenta|téléfilm|cinéma|motion picture)/i
    : /(série télévisée|série d'animation|television series|tv series|animated series|mini-?series|web series)/i;
  const selected = (payload.search ?? []).filter((item) => likelyDescription.test(item.description ?? ""))
    .sort((left, right) => titleMatchScore(query, right.label ?? right.match?.text ?? "") - titleMatchScore(query, left.label ?? left.match?.text ?? ""))
    .slice(0, 3);
  const candidates: MetadataSearchCandidate[] = [];
  for (const item of selected) {
    const entity = await wikidataEntity(item.id, language, .5); if (!entity) continue;
    const score = Math.max(titleMatchScore(query, entity.title, year, entity.year), entity.originalTitle ? titleMatchScore(query, entity.originalTitle, year, entity.year) : 0);
    candidates.push({ provider: "wikidata", externalId: item.id, kind, title: entity.title, originalTitle: entity.originalTitle,
      year: entity.year, overview: entity.overview, posterUrl: entity.posterSourceUrl, score: Math.round(score * 1000) / 1000 });
    if (score >= .98 && (!year || entity.year === year)) break;
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function searchWikidata(query: string, language: string, year?: number): Promise<MetadataSearchCandidate[]> {
  return searchWikidataByKind(query, language, year, "movie");
}

export async function fetchWikidataShowLocalization(parsed: ParsedMedia, language: string): Promise<EntityMetadata | null> {
  const query = parsed.showTitle?.trim();
  if (!query) return null;
  const candidates = await searchWikidataByKind(query, language, parsed.year ?? undefined, "tv");
  const match = candidates[0];
  if (!match) return null;
  const decision = scoreMetadataMatch({ title: query, year: parsed.year, externalIds: parsed.externalIds }, match);
  if (decision.status !== "automatic") return null;
  return wikidataEntity(match.externalId, language, decision.score);
}

export async function fetchWikidataBundle(parsed: ParsedMedia, language: string, forcedId?: string): Promise<MetadataBundle | null> {
  const candidates = forcedId ? [] : await searchWikidata(parsed.title, language, parsed.year ?? undefined);
  const match = forcedId ? null : candidates[0];
  const decision = match
    ? scoreMetadataMatch({ title: parsed.title, year: parsed.year, externalIds: parsed.externalIds }, match)
    : null;
  if (!forcedId && (!match || !decision || decision.status === "rejected")) return null;
  const entity = await wikidataEntity(forcedId ?? match!.externalId, language, forcedId ? 1 : decision!.score);
  return entity ? { movie: entity } : null;
}

export function resetOpenMetadataCaches(): void {
  cache.clear(); pending.clear(); nextTvmazeRequestAt = 0; nextWikidataRequestAt = 0;
  tvmazeQueue = Promise.resolve(); wikidataQueue = Promise.resolve();
}
