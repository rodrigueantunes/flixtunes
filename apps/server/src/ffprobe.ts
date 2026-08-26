import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MasteringDisplayMetadata, MediaStream, VideoColorMetadata } from "@flixtunes/contracts";
import { cleanTitle, type ParsedMedia } from "./media-parser.js";
import { config } from "./config.js";
import { scoreSuite } from "./sequel-match.js";

const execFileAsync = promisify(execFile);

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  level?: number;
  bit_rate?: string;
  bits_per_raw_sample?: string;
  r_frame_rate?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  color_space?: string;
  color_range?: string;
  field_order?: string;
  display_aspect_ratio?: string;
  closed_captions?: number;
  color_transfer?: string;
  color_primaries?: string;
  chroma_location?: string;
  pix_fmt?: string;
  disposition?: { default?: number; forced?: number; commentary?: number; hearing_impaired?: number; visual_impaired?: number };
  side_data_list?: Array<Record<string, unknown>>;
  tags?: Record<string, string>;
  /** Enrichissement FlixTunes persisté avec le JSON FFprobe brut après le sondage d'une image. */
  flixtunes_available_hdr_formats?: MediaStream["availableHdrFormats"];
}

export interface EmbeddedMetadata {
  durationSeconds: number | null;
  title: string | null;
  year: number | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  externalIds?: { tmdb?: string; imdb?: string; tvdb?: string };
  audioLanguages: string[];
  subtitleLanguages: string[];
  streams: MediaStream[];
  formatLongName?: string | null;
  fileSize?: number | null;
  overallBitRate?: number | null;
  chapters?: Array<{ index: number; startSeconds: number; endSeconds: number | null; title: string | null }>;
  raw: unknown;
}

function tag(tags: Record<string, string> | undefined, ...names: string[]): string | null {
  if (!tags) return null;
  const entry = Object.entries(tags).find(([key]) => names.some((name) => key.toLowerCase() === name));
  return entry?.[1]?.trim() || null;
}

function validNumber(value: string | null, minimum = 0): number | null {
  if (!value) return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= minimum ? number : null;
}

