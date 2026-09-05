import { z } from "zod";

/**
 * Ce qu'un media est.
 *
 * `video` designe une video de plateforme : elle n'a ni saison ni numero d'episode, et se presente
 * par son titre et sa date de publication. Elle etait enregistree en `episode` pour heriter sans code
 * neuf de la reprise et de l'enchainement — mais le type voyage avec la fiche, et les ecrans
 * l'annoncaient « S1 · E20024 ». Une video n'est pas un episode.
 */
export const mediaKindSchema = z.enum(["movie", "show", "episode", "video"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const progressInputSchema = z.object({
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().positive(),
  completed: z.boolean().optional(),
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

export const libraryKindSchema = z.enum(["auto", "movie", "tv", "other", "web"]);
export type LibraryKind = z.infer<typeof libraryKindSchema>;
export const metadataLanguageSchema = z.enum(["fr-FR", "en-US"]);
export type MetadataLanguage = z.infer<typeof metadataLanguageSchema>;
export const catalogKindSchema = z.enum(["movie", "show", "season", "episode"]);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

export const libraryInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().trim().min(1),
  kind: libraryKindSchema,
  language: metadataLanguageSchema,
  organizeSeasons: z.literal(false).default(false),
});
export type LibraryInput = z.infer<typeof libraryInputSchema>;

export const libraryLocalizationInputSchema = z.object({ language: metadataLanguageSchema }).strict();
export type LibraryLocalizationInput = z.infer<typeof libraryLocalizationInputSchema>;

export const setupInputSchema = z.object({
  libraries: z.array(libraryInputSchema).min(1).max(20),
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export type ScanMode = "files" | "metadata";
export type ScanStatus = "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";
export const scanScopeSchema = z.enum(["all", "movie", "tv", "library"]);
export type ScanScope = z.infer<typeof scanScopeSchema>;

export const scanRequestSchema = z.object({
  scope: scanScopeSchema.default("all"),
  mode: z.enum(["files", "metadata"]).default("files"),
  libraryId: z.string().uuid().optional(),
  priority: z.coerce.number().int().min(0).max(100).default(50),
}).superRefine((value, context) => {
  if (value.scope === "library" && !value.libraryId) {
    context.addIssue({ code: "custom", message: "libraryId est requis pour cette portée", path: ["libraryId"] });
  }
});
export type ScanRequest = z.infer<typeof scanRequestSchema>;

export interface ScanJob {
  id: string;
  libraryId: string;
  libraryName: string;
  scope: ScanScope;
  mode: ScanMode;
  status: Exclude<ScanStatus, "idle">;
  priority: number;
  discovered: number;
  imported: number;
  enriched: number;
  removed: number;
  errorCount: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancellable: boolean;
  retryable: boolean;
}

export interface ScanSummary {
  mode: ScanMode;
  status: ScanStatus;
  discovered: number;
  imported: number;
  enriched: number;
  removed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface LibraryFolder extends LibraryInput {
  id: string;
  resolvedKind: Exclude<LibraryKind, "auto">;
  enabled: boolean;
  itemCount: number;
  scan: ScanSummary;
}

export interface SetupStatus {
  firstRunRequired: boolean;
  libraries: LibraryFolder[];
}

export interface DirectoryBrowserEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowserListing {
  path: string | null;
  parentPath: string | null;
  roots: DirectoryBrowserEntry[];
  directories: DirectoryBrowserEntry[];
  /**
   * Les fichiers du dossier, quand l'appelant en a demandé — et seulement ceux dont l'extension a été
   * nommée. Absent lorsqu'on choisit un dossier, ce qui reste le cas des bibliothèques.
   */
  files?: DirectoryBrowserEntry[];
}

export const metadataSearchQuerySchema = z.object({
  kind: z.enum(["movie", "tv"]),
  query: z.string().trim().min(1).max(160),
  /** Année exacte, utilisée par l'analyse automatique pour départager des titres homonymes. */
  year: z.coerce.number().int().min(1870).max(2200).optional(),
  /**
   * Année **minimale**, saisie lors d'une correction manuelle.
   *
   * Distincte de `year` à dessein : une correction porte souvent sur une fiche dont l'année est
   * précisément fausse. Filtrer sur une année exacte rendait alors la bonne réponse inatteignable —
   * chercher « Daredevil » depuis une fiche datée 2025 masquait la série de 2015. Un seuil laisse
   * écarter les rééditions anciennes sans exclure ce qu'on cherche.
   */
  minYear: z.coerce.number().int().min(1870).max(2200).optional(),
  language: metadataLanguageSchema.default("fr-FR"),
});

export const metadataMatchInputSchema = z.object({
  /**
   * La liste doit couvrir **tous** les fournisseurs capables de proposer un candidat, sinon le
   * serveur refuse un choix que l'interface vient d'afficher. `tvmaze` et `wikidata` y manquaient :
   * une série proposée depuis TVmaze — le cas de toutes les séries hors TMDB — se voyait répondre
   * « Correspondance invalide », sans que rien n'indique que le fournisseur était en cause.
   */
  provider: z.enum(["tmdb", "tvmaze", "wikidata", "anilist", "tvdb", "imdb", "allocine"]),
  externalId: z.string().trim().regex(/^[a-zA-Z0-9._:-]+$/),
  /** Copie de la proposition affichée, utilisée uniquement pour la retrouver et la valider. */
  title: z.string().trim().min(1).max(240).optional(),
  year: z.number().int().min(1870).max(2200).nullable().optional(),
}).strict();
export type MetadataMatchInput = z.infer<typeof metadataMatchInputSchema>;

export const manualMetadataInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  year: z.number().int().min(1870).max(2200).nullable(),
  overview: z.string().trim().max(10000).nullable(),
  language: metadataLanguageSchema,
}).strict();
export type ManualMetadataInput = z.infer<typeof manualMetadataInputSchema>;

export interface MetadataSearchCandidate {
  provider: "local" | "tvmaze" | "wikidata" | "anilist" | "tmdb" | "tvdb" | "imdb" | "fanart" | "allocine";
  externalId: string;
  kind: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  /** Titres de sortie alternatifs connus du fournisseur (pays, ressortie, titre de travail). */
  alternativeTitles?: string[];
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  score: number;
  /** Position rendue par le fournisseur avant tout reclassement FlixTunes (0 = premier résultat). */
  providerSearchRank?: number;
  matchReasons?: string[];
}

export interface MetadataProviderStatus {
  id: MetadataSearchCandidate["provider"];
  name: string;
  role: "metadata" | "artwork" | "local";
  configured: boolean;
  enabled: boolean;
  legalMode: "open-api" | "licensed-api" | "local";
  message: string;
  health?: "idle" | "healthy" | "degraded";
  lastSuccessAt?: string | null;
  lastError?: string | null;
  latencyMs?: number | null;
}

export interface MetadataFieldProvenance {
  catalogId: string;
  field: "title" | "originalTitle" | "overview" | "year" | "runtimeSeconds" | "poster" | "backdrop";
  value: string | number | null;
  source: "filename" | "embedded" | "nfo" | MetadataSearchCandidate["provider"] | "manual";
  sourceId: string | null;
  language: string | null;
  confidence: number;
  locked: boolean;
  updatedAt: string;
}

export const metadataProviderConfigurationSchema = z.object({
  tmdbToken: z.string().trim().min(20).max(4096).nullable().optional(),
  tvdbApiKey: z.string().trim().min(8).max(1024).nullable().optional(),
  tvdbPin: z.string().trim().max(256).nullable().optional(),
  fanartApiKey: z.string().trim().min(8).max(1024).nullable().optional(),
  imdbApiUrl: z.string().url().max(2048).nullable().optional(),
  imdbApiToken: z.string().trim().min(8).max(4096).nullable().optional(),
  allocineApiUrl: z.string().url().max(2048).nullable().optional(),
  allocineApiToken: z.string().trim().min(8).max(4096).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Au moins un fournisseur doit être modifié");
export type MetadataProviderConfigurationInput = z.infer<typeof metadataProviderConfigurationSchema>;

/** Commandes de correction durable de l'étape 53. Chacune est transactionnelle et annulable. */
export const correctionCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rematch"), catalogId: z.string().min(1),
    provider: z.string().trim().min(1).max(32), externalId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(240).optional(), year: z.number().int().min(1870).max(2200).nullable().optional() }),
  z.object({ type: z.literal("renumber"), catalogId: z.string().min(1),
    seasonNumber: z.number().int().min(0).max(200).nullable(), episodeNumber: z.number().int().min(0).max(2000).nullable() }),
  z.object({ type: z.literal("lock"), catalogId: z.string().min(1) }),
  z.object({ type: z.literal("unlock"), catalogId: z.string().min(1) }),
  z.object({ type: z.literal("merge"), targetId: z.string().min(1), sourceId: z.string().min(1) }),
  z.object({ type: z.literal("split"), sourceId: z.string().min(1) }),
]);
export type CorrectionCommandInput = z.infer<typeof correctionCommandSchema>;

export interface CorrectionAuditEntry {
  id: string;
  at: string;
  command: CorrectionCommandInput["type"];
  scope: string;
  summary: string;
  undone: boolean;
}

export interface CatalogItem {
  id: string;
  libraryId: string;
  parentId: string | null;
  kind: CatalogKind;
  title: string;
  overview?: string | null;
  year: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  posterUrl: string | null;
  externalProvider: string | null;
  externalId: string | null;
  matchStatus: "unmatched" | "review" | "automatic" | "manual";
  metadataLocked: boolean;
  matchConfidence: number | null;
  needsReview: boolean;
  /** Proposition conservée à part : elle n'a encore modifié ni la fiche ni son regroupement. */
  matchProposal?: MetadataSearchCandidate | null;
}

export const playbackCapabilitiesSchema = z.object({
  containers: z.array(z.enum(["mp4", "webm", "mpegts", "matroska", "avi", "mov"])).min(1),
  videoCodecs: z.array(z.string().min(1)),
  audioCodecs: z.array(z.string().min(1)),
  hls: z.boolean(),
  dash: z.boolean().default(false),
  maxWidth: z.number().int().positive().max(16384).default(3840),
  maxHeight: z.number().int().positive().max(16384).default(2160),
  hdr: z.boolean().default(false),
  hdrFormats: z.array(z.enum(["hdr10", "hdr10plus", "hlg", "dolbyvision"])).default([]),
  dolbyVisionProfiles: z.array(z.number().int().min(4).max(20)).default([]),
  dolbyAtmos: z.boolean().default(false),
  immersiveAudioFormats: z.array(z.enum(["dolby-atmos", "dts-x", "auro-3d"])).default([]),
  maxAudioChannels: z.number().int().positive().max(64).default(8),
  losslessAudio: z.boolean().default(false),
  maxVideoBitrate: z.number().int().positive().nullable().default(null),
  audioStreamIndex: z.number().int().min(0).nullable().default(null),
  /** Le lecteur sait-il choisir une piste audio dans un fichier servi entier en lecture directe ? */
  directAudioStreamSelection: z.boolean().optional(),
  preferredAudioLanguages: z.array(z.string().trim().min(2).max(16)).max(12).optional(),
  preferredSubtitleLanguages: z.array(z.string().trim().min(2).max(16)).max(12).optional(),
  audioOutputMode: z.enum(["auto", "copy", "aac", "ac3", "opus"]).optional(),
  audioNormalization: z.boolean().optional(),
  nightMode: z.boolean().optional(),
  subtitleStreamIndex: z.number().int().min(0).nullable().default(null),
  externalSubtitleId: z.number().int().min(0).nullable().optional(),
  burnSubtitles: z.boolean().default(false),
  subtitleOffsetSeconds: z.number().min(-600).max(600).optional(),
  networkMbps: z.number().positive().max(10_000).nullable().optional(),
  displayPeakNits: z.number().positive().max(10_000).nullable().optional(),
  hlsSegmentContainer: z.enum(["fmp4", "mpegts"]).optional(),
  deviceClass: z.enum(["web", "desktop", "mobile", "tv"]).optional(),
  /**
   * Identifiant stable de l'appareil, choisi par le client.
   *
   * Il ne sert qu'à retenir ce qui a échoué **sur cet appareil** : un codec annoncé mais que son
   * décodeur refuse. La même mémoire tenue globalement ferait payer à tous le défaut d'un seul, et
   * tenue par session elle n'apprendrait jamais rien.
   *
   * Aucune donnée personnelle n'y est attendue — une valeur opaque suffit.
   */
  deviceId: z.string().trim().min(6).max(120).optional(),
  modePreference: z.enum(["auto", "direct", "remux", "compatible"]).optional(),
  /**
   * Ce démultiplexeur sait-il aller chercher la définition des pistes où qu'elle soit ?
   *
   * Matroska autorise l'élément `Tracks` à se trouver **après** les données vidéo, tout à la fin du
   * fichier ; le `SeekHead` de tête y renvoie. FFmpeg et les navigateurs suivent ce renvoi. Media3,
   * qui analyse le flux linéairement, rencontre les données avant toute définition de piste et se
   * retrouve sans vidéo, sans son et sans table de positions — **sans lever d'erreur**, donc sans
   * qu'aucun repli ne se déclenche.
   *
   * Absent, on suppose que oui : c'était le comportement de tous les clients jusqu'à r68, et le
   * serveur le corrige de lui-même pour les clients Android antérieurs (voir `decidePlayback`).
   */
  seekableTrackHeaders: z.boolean().optional(),
  /**
   * Point de départ du transcodage, en secondes.
   *
   * Un transcodage part de zéro et encode linéairement : on ne peut se déplacer que dans la portion
   * déjà encodée. Demander une session qui commence au point visé rend la navigation immédiate sur
   * toute la durée du film, comme sur un fichier lu en direct.
   */
  startSeconds: z.number().min(0).max(86_400).optional(),
  /**
   * Sortie colorimétrique préférée. Une valeur précise n'est retenue que si le fichier la contient
   * (ou expose une couche de base compatible) et si l'appareil sait réellement la décoder.
   * Sinon la négociation reprend l'ordre Dolby Vision, HDR10+, HDR10, HLG, SDR.
   * `hdr` reste accepté pour les anciens clients r43/r44.
   */
  dynamicRangePreference: z.enum(["auto", "hdr", "dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr"]).optional(),
  adaptiveStreaming: z.boolean().default(true),
  streamingProtocol: z.enum(["auto", "hls", "dash"]).default("auto"),
});
export type PlaybackCapabilities = z.infer<typeof playbackCapabilitiesSchema>;

export interface MasteringDisplayMetadata {
  redX: number; redY: number; greenX: number; greenY: number; blueX: number; blueY: number;
  whitePointX: number; whitePointY: number; minLuminanceNits: number; maxLuminanceNits: number;
}

/** Modèle colorimétrique complet d'une piste vidéo, tel que rapporté par FFprobe. */
export interface VideoColorMetadata {
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorRange: "tv" | "pc" | null;
  chromaLocation: string | null;
  chromaSubsampling: "4:0:0" | "4:2:0" | "4:2:2" | "4:4:4" | null;
  bitDepth: number | null;
  masteringDisplay: MasteringDisplayMetadata | null;
  maxContentLightLevel: number | null;
  maxFrameAverageLightLevel: number | null;
  rotationDegrees: number;
  interlaced: boolean;
  fieldOrder: string | null;
  dolbyVisionProfile: number | null;
  dolbyVisionLevel: number | null;
  dolbyVisionRpuPresent: boolean;
  dolbyVisionElPresent: boolean;
  dolbyVisionBlPresent: boolean;
  /** 0 = non rétrocompatible, 1 = HDR10, 2 = SDR, 4 = HLG, 6 = BL contient déjà HDR10. */
  dolbyVisionBlCompatibilityId: number | null;
}

/** `hdr-base-layer` : le flux d'origine est lu via sa couche rétrocompatible (Dolby Vision 8.1, HDR10+ sur HDR10). */
export type ColorPipelineAction = "sdr-passthrough" | "preserve" | "hdr-base-layer" | "hdr-to-sdr";
export type ToneMappingBackend = "none" | "libplacebo" | "vaapi" | "opencl" | "cuda" | "zscale" | "software";

/** Décision colorimétrique explicite prise avant la lecture, affichable dans le diagnostic. */
export interface ColorPipelinePlan {
  sourceFormat: MediaStream["hdrFormat"];
  outputFormat: MediaStream["hdrFormat"];
  action: ColorPipelineAction;
  toneMapping: ToneMappingBackend;
  toneMappingHardware: boolean;
  sourcePeakNits: number | null;
  targetPeakNits: number | null;
  preservesStaticMetadata: boolean;
  preservesDynamicMetadata: boolean;
  deinterlace: "none" | "bwdif" | "yadif";
  rotationDegrees: number;
  sourceFrameRate: number | null;
  outputBitDepth: number | null;
  /** Perte annoncée à l'utilisateur avant la lecture, ou null si la chaîne est fidèle. */
  lossNotice: string | null;
  /** Graphe de décision lisible, du flux source jusqu'à la sortie client. */
  steps: string[];
  /** Filtres FFmpeg réellement appliqués, dans l'ordre. */
  filters: string[];
}

export interface MediaStream {
  index: number;
  type: "video" | "audio" | "subtitle";
  codec: string;
  title: string | null;
  language: string | null;
  channels: number | null;
  width: number | null;
  height: number | null;
  hdr: boolean;
  hdrFormat: "sdr" | "hdr10" | "hdr10plus" | "hlg" | "dolbyvision";
  /** Formats dynamiques réellement présents dans le même flux (notamment les hybrides DV + HDR10+). */
  availableHdrFormats?: Array<"hdr10" | "hdr10plus" | "hlg" | "dolbyvision">;
  dolbyVisionProfile: number | null;
  dolbyAtmos: boolean;
  audioTechnology?: "standard" | "dolby-atmos" | "dts-x" | "auro-3d";
  losslessAudio?: boolean;
  profile?: string | null;
  level?: number | null;
  bitRate?: number | null;
  bitDepth?: number | null;
  frameRate?: number | null;
  pixelFormat?: string | null;
  channelLayout?: string | null;
  isDefault: boolean;
  isForced: boolean;
  canExtractAsWebVtt: boolean;
  codecLongName?: string | null;
  sampleRate?: number | null;
  colorSpace?: string | null;
  colorRange?: string | null;
  fieldOrder?: string | null;
  aspectRatio?: string | null;
  commentary?: boolean;
  hearingImpaired?: boolean;
  visualImpaired?: boolean;
  closedCaptions?: boolean;
  audioRole?: "main" | "original" | "dub" | "commentary" | "audio-description";
  color?: VideoColorMetadata | null;
}

export interface MediaChapter { index: number; startSeconds: number; endSeconds: number | null; title: string | null }
export interface ExternalSubtitle {
  id: number;
  name: string;
  format: string;
  kind: "text" | "image";
  language: string | null;
  forced: boolean;
  hearingImpaired: boolean;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" | null;
  canConvertToWebVtt: boolean;
}
export const subtitlePreferenceSchema = z.object({
  selectionType: z.enum(["off", "internal", "external"]).default("off"),
  streamIndex: z.number().int().min(0).nullable().default(null),
  externalName: z.string().min(1).max(512).nullable().default(null),
  offsetSeconds: z.number().min(-600).max(600).default(0),
  size: z.enum(["small", "normal", "large"]).default("normal"),
  /** Transparent par défaut ; le contraste renforcé reste un choix explicite. */
  background: z.boolean().default(false),
  color: z.enum(["white", "yellow", "cyan", "green"]).default("white"),
  position: z.enum(["bottom", "middle", "top"]).default("bottom"),
  fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
  encodingOverride: z.enum(["auto", "utf-8", "utf-16le", "utf-16be", "windows-1252"]).default("auto"),
}).strict().superRefine((value, context) => {
  if (value.selectionType === "internal" && value.streamIndex == null) context.addIssue({ code: "custom", path: ["streamIndex"], message: "Une piste interne est requise" });
  if (value.selectionType === "external" && !value.externalName) context.addIssue({ code: "custom", path: ["externalName"], message: "Un fichier externe est requis" });
});
export type SubtitlePreference = z.infer<typeof subtitlePreferenceSchema>;
export interface MediaTechnologies {
  resolution: string | null;
  dynamicRange: "SDR" | "HDR10" | "HDR10+" | "HLG" | "Dolby Vision";
  videoCodec: string | null;
  immersiveAudio: Array<"Dolby Atmos" | "DTS:X" | "Auro-3D">;
  audioCodecs: string[];
  subtitleFormats: string[];
  closedCaptions?: boolean;
}
export interface ServerMediaInventory {
  mediaCount: number;
  streamCount: number;
  videoCodecs: Record<string, number>;
  audioCodecs: Record<string, number>;
  subtitleCodecs: Record<string, number>;
  dynamicRanges: Record<string, number>;
  immersiveAudio: Record<string, number>;
}

export interface MediaEngineCapability {
  id: string;
  label: string;
  available: boolean;
  component: "decoder" | "encoder" | "demuxer" | "muxer" | "filter";
  fallback: string | null;
}

export interface PlaybackCompatibilityMatrix {
  generatedAt: string;
  engineVersion: string | null;
  healthy: boolean;
  missingCritical: string[];
  video: MediaEngineCapability[];
  audio: MediaEngineCapability[];
  containers: MediaEngineCapability[];
  subtitles: MediaEngineCapability[];
  processing: MediaEngineCapability[];
  colorPipelines?: MediaEngineCapability[];
}

export interface PlaybackInfo {
  mediaId: string;
  container: string;
  durationSeconds: number | null;
  streams: MediaStream[];
  formatLongName?: string | null;
  fileSize?: number | null;
  overallBitRate?: number | null;
  chapters?: MediaChapter[];
  externalSubtitles?: ExternalSubtitle[];
  /**
   * Langue de tournage du film, ou `null` si le fournisseur ne l'a pas donnée.
   *
   * Elle permet au client d'honorer la préférence audio « langue originale ». En lecture directe il
   * reçoit toutes les pistes du fichier et n'a aucun autre moyen de savoir laquelle est l'originale :
   * le japonais d'un film japonais ressemble en tout point au japonais d'un doublage.
   */
  originalLanguage?: string | null;
  /**
   * La définition des pistes est rangée après les données, à la fin du fichier.
   *
   * Légal en Matroska, transparent pour qui sait se déplacer dans le fichier, et fatal à un lecteur
   * qui l'analyse d'un bout à l'autre. Un remux suffit à y remédier : il réécrit l'en-tête en tête de
   * flux sans toucher à l'image.
   */
  trackHeadersAfterData?: boolean;
  /**
   * Début du générique de fin, en secondes de film, ou `null` si le fichier ne le dit pas.
   *
   * Tiré des chapitres nommés, pas d'une analyse d'image. C'est le moment d'annoncer l'épisode
   * suivant : jusqu'ici la carte n'apparaissait qu'à la toute fin, quand l'écran est déjà noir.
   */
  creditsStartSeconds?: number | null;
  /** Introduction repérée, de quoi proposer de la passer. `null` quand le fichier ne la nomme pas. */
  intro?: { startSeconds: number; endSeconds: number } | null;
  technologies?: MediaTechnologies;
}

export type PlaybackMode = "direct" | "remux" | "transcode";
export type PlaybackSessionStatus = "starting" | "ready" | "completed" | "failed";

export interface PlaybackSession {
  id: string | null;
  mediaId: string;
  mode: PlaybackMode;
  status: PlaybackSessionStatus;
  url: string | null;
  videoEncoder: string | null;
  audioEncoder: string | null;
  reason: string;
  decisionReasons?: string[];
  error: string | null;
  targetWidth?: number | null;
  targetHeight?: number | null;
  targetVideoBitrate?: number | null;
  segmentContainer?: "fmp4" | "mpegts" | null;
  variants?: Array<{ width: number; height: number; videoBitrate: number }>;
  protocol?: "direct" | "hls" | "dash";
  colorPipeline?: ColorPipelinePlan | null;
  /**
   * Décalage, en secondes, entre le début de ce flux et le début du média.
   *
   * Vaut 0 pour une lecture directe ou un transcodage parti du début. Le lecteur ajoute cette valeur
   * à la position du flux pour afficher la position réelle dans le film.
   */
  startOffsetSeconds?: number;
}

export type AcceleratorId = "software" | "nvenc" | "qsv" | "vaapi" | "amf" | "v4l2m2m";

/** Résultat du micro-banc non destructif exécuté sur un encodeur candidat. */
export interface AcceleratorProbe {
  id: AcceleratorId;
  label: string;
  vendor: "cpu" | "nvidia" | "intel" | "amd" | "arm";
  encoder: string;
  /** Présent dans la compilation FFmpeg. Ne présage pas de son utilisabilité réelle. */
  compiled: boolean;
  /** A réellement encodé pendant le micro-banc. */
  usable: boolean;
  framesPerSecond: number | null;
  /** Débit mesuré rapporté à l'encodeur logiciel. */
  relativeToSoftware: number | null;
  selected: boolean;
  error: string | null;
  /**
   * Message brut du pilote, conservé tel quel.
   *
   * Le libellé lisible ne couvre que les pannes connues ; sans le message d'origine, tout le reste se
   * réduit à « le périphérique a refusé », qui n'indique aucun remède. C'est arrivé sur un NAS réel :
   * Quick Sync compilé, refusé, et rien pour savoir s'il manquait un pilote ou un droit d'accès.
   */
  detail?: string | null;
}

/**
 * Reglages de conversion, modifiables depuis l'interface.
 *
 * L'automatique s'appuie sur des mesures faites sur la machine et suffit au cas courant. Le mode
 * expert n'ajoute pas un passage oblige : il ouvre ce qui n'etait accessible qu'en modifiant un
 * fichier d'environnement par SSH — voir ce que la mesure a trouve, et la contredire avec raison.
 */
export interface ConversionPreferences {
  /** Ouvre les reglages detailles dans l'interface. Sans effet sur la conversion elle-meme. */
  expert: boolean;
  /** `auto`, ou un accelerateur impose. */
  accelerateur: string;
  /** `auto`, ou un chemin de tone mapping impose. */
  toneMapping: string;
  /** `auto`, `h264` ou `hevc`. */
  codecSortie: string;
  /**
   * Plafond de definition impose au serveur : `auto`, ou une hauteur en pixels — `2160`, `1440`,
   * `1080`, `720`.
   *
   * L'appareil annonce deja ce qu'il sait afficher, et le cas courant n'a pas besoin d'autre chose.
   * Ce reglage sert a le contredire : brider volontairement sur un reseau charge, ou au contraire
   * refuser un rabaissement decide par la negociation.
   */
  resolutionMax: string;
  /**
   * Plafond de conversions simultanees : `auto`, ou un entier.
   *
   * `auto` suit ce que le micro-banc mesure sur cette machine — sept conversions 1080p sur un
   * AS5404T avec VA-API, deux avec le seul processeur. Aucune constante ne convenait aux deux.
   */
  conversionsSimultanees: number | "auto";
}

/**
 * Un appareil qui s'annonce pilotable — televiseur, tablette, navigateur.
 *
 * La liste decrit ce qui ecoute **maintenant**. Rien n'en est conserve : un appareil eteint disparait,
 * faute de quoi un televiseur debranche depuis trois semaines figurerait comme cible valide et l'ordre
 * envoye se perdrait sans que rien ne le dise.
 */
export interface AppareilConnecte {
  id: string;
  nom: string;
  /** `tv`, `mobile` ou `web` — ce qui permet de proposer la bonne cible en premier. */
  type: "tv" | "mobile" | "web";
  /** Ce qui est lu en ce moment, ou `null` si l'appareil est au repos. */
  mediaEnCours: string | null;
  /** Horodatage du dernier signe de vie, en millisecondes. */
  vuA: number;
}

/**
 * Un ordre adresse a un appareil.
 *
 * Le controleur ne relaie jamais la video : il depose un ordre, la cible le retire et negocie
 * elle-meme sa lecture avec le serveur.
 */
export type CommandeAppareil =
  | { type: "lire"; mediaId: string; positionSecondes?: number }
  | { type: "pause" }
  | { type: "reprendre" }
  | { type: "naviguer"; positionSecondes: number }
  | { type: "arreter" };

/** Chemin de tone mapping HDR vers SDR soumis au micro-banc. */
export type ToneMappingBackendId = "libplacebo" | "vaapi" | "opencl" | "zscale" | "software";

/**
 * Resultat mesure d'un chemin de tone mapping sur cette machine.
 *
 * Le tone mapping est le filtre le plus couteux de toute la chaine — sur un processeur de NAS il
 * pese davantage que l'encodage lui-meme. Tant qu'il n'etait pas mesure, la regle du projet
 * interdisait de le choisir automatiquement : les chemins materiels restaient derriere un reglage
 * d'administrateur, et l'installation par defaut convertissait donc en logiciel meme sur une machine
 * capable de faire mieux. Mesurer les leve cette interdiction sans l'enfreindre.
 */
export interface ToneMappingProbe {
  id: ToneMappingBackendId;
  label: string;
  /** Le filtre s'execute sur le peripherique, et non sur le processeur. */
  hardware: boolean;
  /** Present dans la compilation FFmpeg. Ne presage pas de son utilisabilite reelle. */
  compiled: boolean;
  /** A reellement converti pendant le micro-banc. */
  usable: boolean;
  framesPerSecond: number | null;
  /** Debit mesure rapporte au chemin logiciel de reference. */
  relativeToSoftware: number | null;
  selected: boolean;
  error: string | null;
  /** Message brut de FFmpeg, conserve tel quel — voir `AcceleratorProbe.detail`. */
  detail?: string | null;
}

export interface CapacityAlert {
  level: "info" | "warning" | "critical";
  message: string;
  action: string;
}

export interface ActiveSessionCost {
  id: string | null;
  mediaId: string;
  mode: PlaybackMode;
  encoder: string | null;
  costUnits: number;
}

/** Tableau « capacité de mon serveur ». Une unité vaut un transcodage 1080p à 25 images/s. */
export interface ServerCapacityReport {
  generatedAt: string;
  calibration: { signature: string; measuredAt: string | null; source: "mesure" | "estimation" };
  architecture: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  loadAverage1: number | null;
  temperatureCelsius: number | null;
  accelerators: AcceleratorProbe[];
  /** Chemins de tone mapping mesures sur cette machine, du plus rapide au plus lent. */
  toneMapping: ToneMappingProbe[];
  selectedEncoder: string | null;
  budgetUnits: number;
  usedUnits: number;
  headroomRatio: number;
  simultaneous: Array<{ label: string; sessions: number }>;
  /** Plafond de conversions réellement appliqué. */
  plafondConversions: number;
  /** Ce que la mesure de cette machine soutient : la valeur à proposer. */
  plafondRecommande: number;
  /** Vrai lorsque le plafond suit la mesure au lieu d'être imposé. */
  plafondAutomatique: boolean;
  scans: { configured: number; effective: number; pausedByPlayback: boolean };
  activeSessions: ActiveSessionCost[];
  alerts: CapacityAlert[];
}

export interface AdmissionDecision {
  accepted: boolean;
  /** La session est acceptée mais plafonnée en définition pour tenir dans le budget. */
  degraded: boolean;
  reason: string;
  costUnits: number;
  budgetUnits: number;
  usedUnits: number;
  maxHeight: number | null;
}

export interface Profile {
  id: string;
  groupId: string;
  name: string;
  avatarColor: string;
  language: MetadataLanguage;
  preferredAudioLanguages?: string[];
  preferredSubtitleLanguages?: string[];
  subtitleMode?: "off" | "forced" | "always";
  audioOutputMode?: "auto" | "copy" | "aac" | "ac3" | "opus";
  audioNormalization?: boolean;
  nightMode?: boolean;
  dynamicRangePriority?: "auto" | "dolbyvision" | "hdr10plus" | "hdr10" | "hlg" | "sdr";
  resumeMode?: "continue" | "ask" | "restart";
  resumeRewindSeconds?: number;
  defaultPlaybackRate?: number;
  autoplayNext?: boolean;
  autoplayLimit?: number;
  /** Un profil enfant ne reçoit que les œuvres classées pour son âge ou sans classification connue. */
  isChild: boolean;
  age: number | null;
  protected: boolean;
}

export interface ProfileGroup {
  id: string;
  name: string;
  createdAt?: string;
}

export const profileGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(32),
}).strict();
export type ProfileGroupInput = z.infer<typeof profileGroupInputSchema>;

