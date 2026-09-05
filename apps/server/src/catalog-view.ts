import type {
  CatalogFilter, CatalogPage, CatalogPerson, CatalogQuery, CatalogSort,
  HomeResponse, MediaDetails, MediaItem, MediaSourceVersion, PersonDetails, PlaybackNeighbors, Profile, SeasonDetails,
} from "@flixtunes/contracts";

/** Compatible aussi avec un client r47 dont la copie locale des types n'a pas encore été relancée. */
type AnchoredCatalogPage = CatalogPage & { anchor?: number };
import { db, mapMedia, mediaAgeRatingSql, mediaSelect, type MediaItemWithProgress } from "./database.js";
import { parseProbeOutput } from "./ffprobe.js";
import { recommendLocal } from "./recommendation-engine.js";
import { normaliseForSearch } from "./search-normalise.js";
import { displayResolution } from "./video-resolution.js";

type MediaRow = Parameters<typeof mapMedia>[0];

function pathParts(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

function sourceFile(mediaId: string): { kind: "file"; name: string } | null {
  const row = db.prepare("SELECT file_path FROM media_items WHERE id = ?").get(mediaId) as { file_path: string | null } | undefined;
  const name = row?.file_path ? pathParts(row.file_path).at(-1) : null;
  return name ? { kind: "file", name } : null;
}

function mergeTargets(): Map<string, string> {
  const rows = db.prepare("SELECT source_id, target_id FROM catalog_merges").all() as Array<{ source_id: string; target_id: string }>;
  return new Map(rows.map((row) => [row.source_id, row.target_id]));
}

function resolvedCatalogId(id: string, targets = mergeTargets()): string {
  const seen = new Set<string>();
  let current = id;
  while (targets.has(current) && !seen.has(current)) {
    seen.add(current);
    current = targets.get(current)!;
  }
  return current;
}

/** Une œuvre n'occupe qu'une carte, même lorsqu'elle possède plusieurs fichiers ou un regroupement manuel. */
function groupMovieItems(items: MediaItemWithProgress[]): MediaItemWithProgress[] {
  const targets = mergeTargets();
  const grouped = new Map<string, MediaItemWithProgress>();
  for (const item of items) {
    if (item.kind !== "movie") { grouped.set(`media:${item.id}`, item); continue; }
    const key = resolvedCatalogId(item.catalogId ?? item.id, targets);
    const current = grouped.get(key);
    // Le fichier en cours de lecture reste le représentant. Sinon la fiche cible d'un regroupement
    // manuel prime, puis l'ordre SQL d'origine est préservé.
    if (!current || item.progressPercent > current.progressPercent
      || (item.catalogId === key && current.catalogId !== key)) grouped.set(key, { ...item, catalogId: key });
  }
  return [...grouped.values()];
}

function qualityFromProbe(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const metadata = parseProbeOutput(JSON.parse(payload));
    const video = metadata.streams.find((stream) => stream.type === "video");
    if (!video) return null;
    const resolution = displayResolution(video.width, video.height);
    const dynamicRange = video.hdrFormat === "dolbyvision" ? "Dolby Vision" : video.hdrFormat === "hdr10plus" ? "HDR10+"
      : video.hdrFormat === "hdr10" ? "HDR10" : video.hdrFormat === "hlg" ? "HLG" : "SDR";
    const codec = ({ hevc: "HEVC/H.265", h265: "HEVC/H.265", h264: "H.264", av1: "AV1", vp9: "VP9" } as Record<string, string>)[video.codec.toLowerCase()]
      ?? video.codec.toUpperCase();
    return [resolution, dynamicRange, codec].filter(Boolean).join(" · ");
  } catch { return null; }
}

function movieVersions(catalogId: string): MediaSourceVersion[] {
  const targets = mergeTargets();
  const ids = [catalogId, ...[...targets.keys()].filter((source) => resolvedCatalogId(source, targets) === catalogId)];
  const rows = db.prepare(`SELECT id, file_path, file_size, embedded_metadata_json FROM media_items
    WHERE available = 1 AND kind = 'movie' AND catalog_id IN (${ids.map(() => "?").join(", ")})
    ORDER BY file_size DESC NULLS LAST, created_at`).all(...ids) as Array<{
      id: string; file_path: string | null; file_size: number | null; embedded_metadata_json: string | null;
    }>;
  return rows.flatMap((row) => {
    const name = row.file_path ? pathParts(row.file_path).at(-1) : null;
    return name ? [{ mediaId: row.id, name, quality: qualityFromProbe(row.embedded_metadata_json), fileSizeBytes: row.file_size }] : [];
  });
}

function showQualities(catalogId: string): string[] {
  const rows = db.prepare(`SELECT DISTINCT m.embedded_metadata_json FROM media_items m
    JOIN catalog_items episode ON episode.id = m.catalog_id AND episode.kind = 'episode'
    JOIN catalog_items season ON season.id = episode.parent_id AND season.parent_id = ?
    WHERE m.available = 1 AND m.embedded_metadata_json IS NOT NULL`).all(catalogId) as Array<{ embedded_metadata_json: string }>;
  return [...new Set(rows.map((row) => qualityFromProbe(row.embedded_metadata_json)).filter((quality): quality is string => Boolean(quality)))];
}

/** Remonte au dossier de série et ne renvoie jamais le dossier de saison intermédiaire. */
function sourceShowFolder(mediaId: string | null): { kind: "folder"; name: string } | null {
  if (!mediaId) return null;
  const row = db.prepare("SELECT file_path FROM media_items WHERE id = ?").get(mediaId) as { file_path: string | null } | undefined;
  if (!row?.file_path) return null;
  const parts = pathParts(row.file_path);
  parts.pop();
  if (!parts.length) return null;
  const immediate = parts.at(-1)!;
  const isSeasonFolder = /^(?:season|saison|series|s)[ ._-]*\d{1,3}$/i.test(immediate)
    || /^(?:specials?|hors[ ._-]s[ée]rie)$/i.test(immediate);
  const name = isSeasonFolder ? parts.at(-2) : immediate;
  return name ? { kind: "folder", name } : null;
}