/** FFprobe exprime les métadonnées de mastering en rationnels textuels (« 34000/50000 »). */
export function parseProbeRational(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/");
  const top = Number(numerator);
  const bottom = denominator === undefined ? 1 : Number(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0 ? top / bottom : null;
}

function sideDataOfType(list: Array<Record<string, unknown>> | undefined, pattern: RegExp): Record<string, unknown> | null {
  return list?.find((item) => pattern.test(String(item.side_data_type ?? ""))) ?? null;
}

export function parseMasteringDisplay(entry: Record<string, unknown> | null): MasteringDisplayMetadata | null {
  if (!entry) return null;
  const values = {
    redX: parseProbeRational(entry.red_x), redY: parseProbeRational(entry.red_y),
    greenX: parseProbeRational(entry.green_x), greenY: parseProbeRational(entry.green_y),
    blueX: parseProbeRational(entry.blue_x), blueY: parseProbeRational(entry.blue_y),
    whitePointX: parseProbeRational(entry.white_point_x), whitePointY: parseProbeRational(entry.white_point_y),
    minLuminanceNits: parseProbeRational(entry.min_luminance), maxLuminanceNits: parseProbeRational(entry.max_luminance),
  };
  return Object.values(values).every((value) => value != null) ? values as MasteringDisplayMetadata : null;
}

export function chromaSubsamplingFromPixelFormat(pixelFormat: string | null | undefined): VideoColorMetadata["chromaSubsampling"] {
  if (!pixelFormat) return null;
  if (/^(?:gray|ya)/.test(pixelFormat)) return "4:0:0";
  if (/444/.test(pixelFormat) || /^(?:gbr|rgb|bgr|argb|rgba|abgr|bgra)/.test(pixelFormat)) return "4:4:4";
  if (/422/.test(pixelFormat) || /^(?:nv16|nv20|yuyv|uyvy)/.test(pixelFormat)) return "4:2:2";
  if (/4(?:20|11|10)/.test(pixelFormat) || /^(?:nv12|nv21|p010|p016)/.test(pixelFormat)) return "4:2:0";
  return null;
}

/** Rassemble primaires, matrice, plage, profondeur, mastering, MaxCLL/MaxFALL, rotation et entrelacement. */
export function parseVideoColor(stream: ProbeStream, bitDepth: number | null): VideoColorMetadata {
  const sideData = stream.side_data_list;
  const dolbyVision = sideDataOfType(sideData, /DOVI configuration/i);
  const rotation = sideDataOfType(sideData, /Display Matrix/i)?.rotation;
  const parsedRotation = typeof rotation === "number" ? rotation : Number(rotation);
  const fieldOrder = stream.field_order ?? null;
  const range = stream.color_range === "pc" || stream.color_range === "full" ? "pc"
    : stream.color_range === "tv" || stream.color_range === "limited" ? "tv" : null;
  const flag = (value: unknown) => value === 1 || value === true;
  const integer = (value: unknown) => (Number.isInteger(Number(value)) ? Number(value) : null);
  return {
    colorSpace: stream.color_space ?? null,
    colorPrimaries: stream.color_primaries ?? null,
    colorTransfer: stream.color_transfer ?? null,
    colorRange: range,
    chromaLocation: stream.chroma_location ?? null,
    chromaSubsampling: chromaSubsamplingFromPixelFormat(stream.pix_fmt),
    bitDepth,
    masteringDisplay: parseMasteringDisplay(sideDataOfType(sideData, /Mastering display/i)),
    maxContentLightLevel: integer(sideDataOfType(sideData, /Content light level/i)?.max_content),
    maxFrameAverageLightLevel: integer(sideDataOfType(sideData, /Content light level/i)?.max_average),
    rotationDegrees: Number.isFinite(parsedRotation) ? ((Math.round(parsedRotation) % 360) + 360) % 360 : 0,
    interlaced: Boolean(fieldOrder && !["progressive", "unknown"].includes(fieldOrder)),
    fieldOrder,
    dolbyVisionProfile: integer(dolbyVision?.dv_profile),
    dolbyVisionLevel: integer(dolbyVision?.dv_level),
    dolbyVisionRpuPresent: flag(dolbyVision?.rpu_present_flag),
    dolbyVisionElPresent: flag(dolbyVision?.el_present_flag),
    dolbyVisionBlPresent: flag(dolbyVision?.bl_present_flag),
    dolbyVisionBlCompatibilityId: integer(dolbyVision?.dv_bl_signal_compatibility_id),
  };
}

export function parseProbeOutput(payload: unknown): EmbeddedMetadata {
  const data = payload as { format?: { duration?: string; format_long_name?: string; size?: string; bit_rate?: string; tags?: Record<string, string> };
    streams?: ProbeStream[]; chapters?: Array<{ id?: number; start_time?: string; end_time?: string; tags?: Record<string, string> }> };
  const formatTags = data.format?.tags;
  const streams = data.streams ?? [];
  const languages = (type: string) => [
    ...new Set(
      streams
        .filter((stream) => stream.codec_type === type)
        .map((stream) => tag(stream.tags, "language"))
        .filter((language): language is string => Boolean(language)),
    ),
  ];
  const date = tag(formatTags, "date", "year");
  const containerTitle = tag(formatTags, "title");
  // Windows et plusieurs muxers rangent l'année dans Title au lieu de Date/Year. Seule une année
  // explicitement encadrée est retenue : `2001: L'Odyssée de l'espace` ne doit jamais devenir 2001.
  const titleYear = containerTitle?.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)?.[1]
    // Certains muxers recopient le nom de release dans Title : `… 2021 FRENCH`. L'année est alors
    // sûre parce qu'elle précède immédiatement une balise technique finale. Une année seule reste
    // volontairement ignorée afin de ne jamais transformer les titres `1917` ou `2001` en dates.
    ?? containerTitle?.match(/\b((?:19|20)\d{2})\s+(?:french|truefrench|multi|vostfr|vff|vfq)\s*$/i)?.[1]
    ?? null;
  const externalIds: NonNullable<EmbeddedMetadata["externalIds"]> = {};
  const tmdb = tag(formatTags, "tmdb", "tmdbid", "tmdb_id");
  const imdb = tag(formatTags, "imdb", "imdbid", "imdb_id");
  const tvdb = tag(formatTags, "tvdb", "tvdbid", "tvdb_id");
  if (tmdb?.match(/^\d+$/)) externalIds.tmdb = tmdb;
  if (imdb?.match(/^tt\d+$/i)) externalIds.imdb = imdb;
  if (tvdb?.match(/^\d+$/)) externalIds.tvdb = tvdb;
  const parsedStreams = streams.flatMap((stream): MediaStream[] => {
    if (stream.codec_type !== "video" && stream.codec_type !== "audio" && stream.codec_type !== "subtitle") return [];
    const codec = stream.codec_name || "unknown";
    const technicalText = JSON.stringify({
      profile: stream.profile, codecTag: stream.codec_tag_string, sideData: stream.side_data_list, tags: stream.tags,
    });
    const dolbyVision = /DOVI configuration record|Dolby Vision|\b(?:dvhe|dvh1)\b/i.test(technicalText);
    const hdr10Plus = /HDR Dynamic Metadata SMPTE2094-40|HDR10\+/i.test(technicalText);
    const hlg = /arib-std-b67/i.test(stream.color_transfer ?? "");
    const hdr10 = /smpte2084/i.test(stream.color_transfer ?? "") && /bt2020/i.test(stream.color_primaries ?? technicalText);
    const hdrFormat: MediaStream["hdrFormat"] = dolbyVision ? "dolbyvision" : hdr10Plus ? "hdr10plus" : hlg ? "hlg" : hdr10 ? "hdr10" : "sdr";
    const availableHdrFormats = stream.codec_type === "video" ? [...new Set([
      ...(stream.flixtunes_available_hdr_formats ?? []),
      ...(dolbyVision ? ["dolbyvision" as const] : []),
      ...(hdr10Plus ? ["hdr10plus" as const] : []),
      ...(hlg ? ["hlg" as const] : []),
      ...(hdr10 && !hdr10Plus ? ["hdr10" as const] : []),
    ])] : undefined;
    const bitDepth = stream.bits_per_raw_sample ? Number(stream.bits_per_raw_sample) || null
      : stream.pix_fmt?.match(/(?:p|gbrp)(10|12|16)(?:le|be)?$/i)?.[1] ? Number(stream.pix_fmt.match(/(?:p|gbrp)(10|12|16)(?:le|be)?$/i)?.[1]) : null;
    const color = stream.codec_type === "video" ? parseVideoColor(stream, bitDepth) : null;
    const dolbyAtmos = stream.codec_type === "audio" && (/Dolby Atmos|\bAtmos\b|\bJOC\b/i.test(technicalText)
      || (codec === "truehd" && /atmos/i.test(stream.tags?.title ?? "")));
    const dtsX = stream.codec_type === "audio" && (/DTS[: -]?X/i.test(technicalText) || (codec === "dts" && /dts[ ._-]*x/i.test(stream.tags?.title ?? "")));
    const auro3d = stream.codec_type === "audio" && /Auro[- ]?3D/i.test(technicalText);
    const audioTechnology: MediaStream["audioTechnology"] = dolbyAtmos ? "dolby-atmos" : dtsX ? "dts-x" : auro3d ? "auro-3d" : "standard";
    const losslessAudio = stream.codec_type === "audio" && (
      ["truehd", "flac", "alac", "wavpack", "pcm_s16le", "pcm_s24le", "pcm_s32le"].includes(codec)
      || /DTS-HD MA|DTS-HD Master Audio|lossless/i.test(stream.profile ?? technicalText)
    );
    const frameRateParts = stream.r_frame_rate?.split("/").map(Number) ?? [];
    const frameRate = frameRateParts.length === 2 && frameRateParts[1] ? frameRateParts[0]! / frameRateParts[1]! : null;
    const streamTitle = tag(stream.tags, "title");
    const commentary = stream.codec_type === "audio" && (stream.disposition?.commentary === 1 || /comment(?:ary|aire)/i.test(streamTitle ?? ""));
    const audioDescription = stream.codec_type === "audio" && (stream.disposition?.visual_impaired === 1
      || /audio.?description|audiodescription|descriptive/i.test(streamTitle ?? ""));
    const audioRole: MediaStream["audioRole"] = stream.codec_type !== "audio" ? undefined : commentary ? "commentary"
      : audioDescription ? "audio-description" : /(?:^|\b)(?:vo|vost|original(?:e)?)(?:\b|$)/i.test(streamTitle ?? "") ? "original"
        : /(?:dub(?:bed)?|doubl(?:age|é|ee)|\bvf\b)/i.test(streamTitle ?? "") ? "dub" : "main";
    return [{
      index: stream.index ?? 0,
      type: stream.codec_type,
      codec,
      title: streamTitle,
      language: tag(stream.tags, "language"),
      channels: stream.channels ?? null,
      width: stream.width ?? null,
      height: stream.height ?? null,
      hdr: hdrFormat !== "sdr",
      hdrFormat,
      availableHdrFormats,
      dolbyVisionProfile: color?.dolbyVisionProfile ?? null,
      dolbyAtmos,
      audioTechnology,
      losslessAudio,
      profile: stream.profile ?? null,
      level: stream.level ?? null,
      bitRate: stream.bit_rate ? Number(stream.bit_rate) || null : null,
      bitDepth,
      frameRate,
      pixelFormat: stream.pix_fmt ?? null,
      channelLayout: stream.channel_layout ?? null,
      isDefault: stream.disposition?.default === 1,
      isForced: stream.disposition?.forced === 1,
      canExtractAsWebVtt: stream.codec_type === "subtitle" && ["subrip", "srt", "ass", "ssa", "webvtt", "mov_text"].includes(codec),
      codecLongName: stream.codec_long_name ?? null,
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) || null : null,
      colorSpace: stream.color_space ?? null,
      colorRange: stream.color_range ?? null,
      fieldOrder: stream.field_order ?? null,
      aspectRatio: stream.display_aspect_ratio ?? null,
      commentary,
      hearingImpaired: stream.disposition?.hearing_impaired === 1,
      visualImpaired: audioDescription || stream.disposition?.visual_impaired === 1,
      closedCaptions: stream.codec_type === "video" && stream.closed_captions === 1,
      audioRole,
      color,
    }];
  });
  return {
    durationSeconds: data.format?.duration ? Math.round(Number(data.format.duration)) : null,
    title: containerTitle,
    year: date?.match(/(?:19|20)\d{2}/)?.[0] ? Number(date.match(/(?:19|20)\d{2}/)?.[0])
      : titleYear ? Number(titleYear) : null,
    showTitle: tag(formatTags, "show", "series", "album"),
    seasonNumber: validNumber(tag(formatTags, "season_number", "season"), 0),
    episodeNumber: validNumber(tag(formatTags, "episode_sort", "episode_id", "episode"), 0),
    externalIds,
    audioLanguages: languages("audio"),
    subtitleLanguages: languages("subtitle"),
    streams: parsedStreams,
    formatLongName: data.format?.format_long_name ?? null,
    fileSize: data.format?.size ? Number(data.format.size) || null : null,
    overallBitRate: data.format?.bit_rate ? Number(data.format.bit_rate) || null : null,
    chapters: (data.chapters ?? []).map((chapter, index) => ({ index: chapter.id ?? index,
      startSeconds: Number(chapter.start_time ?? 0) || 0, endSeconds: chapter.end_time ? Number(chapter.end_time) || null : null,
      title: tag(chapter.tags, "title") })),
    raw: data,
  };
}