const profileInputObjectSchema = z.object({
  /** Facultatif pour les anciens clients : le serveur choisit alors le premier groupe. */
  groupId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(32),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  language: metadataLanguageSchema.default("fr-FR"),
  preferredAudioLanguages: z.array(z.string().trim().min(2).max(12)).max(10).default(["fra", "fre", "fr", "eng", "en"]),
  preferredSubtitleLanguages: z.array(z.string().trim().min(2).max(12)).max(10).default(["fra", "fre", "fr"]),
  subtitleMode: z.enum(["off", "forced", "always"]).default("forced"),
  audioOutputMode: z.enum(["auto", "copy", "aac", "ac3", "opus"]).default("auto"),
  audioNormalization: z.boolean().default(false),
  nightMode: z.boolean().default(false),
  dynamicRangePriority: z.enum(["auto", "dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr"]).default("auto"),
  resumeMode: z.enum(["continue", "ask", "restart"]).default("continue"),
  resumeRewindSeconds: z.number().int().min(0).max(60).default(5),
  defaultPlaybackRate: z.number().min(0.5).max(2).default(1),
  autoplayNext: z.boolean().default(true),
  autoplayLimit: z.number().int().min(1).max(20).default(3),
  isChild: z.boolean().default(false),
  age: z.number().int().min(0).max(17).nullable().default(null),
  pin: z.union([z.string().regex(/^\d{4,8}$/), z.null()]).optional(),
});
export const profileInputSchema = profileInputObjectSchema.superRefine((value, context) => {
  if (value.isChild && value.age == null) context.addIssue({
    code: "custom", path: ["age"], message: "L'âge est requis pour un profil enfant",
  });
});
export const profileUnlockSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/) }).strict();
export type ProfileInput = z.infer<typeof profileInputSchema>;
export const recommendationFeedbackSchema = z.object({ catalogId: z.string().min(1), value: z.enum(["like", "dislike", "dismissed"]) });
export const watchedInputSchema = z.object({ completed: z.boolean() }).strict();

