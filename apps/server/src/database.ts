import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { LibraryFolder, MediaItem, Profile, ProfileGroup, ScanStatus } from "@flixtunes/contracts";
import { config } from "./config.js";
import { normaliseForSearch } from "./search-normalise.js";
import { appliquerLesMigrations } from "./migrations.js";

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "flixtunes.db"));
/**
 * Les provenances acceptées pour un champ de métadonnées.
 *
 * Cette liste **doit** rester le miroir exact de `MetadataFieldProvenance["source"]` dans les
 * contrats. Elle ne l'était pas : `anilist` avait été ajouté aux fournisseurs sans rejoindre la
 * contrainte `CHECK`, et chaque série animée appariée par AniList faisait échouer son écriture.
 * L'utilisateur ne voyait qu'un « 16 erreur(s). CHECK constraint failed » sur sa bibliothèque, sans
 * qu'aucun message ne nomme le fournisseur en cause.
 *
 * D'où la constante : la contrainte de la table et la migration se construisent toutes deux à partir
 * d'elle, et ajouter un fournisseur sans l'inscrire ici devient impossible à oublier — la table le
 * refuserait dès le premier essai, en développement.
 */
export const SOURCES_METADONNEES = [
  "filename", "embedded", "nfo", "manual",
  "local", "tvmaze", "wikidata", "anilist", "tmdb", "tvdb", "imdb", "fanart", "allocine",
] as const;

const CHECK_SOURCES = SOURCES_METADONNEES.map((nom) => `'${nom}'`).join(", ");

db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA temp_store = MEMORY;");

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('movie', 'show', 'episode')),
    title TEXT NOT NULL,
    sort_title TEXT NOT NULL,
    year INTEGER,
    overview TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    file_path TEXT UNIQUE,
    show_title TEXT,
    season_number INTEGER,
    episode_number INTEGER,
    runtime_seconds INTEGER,
    external_provider TEXT,
    external_id TEXT,
    imdb_id TEXT,
    file_size INTEGER,
    file_modified_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_media_kind ON media_items(kind);
  CREATE INDEX IF NOT EXISTS idx_episode_show ON media_items(show_title, season_number, episode_number);

  CREATE TABLE IF NOT EXISTS playback_progress (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS subtitle_preferences (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    selection_type TEXT NOT NULL DEFAULT 'off' CHECK(selection_type IN ('off', 'internal', 'external')),
    stream_index INTEGER,
    external_name TEXT,
    offset_seconds REAL NOT NULL DEFAULT 0,
    size TEXT NOT NULL DEFAULT 'normal' CHECK(size IN ('small', 'normal', 'large')),
    background INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT 'white' CHECK(color IN ('white', 'yellow', 'cyan', 'green')),
    position TEXT NOT NULL DEFAULT 'bottom' CHECK(position IN ('bottom', 'middle', 'top')),
    font_family TEXT NOT NULL DEFAULT 'sans' CHECK(font_family IN ('sans', 'serif', 'mono')),
    encoding_override TEXT NOT NULL DEFAULT 'auto' CHECK(encoding_override IN ('auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, media_id)
  );
  CREATE TABLE IF NOT EXISTS profile_watchlist (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, catalog_id)
  );
  CREATE TABLE IF NOT EXISTS recommendation_feedback (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    value TEXT NOT NULL CHECK(value IN ('like', 'dislike', 'dismissed')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, catalog_id)
  );

  CREATE TABLE IF NOT EXISTS library_folders (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('auto', 'movie', 'tv', 'other')),
    language TEXT NOT NULL DEFAULT 'fr-FR',
    organize_seasons INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS server_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS metadata_provider_cache (
    url TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_metadata_provider_cache_expiry ON metadata_provider_cache(expires_at);

  CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES catalog_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('movie', 'show', 'season', 'episode')),
    title TEXT NOT NULL,
    original_title TEXT,
    sort_title TEXT NOT NULL,
    year INTEGER,
    season_number INTEGER,
    episode_number INTEGER,
    overview TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    metadata_language TEXT NOT NULL DEFAULT 'fr-FR',
    external_provider TEXT,
    external_id TEXT,
    imdb_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_catalog_library_kind ON catalog_items(library_id, kind);
  CREATE INDEX IF NOT EXISTS idx_catalog_parent ON catalog_items(parent_id);
  CREATE INDEX IF NOT EXISTS idx_progress_profile_updated ON playback_progress(profile_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS artwork_assets (
    id TEXT PRIMARY KEY,
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('poster', 'backdrop', 'still')),
    language TEXT,
    source TEXT NOT NULL CHECK(source IN ('local', 'tvmaze', 'wikidata', 'tmdb')),
    source_key TEXT NOT NULL,
    local_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(catalog_id, role, source_key)
  );

  CREATE INDEX IF NOT EXISTS idx_artwork_catalog_role ON artwork_assets(catalog_id, role, is_primary);

  CREATE TABLE IF NOT EXISTS metadata_field_values (
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK(field IN ('title', 'originalTitle', 'overview', 'year', 'runtimeSeconds', 'poster', 'backdrop')),
    value_json TEXT,
    source TEXT NOT NULL CHECK(source IN (${CHECK_SOURCES})),
    source_id TEXT,
    language TEXT,
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    locked INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(catalog_id, field)
  );
  CREATE INDEX IF NOT EXISTS idx_metadata_fields_source ON metadata_field_values(source, field);

  CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK(scope IN ('all', 'movie', 'tv', 'library')),
    mode TEXT NOT NULL CHECK(mode IN ('files', 'metadata')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 50,
    discovered INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    enriched INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_priority ON scan_jobs(status, priority DESC, created_at);
`);

function tableDefinition(name: string): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { sql?: string } | undefined)?.sql ?? "";
}

function migrateOpenMetadataProviders(): void {
  const artworkNeedsMigration = !tableDefinition("artwork_assets").includes("'tvmaze'");
  // Deux jalons, et le second compte autant que le premier : une base créée après l'ajout de
  // `tvmaze` mais avant celui d'`anilist` passait le premier test et gardait une contrainte trop
  // étroite. C'est ce qui a fait échouer l'analyse des séries animées.
  const fieldsNeedsMigration = !tableDefinition("metadata_field_values").includes("'tvmaze'")
    || !tableDefinition("metadata_field_values").includes("'anilist'");
  if (!artworkNeedsMigration && !fieldsNeedsMigration) return;
  db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    if (artworkNeedsMigration) db.exec(`
      CREATE TABLE artwork_assets_open (
        id TEXT PRIMARY KEY, catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('poster', 'backdrop', 'still')), language TEXT,
        source TEXT NOT NULL CHECK(source IN ('local', 'tvmaze', 'wikidata', 'tmdb')),
        source_key TEXT NOT NULL, local_path TEXT NOT NULL, mime_type TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(catalog_id, role, source_key)
      );
      INSERT INTO artwork_assets_open SELECT * FROM artwork_assets;
      DROP TABLE artwork_assets;
      ALTER TABLE artwork_assets_open RENAME TO artwork_assets;
      CREATE INDEX idx_artwork_catalog_role ON artwork_assets(catalog_id, role, is_primary);
    `);
    if (fieldsNeedsMigration) db.exec(`
      CREATE TABLE metadata_field_values_open (
        catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        field TEXT NOT NULL CHECK(field IN ('title', 'originalTitle', 'overview', 'year', 'runtimeSeconds', 'poster', 'backdrop')),
        value_json TEXT,
        source TEXT NOT NULL CHECK(source IN (${CHECK_SOURCES})),
        source_id TEXT, language TEXT, confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        locked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(catalog_id, field)
      );
      INSERT INTO metadata_field_values_open SELECT * FROM metadata_field_values;
      DROP TABLE metadata_field_values;
      ALTER TABLE metadata_field_values_open RENAME TO metadata_field_values;
      CREATE INDEX idx_metadata_fields_source ON metadata_field_values(source, field);
    `);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

migrateOpenMetadataProviders();

function ensureMediaColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(media_items)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE media_items ADD COLUMN ${name} ${definition}`);
}

function ensureLibraryColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(library_folders)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE library_folders ADD COLUMN ${name} ${definition}`);
}

function ensureCatalogColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(catalog_items)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE catalog_items ADD COLUMN ${name} ${definition}`);
}

function ensureProfileColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(profiles)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${definition}`);
}

function ensureSubtitlePreferenceColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(subtitle_preferences)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE subtitle_preferences ADD COLUMN ${name} ${definition}`);
}

ensureMediaColumn("library_id", "TEXT REFERENCES library_folders(id) ON DELETE SET NULL");
ensureMediaColumn("catalog_id", "TEXT REFERENCES catalog_items(id) ON DELETE SET NULL");
ensureMediaColumn("available", "INTEGER NOT NULL DEFAULT 1");
ensureMediaColumn("embedded_metadata_json", "TEXT");
ensureMediaColumn("audio_languages", "TEXT");
ensureMediaColumn("subtitle_languages", "TEXT");
ensureMediaColumn("content_type", "TEXT NOT NULL DEFAULT 'movie'");
ensureMediaColumn("edition", "TEXT");
ensureMediaColumn("source_ids_json", "TEXT NOT NULL DEFAULT '{}'");
/**
 * La date de publication, telle que la source la donne.
 *
 * Elle etait analysee depuis toujours et jetee aussitot : rien ne la stockait. Une video web s'ordonne
 * par elle et l'affiche sous son titre — la deduire du numero d'episode donnerait une date fausse d'un
 * ou deux jours des que deux publications d'un meme jour se sont decalees.
 */