function likePattern(value: string): string {
  return `%${value.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * Condition de recherche sur un titre, et ses paramètres.
 *
 * Trois comparaisons, dans cet ordre :
 *   - `search_title`, la forme sans accent ni ponctuation : « amelie » y trouve « Amélie » ;
 *   - `title`, la forme exacte ;
 *   - `sort_title`, en minuscules, qui reste le filet pour les fiches écrites avant l'ajout de la
 *     colonne de recherche, ou par un chemin qui ne la renseignerait pas.
 *
 * La normalisation retire la ponctuation — donc aussi `%` et `_`. Une saisie qui n'en contient que
 * se normalise en chaîne vide, et l'interroger reviendrait à demander « tout » : dans ce cas la
 * branche normalisée est écartée, et l'échappement des jokers fait son travail sur les deux autres.
 */
/**
 * Bornes d'année de sortie, et leurs paramètres.
 *
 * Une fiche sans année n'est retenue par aucune borne. On ne sait pas si elle appartient à
 * l'intervalle demandé ; l'y inclure au hasard tromperait autant que l'en exclure, mais l'exclusion
 * se voit — la personne constate qu'un titre manque et peut corriger sa fiche.
 */
/**
 * Condition de genre, et ses paramètres.
 *
 * Une fiche doit porter **tous** les genres demandés : deux cases cochées ensemble cherchent une
 * comédie d'action, pas la réunion des deux rayons. On l'exprime par autant de tests d'existence que
 * de genres, chacun sur son index — plutôt qu'un `IN` suivi d'un comptage, qui obligerait à
 * regrouper avant de filtrer.
 *
 * Pour les films, la table des genres est portée par la fiche du catalogue, pas par le média : c'est
 * `catalog_id` qui fait le lien.
 */
function genreClause(alias: "c" | "m", genres: string[] | undefined): { clause: string; params: string[] } {
  const propres = [...new Set((genres ?? []).map((genre) => genre.trim()).filter(Boolean))];
  if (!propres.length) return { clause: "", params: [] };
  const cle = alias === "c" ? "c.id" : "m.catalog_id";
  const clause = propres
    .map(() => `AND EXISTS (SELECT 1 FROM catalog_genres g WHERE g.catalog_id = ${cle} AND g.genre = ?)`)
    .join(" ");
  return { clause, params: propres };
}

/**
 * Genres présents dans un catalogue, triés par nom.
 *
 * Calculés sur le catalogue entier, jamais sur la page affichée : proposer les seuls genres visibles
 * ferait disparaître un choix dès qu'on tourne la page.
 */
function childAge(profileId: string): number | null {
  const profile = db.prepare("SELECT is_child, age FROM profiles WHERE id = ?").get(profileId) as
    { is_child: number; age: number | null } | undefined;
  return profile?.is_child === 1 ? Math.max(0, Math.min(17, profile.age ?? 0)) : null;
}

/** Vérification centrale, réutilisée par les fiches et les routes de lecture directe. */
export function isCatalogAllowed(profileId: string, catalogId: string): boolean {
  const limit = childAge(profileId);
  if (limit == null) return true;
  const row = db.prepare(`WITH RECURSIVE ancestors(id, parent_id, age_rating, depth) AS (
      SELECT id, parent_id, age_rating, 0 FROM catalog_items WHERE id = ?
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.age_rating, ancestors.depth + 1
      FROM catalog_items parent JOIN ancestors ON ancestors.parent_id = parent.id)
    SELECT age_rating FROM ancestors WHERE age_rating IS NOT NULL ORDER BY depth DESC LIMIT 1`)
    .get(catalogId) as { age_rating: number } | undefined;
  return row?.age_rating == null || row.age_rating <= limit;
}

export function listAvailableGenres(profileId: string, kind: "movies" | "shows"): string[] {
  const limit = childAge(profileId);
  const parental = limit == null ? "" : "AND (c.age_rating IS NULL OR c.age_rating <= ?)";
  const rows = db.prepare(`
    SELECT DISTINCT g.genre FROM catalog_genres g
    JOIN catalog_items c ON c.id = g.catalog_id
    WHERE c.kind = ? ${parental} ORDER BY g.genre
  `).all(kind === "movies" ? "movie" : "show", ...(limit == null ? [] : [limit])) as Array<{ genre: string }>;
  return rows.map((row) => row.genre);
}

function yearBoundsClause(alias: "c" | "m", minYear?: number, maxYear?: number): { clause: string; params: number[] } {
  const branches: string[] = [];
  const params: number[] = [];
  if (minYear != null) { branches.push(`${alias}.year >= ?`); params.push(minYear); }
  if (maxYear != null) { branches.push(`${alias}.year <= ?`); params.push(maxYear); }
  if (!branches.length) return { clause: "", params };
  return { clause: `AND ${alias}.year IS NOT NULL AND ${branches.join(" AND ")}`, params };
}

function titleSearchClause(alias: "c" | "m", saisie: string): { clause: string; params: string[] } {
  const normalise = normaliseForSearch(saisie);
  const branches = [`${alias}.title LIKE ? ESCAPE '\\'`, `${alias}.sort_title LIKE ? ESCAPE '\\'`];
  const params = [likePattern(saisie), likePattern(saisie.toLocaleLowerCase("fr"))];
  if (normalise) {
    branches.unshift(`${alias}.search_title LIKE ? ESCAPE '\\'`);
    params.unshift(likePattern(normalise));
  }
  return { clause: `AND (${branches.join(" OR ")})`, params };
}

/** Décalage de la première initiale, dans une liste déjà triée par titre — jamais un filtre. */
function alphabeticOffset(items: Array<{ title: string }>, letter?: string): number {
  if (!letter || !items.length) return 0;
  const target = letter.toLocaleLowerCase("fr");
  const initials = items.map((item) => normaliseForSearch(item.title).charAt(0));
  if (target === "#") return Math.max(0, initials.findIndex((initial) => !/^[a-z]$/.test(initial)));
  const exact = initials.findIndex((initial) => initial === target);
  if (exact >= 0) return exact;
  const following = initials.findIndex((initial) => /^[a-z]$/.test(initial) && initial > target);
  return following >= 0 ? following : items.length - 1;
}

/**
 * Garde du catalogue avant et après la lettre visée.
 *
 * Commencer la réponse exactement à l'ancre donnait l'impression d'un filtre : impossible de remonter
 * vers la jaquette précédente. Un tiers de page avant la cible laisse celle-ci proche du haut tout en
 * rendant immédiatement les deux directions disponibles, sans charger tout le catalogue sur la TV.
 */
function alphabeticWindow(anchor: number, total: number, limit: number): number {
  const before = Math.floor(limit / 3);
  return Math.max(0, Math.min(anchor - before, Math.max(0, total - limit)));
}

/**
 * Ajoute aux titres les œuvres reliées à une personne dont le nom correspond.
 *
 * Les identifiants sont d'abord résolus en une requête courte puis injectés dans la recherche du
 * catalogue. Cela évite une jointure personnes/crédits sur chaque ligne de chaque grille, et surtout
 * laisse les parcours sans recherche strictement identiques à r45.
 */
function workSearchClause(alias: "c" | "m", saisie: string): { clause: string; params: string[] } {
  const title = titleSearchClause(alias, saisie);
  const normalized = normaliseForSearch(saisie);
  if (!normalized) return title;
  const credits = db.prepare(`
    SELECT DISTINCT credit.catalog_id FROM catalog_people person
    JOIN catalog_people_credits credit ON credit.person_id = person.id
    WHERE person.search_name LIKE ? ESCAPE '\\' ORDER BY credit.catalog_id LIMIT 400
  `).all(likePattern(normalized)) as Array<{ catalog_id: string }>;
  const genres = db.prepare(`SELECT DISTINCT catalog_id FROM catalog_genres
    WHERE genre LIKE ? ESCAPE '\\' COLLATE NOCASE LIMIT 400`).all(likePattern(saisie)) as Array<{ catalog_id: string }>;
  const collections = db.prepare(`SELECT id AS catalog_id FROM catalog_items
    WHERE collection_name LIKE ? ESCAPE '\\' COLLATE NOCASE LIMIT 400`).all(likePattern(saisie)) as Array<{ catalog_id: string }>;
  const matches = [...new Set([...credits, ...genres, ...collections].map((row) => row.catalog_id))].slice(0, 400);
  if (!matches.length) return title;
  const key = alias === "c" ? "c.id" : "m.catalog_id";
  return {
    clause: `AND (${title.clause.slice(4)} OR ${key} IN (${matches.map(() => "?").join(", ")}))`,
    params: [...title.params, ...matches],
  };
}


function mediaRows(profileId: string, where = "", ...params: Array<string | number | bigint | null | Uint8Array>): MediaItemWithProgress[] {
  const limit = childAge(profileId);
  const parental = limit == null ? "" : `AND (${mediaAgeRatingSql} IS NULL OR ${mediaAgeRatingSql} <= ?)`;
  const rows = db.prepare(`${mediaSelect} WHERE m.available = 1 AND m.library_id IS NOT NULL ${parental} ${where}`)
    .all(profileId, ...(limit == null ? [] : [limit]), ...params) as MediaRow[];
  return rows.map(mapMedia);
}

const SHOW_ORDER: Record<CatalogSort, string> = {
  title: "c.sort_title, c.id",
  release: "c.year DESC NULLS LAST, c.sort_title, c.id",
  added: "c.created_at DESC, c.id",
};

type ShowRow = {
  id: string; title: string; sort_title: string; year: number | null; created_at: string; overview: string | null;
  poster_url: string | null; backdrop_url: string | null; season_count: number; age_rating: number | null; rating_label: string | null;
  position_seconds: number; duration_seconds: number; media_id: string | null; in_watchlist: number;
  completed_count?: number; media_count?: number;
};

/**
 * Une série n'est visible que si au moins un épisode d'une de ses saisons a un fichier disponible.
 *
 * Les `EXISTS` sont imbriqués plutôt qu'écrits en jointures. Avec des jointures, SQLite attaquait la
 * condition par `media_items` sur le seul critère « disponible » et balayait toute la table pour chaque
 * série : mesuré à une trentaine de secondes par recherche sur une base de 110 000 médias, et d'autant
 * plus coûteux que la série n'a aucun épisode, cas où le balayage va jusqu'au bout avant de conclure.
 * L'imbrication impose la descente série → saison → épisode, chaque étage sur son index.
 */
const HAS_AVAILABLE_EPISODE = `EXISTS (
  SELECT 1 FROM catalog_items season
  WHERE season.parent_id = c.id AND season.kind = 'season' AND EXISTS (
    SELECT 1 FROM catalog_items episode
    WHERE episode.parent_id = season.id AND episode.kind = 'episode' AND EXISTS (
      SELECT 1 FROM media_items media WHERE media.catalog_id = episode.id AND media.available = 1)))`;

/** La même chose, restreinte aux épisodes commencés sans être terminés. */
const HAS_EPISODE_IN_PROGRESS = `EXISTS (
  SELECT 1 FROM catalog_items season
  WHERE season.parent_id = c.id AND season.kind = 'season' AND EXISTS (
    SELECT 1 FROM catalog_items episode
    WHERE episode.parent_id = season.id AND episode.kind = 'episode' AND EXISTS (
      SELECT 1 FROM media_items media
      JOIN playback_progress progress ON progress.media_id = media.id AND progress.profile_id = ?
      WHERE media.catalog_id = episode.id AND media.available = 1
        AND progress.completed = 0 AND progress.position_seconds > 0)))`;

/** Au moins un fichier d'épisode disponible n'est pas encore terminé pour ce profil. */
const HAS_UNWATCHED_EPISODE = `EXISTS (
  SELECT 1 FROM catalog_items season
  JOIN catalog_items episode ON episode.parent_id = season.id AND episode.kind = 'episode'
  JOIN media_items media ON media.catalog_id = episode.id AND media.available = 1
  LEFT JOIN playback_progress progress ON progress.media_id = media.id AND progress.profile_id = ?
  WHERE season.parent_id = c.id AND season.kind = 'season' AND COALESCE(progress.completed, 0) = 0)`;

/**
 * Étanchéité entre Films et Séries, dans l'autre sens.
 *
 * Une bibliothèque explicitement déclarée « films » n'alimente pas la page Séries. La déclaration de
 * la personne prime sur le résultat d'une analyse de nom de fichier, qui peut se tromper : c'est une
 * intention exprimée, pas une déduction.
 *
 * Les bibliothèques en mode automatique ou mixte restent servies des deux côtés — les exclure ferait
 * disparaître de vraies séries chez quelqu'un qui range tout au même endroit.
 */
const NOT_IN_MOVIE_LIBRARY =
  "AND NOT EXISTS (SELECT 1 FROM library_folders lib WHERE lib.id = c.library_id AND lib.kind = 'movie')";

function showFilterClause(filter: CatalogFilter | undefined): { sql: string; needsProfile: boolean } {
  if (filter === "watched") return { sql: `AND NOT ${HAS_UNWATCHED_EPISODE}`, needsProfile: true };
  if (filter === "progress") return { sql: `AND ${HAS_EPISODE_IN_PROGRESS}`, needsProfile: true };
  if (filter === "unwatched") return { sql: `AND ${HAS_UNWATCHED_EPISODE}`, needsProfile: true };
  return { sql: "", needsProfile: false };
}

/**
 * Les séries, en deux requêtes bornées.
 *
 * L'épisode représentatif — celui que l'accueil propose de reprendre — était cherché par une requête
 * par série, plus une requête de liste d'envies : 400 allers-retours pour 200 séries. Une première
 * version regroupait le tout en une seule requête à fonction de fenêtrage, mais celle-ci classait la
 * totalité des épisodes de la médiathèque même pour n'en afficher que soixante : 465 ms sur 100 000
 * épisodes, et près de cinq secondes pour une recherche.
 *
 * La page de séries se choisit donc d'abord, par simples tests d'existence indexés, et le classement
 * ne porte ensuite que sur les épisodes des séries retenues. Le coût suit ce qui est affiché, non ce
 * que contient la médiathèque.
 */
function showItems(
  profileId: string,
  options: {
    titleFilter?: string; limit?: number; offset?: number; sort?: CatalogSort; filter?: CatalogFilter;
    /** Bornes d'année de sortie, incluses, combinables avec l'état et la recherche. */
    minYear?: number; maxYear?: number;
    /** Genres exigés : la fiche doit tous les porter. */
    genres?: string[];
    /** Restreint le résultat à ces fiches. Sert à composer « Ma liste » sans parcourir le catalogue. */
    catalogIds?: string[];
    /**
     * Sans épisode représentatif : le résultat n'a alors ni média jouable ni progression. Réservé aux
     * usages internes qui ne les lisent pas — les recommandations — et jamais à ce qui part au client.
     */
    withRepresentative?: boolean;
  } = {},
): Array<MediaItemWithProgress & { seasonCount: number }> {
  if (options.catalogIds?.length === 0) return [];
  const params: Array<string | number> = [profileId];
  const limitAge = childAge(profileId);
  if (limitAge != null) params.push(limitAge);
  const state = showFilterClause(options.filter);
  if (state.needsProfile) params.push(profileId);
  const filters = [limitAge == null ? "" : "AND (c.age_rating IS NULL OR c.age_rating <= ?)", state.sql];
  if (options.catalogIds?.length) {
    filters.push(`AND c.id IN (${options.catalogIds.map(() => "?").join(", ")})`);
    params.push(...options.catalogIds);
  }
  if (options.titleFilter) {
    const recherche = workSearchClause("c", options.titleFilter);
    filters.push(recherche.clause);
    params.push(...recherche.params);
  }
  const annees = yearBoundsClause("c", options.minYear, options.maxYear);
  if (annees.clause) { filters.push(annees.clause); params.push(...annees.params); }
  const genresDemandes = genreClause("c", options.genres);
  if (genresDemandes.clause) { filters.push(genresDemandes.clause); params.push(...genresDemandes.params); }
  let bounds = "";
  if (options.limit != null) {
    bounds = " LIMIT ? OFFSET ?";
    params.push(options.limit, options.offset ?? 0);
  }

  const rows = db.prepare(`
    SELECT c.id, c.title, c.sort_title, c.year, c.created_at, c.overview, c.poster_url, c.backdrop_url,
      c.age_rating, c.rating_label,
      (SELECT COUNT(*) FROM catalog_items season WHERE season.parent_id = c.id AND season.kind = 'season') AS season_count,
      CASE WHEN w.catalog_id IS NULL THEN 0 ELSE 1 END AS in_watchlist
    FROM catalog_items c
    LEFT JOIN profile_watchlist w ON w.catalog_id = c.id AND w.profile_id = ?
    WHERE c.kind = 'show' AND ${HAS_AVAILABLE_EPISODE} ${NOT_IN_MOVIE_LIBRARY} ${filters.join(" ")}
    ORDER BY ${SHOW_ORDER[options.sort ?? "title"]}${bounds}
  `).all(...params) as ShowRow[];

  if (options.withRepresentative !== false && rows.length) {
    const placeholders = rows.map(() => "?").join(", ");
    const representatives = db.prepare(`
      SELECT show_id, media_id, duration_seconds, position_seconds FROM (
        SELECT s.parent_id AS show_id, m.id AS media_id,
          COALESCE(p.duration_seconds, m.runtime_seconds, 0) AS duration_seconds,
          COALESCE(p.position_seconds, 0) AS position_seconds,
          ROW_NUMBER() OVER (
            PARTITION BY s.parent_id
            ORDER BY CASE WHEN p.completed = 0 AND p.position_seconds > 0 THEN 0 WHEN p.completed IS NULL THEN 1 ELSE 2 END,
              s.season_number, e.episode_number
          ) AS position_rank
        FROM media_items m
        JOIN catalog_items e ON e.id = m.catalog_id AND e.kind = 'episode'
        JOIN catalog_items s ON s.id = e.parent_id AND s.kind = 'season' AND s.parent_id IN (${placeholders})
        LEFT JOIN playback_progress p ON p.media_id = m.id AND p.profile_id = ?
        WHERE m.available = 1
      ) WHERE position_rank = 1
    `).all(...rows.map((row) => row.id), profileId) as Array<{
      show_id: string; media_id: string; duration_seconds: number; position_seconds: number;
    }>;
    const byShow = new Map(representatives.map((row) => [row.show_id, row]));
    for (const row of rows) {
      const representative = byShow.get(row.id);
      row.media_id = representative?.media_id ?? null;
      row.duration_seconds = representative?.duration_seconds ?? 0;
      row.position_seconds = representative?.position_seconds ?? 0;
    }
  }

  if (options.withRepresentative !== false && rows.length) {
    const placeholders = rows.map(() => "?").join(", ");
    const totals = db.prepare(`
      SELECT s.parent_id AS show_id, COUNT(m.id) AS media_count,
        SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END) AS completed_count
      FROM catalog_items s
      JOIN catalog_items e ON e.parent_id = s.id AND e.kind = 'episode'
      JOIN media_items m ON m.catalog_id = e.id AND m.available = 1
      LEFT JOIN playback_progress p ON p.media_id = m.id AND p.profile_id = ?
      WHERE s.kind = 'season' AND s.parent_id IN (${placeholders})
      GROUP BY s.parent_id
    `).all(profileId, ...rows.map((row) => row.id)) as Array<{
      show_id: string; media_count: number; completed_count: number;
    }>;
    const byShow = new Map(totals.map((row) => [row.show_id, row]));
    for (const row of rows) {
      const total = byShow.get(row.id);
      row.media_count = Number(total?.media_count ?? 0);
      row.completed_count = Number(total?.completed_count ?? 0);
    }
  }

  return rows.map((show) => ({
    id: show.id,
    catalogId: show.id,
    playableMediaId: show.media_id ?? null,
    kind: "show" as const,
    title: show.title,
    sortTitle: show.sort_title,
    year: show.year,
    addedAt: show.created_at,
    overview: show.overview,
    posterUrl: show.poster_url,
    backdropUrl: show.backdrop_url,
    showTitle: show.title,
    seasonNumber: null,
    episodeNumber: null,
    runtimeSeconds: null,
    ageRating: show.age_rating,
    ratingLabel: show.rating_label,
    progressPercent: show.duration_seconds > 0
      ? Math.min(100, Math.round((show.position_seconds / show.duration_seconds) * 100))
      : 0,
    progressPositionSeconds: Math.max(0, show.position_seconds),
    progressDurationSeconds: Math.max(0, show.duration_seconds),
    completed: (show.media_count ?? 0) > 0 && show.completed_count === show.media_count,
    seasonCount: Number(show.season_count),
    inWatchlist: show.in_watchlist === 1,
  }));
}

export function buildHome(profile: Profile): HomeResponse {
  // Chaque rail est borné par SQL. Auparavant l'accueil chargeait la totalité des médias — épisodes
  // compris — pour n'en garder que quelques dizaines après filtrage en mémoire, et transmettait au
  // client l'intégralité du catalogue à chaque ouverture.
  // Les listes complètes restent chargées côté serveur — quelques dizaines de millisecondes une fois
  // les index en place — parce que « Ma liste » et les recommandations doivent voir tout le catalogue.
  // Seule la première page part sur le réseau ; le reste se demande à `/api/catalog`.
  const allMovies = groupMovieItems(mediaRows(profile.id, "AND m.kind = 'movie' ORDER BY m.created_at DESC"));
  // Les séries candidates se passent de leur épisode représentatif : le moteur de recommandation ne lit
  // que le titre, l'année et l'état terminé. Seule la page affichée paie le classement des épisodes.
  const allShows = showItems(profile.id, { withRepresentative: false });
  const movies = allMovies.slice(0, HOME_PAGE_SIZE);
  const shows = showItems(profile.id, { limit: HOME_PAGE_SIZE });
  const recentlyAdded = groupMovieItems(mediaRows(profile.id, "ORDER BY m.created_at DESC LIMIT 80")).slice(0, 24);
  const continueWatching = groupMovieItems(mediaRows(profile.id,
    `AND p.position_seconds > 0 AND p.completed = 0
     AND COALESCE(p.duration_seconds, m.runtime_seconds, 0) > 0
     ORDER BY m.created_at DESC LIMIT 80`)).slice(0, 20);
  const completed = groupMovieItems(mediaRows(profile.id, "AND p.completed = 1 ORDER BY m.created_at DESC LIMIT 120")).slice(0, 40);
  const watchedRecently = groupMovieItems(mediaRows(profile.id, "AND p.updated_at IS NOT NULL ORDER BY p.updated_at DESC LIMIT 120")).slice(0, 40);
  const watchlistIds = new Set((db.prepare("SELECT catalog_id FROM profile_watchlist WHERE profile_id = ? ORDER BY created_at DESC").all(profile.id) as Array<{ catalog_id: string }>).map((row) => row.catalog_id));
  // « Ma liste » se compose de fiches complètes : ses séries sont rechargées avec leur épisode
  // représentatif, sans quoi elles arriveraient au client sans média jouable et sans bouton de lecture.
  const watchlistShows = showItems(profile.id, { catalogIds: [...watchlistIds] });
  const watchlist = [...watchlistShows, ...allMovies.filter((item) => watchlistIds.has(item.catalogId ?? item.id))]
    .map((item) => ({ ...item, inWatchlist: true }));
  const candidates = [...allShows, ...allMovies].map((item) => ({ ...item, inWatchlist: watchlistIds.has(item.catalogId ?? item.id) }));
  const feedback = new Map((db.prepare("SELECT catalog_id, value FROM recommendation_feedback WHERE profile_id = ?").all(profile.id) as Array<{ catalog_id: string; value: "like" | "dislike" | "dismissed" }>).map((row) => [row.catalog_id, row.value]));
  return {
    profile,
    featured: continueWatching[0] ?? movies[0] ?? shows[0] ?? null,
    continueWatching,
    recentlyAdded,
    movies,
    movieTotal: allMovies.length,
    showTotal: allShows.length,
    shows,
    completed,
    watchedRecently,
    watchlist,
    recommendations: recommendLocal(candidates, watchedRecently, 20, feedback),
  };
}

const HOME_PAGE_SIZE = 60;
const CATALOG_MAX_LIMIT = 200;

/**
 * Une page de catalogue, triée et filtrée par SQL.
 *
 * Le tri et le filtre d'état doivent impérativement s'appliquer avant le découpage : trier une page
 * déjà découpée ne trierait que les quelques titres chargés, ce qui donne un classement faux sans
 * lever la moindre erreur.
 *
 * La pagination est par décalage plutôt que par curseur. À l'échelle d'une médiathèque — quelques
 * milliers de fiches, index couvrant — un `OFFSET` est négligeable, et il préserve les trois tris et
 * le saut direct dans la liste. Le prix est connu : une analyse qui insère des fiches pendant le
 * défilement peut décaler d'un rang la page suivante.
 */
export function listCatalog(profileId: string, query: CatalogQuery): AnchoredCatalogPage {
  const limit = Math.min(CATALOG_MAX_LIMIT, Math.max(1, Math.trunc(query.limit ?? HOME_PAGE_SIZE)));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const sort: CatalogSort = query.sort ?? "title";
  const filter: CatalogFilter = query.filter ?? "all";
  const search = query.query?.trim() ?? "";
  const initialLetter = query.letter;

  if (query.kind === "shows") {
    const bornes = { minYear: query.minYear, maxYear: query.maxYear, genres: query.genres };
    const total = countShows(profileId, search, filter, bornes);
    const letterAnchor = initialLetter && sort === "title" && offset === 0
      ? alphabeticOffset(showItems(profileId, { titleFilter: search || undefined, sort, filter, ...bornes,
        withRepresentative: false }), initialLetter)
      : undefined;
    const pageOffset = letterAnchor == null ? offset : alphabeticWindow(letterAnchor, total, limit);
    const items = showItems(profileId, { titleFilter: search || undefined, sort, filter, limit, offset: pageOffset, ...bornes });
    return { items, total, offset: pageOffset, limit, anchor: letterAnchor,
      availableGenres: listAvailableGenres(profileId, "shows") };
  }

  // Étanchéité entre Films et Séries. Le filtre sur `m.kind` ne suffit pas : un épisode dont la
  // détection a échoué est enregistré comme film et se retrouve dans la page Films. Une bibliothèque
  // explicitement déclarée « séries » n'a aucune raison d'y alimenter quoi que ce soit — c'est une
  // information que la personne a donnée, plus fiable que la lecture d'un nom de fichier.
  // Les bibliothèques en mode automatique ou mixte restent servies : elles peuvent légitimement
  // contenir les deux, et les exclure ferait disparaître de vrais films.
  const conditions = ["AND m.kind = 'movie'",
    "AND NOT EXISTS (SELECT 1 FROM library_folders lib WHERE lib.id = m.library_id AND lib.kind = 'tv')"];
  const params: Array<string | number> = [];
  if (search) {
    const recherche = workSearchClause("m", search);
    conditions.push(recherche.clause);
    params.push(...recherche.params);
  }
  conditions.push(movieFilterClause(filter));
  // Les bornes rejoignent les mêmes conditions que la recherche et l'état : les trois s'appliquent
  // ensemble, et le décompte total en tient compte au même titre que la page affichée.
  const annees = yearBoundsClause("m", query.minYear, query.maxYear);
  if (annees.clause) { conditions.push(annees.clause); params.push(...annees.params); }
  const genresDemandes = genreClause("m", query.genres);
  if (genresDemandes.clause) { conditions.push(genresDemandes.clause); params.push(...genresDemandes.params); }

  const allItems = groupMovieItems(mediaRows(profileId,
    `${conditions.join(" ")} ORDER BY ${MOVIE_ORDER[sort]}`, ...params));
  const letterAnchor = initialLetter && sort === "title" && offset === 0
    ? alphabeticOffset(allItems, initialLetter) : undefined;
  const pageOffset = letterAnchor == null ? offset : alphabeticWindow(letterAnchor, allItems.length, limit);
  return { items: allItems.slice(pageOffset, pageOffset + limit), total: allItems.length, offset: pageOffset, limit,
    anchor: letterAnchor,
    availableGenres: listAvailableGenres(profileId, "movies") };
}

function countShows(profileId: string, search: string, filter: CatalogFilter,
  bornes: { minYear?: number; maxYear?: number; genres?: string[] } = {}): number {
  const state = showFilterClause(filter);
  const params: Array<string | number> = [];
  const limitAge = childAge(profileId);
  if (limitAge != null) params.push(limitAge);
  if (state.needsProfile) params.push(profileId);
  let titleClause = "";
  if (search) {
    const recherche = workSearchClause("c", search);
    titleClause = recherche.clause;
    params.push(...recherche.params);
  }
  const annees = yearBoundsClause("c", bornes.minYear, bornes.maxYear);
  params.push(...annees.params);
  const genresDemandes = genreClause("c", bornes.genres);
  params.push(...genresDemandes.params);
  return Number((db.prepare(`
    SELECT COUNT(*) AS total FROM catalog_items c
    WHERE c.kind = 'show' AND ${HAS_AVAILABLE_EPISODE} ${NOT_IN_MOVIE_LIBRARY}
      ${limitAge == null ? "" : "AND (c.age_rating IS NULL OR c.age_rating <= ?)"}
      ${state.sql} ${titleClause} ${annees.clause} ${genresDemandes.clause}
  `).get(...params) as { total: number }).total);
}

const MOVIE_ORDER: Record<CatalogSort, string> = {
  // NULLS LAST reproduit le tri du client, où une année absente valait -Infinity en ordre décroissant.
  title: "m.sort_title, m.id",
  release: "m.year DESC NULLS LAST, m.sort_title, m.id",
  added: "m.created_at DESC, m.id",
};

function movieFilterClause(filter: CatalogFilter): string {
  if (filter === "watched") return "AND p.completed = 1";
  if (filter === "progress") return "AND p.completed = 0 AND p.position_seconds > 0";
  if (filter === "unwatched") return "AND (p.media_id IS NULL OR (p.completed = 0 AND p.position_seconds = 0))";
  return "";
}

export function searchCatalog(profileId: string, query: string): Array<MediaItem & { seasonCount?: number }> {
  const normalized = query.trim();
  if (!normalized) return [];
  // Le titre de recherche d'un épisode contient déjà le nom de sa série.
  const recherche = workSearchClause("m", normalized);
  const media = groupMovieItems(mediaRows(profileId, `${recherche.clause} ORDER BY m.sort_title LIMIT 160`, ...recherche.params));
  // Le filtre part en SQL : la recherche construisait auparavant la totalité des séries pour n'en
  // conserver que celles dont le titre correspondait, soit le coût d'un accueil complet par frappe.
  const shows = showItems(profileId, { titleFilter: normalized, limit: 80 });
  return [...shows, ...media].slice(0, 80);
}

function peopleForCatalog(catalogId: string): CatalogPerson[] {
  const rows = db.prepare(`
    SELECT person.id, person.name, person.profile_url, credit.role, credit.character, credit.job, credit.credit_order
    FROM catalog_people_credits credit JOIN catalog_people person ON person.id = credit.person_id
    WHERE credit.catalog_id = ?
    ORDER BY CASE credit.role WHEN 'actor' THEN 0 WHEN 'creator' THEN 1 WHEN 'director' THEN 2
      WHEN 'writer' THEN 3 ELSE 4 END, credit.credit_order, person.name LIMIT 40
  `).all(catalogId) as Array<{
    id: string; name: string; profile_url: string | null; role: CatalogPerson["role"];
    character: string; job: string | null; credit_order: number;
  }>;
  return rows.map((row) => ({ id: row.id, name: row.name, profileUrl: row.profile_url, role: row.role,
    character: row.character || null, job: row.job, order: row.credit_order }));
}

function genresForCatalog(catalogId: string): string[] {
  return (db.prepare("SELECT genre FROM catalog_genres WHERE catalog_id = ? ORDER BY genre").all(catalogId) as Array<{ genre: string }>)
    .map((row) => row.genre);
}

function collectionForCatalog(profileId: string, catalogId: string): MediaDetails["collection"] {
  const collection = db.prepare("SELECT collection_id, collection_name FROM catalog_items WHERE id = ?").get(catalogId) as
    { collection_id: string | null; collection_name: string | null } | undefined;
  if (!collection?.collection_id || !collection.collection_name) return null;
  const items = groupMovieItems(mediaRows(profileId, `AND m.kind = 'movie' AND m.catalog_id IN (
    SELECT id FROM catalog_items WHERE kind = 'movie' AND collection_id = ?)
    ORDER BY m.year, m.sort_title`, collection.collection_id)).slice(0, 30);
  return items.length > 1 ? { id: collection.collection_id, name: collection.collection_name, items } : null;
}

/** Filmographie locale d'une personne ; aucun appel fournisseur n'est effectué à l'ouverture. */
export function getPersonDetails(profileId: string, id: string): PersonDetails | null {
  const person = db.prepare("SELECT id, name, profile_url FROM catalog_people WHERE id = ?").get(id) as
    { id: string; name: string; profile_url: string | null } | undefined;
  if (!person) return null;
  const roles = db.prepare(`SELECT catalog_id, role, character, job FROM catalog_people_credits
    WHERE person_id = ? ORDER BY catalog_id, credit_order`).all(id) as Array<{
      catalog_id: string; role: CatalogPerson["role"]; character: string; job: string | null;
    }>;
  const catalogIds = [...new Set(roles.map((role) => role.catalog_id))].filter((catalogId) => isCatalogAllowed(profileId, catalogId));
  if (!catalogIds.length) return { person: { id: person.id, name: person.name, profileUrl: person.profile_url }, items: [], roles: [] };
  const movies = groupMovieItems(mediaRows(profileId,
    `AND m.kind = 'movie' AND m.catalog_id IN (${catalogIds.map(() => "?").join(", ")})`, ...catalogIds));
  const shows = showItems(profileId, { catalogIds, limit: 120 });
  const allowedCatalogIds = new Set(catalogIds);
  const items = [...movies, ...shows].sort((left, right) => (right.year ?? 0) - (left.year ?? 0)
    || left.sortTitle.localeCompare(right.sortTitle, "fr"));
  return {
    person: { id: person.id, name: person.name, profileUrl: person.profile_url }, items,
    roles: roles.filter((role) => allowedCatalogIds.has(role.catalog_id)).map((role) => ({ catalogId: role.catalog_id, role: role.role,
      character: role.character || null, job: role.job })),
  };
}

export function getMediaItem(profileId: string, id: string): MediaItem | null {
  return mediaRows(profileId, "AND m.id = ?", id)[0] ?? null;
}

export function getPlaybackNeighbors(profileId: string, mediaId: string): PlaybackNeighbors {
  const current = db.prepare(`SELECT library_id, show_title, season_number, episode_number FROM media_items
    WHERE id = ? AND kind = 'episode' AND available = 1`).get(mediaId) as {
      library_id: string | null; show_title: string | null; season_number: number | null; episode_number: number | null;
    } | undefined;
  if (!current?.library_id || !current.show_title || current.season_number == null || current.episode_number == null) {
    return { previous: null, next: null };
  }
  const row = (direction: "previous" | "next") => {
    const comparison = direction === "next"
      ? "(m.season_number > ? OR (m.season_number = ? AND m.episode_number > ?))"
      : "(m.season_number < ? OR (m.season_number = ? AND m.episode_number < ?))";
    const order = direction === "next" ? "ASC" : "DESC";
    return db.prepare(`${mediaSelect} WHERE m.available = 1 AND m.kind = 'episode' AND m.library_id = ? AND m.show_title = ?
      AND ${comparison} ORDER BY m.season_number ${order}, m.episode_number ${order}, m.created_at ${order} LIMIT 1`)
      .get(profileId, current.library_id, current.show_title, current.season_number, current.season_number, current.episode_number) as MediaRow | undefined;
  };
  const previous = row("previous"); const next = row("next");
  return { previous: previous ? mapMedia(previous) : null, next: next ? mapMedia(next) : null };
}

/**
 * Films à proposer à côté d'une fiche.
 *
 * Cette liste tirait douze films **au hasard** : la section s'appelait « À voir ensuite » et
 * proposait n'importe quoi. Un rapprochement arbitraire est pire qu'une section vide, parce qu'il
 * laisse croire à un lien qui n'existe pas.
 *
 * Trois niveaux, du plus sûr au plus lâche :
 *   1. **la même saga** — c'est le lien le plus fort qui soit : les autres films de la série ;
 *   2. **les genres partagés**, classés par nombre de genres communs ;
 *   3. **rien d'autre**, plutôt que de compléter au hasard.
 *
 * Le troisième point est un choix : une liste courte mais juste vaut mieux qu'une liste pleine et
 * fausse. Sur un catalogue sans métadonnées encore analysées, la section disparaît — et c'est une
 * information honnête sur l'état de la médiathèque.
 */
function relatedMovies(profileId: string, excludedId: string, catalogId: string | null): MediaItem[] {
  if (!catalogId) return [];

  const saga = groupMovieItems(mediaRows(profileId, `
    AND m.kind = 'movie' AND m.id <> ?
    AND EXISTS (
      SELECT 1 FROM catalog_items moi
      JOIN catalog_items autre ON autre.id = m.catalog_id
      WHERE moi.id = ? AND moi.collection_id IS NOT NULL AND autre.collection_id = moi.collection_id)
    ORDER BY m.year, m.sort_title LIMIT 30`, excludedId, catalogId)).slice(0, 12);
  if (saga.length >= 12) return saga;

  // Les genres partagés viennent ensuite, les plus proches d'abord. Les films de la saga déjà retenus
  // en sont écartés : les répéter donnerait l'impression d'un catalogue plus pauvre qu'il n'est.
  const dejaVus = new Set([excludedId, ...saga.map((film) => film.id)]);
  const parGenre = db.prepare(`
    SELECT m.id, COUNT(*) AS communs
    FROM media_items m
    JOIN catalog_genres sien ON sien.catalog_id = m.catalog_id
    JOIN catalog_genres mien ON mien.genre = sien.genre AND mien.catalog_id = ?
    WHERE m.available = 1 AND m.library_id IS NOT NULL AND m.kind = 'movie' AND m.catalog_id <> ?
    GROUP BY m.id ORDER BY communs DESC, m.sort_title LIMIT 40
  `).all(catalogId, catalogId) as Array<{ id: string }>;

  const retenus = parGenre.map((ligne) => ligne.id).filter((id) => !dejaVus.has(id)).slice(0, 12 - saga.length);
  if (!retenus.length) return saga;
  const complements = mediaRows(profileId,
    `AND m.id IN (${retenus.map(() => "?").join(", ")})`, ...retenus);
  // `IN` ne garantit aucun ordre : on rétablit celui du classement par genres communs.
  const rang = new Map(retenus.map((id, index) => [id, index]));
  complements.sort((gauche, droite) => (rang.get(gauche.id) ?? 0) - (rang.get(droite.id) ?? 0));
  return groupMovieItems([...saga, ...complements]).slice(0, 12);
}

export function getDetails(profileId: string, id: string): MediaDetails | null {
  const direct = getMediaItem(profileId, id);
  let catalogId = resolvedCatalogId(direct?.catalogId ?? id);
  let catalog = db.prepare(`
    SELECT id, library_id, parent_id, kind, title, sort_title, year, created_at, overview, poster_url, backdrop_url,
      season_number, age_rating, rating_label
    FROM catalog_items WHERE id = ?
  `).get(catalogId) as {
    id: string; library_id: string | null; parent_id: string | null; kind: "movie" | "show" | "season" | "episode"; title: string;
    sort_title: string; year: number | null; created_at: string; overview: string | null; poster_url: string | null;
    backdrop_url: string | null; season_number: number | null; age_rating: number | null; rating_label: string | null;
  } | undefined;

  if (catalog?.kind === "episode" && catalog.parent_id) {
    const season = db.prepare("SELECT parent_id FROM catalog_items WHERE id = ?").get(catalog.parent_id) as { parent_id: string | null } | undefined;
    if (season?.parent_id) {
      catalogId = season.parent_id;
      catalog = db.prepare(`
        SELECT id, library_id, parent_id, kind, title, sort_title, year, created_at, overview, poster_url, backdrop_url,
          season_number, age_rating, rating_label
        FROM catalog_items WHERE id = ?
      `).get(catalogId) as typeof catalog;
    }
  }

  if (catalog && !isCatalogAllowed(profileId, catalog.id)) return null;

  if (!catalog) {
    if (!direct) return null;
    return { item: direct, source: sourceFile(direct.id), seasons: [], related: relatedMovies(profileId, direct.id, direct.catalogId ?? null) };
  }

  if (catalog.kind === "movie") {
    const versions = movieVersions(catalog.id);
    // `movieVersions` ne retient qu'un fichier disponible et nommé : c'est ce qu'il faut pour offrir
    // le choix d'une version, mais pas pour décider qu'il n'y a rien à montrer. Un film dont le
    // partage réseau dort n'a plus aucune version listable, et la fiche disparaissait entièrement —
    // ni titre, ni jaquette, ni résumé — au lieu d'afficher l'œuvre et de dire qu'elle est
    // momentanément injoignable. Le média rattaché à la fiche reste la bonne réponse.
    const attaché = db.prepare("SELECT id FROM media_items WHERE catalog_id = ? ORDER BY available DESC, created_at LIMIT 1")
      .get(catalog.id) as { id: string } | undefined;
    const movie = (versions.length ? getMediaItem(profileId, versions[0]!.mediaId) : null)
      ?? (attaché ? getMediaItem(profileId, attaché.id) : null) ?? direct;
    if (!movie) return null;
    return {
      item: {
        ...movie,
        catalogId: catalog.id,
        title: catalog.title,
        sortTitle: catalog.sort_title,
        year: catalog.year,
        overview: catalog.overview,
        posterUrl: catalog.poster_url,
        backdropUrl: catalog.backdrop_url,
        inWatchlist: Boolean(db.prepare("SELECT 1 FROM profile_watchlist WHERE profile_id = ? AND catalog_id = ?").get(profileId, catalog.id)),
        // Sans cette bibliothèque, la fiche ne peut pas proposer de corriger sa correspondance : le
        // bouton se conditionne à sa présence. Le chemin des séries l'attachait, celui des films non,
        // si bien que la correction n'était offerte que pour les séries.
        libraryId: catalog.library_id,
      },
      source: versions[0] ? { kind: "file", name: versions[0].name } : sourceFile(movie.id),
      versions,
      qualities: [...new Set(versions.map((version) => version.quality).filter((quality): quality is string => Boolean(quality)))],
      people: peopleForCatalog(catalog.id),
      genres: genresForCatalog(catalog.id),
      collection: collectionForCatalog(profileId, catalog.id),
      seasons: [],
      related: relatedMovies(profileId, movie.id, catalog.id),
    };
  }

  if (catalog.kind !== "show") return null;
  const seasons = db.prepare(`
    SELECT id, title, season_number, overview, poster_url FROM catalog_items
    WHERE parent_id = ? AND kind = 'season' ORDER BY season_number
  `).all(catalog.id) as Array<{ id: string; title: string; season_number: number; overview: string | null; poster_url: string | null }>;
  const seasonDetails: SeasonDetails[] = seasons.map((season) => {
    // Un épisode dont la numérotation n'a pas été extraite a `episode_number` à NULL, et SQLite
    // classe les NULL **en premier** : un seul épisode mal analysé suffisait à ouvrir la saison sur
    // le neuvième. Ils passent en fin de liste, et le titre départage à numéro égal plutôt que de
    // laisser l'ordre au hasard de l'insertion.
    const episodes = mediaRows(profileId, `
      AND m.catalog_id IN (SELECT id FROM catalog_items WHERE parent_id = ? AND kind = 'episode')
      ORDER BY m.season_number NULLS LAST, m.episode_number NULLS LAST, m.sort_title, m.title
    `, season.id);
    return {
      id: season.id,
      number: season.season_number,
      title: season.title,
      overview: season.overview,
      posterUrl: season.poster_url,
      completed: episodes.length > 0 && episodes.every((episode) => episode.completed),
      episodes,
    };
  });
  /**
   * **L'épisode par lequel on reprend une série, et non son tout premier.**
   *
   * La fiche désignait `episodes[0]` — le premier épisode de la première saison —, et rapportait *sa*
   * progression comme étant celle de la série. Conséquence visible partout : « Reprendre » sur
   * n'importe quelle série ramenait à S01E01, sur le Web comme sur Android, et la fiche d'une série
   * finie s'annonçait à 100 % parce que son premier épisode l'était.
   *
   * Ce n'était pas une faute d'affichage : les deux clients ne faisaient que suivre ce que le serveur
   * leur désignait. La rangée « Continuer à regarder » savait pourtant répondre juste — le
   * renseignement existait, il n'était simplement pas calculé ici.
   *
   * Trois cas, dans cet ordre, et l'ordre est ce qui compte :
   *
   * 1. **l'épisode commencé et non fini** — celui qu'on a quitté en cours de route, le plus ancien
   *    s'il y en a plusieurs ; c'est très exactement ce que « reprendre » veut dire ;
   * 2. sinon **le premier non terminé**, c'est-à-dire celui qui vient ensuite ;
   * 3. sinon le tout premier : la série est finie, on la recommence — et là, `episodes[0]` est la
   *    bonne réponse.
   *
   * Les épisodes arrivent déjà dans l'ordre des saisons puis des numéros, ce qui rend « le plus
   * ancien » lisible sans tri supplémentaire.
   */
  const tousLesEpisodes = seasonDetails.flatMap((season) => season.episodes) as MediaItemWithProgress[];
  const commence = tousLesEpisodes.find((episode) => !episode.completed && (episode.progressPercent ?? 0) > 0);
  const aVenir = tousLesEpisodes.find((episode) => !episode.completed);
  const firstEpisode = commence ?? aVenir ?? tousLesEpisodes[0] ?? null;
  const firstEpisodeProgress = firstEpisode as MediaItemWithProgress | null;
  const item: MediaItemWithProgress & { seasonCount: number; libraryId: string | null } = {
    id: catalog.id,
    catalogId: catalog.id,
    playableMediaId: firstEpisode?.id ?? null,
    kind: "show",
    title: catalog.title,
    sortTitle: catalog.sort_title,
    year: catalog.year,
    addedAt: catalog.created_at,
    overview: catalog.overview,
    posterUrl: catalog.poster_url,
    backdropUrl: catalog.backdrop_url,
    showTitle: catalog.title,
    seasonNumber: null,
    episodeNumber: null,
    runtimeSeconds: null,
    ageRating: catalog.age_rating,
    ratingLabel: catalog.rating_label,
    progressPercent: firstEpisode?.progressPercent ?? 0,
    progressPositionSeconds: firstEpisodeProgress?.progressPositionSeconds ?? 0,
    progressDurationSeconds: firstEpisodeProgress?.progressDurationSeconds ?? 0,
    completed: seasonDetails.some((season) => season.episodes.length > 0)
      && seasonDetails.filter((season) => season.episodes.length > 0).every((season) => season.completed),
    seasonCount: seasonDetails.length,
    libraryId: catalog.library_id,
    inWatchlist: Boolean(db.prepare("SELECT 1 FROM profile_watchlist WHERE profile_id = ? AND catalog_id = ?").get(profileId, catalog.id)),
  };
  return { item, source: sourceShowFolder(firstEpisode?.id ?? null), qualities: showQualities(catalog.id),
    people: peopleForCatalog(catalog.id), genres: genresForCatalog(catalog.id), collection: null,
    seasons: seasonDetails, related: [] };
}