export const profileUpdateSchema = profileInputObjectSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Au moins une propriété doit être modifiée",
);

export interface MediaItem {
  id: string;
  catalogId: string | null;
  playableMediaId: string | null;
  kind: MediaKind;
  title: string;
  sortTitle: string;
  year: number | null;
  addedAt: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /**
   * Date de publication, `AAAA-MM-JJ`, quand la source la donne.
   *
   * Renseignée pour une vidéo web, où elle est à la fois le critère de tri et une information
   * affichée. Absente partout ailleurs tant que rien ne l'y écrit.
   */
  airDate?: string | null;
  runtimeSeconds: number | null;
  /** Âge minimal conseillé par la classification du pays du profil, lorsqu'elle est connue. */
  ageRating?: number | null;
  ratingLabel?: string | null;
  progressPercent: number;
  /** Position exacte du profil. Le pourcentage reste présent pour les anciens clients et l'affichage. */
  progressPositionSeconds?: number;
  /** Durée employée lors du dernier enregistrement, utile pour valider la position exacte. */
  progressDurationSeconds?: number;
  completed: boolean;
  inWatchlist?: boolean;
}

export interface PlaybackNeighbors {
  previous: MediaItem | null;
  next: MediaItem | null;
}

export interface SeasonDetails {
  id: string;
  number: number;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  completed: boolean;
  episodes: MediaItem[];
}