ensureMediaColumn("air_date", "TEXT");
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_available_library_created ON media_items(available, library_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_catalog_available ON media_items(catalog_id, available);
  -- idx_catalog_library_kind ne sert pas aux parcours qui ne connaissent pas la bibliothèque : la
  -- colonne de tête manque. L'accueil balayait donc toutes les fiches pour isoler les séries.
  CREATE INDEX IF NOT EXISTS idx_catalog_kind_sort ON catalog_items(kind, sort_title);
  CREATE INDEX IF NOT EXISTS idx_catalog_parent_kind ON catalog_items(parent_id, kind);
  CREATE INDEX IF NOT EXISTS idx_media_available_kind_created ON media_items(available, kind, created_at DESC);`);
ensureLibraryColumn("name", "TEXT NOT NULL DEFAULT 'Bibliothèque'");
ensureLibraryColumn("last_scan_mode", "TEXT NOT NULL DEFAULT 'files'");
ensureLibraryColumn("last_scan_status", "TEXT NOT NULL DEFAULT 'idle'");
ensureLibraryColumn("last_scan_discovered", "INTEGER NOT NULL DEFAULT 0");
ensureLibraryColumn("last_scan_imported", "INTEGER NOT NULL DEFAULT 0");
ensureLibraryColumn("last_scan_enriched", "INTEGER NOT NULL DEFAULT 0");
ensureLibraryColumn("last_scan_removed", "INTEGER NOT NULL DEFAULT 0");
ensureLibraryColumn("last_scan_started_at", "TEXT");
ensureLibraryColumn("last_scan_finished_at", "TEXT");
ensureLibraryColumn("last_scan_error", "TEXT");
db.exec(`
  -- Journal d'audit des corrections. Chaque commande conserve son état avant et après, ce qui rend
  -- l'annulation possible sans reconstruire la fiche et fournit une trace consultable.
  CREATE TABLE IF NOT EXISTS correction_audit (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    command TEXT NOT NULL,
    scope TEXT NOT NULL,
    summary TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON correction_audit(at DESC);

  -- Regroupement de doublons. Les fiches restent en base et aucun fichier n'est touché : seule
  -- l'appartenance à un groupe est enregistrée, ce qui rend la séparation triviale.
  CREATE TABLE IF NOT EXISTS catalog_merges (
    source_id TEXT PRIMARY KEY REFERENCES catalog_items(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    merged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_merges_target ON catalog_merges(target_id);

  -- Journal des fichiers qu'une analyse n'a pas importés. Sans lui, un fichier qui n'entre jamais dans
  -- le catalogue reste muet : rien ne dit s'il a été ignoré, refusé, ou s'il a échoué, ni pourquoi.
  -- Une ligne par fichier et par bibliothèque, remplacée à chaque passage : c'est un état courant,
  -- pas un historique, et la ligne disparaît dès que le fichier finit par entrer.
  CREATE TABLE IF NOT EXISTS scan_skips (
    library_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    reason TEXT NOT NULL CHECK(reason IN ('unstable', 'error')),
    detail TEXT,
    attempts INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(library_id, file_path)
  );
  CREATE INDEX IF NOT EXISTS idx_scan_skips_library ON scan_skips(library_id, reason);

  -- Proposition distante séparée de la fiche. Tant qu'elle n'est pas automatique ou confirmée à la
  -- main, elle ne peut modifier ni l'identité visible ni le regroupement des fichiers.
  CREATE TABLE IF NOT EXISTS metadata_match_proposals (
    catalog_id TEXT PRIMARY KEY REFERENCES catalog_items(id) ON DELETE CASCADE,
    source_title TEXT NOT NULL,
    source_year INTEGER,
    provider TEXT,
    external_id TEXT,
    candidate_title TEXT,
    candidate_year INTEGER,
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('review', 'rejected')),
    reasons_json TEXT NOT NULL DEFAULT '[]',
    candidates_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_match_proposals_status_score ON metadata_match_proposals(status, score DESC);

  -- Première barrière de l'accès Internet. Ces comptes ne sont pas des profils de visionnage : ils
  -- autorisent un appareil à atteindre le sélecteur de groupes, puis le PIN du profil reste exigé.
  CREATE TABLE IF NOT EXISTS remote_accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS remote_device_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES remote_accounts(id) ON DELETE CASCADE,
    device_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_remote_device_account ON remote_device_sessions(account_id, expires_at);
  CREATE TABLE IF NOT EXISTS remote_login_failures (
    source TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt TEXT NOT NULL
  );
`);
ensureCatalogColumn("match_status", "TEXT NOT NULL DEFAULT 'unmatched'");
ensureCatalogColumn("metadata_locked", "INTEGER NOT NULL DEFAULT 0");
ensureCatalogColumn("match_confidence", "REAL");
ensureCatalogColumn("content_type", "TEXT");
ensureCatalogColumn("edition", "TEXT");
ensureCatalogColumn("source_ids_json", "TEXT NOT NULL DEFAULT '{}'");
ensureCatalogColumn("age_rating", "INTEGER");
ensureCatalogColumn("rating_label", "TEXT");
ensureCatalogColumn("rating_checked", "INTEGER NOT NULL DEFAULT 0");

/**
 * Colonne de recherche insensible aux accents, à la ponctuation et à la casse.
 *
 * Elle est remplie ici pour tout ce qui existe déjà — un catalogue analysé avant cette version n'a
 * aucune raison de rester introuvable — puis maintenue par l'analyseur à chaque écriture. Le
 * remplissage ne touche que les lignes vides, il est donc sans effet aux démarrages suivants.
 */
/**
 * Genres d'une fiche, une ligne par genre.
 *
 * Une colonne texte contenant « Action, Aventure » obligerait à chercher par sous-chaîne : non
 * indexable, et « Action » y trouverait « Action & Aventure » sans qu'on l'ait demandé. Une table
 * dédiée rend le filtre exact et indexable, et se combine sans effort avec les autres critères.
 *
 * Les genres viennent de TMDB, qui les nomme dans la langue de la bibliothèque. Ils n'apparaissent
 * donc qu'après une analyse des métadonnées : un catalogue analysé avant cette version n'en aura
 * aucun tant qu'il n'est pas repassé.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS catalog_genres (
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    genre TEXT NOT NULL,
    PRIMARY KEY(catalog_id, genre)
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_genres_genre ON catalog_genres(genre);

  -- Les personnes sont séparées des fiches : un acteur n'est enregistré qu'une fois, puis relié aux
  -- seules œuvres réellement présentes. Les grilles n'effectuent donc aucune jointure sur ce bloc.
  CREATE TABLE IF NOT EXISTS catalog_people (
    id TEXT PRIMARY KEY,
    external_provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    search_name TEXT NOT NULL,
    profile_url TEXT,
    department TEXT,
    UNIQUE(external_provider, external_id)
  );
  CREATE TABLE IF NOT EXISTS catalog_people_credits (
    catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES catalog_people(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('actor', 'director', 'creator', 'writer', 'composer')),
    character TEXT NOT NULL DEFAULT '',
    job TEXT,
    credit_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(catalog_id, person_id, role, character)
  );
  CREATE INDEX IF NOT EXISTS idx_catalog_people_search ON catalog_people(search_name);
  CREATE INDEX IF NOT EXISTS idx_catalog_people_credits_person ON catalog_people_credits(person_id, catalog_id);
  CREATE INDEX IF NOT EXISTS idx_catalog_people_credits_catalog ON catalog_people_credits(catalog_id, role, credit_order);
`);

/**
 * La télévision en direct — le modèle mesuré du chantier 0.5.7.
 *
 * Quatre tables, et chacune répond à un chiffre relevé sur le corpus réel (527 listes, 181 126
 * entrées, `docs/CHANTIER_LIVE_TV_0.5.7.md`) :
 *
 * - `live_sources` — un fournisseur réglé. Une seule sorte existe aujourd'hui, `m3u` ; `xtream` et
 *   `fast` viendront s'y ranger sans toucher au reste, ce qui est la raison d'être de cette table.
 * - `live_playlists` — une liste à l'intérieur d'une source. C'est l'unité que l'on coche à l'écran,
 *   et elle porte le classement ✅/〰️/⚠️/❌ lu dans le nom à l'import.
 * - `live_channels` — la chaîne **fusionnée**. 181 126 entrées pour 84 309 noms distincts : sans
 *   fusion, la grille afficherait quatre-vingts « TF1 » dont la plupart sont mortes.
 * - `live_channel_urls` — les N adresses d'une chaîne. C'est la table qui rend le repli possible, et
 *   la seule qui retienne ce qui a marché la dernière fois.
 *
 * **Une chaîne n'est jamais supprimée**, seulement laissée sans adresse (`adresses = 0`) et datée par
 * `disparue_le`. C'est ce qui tient la promesse du numéro stable : une liste retirée puis remise ne
 * doit pas renuméroter la grille de la personne qui s'en sert.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS live_sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('m3u', 'xtream', 'fast')),
    libelle TEXT NOT NULL,
    emplacement TEXT NOT NULL,
    activee INTEGER NOT NULL DEFAULT 1,
    rafraichie_le TEXT,
    dernier_message TEXT,
    cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(type, emplacement)
  );

  CREATE TABLE IF NOT EXISTS live_playlists (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES live_sources(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    url TEXT NOT NULL,
    classement TEXT NOT NULL DEFAULT 'inconnue'
      CHECK(classement IN ('bonne', 'moyenne', 'douteuse', 'faible', 'inconnue')),
    cochee INTEGER NOT NULL DEFAULT 1,
    entrees INTEGER NOT NULL DEFAULT 0,
    ecartees INTEGER NOT NULL DEFAULT 0,
    rafraichie_le TEXT,
    dernier_message TEXT,
    UNIQUE(source_id, url)
  );
  CREATE INDEX IF NOT EXISTS idx_live_playlists_source ON live_playlists(source_id, cochee);

  CREATE TABLE IF NOT EXISTS live_channels (
    id TEXT PRIMARY KEY,
    cle TEXT NOT NULL UNIQUE,
    nom TEXT NOT NULL,
    nom_recherche TEXT NOT NULL,
    logo TEXT,
    groupe TEXT,
    tvg_id TEXT,
    numero INTEGER UNIQUE,
    numero_manuel INTEGER,
    numero_souhaite INTEGER,
    etat TEXT NOT NULL DEFAULT 'inconnue' CHECK(etat IN ('bonne', 'morte', 'inconnue')),
    adresses INTEGER NOT NULL DEFAULT 0,
    vue_le TEXT,
    disparue_le TEXT,
    cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_live_channels_recherche ON live_channels(nom_recherche);
  CREATE INDEX IF NOT EXISTS idx_live_channels_grille ON live_channels(adresses, numero);
  CREATE INDEX IF NOT EXISTS idx_live_channels_groupe ON live_channels(groupe);

  CREATE TABLE IF NOT EXISTS live_channel_urls (
    channel_id TEXT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    playlist_id TEXT NOT NULL REFERENCES live_playlists(id) ON DELETE CASCADE,
    succes INTEGER NOT NULL DEFAULT 0,
    echecs INTEGER NOT NULL DEFAULT 0,
    essayee_le TEXT,
    PRIMARY KEY(channel_id, url)
  );
  CREATE INDEX IF NOT EXISTS idx_live_urls_playlist ON live_channel_urls(playlist_id);
  CREATE INDEX IF NOT EXISTS idx_live_urls_ordre ON live_channel_urls(channel_id, echecs, succes DESC);
`);

/**
 * Le pays d'une chaîne, ajouté après coup.
 *
 * `CREATE TABLE IF NOT EXISTS` ne touche pas à une table qui existe déjà : une base créée avant ce
 * jour n'aurait jamais eu la colonne, et l'index posé dessus aurait fait échouer le démarrage entier.
 * C'est le même ajout additif que pour les fiches du catalogue, et il vaut aussi pour la base des
 * tests, qui vit d'une exécution à l'autre.
 *
 * La valeur, elle, se remplit au prochain rafraîchissement : rien ne sert de la deviner ici.
 */
function ensureLiveChannelColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(live_channels)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE live_channels ADD COLUMN ${name} ${definition}`);
}
ensureLiveChannelColumn("pays", "TEXT");
/**
 * Le rang du pays dans la grille — la France d'abord, puis l'alphabet.
 *
 * Un entier plutôt qu'un `CASE` au moment du tri, pour que l'`ORDER BY` continue de suivre un index :
 * c'est ce qui garde la grille à 0,4 ms sur 76 899 chaînes. Sa valeur se calcule au rafraîchissement,
 * et se rattrape au démarrage si la table des pays a changé de forme entre deux versions.
 *
 * `999` par défaut, c'est-à-dire « pas de pays, en fin de grille » : une base existante affichera son
 * ordre d'avant jusqu'au premier calcul, jamais un ordre faux.
 */
ensureLiveChannelColumn("rang_pays", "INTEGER NOT NULL DEFAULT 999");

/**
 * Ce que vaut une adresse, et non plus seulement si elle répond.
 *
 * Le classement des adresses ne connaissait que les échecs et les succès — de quoi écarter une source
 * morte, de quoi rien dire entre une source en 480p et la même chaîne en 1080p. La définition et le
 * débit sont lus dans le manifeste par `live-qualite.ts`, à l'ouverture d'une chaîne et une fois par
 * semaine. `sonde_le` retient la date, faute de quoi une adresse qui ne déclare rien serait resondée
 * à chaque ouverture.
 */
function ensureLiveUrlColumn(name: string, definition: string) {
  const columns = db.prepare("PRAGMA table_info(live_channel_urls)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE live_channel_urls ADD COLUMN ${name} ${definition}`);
}
ensureLiveUrlColumn("hauteur", "INTEGER");
ensureLiveUrlColumn("debit", "INTEGER");
ensureLiveUrlColumn("sonde_le", "TEXT");

/**
 * Les fiabilités d'une chaîne, réunies en un seul entier.
 *
 * Une chaîne traverse jusqu'à dix listes, de qualités différentes, et le filtre demande « au moins
 * une liste de ce niveau ». Cela s'écrivait par un `EXISTS` corrélé sur les 118 335 adresses —
 * mesuré à **190 ms** dès qu'on comptait les pays sous une fiabilité, contre 24 ms sans. Un bit par
 * classement rend la même réponse par un `ET` binaire, sur une seule table.
 *
 * Ce n'est pas le classement *meilleur* ni *pire* : ce sont **tous** ceux qu'elle porte. Prendre le
 * meilleur aurait changé le sens du filtre — une chaîne présente dans une bonne liste et dans une
 * mauvaise doit apparaître dans les deux, puisqu'elle est vraiment dans les deux.
 */
ensureLiveChannelColumn("classements", "INTEGER NOT NULL DEFAULT 0");

/**
 * La part **exacte** de chaînes joignables d'une liste, quand le fichier la donne.
 *
 * Le classement en quatre bandes était tout ce qui arrivait jusqu'ici, parce que le fichier ne
 * transportait qu'un nom et une adresse : la mesure voyageait sous forme d'emoji dans le libellé.
 * La version 2 du fichier porte le chiffre ; `NULL` pour les listes venues d'un ancien fichier, qui
 * ne l'ont jamais dit.
 */
{
  const colonnes = db.prepare("PRAGMA table_info(live_playlists)").all() as Array<{ name: string }>;
  if (!colonnes.some((colonne) => colonne.name === "pourcentage")) {
    db.exec("ALTER TABLE live_playlists ADD COLUMN pourcentage REAL");
  }
}
/**
 * Le nom **compact** : sans accents, sans espaces, mais **avec sa ponctuation**.
 *
 * Il sert la recherche littérale : « canal + » doit trouver « Canal+ » et « CANAL+ EN CLAIR », et
 * surtout **pas** les mille « Canal 8 » du corpus hispanophone. La forme ordinaire ne peut pas s'en
 * charger : elle retire la ponctuation, si bien que « canal + » et « canal » y deviennent le même mot.
 */
ensureLiveChannelColumn("nom_compact", "TEXT");

/**
 * Les chaînes qu'un profil garde sous la main, et la dernière qu'il a regardée.
 *
 * **Par profil, comme la liste d'envies** : vingt chaînes sur 76 823, c'est le vrai usage, et ce ne
 * sont pas les mêmes vingt pour tout le monde. Les mettre au foyer obligerait chacun à traverser
 * celles des autres.
 *
 * La suppression en cascade porte des deux côtés : un profil effacé n'a plus de favorites, et une
 * chaîne réellement supprimée — ce qui n'arrive qu'à une remise à zéro — n'en laisse pas d'orphelines.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS live_favoris (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
    ajoute_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, channel_id)
  );
  CREATE INDEX IF NOT EXISTS idx_live_favoris_profil ON live_favoris(profile_id, ajoute_le DESC);

  CREATE TABLE IF NOT EXISTS live_derniere_chaine (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES live_channels(id) ON DELETE CASCADE,
    vue_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * Le ❌ des listes ne voulait pas dire ce qu'on croyait.
 *
 * Il était enregistré `morte` ; le script qui produit `m3u.json` le posait en réalité sur les listes
 * dont **25 à 49 %** des flux répondaient — une liste sur trois chaînes utiles, qu'on garde. La
 * valeur s'appelle donc `faible`, et l'ancienne contrainte `CHECK` refuserait la nouvelle.
 *
 * Le script a depuis été corrigé — `❌` marque maintenant les listes sous 25 %, voir `m3u.ts` — mais
 * le nom `faible` reste juste, et c'est tout ce que cette migration avait à réparer.
 *
 * Une base créée avant ce jour porte l'ancienne contrainte : on refait la table. Elle est reconstruite
 * de bout en bout à chaque rafraîchissement — c'est le fichier de listes qui fait foi —, donc rien
 * n'est perdu qu'un rafraîchissement ne rende. Les chaînes, elles, ne sont pas touchées : leurs
 * numéros tiennent.
 */
const schemaListes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'live_playlists'")
  .get() as unknown as { sql: string } | undefined;
if (schemaListes && !schemaListes.sql.includes("'faible'")) {
  db.exec("DROP TABLE IF EXISTS live_playlists");
  db.exec(`
    CREATE TABLE live_playlists (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES live_sources(id) ON DELETE CASCADE,
      nom TEXT NOT NULL,
      url TEXT NOT NULL,
      classement TEXT NOT NULL DEFAULT 'inconnue'
        CHECK(classement IN ('bonne', 'moyenne', 'douteuse', 'faible', 'inconnue')),
      cochee INTEGER NOT NULL DEFAULT 1,
      entrees INTEGER NOT NULL DEFAULT 0,
      ecartees INTEGER NOT NULL DEFAULT 0,
      rafraichie_le TEXT,
      dernier_message TEXT,
      UNIQUE(source_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_live_playlists_source ON live_playlists(source_id, cochee);
    UPDATE live_channels SET adresses = 0;
  `);
}
/*
 * Les listes publiques s'appelaient « Chaînes gratuites ».
 *
 * Le libellé est écrit à l'activation et jamais réécrit ensuite : sans cette ligne, une installation
 * qui les a déjà ajoutées garderait l'ancien nom jusqu'à ce qu'on les retire et les remette. La table
 * des sources compte trois lignes — le coût est celui d'une phrase.
 */
db.exec("UPDATE live_sources SET libelle = 'Chaînes' WHERE type = 'fast' AND libelle = 'Chaînes gratuites'");
db.exec("CREATE INDEX IF NOT EXISTS idx_live_channels_pays ON live_channels(pays, numero)");
/*
 * L'index de la facette des pays — et c'est le NAS qui l'a réclamé.
 *
 * Le compte des pays met **186 ms sur l'AS5404T**, contre 24 ms sur un poste de développement : c'est
 * de loin le point le plus lent de l'écran du direct, et il se déclenche à chaque ouverture et à
 * chaque changement de filtre. Sur un SSD tiède la lenteur ne se voyait pas ; sur la machine où le
 * produit tourne, elle se voit.
 *
 * La cause est que l'index existant porte `(pays, numero)` sans `adresses` : pour vérifier
 * `adresses > 0`, SQLite devait aller chercher **chacune des 92 204 lignes** dans la table. L'index
 * partiel ne contient que les chaînes joignables et que la colonne groupée — le compte devient un
 * parcours d'index sans un seul accès à la table.
 *
 * Mesuré sur le corpus réel : **32,8 ms → 0,7 ms**, quarante-sept fois moins.
 */
db.exec(`CREATE INDEX IF NOT EXISTS idx_live_pays_facette
  ON live_channels(pays) WHERE adresses > 0 AND pays IS NOT NULL`);
/*
 * L'index du parcours, dans l'ordre exact du tri de la grille — et **partiel**, ce qui fait tout.
 *
 * La première écriture mettait `adresses` en tête, comme l'index qu'elle remplaçait. Mesuré sur
 * 80 000 lignes, le résultat était sans appel : `adresses > 0` est une inégalité, elle épuise le
 * pouvoir d'ordonner de l'index, et SQLite retombait sur un tri complet de la table — 8,8 ms pour la
 * première page et 17,1 ms pour la centième, contre 0,06 ms auparavant. Cent cinquante fois plus
 * cher, pour un changement d'ordre.
 *
 * La condition passe donc dans l'index lui-même : il ne contient que les chaînes joignables, dans
 * l'ordre où on veut les lire. SQLite le parcourt et s'arrête à la soixantième ligne — 0,04 ms, et
 * 0,12 ms à la centième page. C'est l'ordre voulu **et** la performance d'avant.
 */
// La première écriture, sur les bases qui l'ont connue le temps d'une journée de chantier.
db.exec("DROP INDEX IF EXISTS idx_live_channels_ordre");
db.exec(`CREATE INDEX IF NOT EXISTS idx_live_channels_grille_pays
  ON live_channels(rang_pays, pays, numero) WHERE adresses > 0`);

/**
 * L'index de recherche des chaînes — et pourquoi il n'est pas un `LIKE` de plus.
 *
 * Le catalogue cherche ses titres par `LIKE '%…%'` sur une colonne normalisée, et c'est très bien
 * pour quelques milliers de fiches. Ici il y en a **78 741**, mesurées sur le corpus réel, et le
 * `LIKE` y coûtait **191 ms** sur un poste de développement — donc plusieurs fois cela sur le Celeron
 * du NAS, pour un budget annoncé à 100 ms. Un `%…%` ne peut pas s'indexer : il parcourt tout.
 *
 * FTS5 indexe les mots, sait chercher par préfixe de mot (`can*` trouve « Canal+ » comme « TV Cannes »)
 * et rend la recherche indépendante de la taille du corpus. Le contenu n'est pas dupliqué —
 * `content='live_channels'` fait pointer l'index sur la table elle-même —, et il est **reconstruit**
 * à la fin de chaque rafraîchissement plutôt qu'entretenu par des déclencheurs : une reconstruction
 * de 78 000 lignes prend moins d'une seconde, là où un déclencheur oublié se paie en résultats
 * manquants qu'on ne remarque pas.
 */
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS live_channels_fts USING fts5(
    nom_recherche,
    content='live_channels',
    content_rowid='rowid',
    tokenize='unicode61'
  );
`);

/**
 * Saga d'un film — « Collection » chez TMDB.
 *
 * Deux colonnes plutôt qu'une table : un film n'appartient qu'à une seule saga, et l'identifiant
 * comme le nom viennent ensemble de la même réponse. L'identifiant sert au regroupement, le nom à
 * l'affichage — se fier au seul nom regrouperait deux sagas homonymes.
 */
ensureCatalogColumn("collection_id", "TEXT");
ensureCatalogColumn("collection_name", "TEXT");

// Langue de tournage du film, telle que le fournisseur la donne — à ne pas confondre avec
// `metadata_language`, qui est la langue *demandée* pour les textes. Elle était récupérée chez TMDB
// pour choisir les affiches, puis jetée. Sans elle, la préférence audio « langue originale » d'un
// profil ne peut pas être honorée : le lecteur ignore quelle piste est l'originale.
ensureCatalogColumn("original_language", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_collection ON catalog_items(collection_id)");

ensureCatalogColumn("search_title", "TEXT");
ensureMediaColumn("search_title", "TEXT");

/**
 * Dossier d'origine d'une fiche de série : son identité stable.
 *
 * Une fiche s'identifiait par son titre et son année, deux valeurs venues du fournisseur qui avait
 * répondu pour *ce* fichier-là. Pendant une analyse, TMDB peut céder la main à TVDB ou à TVmaze le
 * temps que son coupe-circuit se referme : les épisodes suivants recevaient alors un autre titre,
 * donc une autre clé, donc une **seconde fiche de série** pour le même dossier. Mesuré sur la
 * médiathèque réelle : dix dossiers éclatés, dont `Dr Who` en deux fiches toutes deux datées 2005,
 * et `Dr House` réparti entre « House » (TVDB) et « Dr House » (TMDB).
 *
 * Le dossier, lui, ne dépend d'aucun fournisseur. Et il sépare ce qui doit l'être : `Dr Who` et
 * `Dr Who (2023)` lisent le même titre et restent deux séries.
 */
ensureCatalogColumn("source_folder", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_source_folder ON catalog_items(library_id, kind, source_folder)");

function backfillSearchTitles(table: "catalog_items" | "media_items"): void {
  const rows = db.prepare(`SELECT id, title FROM ${table} WHERE search_title IS NULL`).all() as Array<{ id: string; title: string }>;
  if (rows.length === 0) return;
  const update = db.prepare(`UPDATE ${table} SET search_title = ? WHERE id = ?`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) update.run(normaliseForSearch(row.title), row.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
backfillSearchTitles("catalog_items");
backfillSearchTitles("media_items");

// Sans index, la colonne ne ferait qu'ajouter du travail : la recherche resterait un parcours complet.
db.exec("CREATE INDEX IF NOT EXISTS idx_catalog_search_title ON catalog_items(search_title)");
db.exec("CREATE INDEX IF NOT EXISTS idx_media_search_title ON media_items(search_title)");
ensureProfileColumn("language", "TEXT NOT NULL DEFAULT 'fr-FR'");
ensureProfileColumn("preferred_audio_languages", "TEXT NOT NULL DEFAULT '[\"fra\",\"fre\",\"fr\",\"eng\",\"en\"]'");
ensureProfileColumn("preferred_subtitle_languages", "TEXT NOT NULL DEFAULT '[\"fra\",\"fre\",\"fr\"]'");
ensureProfileColumn("subtitle_mode", "TEXT NOT NULL DEFAULT 'forced'");
ensureProfileColumn("audio_output_mode", "TEXT NOT NULL DEFAULT 'auto'");
ensureProfileColumn("audio_normalization", "INTEGER NOT NULL DEFAULT 0");
ensureProfileColumn("night_mode", "INTEGER NOT NULL DEFAULT 0");
ensureProfileColumn("dynamic_range_priority", "TEXT NOT NULL DEFAULT 'auto'");
ensureProfileColumn("resume_mode", "TEXT NOT NULL DEFAULT 'continue'");
ensureProfileColumn("resume_rewind_seconds", "INTEGER NOT NULL DEFAULT 5");
ensureProfileColumn("default_playback_rate", "REAL NOT NULL DEFAULT 1");
ensureProfileColumn("autoplay_next", "INTEGER NOT NULL DEFAULT 1");
ensureProfileColumn("autoplay_limit", "INTEGER NOT NULL DEFAULT 3");
ensureProfileColumn("pin_hash", "TEXT");
db.exec(`CREATE TABLE IF NOT EXISTS profile_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
ensureProfileColumn("group_id", "TEXT");
ensureProfileColumn("is_child", "INTEGER NOT NULL DEFAULT 0");
ensureProfileColumn("age", "INTEGER");
// Migration additive : les préférences R49 et antérieures restent intactes. Les vidéos sans réglage
// enregistré démarrent avec texte blanc et fond transparent, conformément au lecteur R50.
ensureSubtitlePreferenceColumn("color", "TEXT NOT NULL DEFAULT 'white'");

// Une installation existante ne doit jamais se retrouver devant un écran vide après la migration :
// son historique de profils rejoint automatiquement un groupe neutre, sans changer aucun profil.
let defaultGroup = db.prepare("SELECT id FROM profile_groups ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
if (!defaultGroup) {
  defaultGroup = { id: randomUUID() };
  db.prepare("INSERT INTO profile_groups (id, name) VALUES (?, 'Famille')").run(defaultGroup.id);
}
const defaultGroupId = defaultGroup.id;
db.prepare(`UPDATE profiles SET group_id = ? WHERE group_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM profile_groups g WHERE g.id = profiles.group_id)`).run(defaultGroupId);
db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_group ON profiles(group_id, created_at)");

/**
 * Longueur du code PIN, retenue au moment où il est posé.
 *
 * L'empreinte `scrypt` ne dit rien de la longueur du secret, et l'accès distant en a besoin : un
 * profil n'est joignable depuis Internet qu'avec un PIN d'au moins six chiffres. Sans cette colonne,
 * il faudrait soit conserver le PIN en clair — jamais —, soit exposer les profils sans savoir ce qui
 * les protège.
 *
 * `NULL` pour tout profil antérieur : ils restent hors du périmètre distant tant que leur code n'a
 * pas été reposé. C'est délibérément un choix qui se prend, et non un héritage silencieux.
 */
ensureProfileColumn("pin_digits", "INTEGER");

/**
 * Les sessions ouvertes par un déverrouillage de profil.
 *
 * Elles vivaient dans une `Map` en mémoire : tout le monde était déconnecté à chaque redémarrage du
 * NAS, et rien n'était révocable. Acceptable sur un réseau local, intenable pour un accès distant où
 * la session est **le** rempart devant la médiathèque.
 *
 * **C'est l'empreinte du jeton qui est enregistrée, jamais le jeton.** La base est téléchargeable par
 * qui obtient une sauvegarde, et une sauvegarde qui contiendrait des jetons utilisables donnerait
 * accès à tous les profils ouverts. Une empreinte ne se rejoue pas.
 */
db.exec(`CREATE TABLE IF NOT EXISTS profile_sessions (
  token_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origine TEXT NOT NULL DEFAULT 'lan',
  appareil TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL
);`);
db.exec("CREATE INDEX IF NOT EXISTS idx_profile_sessions_profil ON profile_sessions(profile_id, expires_at)");

/**
 * Les échecs de déverrouillage, comptés par origine.
 *
 * Un PIN à six chiffres ne vaut que par ce qui limite les essais : sans ralentissement, un million de
 * combinaisons tombe en quelques heures. Le compteur est persisté et non gardé en mémoire, sinon un
 * redémarrage — que l'attaquant peut provoquer en saturant le service — remettrait le compteur à zéro.
 */
db.exec(`CREATE TABLE IF NOT EXISTS profile_unlock_failures (
  source TEXT PRIMARY KEY,
  essais INTEGER NOT NULL DEFAULT 0,
  dernier_essai TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

/*
 * Le schéma est construit ; on le consigne.
 *
 * Tout ce qui précède est idempotent — tables créées si absentes, colonnes ajoutées si manquantes —
 * et constitue le **socle**, la version 1. Une base existante l'adopte sans qu'on réexécute quoi que
 * ce soit ; une base neuve l'obtient en étant créée. Les évolutions suivantes, elles, portent un
 * numéro et s'appliquent dans une transaction.
 *
 * La sauvegarde préalable est prise ici même, en trois lignes, plutôt qu'en appelant `maintenance` —
 * qui a besoin de `db` et créerait un cycle d'importation. Elle porte **le nom des sauvegardes
 * ordinaires**, ce qui n'est pas un détail : c'est ce qui la rend restaurable par le mécanisme
 * existant, depuis l'écran d'administration, sans intervention particulière.
 */
function sauvegarderAvantMigration(): void {
  const dossier = path.join(config.dataDir, "backups");
  mkdirSync(dossier, { recursive: true });
  const compact = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const cible = path.join(dossier, `flixtunes-${compact.slice(0, 8)}-${compact.slice(8)}.db`);
  db.exec("PRAGMA wal_checkpoint(FULL)");
  db.exec(`VACUUM INTO '${cible.replaceAll("'", "''")}'`);
  console.info(`[FlixTunes] Sauvegarde avant migration : ${path.basename(cible)}`);
}

appliquerLesMigrations(db, {
  avantModification: sauvegarderAvantMigration,
  journaliser: (message) => console.info(`[FlixTunes] ${message}`),
});

const profileCount = db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number };
if (profileCount.count === 0) {
  db.prepare("INSERT INTO profiles (id, group_id, name, avatar_color) VALUES (?, ?, ?, ?)").run(
    randomUUID(),
    defaultGroupId,
    "Principal",
    "#2968ff",
  );
}

/**
 * Nettoyage unique hérité du prototype : les anciennes bibliothèques étaient injectées depuis `.env`
 * sans confirmation, et il fallait les détacher pour forcer un vrai assistant de première mise en
 * route. Le catalogue est effacé ; les progressions de lecture, elles, sont conservées.
 *
 * Ce nettoyage était gardé par la seule **absence** du réglage `first_run_completed`. Une absence
 * n'est pas une preuve : une table de réglages réinitialisée, une sauvegarde restaurée d'avant la
 * configuration, ou la perte de cette ligne pour toute autre raison, et le démarrage suivant
 * effaçait en silence toutes les bibliothèques et tout le catalogue d'un serveur en production.
 *
 * Le garde-fou est donc un marqueur **qui lui est propre** et qu'on pose définitivement : une fois
 * écrit, le nettoyage ne peut plus se déclencher, quoi qu'il advienne des autres réglages. Une base
 * déjà configurée le reçoit sans que rien ne soit supprimé.
 */
const prototypeCleanupDone = db.prepare("SELECT value FROM server_settings WHERE key = 'prototype_cleanup_done'").get() as { value: string } | undefined;
if (!prototypeCleanupDone) {
  const setupMarker = db.prepare("SELECT value FROM server_settings WHERE key = 'first_run_completed'").get() as { value: string } | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    // Une base déjà passée par l'assistant n'est pas une base de prototype : on pose le marqueur
    // sans rien détruire. C'est le cas de toutes les installations existantes.
    if (!setupMarker) {
      db.prepare("DELETE FROM catalog_items").run();
      db.prepare("DELETE FROM library_folders").run();
    }
    db.prepare(`
      INSERT INTO server_settings (key, value, updated_at) VALUES ('prototype_cleanup_done', 'true', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
    `).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

db.prepare(`
  UPDATE library_folders SET last_scan_status = 'failed', last_scan_finished_at = CURRENT_TIMESTAMP,
    last_scan_error = 'Analyse interrompue par le redémarrage du serveur'
  WHERE last_scan_status IN ('queued', 'running')
`).run();
db.prepare(`
  UPDATE scan_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP,
    error = 'Analyse interrompue par le redémarrage du serveur'
  WHERE status IN ('queued', 'running')
`).run();

type MediaRow = {
  id: string;
  catalog_id: string | null;
  kind: "movie" | "show" | "episode";
  title: string;
  sort_title: string;
  year: number | null;
  created_at: string;
  overview: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  show_title: string | null;
  season_number: number | null;
  episode_number: number | null;
  air_date: string | null;
  runtime_seconds: number | null;
  age_rating?: number | null;
  rating_label?: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
  completed: number | null;
};

export function getDefaultProfile(): Profile {
  const row = db.prepare("SELECT * FROM profiles ORDER BY created_at LIMIT 1").get() as {
    id: string;
    name: string;
    avatar_color: string;
    language: string;
    preferred_audio_languages: string; preferred_subtitle_languages: string; subtitle_mode: string;
    audio_output_mode: string; audio_normalization: number; night_mode: number; dynamic_range_priority: string; resume_mode: string;
    resume_rewind_seconds: number; default_playback_rate: number; autoplay_next: number; autoplay_limit: number;
  };
  return mapProfile(row);
}

export function mapProfile(row: { id: string; name: string; avatar_color: string; language: string;
  group_id?: string; is_child?: number; age?: number | null;
  preferred_audio_languages?: string; preferred_subtitle_languages?: string; subtitle_mode?: string;
  audio_output_mode?: string; audio_normalization?: number; night_mode?: number; resume_mode?: string;
  dynamic_range_priority?: string;
  resume_rewind_seconds?: number; default_playback_rate?: number; autoplay_next?: number; autoplay_limit?: number;
  pin_hash?: string | null }): Profile {
  const parseLanguages = (value: string | undefined, fallback: string[]) => { try { const parsed = JSON.parse(value ?? "") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback; } catch { return fallback; } };
  return {
    id: row.id,
    groupId: row.group_id ?? defaultGroupId,
    name: row.name,
    avatarColor: row.avatar_color,
    language: row.language === "en-US" ? "en-US" : "fr-FR",
    preferredAudioLanguages: parseLanguages(row.preferred_audio_languages, ["fra", "fre", "fr", "eng", "en"]),
    preferredSubtitleLanguages: parseLanguages(row.preferred_subtitle_languages, ["fra", "fre", "fr"]),
    subtitleMode: row.subtitle_mode === "off" || row.subtitle_mode === "always" ? row.subtitle_mode : "forced",
    audioOutputMode: ["copy", "aac", "ac3", "opus"].includes(row.audio_output_mode ?? "")
      ? row.audio_output_mode as "copy" | "aac" | "ac3" | "opus" : "auto",
    audioNormalization: Boolean(row.audio_normalization),
    nightMode: Boolean(row.night_mode),
    dynamicRangePriority: ["dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr"].includes(row.dynamic_range_priority ?? "")
      ? row.dynamic_range_priority as "dolbyvision" | "hdr10plus" | "hdr10" | "hlg" | "sdr" : "auto",
    resumeMode: row.resume_mode === "ask" || row.resume_mode === "restart" ? row.resume_mode : "continue",
    resumeRewindSeconds: Math.max(0, Math.min(60, row.resume_rewind_seconds ?? 5)),
    defaultPlaybackRate: Math.max(0.5, Math.min(2, row.default_playback_rate ?? 1)),
    autoplayNext: row.autoplay_next !== 0,
    autoplayLimit: Math.max(1, Math.min(20, row.autoplay_limit ?? 3)),
    isChild: row.is_child === 1,
    age: row.is_child === 1 ? Math.max(0, Math.min(17, row.age ?? 0)) : null,
    protected: Boolean(row.pin_hash),
  };
}

export function getProfile(profileId?: string | null): Profile | null {
  if (!profileId) return getDefaultProfile();
  const row = db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as
    | { id: string; name: string; avatar_color: string; language: string; preferred_audio_languages: string; preferred_subtitle_languages: string; subtitle_mode: string;
      audio_output_mode: string; audio_normalization: number; night_mode: number; dynamic_range_priority: string; resume_mode: string;
      resume_rewind_seconds: number; default_playback_rate: number; autoplay_next: number; autoplay_limit: number }
    | undefined;
  return row ? mapProfile(row) : null;
}

export function listProfileGroups(): ProfileGroup[] {
  return (db.prepare("SELECT id, name, created_at FROM profile_groups ORDER BY created_at, name").all() as Array<{
    id: string; name: string; created_at: string;
  }>).map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}

/**
 * `node:sqlite` n'offre pas d'assistant de transaction : l'enveloppe est explicite.
 *
 * `BEGIN IMMEDIATE` prend le verrou d'écriture tout de suite plutôt qu'à la première écriture, ce qui
 * transforme un conflit tardif — au milieu d'un lot déjà à moitié appliqué — en refus immédiat.
 * Ces transactions ne s'imbriquent pas : SQLite refuserait un second `BEGIN`.
 */
export function inTransaction<T>(work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type MediaItemWithProgress = MediaItem & {
  progressPositionSeconds: number;
  progressDurationSeconds: number;
};

export function mapMedia(row: MediaRow): MediaItemWithProgress {
  const duration = row.duration_seconds ?? row.runtime_seconds ?? 0;
  const position = row.position_seconds ?? 0;
  return {
    id: row.id,
    catalogId: row.catalog_id,
    playableMediaId: row.id,
    kind: row.kind,
    title: row.title,
    sortTitle: row.sort_title,
    year: row.year,
    addedAt: row.created_at,
    overview: row.overview,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    showTitle: row.show_title,
    seasonNumber: row.season_number,
    episodeNumber: row.episode_number,
    airDate: row.air_date ?? null,
    runtimeSeconds: row.runtime_seconds,
    ageRating: row.age_rating ?? null,
    ratingLabel: row.rating_label ?? null,
    progressPercent: duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0,
    progressPositionSeconds: Math.max(0, position),
    progressDurationSeconds: Math.max(0, duration),
    completed: row.completed === 1,
  };
}

export const mediaSelect = `
  SELECT m.*, p.position_seconds, p.duration_seconds, p.completed,
    COALESCE(root_catalog.age_rating, parent_catalog.age_rating, item_catalog.age_rating) AS age_rating,
    COALESCE(root_catalog.rating_label, parent_catalog.rating_label, item_catalog.rating_label) AS rating_label
  FROM media_items m
  LEFT JOIN playback_progress p ON p.media_id = m.id AND p.profile_id = ?
  LEFT JOIN catalog_items item_catalog ON item_catalog.id = m.catalog_id
  LEFT JOIN catalog_items parent_catalog ON parent_catalog.id = item_catalog.parent_id
  LEFT JOIN catalog_items root_catalog ON root_catalog.id = parent_catalog.parent_id
`;

/** Classification effective d'un film ou de la série parente d'un épisode. */
export const mediaAgeRatingSql =
  "COALESCE(root_catalog.age_rating, parent_catalog.age_rating, item_catalog.age_rating)";

export function inferKindFromPath(folderPath: string): LibraryFolder["resolvedKind"] {
  const normalized = folderPath.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
  if (/(^|[\\/])(series?(?:\s*tv)?|tv\s*shows?)([\\/]|$)/i.test(normalized)) return "tv";
  if (/(^|[\\/])(films?|movies?|cinema)([\\/]|$)/i.test(normalized)) return "movie";
  return "other";
}

export function listLibraries(): LibraryFolder[] {
  const rows = db.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM media_items m WHERE m.library_id = l.id) AS item_count
     FROM library_folders l ORDER BY l.created_at`,
  ).all() as Array<{
    id: string; name: string; path: string; kind: LibraryFolder["kind"]; language: string;
    organize_seasons: number; enabled: number; item_count: number; last_scan_mode: "files" | "metadata";
    last_scan_status: ScanStatus; last_scan_discovered: number; last_scan_imported: number;
    last_scan_enriched: number; last_scan_removed: number; last_scan_started_at: string | null;
    last_scan_finished_at: string | null; last_scan_error: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    kind: row.kind,
    resolvedKind: row.kind === "auto" ? inferKindFromPath(row.path) : row.kind,
    language: row.language === "en-US" ? "en-US" : "fr-FR",
    organizeSeasons: false,
    enabled: row.enabled === 1,
    itemCount: row.item_count,
    scan: {
      mode: row.last_scan_mode,
      status: row.last_scan_status,
      discovered: row.last_scan_discovered,
      imported: row.last_scan_imported,
      enriched: row.last_scan_enriched,
      removed: row.last_scan_removed,
      startedAt: row.last_scan_started_at,
      finishedAt: row.last_scan_finished_at,
      error: row.last_scan_error,
    },
  }));
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM server_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, value);
}

export function isFirstRunRequired(): boolean {
  return getSetting("first_run_completed") !== "true";
}

/**
 * Répare les progressions enregistrées avec la durée du flux transcodé au lieu de celle du média.
 *
 * Jusqu'à 0.5.2, le lecteur transmettait `video.duration`, qui ne couvre que la portion déjà encodée
 * d'un flux HLS. Une position réelle de 300 s enregistrée avec une durée de 12 s donnait 2500 %,
 * plafonné à 100 % : le média passait pour terminé et la reprise repartait de zéro.
 *
 * La position enregistrée, elle, est juste — c'est le temps de lecture réel. Il suffit donc de rétablir
 * la durée depuis le média et de recalculer l'état « terminé ».
 *
 * Les lignes marquées à la main via « Marquer vu » utilisent la sentinelle position 1 / durée 1 : elles
 * sont exclues pour ne pas annuler une décision explicite de l'utilisateur.
 */
export function repairTranscodedProgress(): number {
  const result = db.prepare(`
    UPDATE playback_progress AS p
    SET duration_seconds = (SELECT m.runtime_seconds FROM media_items m WHERE m.id = p.media_id),
        completed = CASE
          WHEN p.position_seconds >= 0.9 * (SELECT m.runtime_seconds FROM media_items m WHERE m.id = p.media_id) THEN 1
          ELSE 0 END
    WHERE p.duration_seconds > 1
      AND EXISTS (
        SELECT 1 FROM media_items m
        WHERE m.id = p.media_id AND m.runtime_seconds > 0
          AND p.duration_seconds < m.runtime_seconds * 0.5
      )
  `).run();
  return Number(result.changes);
}

/**
 * Remplace les genres d'une fiche.
 *
 * Le remplacement est complet : un genre retiré chez TMDB doit disparaître ici aussi, sans quoi une
 * correction de correspondance laisserait traîner les genres de l'ancienne fiche.
 *
 * Une liste vide ne supprime rien. L'absence de genres dans une réponse ne signifie pas que la fiche
 * n'en a pas — le plus souvent, la requête n'a simplement pas ramené le détail.
 */
export function setCatalogGenres(catalogId: string, genres: string[]): void {
  const propres = [...new Set(genres.map((genre) => genre.trim()).filter(Boolean))];
  if (!propres.length) return;
  db.prepare("DELETE FROM catalog_genres WHERE catalog_id = ?").run(catalogId);
  const insert = db.prepare("INSERT OR IGNORE INTO catalog_genres (catalog_id, genre) VALUES (?, ?)");
  for (const genre of propres) insert.run(catalogId, genre);
}

interface CatalogCreditInput {
  externalId: string;
  name: string;
  profileUrl: string | null;
  department: string | null;
  role: "actor" | "director" | "creator" | "writer" | "composer";
  character: string | null;
  job: string | null;
  order: number;
}

/** Remplace atomiquement les crédits d'une fiche sans télécharger d'image ni toucher aux grilles. */
export function setCatalogPeople(catalogId: string, provider: string, people: CatalogCreditInput[]): void {
  const propres = people.filter((person) => person.externalId.trim() && person.name.trim()).slice(0, 40);
  db.prepare("DELETE FROM catalog_people_credits WHERE catalog_id = ?").run(catalogId);
  const upsert = db.prepare(`
    INSERT INTO catalog_people (id, external_provider, external_id, name, search_name, profile_url, department)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, search_name = excluded.search_name,
      profile_url = COALESCE(excluded.profile_url, catalog_people.profile_url),
      department = COALESCE(excluded.department, catalog_people.department)
  `);
  const credit = db.prepare(`
    INSERT OR REPLACE INTO catalog_people_credits
      (catalog_id, person_id, role, character, job, credit_order) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const person of propres) {
    const personId = `${provider}:${person.externalId}`;
    upsert.run(personId, provider, person.externalId, person.name.trim(), normaliseForSearch(person.name),
      person.profileUrl, person.department);
    credit.run(catalogId, personId, person.role, person.character?.trim() ?? "", person.job, person.order);
  }
}