export function mergeEmbeddedMetadata(parsed: ParsedMedia, embedded: EmbeddedMetadata | null): ParsedMedia {
  if (!embedded) return parsed;
  const ids = { ...(parsed.externalIds ?? {}), ...(embedded.externalIds ?? {}) };
  const explicitId = Object.keys(embedded.externalIds ?? {}).length > 0;
  const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Pour établir une identité, une frontière de mot typographique ne doit pas créer un conflit :
  // `SpiderMan` et `Spider-Man` désignent le même titre. La forme espacée reste utilisée comme alias
  // lisible ; seule cette comparaison compacte ignore espaces, tirets et apostrophes.
  const compact = (value: string) => normalize(value).replace(/\s+/g, "");
  const usefulTitle = (value: string | null) => value && !/^(?:unknown|inconnu|video|movie|film|title|output|sample|encode)$/i.test(value.trim());
  const evidence = [...(parsed.detection?.evidence ?? [])];
  if (usefulTitle(embedded.title)) evidence.push(`titre lu dans le conteneur : ${embedded.title}`);
  if (embedded.year) evidence.push(`année lue dans le conteneur : ${embedded.year}`);
  for (const [provider, id] of Object.entries(embedded.externalIds ?? {})) evidence.push(`identifiant ${provider.toUpperCase()} lu dans le conteneur : ${id}`);
  if (parsed.kind === "movie" && usefulTitle(embedded.showTitle)
    && embedded.seasonNumber != null && embedded.episodeNumber != null) {
    // Un fichier TV opaque (`video_001.mkv`) est parfois impossible à classer par son chemin, alors
    // que le conteneur porte l'identité complète. Plex exploite précisément cette information.
    return mergeEmbeddedMetadata({ ...parsed, kind: "episode", showTitle: embedded.showTitle,
      seasonNumber: embedded.seasonNumber, episodeNumber: embedded.episodeNumber,
      episodeNumbers: [embedded.episodeNumber] }, embedded);
  }
  if (parsed.kind === "movie") {
    // Des anciennes analyses peuvent avoir conservé `year: null` alors que le tag brut porte bien
    // `… 2021 FRENCH`. On refait ici cette extraction très bornée : la fusion reste correcte même
    // lorsque le cache provient d'une génération antérieure de l'agent.
    const embeddedSuffixYear = embedded.title?.match(/\b((?:19|20)\d{2})\s+(?:french|truefrench|multi|vostfr|vff|vfq)\s*$/i)?.[1];
    const embeddedYear = embedded.year ?? (embeddedSuffixYear ? Number(embeddedSuffixYear) : null);
    const embeddedTitle = usefulTitle(embedded.title)
      ? cleanTitle(embedded.title!
        .replace(/[\[(]\s*(?:19|20)\d{2}\s*[\])]/g, " ")
        // Même nettoyage borné que l'extraction ci-dessus. Il s'applique seulement en fin de tag :
        // des titres légitimes tels que `French Kiss` ou `The French Dispatch` restent intacts.
        .replace(/\s+(?:19|20)\d{2}\s+(?:french|truefrench|multi|vostfr|vff|vfq)\s*$/i, " ")) : null;
    const filenameOpaque = compact(parsed.title).length < 3 || /^(?:unknown|inconnu|video|movie|film|title|output|sample|encode)\d*$/i.test(compact(parsed.title));
    const replaceWeakFilename = Boolean(embeddedTitle && parsed.detection?.decision !== "auto"
      && (explicitId || embeddedYear != null || filenameOpaque));
    const titlesCompatible = Boolean(embeddedTitle && (compact(embeddedTitle).includes(compact(parsed.title))
      || compact(parsed.title).includes(compact(embeddedTitle))
      || scoreSuite(parsed.title, { title: embeddedTitle, year: embeddedYear }, parsed.year) != null));
    const conflict = Boolean(embeddedTitle && parsed.detection?.decision === "auto"
      && !titlesCompatible && embeddedYear);
    const corroborated = titlesCompatible;
    const year = parsed.year ?? embeddedYear;
    const promoted = explicitId || (replaceWeakFilename && Boolean(year));
    const titleAliases = embeddedTitle && normalize(embeddedTitle) !== normalize(parsed.title)
      ? [...new Set([...(parsed.titleAliases ?? []), replaceWeakFilename ? parsed.title : embeddedTitle])]
      : parsed.titleAliases;
    return {
      ...parsed,
      // Un titre explicite et sûr dans le nom reste prioritaire. Pour un nom vague ou refusé, le tag
      // embarqué est en revanche la seule preuve explicite ; l'ancien ordre ne pouvait jamais
      // l'atteindre puisque l'analyseur fournit toujours une chaîne non vide.
      title: replaceWeakFilename ? embeddedTitle! : parsed.title,
      titleAliases,
      year,
      externalIds: ids,
      detection: promoted ? {
        confidence: explicitId ? 1 : 0.94, pattern: year ? "movie-year" : "movie-name", warnings: [],
        rule: parsed.detection?.rule, decision: "auto", evidence, alternatives: parsed.detection?.alternatives,
      } : conflict ? {
        ...(parsed.detection ?? { confidence: 0.7, pattern: "movie-name" as const, warnings: [] }),
        decision: "revue", warnings: ["Le titre intégré contredit le nom du fichier."], evidence,
      } : corroborated && parsed.detection ? { ...parsed.detection, evidence } : parsed.detection,
    };
  }
  const embeddedShow = usefulTitle(embedded.showTitle) ? embedded.showTitle : null;
  const embeddedEpisode = usefulTitle(embedded.title) ? embedded.title : null;
  const promoted = explicitId || Boolean(embeddedShow && (parsed.seasonNumber ?? embedded.seasonNumber) != null
    && (parsed.episodeNumber ?? embedded.episodeNumber) != null);
  return {
    ...parsed,
    title: embeddedEpisode || parsed.title,
    showTitle: embeddedShow || parsed.showTitle,
    seasonNumber: parsed.seasonNumber ?? embedded.seasonNumber,
    episodeNumber: parsed.episodeNumber ?? embedded.episodeNumber,
    episodeNumbers: parsed.episodeNumbers?.length ? parsed.episodeNumbers
      : embedded.episodeNumber == null ? parsed.episodeNumbers : [embedded.episodeNumber],
    externalIds: ids,
    detection: promoted ? {
      confidence: explicitId ? 1 : 0.96, pattern: "sxe", warnings: [], rule: parsed.detection?.rule,
      decision: "auto", evidence, alternatives: parsed.detection?.alternatives,
    } : parsed.detection,
  };
}