export interface MediaSourceVersion {
  /** Identifiant du fichier réellement lu lorsque cette version est choisie. */
  mediaId: string;
  /** Nom complet du fichier d'origine, extension comprise. */
  name: string;
  /** Résumé lisible de la vidéo : résolution, HDR et codec lorsque disponibles. */
  quality: string | null;
  fileSizeBytes: number | null;
}

export type CatalogPersonRole = "actor" | "director" | "creator" | "writer" | "composer";

/** Une personne créditée sur une œuvre, volontairement limitée aux informations utiles à l'interface. */
export interface CatalogPerson {
  id: string;
  name: string;
  profileUrl: string | null;
  role: CatalogPersonRole;
  character: string | null;
  job: string | null;
  order: number;
}

/** La filmographie ne contient que les titres réellement présents dans la bibliothèque FlixTunes. */
export interface PersonDetails {
  person: Pick<CatalogPerson, "id" | "name" | "profileUrl">;
  items: Array<MediaItem & { seasonCount?: number }>;
  roles: Array<{ catalogId: string; role: CatalogPersonRole; character: string | null; job: string | null }>;
}

export interface CatalogCollectionDetails {
  id: string;
  name: string;
  items: MediaItem[];
}

export interface MediaDetails {
  /**
   * `libraryId` permet d'ouvrir la correction de correspondance depuis la fiche, c'est-à-dire depuis
   * l'écran où l'erreur d'identification se constate, sans passer par la gestion des bibliothèques.
   */
  item: MediaItem & { seasonCount?: number; libraryId?: string | null };
  /**
   * Nom de la source telle qu'elle existe réellement sur le stockage.
   *
   * Un film expose son fichier complet avec extension. Une série expose son dossier racine, jamais
   * son dossier `Season 01`/`Saison 1`. Le chemin absolu reste volontairement côté serveur : son
   * affichage divulguerait l'organisation du NAS sans aider à diagnostiquer la correspondance.
   */
  source?: { kind: "file" | "folder"; name: string } | null;
  /** Toutes les versions physiques d'un même film ; une seule fiche reste affichée au catalogue. */
  versions?: MediaSourceVersion[];
  /** Qualités réellement observées dans les fichiers du film ou des épisodes de la série. */
  qualities?: string[];
  /** Casting et équipe principale, chargés uniquement avec la fiche détaillée. */
  people?: CatalogPerson[];
  /** Genres de la fiche, exploitables comme raccourcis de navigation. */
  genres?: string[];
  /** Saga locale, si d'autres films de cette collection existent dans la bibliothèque. */
  collection?: CatalogCollectionDetails | null;
  seasons: SeasonDetails[];
  related: MediaItem[];
}

