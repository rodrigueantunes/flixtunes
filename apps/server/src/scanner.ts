import { randomUUID } from "node:crypto";
import { opendir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { LibraryFolder, MetadataSearchCandidate, ScanMode } from "@flixtunes/contracts";
import { db, inTransaction, listLibraries, setCatalogGenres, setCatalogPeople } from "./database.js";
import { mergeEmbeddedMetadata, parseProbeOutput, probeMedia } from "./ffprobe.js";
import { mergeSidecarMetadata, parseMediaPath, type ParsedMedia } from "./media-parser.js";
import { readSidecarNfo } from "./nfo.js";
import { applyMatchHints, readMatchHints } from "./match-hints.js";
import { MATCH_THRESHOLDS, rankMetadataMatches } from "./match-engine.js";
import { normaliseForSearch } from "./search-normalise.js";
import { artworkUrlIsGenerated, cacheGeneratedArtwork, cacheLocalArtwork, cacheRemoteArtwork, findLocalArtwork } from "./artwork.js";
import { fetchMetadataWithProviders, searchAllMetadata } from "./metadata-providers.js";
import {
  analyserVideoWeb, illustrerVideoWeb, libelleDuPalierDuFichier, noterCorrespondanceWeb,
} from "./web-analyse.js";
import type { EntityMetadata, MetadataBundle } from "./tmdb.js";
import { recordEntityProvenance } from "./metadata-fields.js";
import {
  assessDisappearance, clearSkippedFile, isStableFile, needsStabilityCheck, pruneSkippedFiles, recordSkippedFile,
} from "./scan-safety.js";

const videoExtensions = new Set([".mkv", ".mp4", ".m4v", ".avi", ".mov", ".webm", ".ts", ".m2ts"]);

function metadataLog(event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  // Une ligne JSON par décision : exploitable dans le journal ASUSTOR partagé, sans jeton ni URL
  // d'API. Le nom du fichier suffit à relier l'événement à la médiathèque.
  console.info(JSON.stringify({ scope: "metadata", event, ...details }));
}

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

interface PendingMatchProposal {
  sourceTitle: string;
  sourceYear: number | null;
  candidate: MetadataSearchCandidate | null;
  candidates: MetadataSearchCandidate[];
  score: number;
  status: "review" | "rejected";
  reasons: string[];
}

function rootCatalogId(catalogId: string): string {
  const row = db.prepare(`SELECT COALESCE(root.id, parent.id, item.id) AS id FROM catalog_items item
    LEFT JOIN catalog_items parent ON parent.id = item.parent_id
    LEFT JOIN catalog_items root ON root.id = parent.parent_id WHERE item.id = ?`).get(catalogId) as { id: string } | undefined;
  return row?.id ?? catalogId;
}

function storeMatchProposal(catalogId: string, proposal: PendingMatchProposal | null): void {
  const rootId = rootCatalogId(catalogId);
  if (!proposal) {
    db.prepare("DELETE FROM metadata_match_proposals WHERE catalog_id = ?").run(rootId);
    return;
  }
  db.prepare(`INSERT INTO metadata_match_proposals (catalog_id, source_title, source_year, provider, external_id,
      candidate_title, candidate_year, score, status, reasons_json, candidates_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(catalog_id) DO UPDATE SET source_title = excluded.source_title, source_year = excluded.source_year,
      provider = excluded.provider, external_id = excluded.external_id, candidate_title = excluded.candidate_title,
      candidate_year = excluded.candidate_year, score = excluded.score, status = excluded.status,
      reasons_json = excluded.reasons_json, candidates_json = excluded.candidates_json, updated_at = CURRENT_TIMESTAMP`)
    .run(rootId, proposal.sourceTitle, proposal.sourceYear, proposal.candidate?.provider ?? null,
      proposal.candidate?.externalId ?? null, proposal.candidate?.title ?? null, proposal.candidate?.year ?? null,
      proposal.score, proposal.status, JSON.stringify(proposal.reasons), JSON.stringify(proposal.candidates));
  db.prepare(`UPDATE catalog_items SET match_status = ?, match_confidence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND metadata_locked = 0`).run(proposal.status === "review" ? "review" : "unmatched", proposal.score, rootId);
}

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) yield fullPath;
  }
}

/**
 * Compte les dossiers de saisons voisins d'un épisode.
 *
 * Une médiathèque range presque toujours chaque saison dans son dossier : le nombre de ces dossiers
 * est une observation directe, utile pour départager deux séries homonymes. On remonte au dossier de
 * la série — le parent du dossier de saison — et on compte ses sous-dossiers qui ressemblent à une
 * saison. Un échec de lecture rend zéro : l'indice disparaît alors, sans conséquence.
 */
export async function countSeasonFolders(mediaPath: string): Promise<number> {
  const showFolder = path.dirname(path.dirname(mediaPath));
  try {
    const entries = await readdir(showFolder, { withFileTypes: true });
    const seasons = entries.filter((entry) => entry.isDirectory()
      && /^(saison|season|s)[\s._-]*\d{1,3}$/i.test(entry.name.trim()));
    return seasons.length;
  } catch {
    return 0;
  }
}

export interface ScanResult {
  roots: number;
  discovered: number;
  imported: number;
  enriched: number;
  removed: number;
  /** Fichiers écartés parce qu'ils étaient encore en cours d'écriture. Ils seront repris au prochain passage. */
  unstable: number;
  /** Fiches de catalogue retirées parce qu'elles ne désignaient plus aucun fichier. */
  ghosts?: number;
  /** Médias absents qu'un garde-fou a refusé de marquer indisponibles. */
  retainedMissing?: number;
  /** Motif de ce refus, à présenter à la personne. */
  retainedReason?: string | null;
  errors: Array<{ path: string; message: string }>;
}