/**
 * Les métadonnées HDR statiques et dynamiques d'un flux HEVC/AV1 sont portées par des SEI :
 * elles n'apparaissent qu'après le décodage d'une image. Le sondage est donc borné à une seule
 * image et n'est déclenché que pour un transfert PQ ou HLG.
 */
const hdrFrameMetadataCache = new Map<string, Promise<Array<Record<string, unknown>>>>();

async function probeHdrFrameMetadataUncached(filePath: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { stdout } = await execFileAsync(
      config.ffprobePath,
      ["-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
        "-show_entries", "frame_side_data=side_data_type,red_x,red_y,green_x,green_y,blue_x,blue_y,white_point_x,white_point_y,min_luminance,max_luminance,max_content,max_average",
        "-of", "json", filePath],
      { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as { frames?: Array<{ side_data_list?: Array<Record<string, unknown>> }> };
    return payload.frames?.flatMap((frame) => frame.side_data_list ?? []) ?? [];
  } catch {
    return [];
  }
}

function probeHdrFrameMetadata(filePath: string): Promise<Array<Record<string, unknown>>> {
  const cached = hdrFrameMetadataCache.get(filePath);
  if (cached) return cached;
  const pending = probeHdrFrameMetadataUncached(filePath);
  hdrFrameMetadataCache.set(filePath, pending);
  return pending;
}

export function applyHdrFrameMetadata(metadata: EmbeddedMetadata, frameSideData: Array<Record<string, unknown>>): EmbeddedMetadata {
  if (!frameSideData.length) return metadata;
  const mastering = parseMasteringDisplay(sideDataOfType(frameSideData, /Mastering display/i));
  const lightLevel = sideDataOfType(frameSideData, /Content light level/i);
  const dynamic = frameSideData.some((item) => /SMPTE2094-40|HDR10\+|Dynamic HDR10\+/i.test(String(item.side_data_type ?? "")));
  const integer = (value: unknown) => (Number.isInteger(Number(value)) ? Number(value) : null);
  const streams = metadata.streams.map((stream) => {
    if (stream.type !== "video" || !stream.color) return stream;
    const color: VideoColorMetadata = {
      ...stream.color,
      masteringDisplay: stream.color.masteringDisplay ?? mastering,
      maxContentLightLevel: stream.color.maxContentLightLevel ?? integer(lightLevel?.max_content),
      maxFrameAverageLightLevel: stream.color.maxFrameAverageLightLevel ?? integer(lightLevel?.max_average),
    };
    const hdrFormat: MediaStream["hdrFormat"] = dynamic && stream.hdrFormat === "hdr10" ? "hdr10plus" : stream.hdrFormat;
    const availableHdrFormats = [...new Set([
      ...(stream.availableHdrFormats ?? (stream.hdrFormat === "sdr" ? [] : [stream.hdrFormat])),
      ...(dynamic ? ["hdr10plus" as const] : []),
    ])];
    return { ...stream, color, hdrFormat, hdr: hdrFormat !== "sdr", availableHdrFormats };
  });
  // Le scanner conserve `raw`, pas `streams`. Cette annotation additive évite de sonder à nouveau
  // chaque image après un redémarrage du serveur et reste ignorée par FFprobe et les anciennes apps.
  const rawSource = metadata.raw as { streams?: ProbeStream[] };
  const videoFormats = streams.find((stream) => stream.type === "video")?.availableHdrFormats;
  const raw = rawSource?.streams && videoFormats ? {
    ...rawSource,
    streams: rawSource.streams.map((stream) => stream.codec_type === "video"
      ? { ...stream, flixtunes_available_hdr_formats: videoFormats } : stream),
  } : metadata.raw;
  return {
    ...metadata,
    streams,
    raw,
  };
}

/** Complète à coût borné les formats compagnons qui n'existent que dans les métadonnées d'image. */
export async function enrichHdrFrameMetadata(metadata: EmbeddedMetadata, filePath: string): Promise<EmbeddedMetadata> {
  const video = metadata.streams.find((stream) => stream.type === "video");
  // HLG n'a pas besoin de ce sondage. Dolby Vision, lui, peut partager son flux avec HDR10+ : il
  // faut lire une image même lorsque mastering et MaxCLL sont déjà présents.
  const needsFrameProbe = Boolean(video?.color && /smpte2084/i.test(video.color.colorTransfer ?? "")
    && (video.hdrFormat === "dolbyvision" || !video.color.masteringDisplay || video.color.maxContentLightLevel == null));
  return needsFrameProbe ? applyHdrFrameMetadata(metadata, await probeHdrFrameMetadata(filePath)) : metadata;
}

export async function probeMedia(filePath: string): Promise<EmbeddedMetadata | null> {
  try {
    const { stdout } = await execFileAsync(
      config.ffprobePath,
      [
        "-v", "error",
        "-show_entries", "format=duration,format_name,format_long_name,size,bit_rate:format_tags=title,year,date,show,series,season_number,episode_sort,episode_id:stream=index,codec_type,codec_name,codec_long_name,profile,level,codec_tag_string,width,height,channels,channel_layout,sample_rate,bit_rate,bits_per_raw_sample,r_frame_rate,color_transfer,color_primaries,color_space,color_range,chroma_location,pix_fmt,field_order,display_aspect_ratio:stream_disposition=default,forced,commentary,hearing_impaired,visual_impaired:stream_tags=language,title:stream_side_data_list:chapter=id,start_time,end_time:chapter_tags=title",
        "-of", "json",
        filePath,
      ],
      { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const metadata = parseProbeOutput(JSON.parse(stdout));
    return await enrichHdrFrameMetadata(metadata, filePath);
  } catch {
    return null;
  }
}