/**
 * Un fichier qu'une analyse n'a pas importé, et la raison.
 *
 * `unstable` : le fichier était encore en cours d'écriture, il sera repris tout seul.
 * `error` : l'import a échoué ; `attempts` distingue l'incident isolé du problème persistant.
 */
export interface SkippedFile {
  filePath: string;
  reason: "unstable" | "error";
  detail: string | null;
  attempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type CatalogSort = "title" | "release" | "added";
export type CatalogFilter = "all" | "progress" | "watched" | "unwatched";

export interface CatalogQuery {
  kind: "movies" | "shows" | "web";
  sort?: CatalogSort;
  filter?: CatalogFilter;
  query?: string;
  /**
   * Bornes d'année de sortie, incluses.
   *
   * Elles se combinent avec l'état et la recherche : les trois critères s'appliquent ensemble, en
   * SQL, avant le découpage en pages. Les appliquer sur les seules fiches déjà chargées donnerait un
   * décompte faux dès la deuxième page.
   *
   * Une fiche sans année n'est retenue par aucune borne : on ne sait pas si elle y appartient, et
   * l'inclure au hasard tromperait autant que l'exclure — sauf qu'ici l'exclusion est visible, donc
   * corrigible par la personne.
   */
  minYear?: number;
  maxYear?: number;
  /**
   * Genres exigés. Une fiche doit porter **tous** ceux qui sont demandés.
   *
   * L'intersection plutôt que l'union : demander « Action » et « Comédie » cherche une comédie
   * d'action, pas l'ensemble des deux rayons. C'est le sens qu'on donne spontanément à deux cases
   * cochées ensemble, et c'est celui qui rétrécit le résultat au lieu de l'élargir.
   *
   * Les genres viennent de TMDB et n'apparaissent qu'après une analyse des métadonnées.
   */
  genres?: string[];
  /** Positionne la page sur la première initiale demandée sans filtrer le catalogue. */
  letter?: string;
  offset?: number;
  limit?: number;
}

/**
 * Une tranche de catalogue. `total` compte les fiches correspondant au tri et au filtre demandés, pas
 * la page renvoyée : les clients en tirent le nombre de titres affiché et savent s'il reste à charger.
 */
export interface CatalogPage {
  items: Array<MediaItem & { seasonCount?: number }>;
  total: number;
  offset: number;
  limit: number;
  /**
   * Rang absolu de la jaquette visée par `letter`.
   *
   * La page peut commencer avant elle afin que la grille reste parcourable dans les deux sens ; les
   * clients positionnent donc l'écran sur cette ancre au lieu de supposer que la cible est en tête.
   */
  anchor?: number;
  /**
   * Genres présents dans ce catalogue, triés par nom.
   *
   * Calculés sur le catalogue entier et non sur la page affichée : proposer les seuls genres visibles
   * ferait disparaître un choix dès qu'on tourne la page.
   */
  availableGenres?: string[];
}

export interface HomeResponse {
  profile: Profile;
  featured: MediaItem | null;
  continueWatching: MediaItem[];
  recentlyAdded: MediaItem[];
  /** Première page seulement. Le catalogue complet se demande par `/api/catalog`. */
  movies: MediaItem[];
  shows: Array<MediaItem & { seasonCount: number }>;
  /** Nombre total de fiches disponibles, toutes pages confondues. */
  movieTotal: number;
  showTotal: number;
  completed: MediaItem[];
  watchedRecently: MediaItem[];
  watchlist?: Array<MediaItem & { seasonCount?: number }>;
  recommendations?: Array<{ item: MediaItem & { seasonCount?: number }; score: number; reason: string }>;
}

/* ------------------------------------------------------------------------ */
/* La télévision en direct                                                   */
/* ------------------------------------------------------------------------ */

/**
 * La fiabilité d'une liste : la part de ses chaînes qui répondent, **mesurée** par le script qui
 * produit `m3u.json` et rangée dans une pastille en tête du nom.
 *
 * `bonne` = 75 % et plus (✅), `moyenne` = 50 à 74 % (〰️), `faible` = 25 à 49 % (❌), `douteuse` = une
 * pastille ⚠️ d'une version antérieure du script. En dessous de 25 %, la liste n'est pas écrite dans
 * le fichier. Un ❌ n'est donc **pas** une liste morte : c'est une liste sur trois chaînes utiles.
 */
export type ClassementListe = "bonne" | "moyenne" | "douteuse" | "faible" | "inconnue";

export interface ParametresDirect {
  /** Éteinte tant que personne ne l'a demandée : rien ne tourne, pas même au démarrage. */
  actif: boolean;
  /** Dossier du serveur où vit le catalogue de listes. `null` : rien n'est réglé. */
  dossier: string | null;
  /** Nom du fichier dans ce dossier — `m3u.json` par défaut. */
  fichier: string;
  cadenceHeures: number;
}

export interface EtatDirect {
  actif: boolean;
  /** Une source est-elle réglée ? Tant que non, l'entrée de menu n'existe pas côté client. */
  configure: boolean;
  enCours: boolean;
  listes: number;
  listesRetenues: number;
  chaines: number;
  adresses: number;
  /** Entrées lues moins chaînes obtenues : ce que la fusion des doublons a réuni. */
  fusionnees: number;
  /** Entrées écartées faute d'un transport que nos lecteurs sachent ouvrir. */
  ecartees: number;
  rafraichieLe: string | null;
  dernierMessage: string | null;
  progression: { faites: number; total: number; liste: string | null; entrees: number } | null;
  dureeSecondes: number | null;
}

/** Une source de chaînes : le fichier du NAS, un portail identifié, ou les listes publiques. */
export interface SourceDirect {
  id: string;
  type: "m3u" | "xtream" | "fast";
  libelle: string;
  emplacement: string;
  activee: boolean;
  rafraichieLe: string | null;
  dernierMessage: string | null;
}

export interface ListeDirect {
  id: string;
  nom: string;
  url: string;
  classement: ClassementListe;
  cochee: boolean;
  entrees: number;
  ecartees: number;
  rafraichieLe: string | null;
  dernierMessage: string | null;
}

export interface ChaineDirect {
  id: string;
  nom: string;
  numero: number | null;
  logo: string | null;
  groupe: string | null;
  /** Code à deux lettres, déduit du `tvg-id`, d'un drapeau ou de l'intitulé. `null` si rien ne le dit. */
  pays: string | null;
  etat: "bonne" | "morte" | "inconnue";
  /** Nombre d'adresses connues : c'est la profondeur du repli, et elle se voit à l'écran. */
  adresses: number;
  /** Retenue par ce profil. Vingt chaînes sur 76 823 : c'est le vrai usage d'une grille pareille. */
  favori?: boolean;
}

/**
 * Une adresse d'une chaîne, avec ce que la lecture en a appris.
 *
 * Le compteur d'échecs et celui de réussites ne servent pas à établir des statistiques : ils
 * **ordonnent** les essais. Ce qui a joué passe devant, ce qui a échoué passe derrière, et le repli
 * cesse d'être un tirage au sort.
 */
export interface SourceChaine {
  url: string;
  succes: number;
  echecs: number;
  /**
   * La hauteur de la meilleure variante déclarée par le manifeste, en pixels.
   *
   * `null` quand l'adresse n'a pas encore été sondée, ou quand elle ne déclare pas de variantes. Elle
   * sert à choisir entre deux sources vivantes : c'est le seul écart que le repli ne sait pas voir.
   */
  hauteur?: number | null;
  /** Le débit de cette variante, en bits par seconde. */
  debit?: number | null;
  /**
   * Ce qui distingue deux adresses **pour l'œil** : l'hôte et le chemin, sans la requête.
   *
   * Deux adresses qui ne diffèrent que par un jeton sont la même à l'écran, et le menu en listait
   * quatre identiques. C'est une empreinte d'affichage, pas d'équivalence : le repli continue de
   * parcourir chaque adresse, parce que deux jetons ne se valent pas.
   */
  empreinte?: string;
  /**
   * La même adresse, mais relayée par le serveur.
   *
   * Elle n'est pas le chemin normal : un navigateur essaie l'adresse directe d'abord, et n'y revient
   * que sur un refus qu'il ne peut pas lever lui-même — absence d'en-tête CORS, ou contenu `http` nu
   * dans une page servie en HTTPS. Android et le client de bureau ne s'en servent jamais.
   */
  relais?: string;
}

/** Une chaîne avec ses adresses, dans l'ordre où il faut les essayer. */
export interface ChaineDirectDetaillee extends ChaineDirect {
  sources: SourceChaine[];
}

export interface PageChaines {
  items: ChaineDirect[];
  total: number;
  offset: number;
  limit: number;
}

export const parametresDirectSchema = z.object({
  actif: z.boolean().optional(),
  dossier: z.string().trim().max(4096).nullable().optional(),
  fichier: z.string().trim().min(1).max(255).optional(),
  cadenceHeures: z.number().int().min(1).max(168).optional(),
}).strict();
export type ParametresDirectInput = z.infer<typeof parametresDirectSchema>;

// La géométrie des planches de vignettes, partagée par le serveur et l'interface.
export * from "./vignettes.js";