interface ScanOptions {
  mode?: ScanMode;
  onProgress?: (result: ScanResult) => void;
  signal?: AbortSignal;
  /** Applique les disparitions malgré le garde-fou : la personne a confirmé la suppression. */
  confirmRemovals?: boolean;
  /** Délai d'observation d'un fichier récemment écrit, en millisecondes. Réduit dans les tests. */
  stabilityDelayMs?: number;
  /**
   * Ne reprend que les fiches restées sans correspondance ou peu sûres.
   *
   * Une analyse de métadonnées complète interroge le fournisseur pour **chaque** film : 1 449 requêtes
   * là où 65 fiches seulement posaient problème. Cette reprise ciblée coûte le vingtième, ce qui la
   * rend assez légère pour être lancée d'elle-même après une analyse — c'est ce qui manquait : une
   * fiche laissée de côté par une indisponibilité passagère n'était jamais reprise.
   *
   * Les fiches corrigées à la main sont exclues : leur verrou signifie que la personne a tranché.
   */
  onlyUnmatched?: boolean;
  /**
   * Ne reprend qu'une seule fiche, désignée par son identifiant de catalogue.
   *
   * Une correction manuelle déclenchait une analyse de **toute** la bibliothèque : mille quatre cents
   * interrogations du fournisseur, mises en file derrière le reste, pour un seul film qu'on venait de
   * corriger. Le temps d'attente était tel que la correction paraissait sans effet — on la refaisait,
   * en vain.
   *
   * Un fichier au lieu de mille quatre cents : la correction s'applique le temps d'un aller-retour, et
   * l'écran peut la montrer aussitôt.
   */
  onlyCatalogId?: string;
  /**
   * Cède la main tant qu'une lecture réclame la machine.
   *
   * Appelée entre deux fichiers. Le contrôle de capacité existait déjà, mais il ne s'appliquait qu'au
   * **démarrage** d'une analyse : une analyse déjà lancée continuait à plein régime si une lecture
   * commençait ensuite — exactement la séquence qui met le NAS à genoux, analyse d'abord, film 4K
   * après. La protection regardait dans le mauvais sens.
   *
   * Entre deux fichiers est le bon moment : aucun travail n'est en cours, rien n'est à défaire, et
   * l'attente ne coûte que du temps d'analyse — précisément ce qu'on accepte de perdre.
   */
  yieldToPlayback?: (signal?: AbortSignal) => Promise<void>;
}

function upsertCatalogEntity(args: {
  library: LibraryFolder;
  kind: "movie" | "show" | "season" | "episode";
  parentId: string | null;
  title: string;
  sortTitle: string;
  year?: number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
    metadata?: EntityMetadata | null;
  parsed?: ParsedMedia;
  /** Dossier racine de la série : identité stable d'une fiche `show`. */
  sourceFolder?: string | null;
  /**
   * Fiche déjà rattachée à ce fichier lors d'une analyse précédente.
   *
   * Filet de dernier recours, consulté après l'identifiant du fournisseur mais avant la clé
   * « titre + année » : quand le fournisseur ne répond pas, le titre retombe sur le nom de fichier et
   * cette clé ne retrouve plus rien. Une nouvelle fiche naissait alors, le média basculait dessus, et
   * l'ancienne restait derrière, vide. Le fichier, lui, n'a pas changé.
   */
  previousId?: string | null;
}): string {
  const { library, kind, parentId } = args;
  let existing: { id: string } | undefined;
  if (kind === "season") {
    existing = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'season' AND parent_id = ? AND season_number = ?")
      .get(library.id, parentId, args.seasonNumber ?? null) as { id: string } | undefined;
  } else if (kind === "episode") {
    existing = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'episode' AND parent_id = ? AND episode_number = ?")
      .get(library.id, parentId, args.episodeNumber ?? null) as { id: string } | undefined;
  } else if (kind === "show" && args.sourceFolder) {
    // Le dossier prime sur tout le reste pour une série : c'est la seule clé qu'un fournisseur muet,
    // lent ou remplacé ne peut pas faire varier d'un épisode à l'autre.
    existing = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'show' AND source_folder = ?")
      .get(library.id, args.sourceFolder) as { id: string } | undefined;
  }
  if (!existing && kind !== "season" && kind !== "episode" && args.metadata?.externalId) {
    existing = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = ? AND external_provider = ? AND external_id = ?")
      .get(library.id, kind, args.metadata.provider, args.metadata.externalId) as { id: string } | undefined;
  }
  if (!existing && args.previousId) {
    existing = db.prepare("SELECT id FROM catalog_items WHERE id = ? AND library_id = ? AND kind = ?")
      .get(args.previousId, library.id, kind) as { id: string } | undefined;
  }
  existing ??= db.prepare(`
    SELECT id FROM catalog_items WHERE library_id = ? AND kind = ? AND COALESCE(parent_id, '') = COALESCE(?, '')
      AND sort_title = ? AND COALESCE(year, -1) = COALESCE(?, -1)
  `).get(library.id, kind, parentId, args.sortTitle, args.year ?? null) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  db.prepare(`
    INSERT INTO catalog_items (
      id, library_id, parent_id, kind, title, original_title, sort_title, search_title, year, season_number, episode_number,
      overview, poster_url, backdrop_url, metadata_language, original_language, external_provider, external_id, imdb_id,
      match_status, match_confidence, content_type, edition, source_ids_json, source_folder, age_rating, rating_label
      , rating_checked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      -- Le dossier ne s'efface jamais : une analyse qui ne le fournit pas ne prouve pas qu'il a changé.
      source_folder = COALESCE(excluded.source_folder, catalog_items.source_folder),
      -- Une fiche verrouillée par une correction manuelle conserve son identité. Sans ces gardes, un
      -- simple rescan réécrivait titre, année, résumé et identifiants par-dessus le travail de
      -- l'utilisateur.
      --
      -- Mais le verrou ne doit pas se retourner contre celui qui l'a posé. Corriger une correspondance,
      -- c'est désigner une fiche TMDB **sans en connaître le contenu** : l'interface envoie un
      -- identifiant, et c'est l'analyse qui doit aller chercher titre, année et résumé. Un verrou
      -- aveugle bloquait cette écriture-là aussi — la correspondance changeait en base, l'écran ne
      -- bougeait pas, et la correction semblait ignorée.
      --
      -- La garde porte donc sur la **provenance** : ce qui arrive de la fiche épinglée est ce que
      -- l'utilisateur a demandé, et s'écrit ; tout le reste est refusé.
      title = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.title ELSE excluded.title END,
      original_title = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.original_title
        ELSE COALESCE(excluded.original_title, catalog_items.original_title) END,
      sort_title = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.sort_title ELSE excluded.sort_title END,
      search_title = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.search_title ELSE excluded.search_title END,
      year = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.year
        ELSE COALESCE(excluded.year, catalog_items.year) END,
      overview = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.overview
        ELSE COALESCE(excluded.overview, catalog_items.overview) END,
      metadata_language = excluded.metadata_language,
      -- La langue de tournage vient du fournisseur : une fiche verrouillée garde la sienne, comme
      -- son titre, et une valeur absente n'efface pas celle qu'on avait.
      original_language = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.original_language
        ELSE COALESCE(excluded.original_language, catalog_items.original_language) END,
      -- L'identifiant épinglé, lui, ne bouge jamais tant que le verrou tient : c'est le verrou.
      external_provider = CASE WHEN catalog_items.metadata_locked = 1 THEN catalog_items.external_provider
        ELSE excluded.external_provider END,
      external_id = CASE WHEN catalog_items.metadata_locked = 1 THEN catalog_items.external_id
        ELSE excluded.external_id END,
      imdb_id = CASE WHEN catalog_items.metadata_locked = 1 AND (excluded.external_provider IS NOT catalog_items.external_provider
          OR excluded.external_id IS NOT catalog_items.external_id) THEN catalog_items.imdb_id
        ELSE excluded.imdb_id END,
      match_status = CASE WHEN catalog_items.metadata_locked = 1 THEN catalog_items.match_status ELSE excluded.match_status END,
      match_confidence = CASE WHEN catalog_items.metadata_locked = 1 THEN catalog_items.match_confidence ELSE excluded.match_confidence END,
      content_type = COALESCE(excluded.content_type, catalog_items.content_type), edition = COALESCE(excluded.edition, catalog_items.edition),
      source_ids_json = CASE WHEN excluded.source_ids_json = '{}' THEN catalog_items.source_ids_json ELSE excluded.source_ids_json END,
      age_rating = COALESCE(excluded.age_rating, catalog_items.age_rating),
      rating_label = COALESCE(excluded.rating_label, catalog_items.rating_label),
      rating_checked = MAX(catalog_items.rating_checked, excluded.rating_checked),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    id, library.id, parentId, kind, args.title, args.metadata?.originalTitle ?? null, args.sortTitle,
    normaliseForSearch(args.title),
    args.year ?? null, args.seasonNumber ?? null, args.episodeNumber ?? null, args.metadata?.overview ?? args.parsed?.overview ?? null,
    library.language, args.metadata?.originalLanguage ?? null,
    args.metadata?.provider ?? null, args.metadata?.externalId ?? null, args.metadata?.imdbId ?? null,
    args.metadata && args.metadata.confidence >= MATCH_THRESHOLDS.automatic ? "automatic"
      : args.metadata && args.metadata.confidence >= MATCH_THRESHOLDS.review ? "review" : "unmatched",
    args.metadata?.confidence ?? null,
    args.parsed?.contentType ?? null, args.parsed?.edition ?? null, JSON.stringify(args.parsed?.externalIds ?? {}),
    args.sourceFolder ?? null,
    args.metadata?.ageRating ?? null, args.metadata?.ratingLabel ?? null, args.metadata ? 1 : 0,
  );
  recordEntityProvenance(id, args.metadata ?? null, args.parsed);
  // Les genres suivent la fiche : une correspondance corrigée doit remplacer ceux de l'ancienne.
  if (args.metadata?.genres?.length) setCatalogGenres(id, args.metadata.genres);
  // Le casting n'est écrit que lorsque le fournisseur l'a explicitement rendu. Une fiche provenant
  // d'un fournisseur plus pauvre ne doit pas effacer les crédits TMDB déjà présents.
  if (args.metadata?.people !== undefined) setCatalogPeople(id, args.metadata.provider, args.metadata.people);
  // La saga suit la même règle que les genres : une absence n'est pas un retrait. Une réponse qui ne
  // la mentionne pas ne prouve pas que le film n'en fait plus partie.
  if (args.metadata?.collection) {
    db.prepare("UPDATE catalog_items SET collection_id = ?, collection_name = ? WHERE id = ?")
      .run(args.metadata.collection.externalId, args.metadata.collection.name, id);
  }
  return id;
}

async function applyEntityArtwork(
  catalogId: string,
  metadata: EntityMetadata | null | undefined,
  mediaPath: string,
  parentLevels: number,
): Promise<{ posterUrl: string | null; backdropUrl: string | null }> {
  const existing = db.prepare("SELECT poster_url, backdrop_url FROM catalog_items WHERE id = ?").get(catalogId) as
    { poster_url: string | null; backdrop_url: string | null };
  let posterUrl = existing.poster_url?.startsWith("/api/artwork/") ? existing.poster_url : null;
  let backdropUrl = existing.backdrop_url?.startsWith("/api/artwork/") ? existing.backdrop_url : null;
  // Les anciennes révisions ont enregistré des captures de film comme affiches. Elles doivent
  // disparaître même après une mise à niveau, sans attendre que l'utilisateur reparte de zéro.
  if (artworkUrlIsGenerated(posterUrl, "poster")) posterUrl = null;
  try {
    const localPoster = await findLocalArtwork(mediaPath, "poster", parentLevels);
    posterUrl = localPoster
      ? await cacheLocalArtwork(catalogId, "poster", localPoster, metadata?.language ?? "und")
      : await cacheRemoteArtwork(catalogId, "poster", metadata?.posterSourceUrl ?? null, metadata?.language ?? "und",
        metadata?.provider === "tvmaze" || metadata?.provider === "wikidata" ? metadata.provider : "tmdb") ?? posterUrl;
    const localBackdrop = await findLocalArtwork(mediaPath, "backdrop", parentLevels);
    backdropUrl = localBackdrop
      ? await cacheLocalArtwork(catalogId, "backdrop", localBackdrop, metadata?.language ?? "und")
      : await cacheRemoteArtwork(catalogId, "backdrop", metadata?.backdropSourceUrl ?? null, metadata?.language ?? "und",
        metadata?.provider === "tvmaze" || metadata?.provider === "wikidata" ? metadata.provider : "tmdb") ?? backdropUrl;
    backdropUrl ??= await cacheGeneratedArtwork(catalogId, "backdrop", mediaPath);
  } catch (error) {
    // Les métadonnées textuelles restent valides si une image est indisponible.
    metadataLog("artwork-failed", { catalogId, file: path.basename(mediaPath), provider: metadata?.provider ?? null,
      error: error instanceof Error ? error.message : String(error) });
  }
  db.prepare("UPDATE catalog_items SET poster_url = ?, backdrop_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(posterUrl, backdropUrl, catalogId);
  metadataLog("artwork-result", { catalogId, file: path.basename(mediaPath), provider: metadata?.provider ?? null,
    remotePosterOffered: Boolean(metadata?.posterSourceUrl), remoteBackdropOffered: Boolean(metadata?.backdropSourceUrl),
    posterStored: Boolean(posterUrl), backdropStored: Boolean(backdropUrl) });
  return { posterUrl, backdropUrl };
}

/**
 * Complète les images manquantes d'une fiche déjà connue.
 *
 * Appelée pour chaque fichier inchangé, donc à chaque analyse et pour toute la médiathèque. Lorsque la
 * fiche possède déjà ses deux images, il n'y a rien à chercher : sans cette sortie anticipée, chaque
 * analyse relançait une recherche d'images voisines sur le disque, et surtout une extraction ffmpeg
 * pour les fiches dont l'affiche ne peut pas être produite — vidéo illisible, fichier tronqué, codec
 * inconnu. Ces extractions échouaient et recommençaient indéfiniment, une par fichier et par analyse.
 */
async function backfillArtwork(catalogId: string, mediaPath: string): Promise<void> {
  const item = db.prepare("SELECT id, parent_id, kind, poster_url, backdrop_url FROM catalog_items WHERE id = ?").get(catalogId) as
    { id: string; parent_id: string | null; kind: "movie" | "show" | "season" | "episode";
      poster_url: string | null; backdrop_url: string | null } | undefined;
  if (!item) return;
  if (item.poster_url?.startsWith("/api/artwork/") && item.backdrop_url?.startsWith("/api/artwork/")) return;
  if (item.kind === "movie") {
    const art = await applyEntityArtwork(item.id, null, mediaPath, 0);
    db.prepare("UPDATE media_items SET poster_url = ?, backdrop_url = ? WHERE catalog_id = ?")
      .run(art.posterUrl, art.backdropUrl, item.id);
    return;
  }
  if (item.kind !== "episode" || !item.parent_id) return;
  const season = db.prepare("SELECT id, parent_id FROM catalog_items WHERE id = ?").get(item.parent_id) as
    { id: string; parent_id: string | null } | undefined;
  if (!season?.parent_id) return;
  const showArt = await applyEntityArtwork(season.parent_id, null, mediaPath, 1);
  const seasonArt = await applyEntityArtwork(season.id, null, mediaPath, 0);
  db.prepare("UPDATE media_items SET poster_url = ?, backdrop_url = ? WHERE catalog_id = ?")
    .run(seasonArt.posterUrl ?? showArt.posterUrl, seasonArt.backdropUrl ?? showArt.backdropUrl, item.id);
}

interface CatalogSyncResult {
  catalogId: string;
  title: string;
  showTitle: string | null;
  metadata: EntityMetadata | null;
  /**
   * Résumé propre à cette fiche, jamais emprunté à un parent.
   *
   * `metadata` retombe sur la série lorsque le détail d'un épisode manque, ce qui est correct pour
   * l'identité — fournisseur, identifiants — mais faux pour le résumé : les neuf épisodes d'une
   * saison affichaient alors le synopsis de la série, mot pour mot. Une absence assumée vaut mieux
   * qu'un texte qui ne décrit pas ce qu'on s'apprête à regarder.
   */
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
}

export function applyLocalMetadataFallbacks(parsed: ParsedMedia, bundle: MetadataBundle | null): MetadataBundle | null {
  if (!bundle || !parsed.overview?.trim()) return bundle;
  const entity = parsed.kind === "movie" ? bundle.movie : bundle.episode ?? bundle.show;
  if (entity && !entity.overview?.trim()) entity.overview = parsed.overview.trim();
  return bundle;
}

async function syncCatalog(
  library: LibraryFolder,
  parsed: ParsedMedia,
  bundle: MetadataBundle | null,
  mediaPath: string,
  /** Fiche déjà rattachée à ce fichier : elle survit à une indisponibilité du fournisseur. */
  previousCatalogId?: string | null,
): Promise<CatalogSyncResult> {
  if (parsed.kind === "movie") {
    const metadata = bundle?.movie ?? null;
    const title = metadata?.title ?? parsed.title;
    const catalogId = upsertCatalogEntity({
      library, kind: "movie", parentId: null, title, sortTitle: title.toLocaleLowerCase(library.language),
      year: metadata?.year ?? parsed.year, metadata, parsed, previousId: previousCatalogId,
    });
    const art = await applyEntityArtwork(catalogId, metadata, mediaPath, 0);
    return { catalogId, title, showTitle: null, metadata, overview: metadata?.overview ?? parsed.overview ?? null, ...art };
  }

  const showMetadata = bundle?.show ?? null;
  const showTitle = showMetadata?.title ?? parsed.showTitle ?? "Série inconnue";
  const showId = upsertCatalogEntity({
    library, kind: "show", parentId: null, title: showTitle,
    sortTitle: showTitle.toLocaleLowerCase(library.language), year: showMetadata?.year ?? parsed.year, metadata: showMetadata, parsed,
    sourceFolder: parsed.showFolder ?? null,
    previousId: previousCatalogId ? rootCatalogId(previousCatalogId) : null,
  });
  const showArt = await applyEntityArtwork(showId, showMetadata, mediaPath, 1);
  const seasonNumber = parsed.seasonNumber ?? 0;
  const seasonMetadata = bundle?.season ?? null;
  // Une chaine n'a pas de saisons : ses paliers sont les dossiers de la personne, et « Saison 3 »
  // dirait faux la ou le dossier s'appelle « Documentaires ».
  const libelleWeb = library.resolvedKind === "web" ? libelleDuPalierDuFichier(library, mediaPath) : "";
  const seasonTitle = seasonMetadata?.title
    ?? (libelleWeb || (library.language === "fr-FR" ? `Saison ${seasonNumber}` : `Season ${seasonNumber}`));
  const seasonId = upsertCatalogEntity({
    library, kind: "season", parentId: showId, title: seasonTitle,
    sortTitle: String(seasonNumber).padStart(4, "0"), seasonNumber, metadata: seasonMetadata,
  });
  const seasonArt = await applyEntityArtwork(seasonId, seasonMetadata, mediaPath, 0);
  const episodeMetadata = bundle?.episode ?? null;
  const title = episodeMetadata?.title ?? parsed.title;
  const catalogId = upsertCatalogEntity({
    library, kind: "episode", parentId: seasonId, title,
    sortTitle: String(parsed.episodeNumber ?? 0).padStart(4, "0"),
    seasonNumber, episodeNumber: parsed.episodeNumber ?? 0, metadata: episodeMetadata,
    parsed,
  });
  return {
    catalogId,
    title,
    showTitle,
    metadata: episodeMetadata ?? showMetadata,
    overview: episodeMetadata?.overview ?? parsed.overview ?? null,
    posterUrl: seasonArt.posterUrl ?? showArt.posterUrl,
    backdropUrl: episodeMetadata?.backdropSourceUrl ? showArt.backdropUrl : seasonArt.backdropUrl ?? showArt.backdropUrl,
  };
}

function knownExternalMatch(catalogId: string | null | undefined, allowUnlocked = false): { provider: string; id: string } | undefined {
  if (!catalogId) return undefined;
  const row = db.prepare(`
    SELECT COALESCE(root.external_id, parent.external_id, item.external_id) AS external_id,
      COALESCE(root.external_provider, parent.external_provider, item.external_provider) AS external_provider,
      COALESCE(root.metadata_locked, parent.metadata_locked, item.metadata_locked) AS metadata_locked
    FROM catalog_items item
    LEFT JOIN catalog_items parent ON parent.id = item.parent_id
    LEFT JOIN catalog_items root ON root.id = parent.parent_id
    WHERE item.id = ?
  `).get(catalogId) as { external_id: string | null; external_provider: string | null; metadata_locked: number } | undefined;
  return row && (row.metadata_locked === 1 || allowUnlocked) && row.external_id && row.external_provider
    ? { provider: row.external_provider, id: row.external_id } : undefined;
}

/** Les anciennes fiches R48 ont une identité fournisseur mais pas encore le résultat de classification. */
function ratingNeedsBackfill(catalogId: string | null | undefined): boolean {
  if (!catalogId) return false;
  const row = db.prepare(`SELECT COALESCE(root.rating_checked, parent.rating_checked, item.rating_checked, 0) AS checked
    FROM catalog_items item
    LEFT JOIN catalog_items parent ON parent.id = item.parent_id
    LEFT JOIN catalog_items root ON root.id = parent.parent_id
    WHERE item.id = ?`).get(catalogId) as { checked: number } | undefined;
  return row?.checked === 0;
}

/**
 * Complète uniquement la classification d'une fiche R48, sans repasser par l'upsert général.
 *
 * Ce chemin séparé est volontaire : une analyse ordinaire d'un fichier inchangé ne doit jamais
 * réécrire un titre corrigé à la main, ni réparer d'autres métadonnées à la place d'une analyse
 * explicitement demandée. L'identité fournisseur déjà enregistrée évite aussi toute nouvelle
 * recherche approximative.
 */
async function backfillRating(catalogId: string, filePath: string, library: LibraryFolder): Promise<boolean> {
  // Une bibliotheque web n'a pas de classification a rattraper : aucune base de films ou de series
  // n'est interrogee pour elle, et c'est precisement ce que ce chemin ferait.
  if (library.resolvedKind === "web") return false;
  try {
    const parsed = parseMediaPath(filePath, library.resolvedKind);
    const known = knownExternalMatch(catalogId, true);
    // Analyse automatique : personne ne regarde l'ecran, donc on attend le retour de TMDB
    // plutot que d'enregistrer une fiche pauvre. Voir `tmdbEnPatientant`.
    const bundle = await fetchMetadataWithProviders(parsed, library.language, known, { patienter: true });
    const metadata = parsed.kind === "episode" ? bundle?.show : bundle?.movie;
    const root = db.prepare(`WITH RECURSIVE ancestors(id, parent_id, depth) AS (
        SELECT id, parent_id, 0 FROM catalog_items WHERE id = ?
        UNION ALL SELECT parent.id, parent.parent_id, ancestors.depth + 1
        FROM catalog_items parent JOIN ancestors ON ancestors.parent_id = parent.id)
      SELECT id FROM ancestors ORDER BY depth DESC LIMIT 1`).get(catalogId) as { id: string } | undefined;
    if (!root) return false;
    db.prepare(`UPDATE catalog_items SET age_rating = COALESCE(?, age_rating),
      rating_label = COALESCE(?, rating_label), rating_checked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(metadata?.ageRating ?? null, metadata?.ratingLabel ?? null, root.id);
    return Boolean(metadata);
  } catch (error) {
    metadataLog("rating-backfill-failed", { catalogId, file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export async function scanLibraryById(libraryId: string, options: ScanOptions = {}): Promise<ScanResult> {
  const library = listLibraries().find((candidate) => candidate.id === libraryId && candidate.enabled);
  if (!library) throw new Error("Bibliothèque introuvable ou désactivée");
  const mode = options.mode ?? "files";
  const forceMetadata = mode === "metadata" || Boolean(options.onlyUnmatched);
  const result: ScanResult = { roots: 1, discovered: 0, imported: 0, enriched: 0, removed: 0, unstable: 0, errors: [] };
  const seenPaths = new Set<string>();
  const existing = db.prepare("SELECT id, catalog_id, file_modified_at, file_size, embedded_metadata_json FROM media_items WHERE file_path = ?");
  const upsert = db.prepare(`
    INSERT INTO media_items (
      id, kind, title, sort_title, search_title, year, overview, poster_url, backdrop_url, file_path,
      show_title, season_number, episode_number, air_date, runtime_seconds, external_provider, external_id, imdb_id,
      file_size, file_modified_at, library_id, catalog_id, embedded_metadata_json, audio_languages, subtitle_languages,
      content_type, edition, source_ids_json, available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(file_path) DO UPDATE SET
      kind = excluded.kind, title = excluded.title, sort_title = excluded.sort_title,
      search_title = excluded.search_title,
      year = COALESCE(excluded.year, media_items.year), overview = COALESCE(excluded.overview, media_items.overview),
      poster_url = excluded.poster_url, backdrop_url = excluded.backdrop_url, show_title = excluded.show_title,
      season_number = excluded.season_number, episode_number = excluded.episode_number,
      -- Une date connue n'est jamais effacee par une analyse qui n'en trouve pas.
      air_date = COALESCE(excluded.air_date, media_items.air_date),
      runtime_seconds = COALESCE(excluded.runtime_seconds, media_items.runtime_seconds),
      external_provider = excluded.external_provider,
      external_id = excluded.external_id,
      imdb_id = excluded.imdb_id, file_size = excluded.file_size,
      file_modified_at = excluded.file_modified_at, library_id = excluded.library_id, catalog_id = excluded.catalog_id,
      embedded_metadata_json = excluded.embedded_metadata_json, audio_languages = excluded.audio_languages,
      subtitle_languages = excluded.subtitle_languages, content_type = excluded.content_type,
      edition = excluded.edition, source_ids_json = excluded.source_ids_json, available = 1, updated_at = CURRENT_TIMESTAMP
  `);

  // Regrouper ces écritures par lots a été essayé puis retiré : mesuré sur 400 fichiers, un lot de
  // 200 ne fait pas mieux qu'une transaction par fichier. Le coût d'une analyse répétée est ailleurs
  // — voir `integration/scan-batching.integration.ts`, qui garde la mesure.
  const touch = db.prepare("UPDATE media_items SET available = 1, library_id = ? WHERE file_path = ?");

  // Les chemins de la fiche visée, quand l'analyse ne porte que sur elle. Un film peut avoir plusieurs
  // fichiers — versions, éditions —, et une série en a autant que d'épisodes : tous sont repris.
  const cheminsCibles = options.onlyCatalogId
    ? new Set((db.prepare(`SELECT file_path FROM media_items WHERE catalog_id = ?
        OR catalog_id IN (SELECT id FROM catalog_items WHERE parent_id = ?
          OR parent_id IN (SELECT id FROM catalog_items WHERE parent_id = ?))`)
      .all(options.onlyCatalogId, options.onlyCatalogId, options.onlyCatalogId) as { file_path: string }[])
      .map((ligne) => path.normalize(ligne.file_path)))
    : null;

  for await (const filePath of walk(library.path)) {
    if (options.signal?.aborted) throw new Error("Analyse annulée");
    // Une reprise ciblée ne doit toucher qu'à sa fiche : les autres ne sont même pas relevées, sans
    // quoi leur absence de la liste des chemins vus les ferait passer pour disparues.
    if (cheminsCibles && !cheminsCibles.has(path.normalize(filePath))) continue;
    // Laisser passer la lecture avant d'entamer le fichier suivant.
    await options.yieldToPlayback?.(options.signal);
    seenPaths.add(path.normalize(filePath));
    result.discovered += 1;
    try {
      let info = await stat(filePath);

      // Un fichier encore en cours de copie produit une fiche fausse — durée tronquée, pistes
      // manquantes — qui restera telle quelle jusqu'à ce qu'une analyse ultérieure remarque le
      // changement de taille. Seuls les fichiers récemment écrits sont observés : un second relevé
      // sur chaque fichier doublerait le coût de l'analyse sans rien apporter sur ceux qui dorment.
      if (needsStabilityCheck(info.mtimeMs, Date.now())) {
        await delay(options.stabilityDelayMs ?? 1_500);
        if (options.signal?.aborted) throw new Error("Analyse annulée");
        const second = await stat(filePath);
        if (!isStableFile({ size: info.size, modifiedMs: info.mtimeMs }, { size: second.size, modifiedMs: second.mtimeMs })) {
          // On le laisse de côté sans toucher à la fiche existante : une copie en cours ne doit ni
          // créer une fiche incomplète, ni dégrader celle d'un fichier remplacé.
          result.unstable += 1;
          recordSkippedFile(library.id, filePath, "unstable",
            `Fichier encore en cours d'écriture (${info.size} puis ${second.size} octets). Il sera repris à la prochaine analyse.`);
          continue;
        }
        info = second;
      }

      const previous = existing.get(filePath) as {
        id: string; catalog_id: string | null; file_modified_at: number; file_size: number; embedded_metadata_json: string | null;
      } | undefined;
      const unchanged = previous?.file_modified_at === Math.floor(info.mtimeMs)
        && previous.file_size === info.size && previous.embedded_metadata_json && previous.catalog_id;
      // R49 complète une seule fois la classification des fiches déjà présentes. Le JSON ffprobe en
      // base est réutilisé : aucun nouveau sondage vidéo, donc aucun coût sur le NAS hors métadonnées.
      const ratingBackfill = Boolean(unchanged && ratingNeedsBackfill(previous?.catalog_id));
      // En reprise ciblée, une fiche déjà bien appariée n'a rien à redemander au fournisseur.
      const dejaSure = options.onlyUnmatched && previous?.catalog_id
        ? Boolean(db.prepare(`SELECT 1 FROM catalog_items
            WHERE id = ? AND (metadata_locked = 1 OR (match_status = 'automatic' AND COALESCE(match_confidence, 0) >= ?))`)
          .get(previous.catalog_id, MATCH_THRESHOLDS.automatic))
        : false;
      if (dejaSure) {
        touch.run(library.id, filePath);
        if (result.discovered % 20 === 0) options.onProgress?.(result);
        continue;
      }
      if (unchanged && !forceMetadata && ratingBackfill) {
        if (await backfillRating(previous!.catalog_id!, filePath, library)) result.enriched += 1;
        touch.run(library.id, filePath);
        await backfillArtwork(previous!.catalog_id!, filePath);
        if (result.discovered % 20 === 0) options.onProgress?.(result);
        continue;
      }
      if (unchanged && !forceMetadata) {
        touch.run(library.id, filePath);
        await backfillArtwork(previous.catalog_id!, filePath);
        if (result.discovered % 20 === 0) options.onProgress?.(result);
        continue;
      }

      const embeddedPromise = forceMetadata && previous?.embedded_metadata_json
        ? Promise.resolve(parseProbeOutput(JSON.parse(previous.embedded_metadata_json)))
        : probeMedia(filePath);

      let embedded: Awaited<typeof embeddedPromise>;
      let parsed: ParsedMedia;
      /** Ce que la video web a dit d'elle-meme, pour l'illustrer une fois la fiche creee. */
      let lectureWeb: Extract<Awaited<ReturnType<typeof analyserVideoWeb>>, { valide: true }> | null = null;
      if (library.resolvedKind === "web") {
        // L'arborescence web se lit par position et n'a ni fichier annexe Kodi ni indice de
        // rapprochement a appliquer : ces deux lectures n'auraient rien a trouver.
        embedded = await embeddedPromise;
        if (options.signal?.aborted) throw new Error("Analyse annulée");
        const lecture = await analyserVideoWeb(library, filePath, embedded?.raw ?? null,
          previous?.catalog_id ?? null);
        // Un rangement fautif est signale, pas devine : le fichier rejoint le journal des
        // laisses-pour-compte avec la raison, par la voie que le bloc englobant emprunte deja.
        if (!lecture.valide) throw new Error(lecture.message);
        parsed = lecture.parsed;
        lectureWeb = lecture;
      } else {
        const pathMetadata = parseMediaPath(filePath, library.resolvedKind);
        const [sonde, sidecar, hints] = await Promise.all([
          embeddedPromise, readSidecarNfo(filePath, pathMetadata.kind), readMatchHints(filePath, library.path),
        ]);
        if (options.signal?.aborted) throw new Error("Analyse annulée");
        embedded = sonde;
        parsed = applyMatchHints(mergeSidecarMetadata(mergeEmbeddedMetadata(pathMetadata, sonde), sidecar), hints);
        // L'observation du disque n'a de sens que pour un épisode, et ne coûte qu'une lecture de
        // dossier par fichier — négligeable devant le sondage du média lui-même.
        if (parsed.kind === "episode") parsed.seasonsOnDisk = await countSeasonFolders(filePath);
      }
      let bundle: MetadataBundle | null = null;
      let proposal: PendingMatchProposal | null = null;
      // Pas de base de films ni de series pour le web : voir `web-analyse`.
      if (library.resolvedKind !== "web") try {
        const locked = knownExternalMatch(previous?.catalog_id);
        bundle = applyLocalMetadataFallbacks(parsed,
          await fetchMetadataWithProviders(parsed, library.language, locked, { patienter: true }));
        if (bundle) result.enriched += 1;
        if (!bundle && !locked) {
          const sourceTitle = parsed.kind === "episode" ? parsed.showTitle : parsed.title;
          if (sourceTitle) {
            const kind = parsed.kind === "episode" ? "tv" : "movie";
            const candidates = await searchAllMetadata(kind, sourceTitle, library.language, parsed.year ?? undefined);
            const ranked = rankMetadataMatches({ title: sourceTitle, year: parsed.year, externalIds: parsed.externalIds }, candidates);
            let status = ranked.status;
            const reasons = [...ranked.reasons];
            if (parsed.detection?.decision === "revue" && status === "automatic") {
              status = "review";
              reasons.push("nom de fichier ambigu");
            } else if (parsed.detection?.decision === "rejet") {
              status = "rejected";
              reasons.push("détection du nom refusée");
            } else if (status === "automatic") {
              // La recherche a une bonne candidate mais sa fiche détaillée n'a pas pu être validée.
              // L'appliquer quand même transformerait une panne fournisseur en écriture irréversible.
              status = "review";
              reasons.push("fiche fournisseur non validée");
            }
            proposal = {
              sourceTitle, sourceYear: parsed.year, candidate: ranked.candidate, candidates: ranked.candidates,
              score: ranked.score, status: status === "review" ? "review" : "rejected", reasons,
            };
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ path: filePath, message });
        metadataLog("provider-failed", { file: path.basename(filePath), title: parsed.title, year: parsed.year, error: message });
      }

      metadataLog("match-decision", {
        file: path.basename(filePath), title: parsed.kind === "episode" ? parsed.showTitle : parsed.title, year: parsed.year,
        status: bundle ? "automatic" : proposal?.status ?? "unmatched",
        provider: bundle ? (parsed.kind === "episode" ? bundle.show?.provider : bundle.movie?.provider) ?? null
          : proposal?.candidate?.provider ?? null,
        externalId: bundle ? (parsed.kind === "episode" ? bundle.show?.externalId : bundle.movie?.externalId) ?? null
          : proposal?.candidate?.externalId ?? null,
        confidence: bundle ? (parsed.kind === "episode" ? bundle.show?.confidence : bundle.movie?.confidence) ?? null
          : proposal?.score ?? null,
        reasons: proposal?.reasons ?? [],
      });

      const catalog = await syncCatalog(library, parsed, bundle, filePath, previous?.catalog_id ?? null);
      if (lectureWeb) {
        // Sans statut explicite, une video web herite du defaut `unmatched` et se declare douteuse
        // meme quand la plateforme l'a parfaitement identifiee.
        noterCorrespondanceWeb(catalog.catalogId, lectureWeb.identite);
        await illustrerVideoWeb({
          library, catalogId: catalog.catalogId, chaineId: rootCatalogId(catalog.catalogId),
          chemin: lectureWeb.chemin, identite: lectureWeb.identite, langue: library.language,
        });
      }
      storeMatchProposal(catalog.catalogId, bundle ? null : proposal);
      // Une video web n'est pas un episode. Le raccourci qui l'enregistrait comme tel lui donnait la
      // reprise et l'enchainement sans code neuf, mais le type voyage avec la fiche : « Ajouts
      // recents » l'annoncait « S1 · E20024 », le numero d'episode etant un nombre de jours.
      const typeDuMedia = library.resolvedKind === "web" ? "video" as const : parsed.kind;
      upsert.run(
        previous?.id ?? randomUUID(), typeDuMedia, catalog.title,
        (catalog.showTitle ?? catalog.title).toLocaleLowerCase(library.language),
        // Un épisode se cherche par le nom de sa série autant que par le sien.
        normaliseForSearch(`${catalog.showTitle ?? ""} ${catalog.title}`),
        catalog.metadata?.year ?? parsed.year,
        catalog.overview, catalog.posterUrl, catalog.backdropUrl, filePath,
        catalog.showTitle, parsed.seasonNumber, parsed.episodeNumber, parsed.airDate ?? null,
        catalog.metadata?.runtimeSeconds ?? embedded?.durationSeconds ?? null, catalog.metadata?.provider ?? null,
        catalog.metadata?.externalId ?? null, catalog.metadata?.imdbId ?? null, info.size, Math.floor(info.mtimeMs), library.id,
        catalog.catalogId, embedded ? JSON.stringify(embedded.raw) : "{}", JSON.stringify(embedded?.audioLanguages ?? []),
        JSON.stringify(embedded?.subtitleLanguages ?? []), parsed.contentType ?? "movie", parsed.edition ?? null, JSON.stringify(parsed.externalIds ?? {}),
      );
      result.imported += 1;
      // Le fichier est entré : il n'a plus rien à faire dans le journal des laissés-pour-compte.
      clearSkippedFile(library.id, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ path: filePath, message });
      // Une annulation n'est pas un défaut du fichier : l'inscrire au journal accuserait à tort un
      // média parfaitement sain, et le compteur de tentatives grimperait à chaque analyse interrompue.
      if (!options.signal?.aborted) recordSkippedFile(library.id, filePath, "error", message);
    }
    if (result.discovered % 10 === 0) options.onProgress?.(result);
  }

  // Une reprise ciblée n'a regardé qu'une fiche : elle n'a rien constaté sur les autres et ne peut
  // donc rien en conclure. Poursuivre lui ferait déclarer disparue toute la bibliothèque — l'analyse
  // aurait « réussi », en n'ayant simplement rien cherché.
  if (options.onlyCatalogId) {
    options.onProgress?.(result);
    return result;
  }

  // Les fichiers du journal que l'analyse n'a pas revus ont quitté le disque : ils n'ont plus à
  // figurer parmi les problèmes à traiter.
  pruneSkippedFiles(library.id, seenPaths);

  const known = db.prepare("SELECT file_path, available FROM media_items WHERE library_id = ?").all(library.id) as Array<{
    file_path: string; available: number;
  }>;
  const previouslyAvailable = known.filter((item) => item.available === 1).length;
  const missing = known.filter((item) => item.available === 1 && !seenPaths.has(path.normalize(item.file_path)));

  // Marquer indisponible ce qu'on n'a pas revu suppose que l'absence vaut suppression. Sur un partage
  // réseau cette supposition est régulièrement fausse, et s'y fier efface un catalogue entier sans
  // qu'aucune erreur ne soit levée : la marche a « réussi », elle n'a simplement rien trouvé.
  const verdict = assessDisappearance(previouslyAvailable, missing.length, result.discovered, options.confirmRemovals);
  if (!verdict.accepted) {
    result.retainedMissing = missing.length;
    result.retainedReason = verdict.reason;
    result.errors.push({ path: library.path, message: verdict.reason ?? "Disparition massive refusée" });
    options.onProgress?.(result);
    return result;
  }

  const markMissing = db.prepare("UPDATE media_items SET available = 0, updated_at = CURRENT_TIMESTAMP WHERE library_id = ? AND file_path = ?");
  inTransaction(() => {
    for (const item of missing) {
      markMissing.run(library.id, item.file_path);
      result.removed += 1;
    }
  });
  result.ghosts = removeGhostCatalogEntries(library.id);
  options.onProgress?.(result);
  return result;
}

/**
 * Retire les fiches de catalogue qui ne désignent plus aucun fichier.
 *
 * Une fiche sans média et sans enfant n'est plus une œuvre : c'est une trace. Deux mécanismes en
 * produisaient. Un déverrouillage effaçait l'identité d'une fiche de film, l'analyse suivante en
 * fabriquait une autre depuis le nom de fichier et abandonnait la première — dix-sept films de la
 * médiathèque réelle. Et lorsqu'un dossier de série éclaté se recolle sur une seule fiche, les
 * saisons et épisodes de la fiche concurrente restent derrière, vides.
 *
 * Trois précautions, dans l'esprit du garde-fou des disparitions :
 *
 * 1. La suppression remonte du bas vers le haut — épisodes, puis saisons, puis séries — afin qu'une
 *    saison vidée de ses épisodes disparaisse dans la même passe.
 * 2. Une fiche corrigée à la main est conservée, comme un regroupement : ce sont des décisions.
 * 3. Au-delà de la moitié du catalogue de la bibliothèque, rien n'est supprimé. Une telle proportion
 *    ne décrit pas des traces mais un incident, et effacer serait alors le pire des choix.
 */
export function removeGhostCatalogEntries(libraryId: string): number {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE library_id = ?").get(libraryId) as { n: number }).n;
  if (!total) return 0;
  const orphelines = db.prepare(`SELECT id FROM catalog_items c
    WHERE c.library_id = ? AND c.kind = ? AND c.metadata_locked = 0
      AND NOT EXISTS (SELECT 1 FROM media_items m WHERE m.catalog_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM catalog_items enfant WHERE enfant.parent_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM catalog_merges g WHERE g.source_id = c.id OR g.target_id = c.id)`);
  const supprimer = db.prepare("DELETE FROM catalog_items WHERE id = ?");
  let retirees = 0;
  inTransaction(() => {
    for (const kind of ["episode", "season", "show", "movie"] as const) {
      const lignes = orphelines.all(libraryId, kind) as Array<{ id: string }>;
      if (retirees + lignes.length > total / 2) {
        metadataLog("ghost-cleanup-refused", { libraryId, kind, candidates: lignes.length, total });
        return;
      }
      for (const ligne of lignes) { supprimer.run(ligne.id); retirees += 1; }
    }
  });
  if (retirees) metadataLog("ghost-cleanup", { libraryId, removed: retirees, total });
  return retirees;
}
