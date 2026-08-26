import type { PlaybackCapabilities, PlaybackMode } from "@flixtunes/contracts";

/**
 * Corpus de régression de la lecture, décrit par propriété technique.
 *
 * Chaque fixture est synthétique et reproductible : elle est produite par `lavfi` à partir de mires et de
 * tonalités générées, sans aucun média sous droits. La recette FFmpeg fait partie du manifeste afin que
 * n'importe qui puisse régénérer le corpus à l'identique et rejouer un échec.
 */

export type CorpusProperty =
  | "conteneur" | "codec-video" | "codec-audio" | "hdr" | "canaux" | "sous-titres" | "cadence" | "cas-limite";

export interface CorpusFixture {
  id: string;
  description: string;
  properties: CorpusProperty[];
  /** Nom du fichier produit dans le répertoire de corpus. */
  filename: string;
  /** Arguments FFmpeg complets, hors chemin de sortie. */
  recipe: string[];
  /**
   * Préparation particulière :
   * - `truncate` coupe le fichier à 60 %, comme une copie encore en cours ;
   * - `pipe` écrit le conteneur sur une sortie non repositionnable, ce qui le prive de son index et de sa
   *   durée déclarée, exactement comme une capture en direct.
   */
  postProcess?: "truncate" | "pipe";
  expectations: CorpusExpectation[];
  /** Décalage audio/vidéo attendu en millisecondes, vérifié à ±40 ms par le banc. */
  expectedAudioVideoOffsetMs?: number;
  /** Limite connue et assumée : la fixture est jouée mais son échec n'est pas bloquant. */
  knownLimitation?: string;
}

/** Tolérance de synchronisation A/V. Au-delà, le décalage devient perceptible à l'écran. */
export const AUDIO_VIDEO_TOLERANCE_MS = 40;

export interface CorpusExpectation {
  /** Identifiant d'un client de référence. */
  client: ReferenceClientId;
  mode: PlaybackMode;
  /** Format de sortie colorimétrique attendu, quand la fixture porte une propriété HDR. */
  outputFormat?: "sdr" | "hdr10" | "hdr10plus" | "hlg" | "dolbyvision";
  /** La piste audio retenue doit porter cette langue, pour les fixtures multilingues. */
  audioLanguage?: string;
}

export type ReferenceClientId = "web-chromium" | "web-safari" | "android-mobile" | "android-tv" | "windows";

const baseCapabilities: PlaybackCapabilities = {
  containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac"], hls: true, dash: false,
  maxWidth: 1920, maxHeight: 1080, hdr: false, hdrFormats: [], dolbyVisionProfiles: [], dolbyAtmos: false,
  immersiveAudioFormats: [], maxAudioChannels: 2, losslessAudio: false, maxVideoBitrate: null,
  audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false,
  // Ordre de langue d'un profil francophone : le banc doit refléter ce que le serveur reçoit réellement.
  preferredAudioLanguages: ["fra", "fre", "fr", "eng", "en"],
  preferredSubtitleLanguages: ["fra", "fre", "fr"],
  adaptiveStreaming: true, streamingProtocol: "hls",
};

/**
 * Profils clients de référence du banc.
 * Ils reproduisent ce que les clients réels annoncent réellement, sans optimisme :
 * un navigateur ne promet pas le multicanal, un téléviseur n'annonce le passthrough que s'il l'expose.
 */
export const referenceClients: Record<ReferenceClientId, PlaybackCapabilities> = {
  "web-chromium": { ...baseCapabilities, containers: ["mp4", "webm"], videoCodecs: ["h264", "vp9", "vp8", "av1"],
    audioCodecs: ["aac", "opus", "mp3"], hlsSegmentContainer: "fmp4", deviceClass: "web" },
  "web-safari": { ...baseCapabilities, containers: ["mp4"], videoCodecs: ["h264", "hevc"],
    audioCodecs: ["aac", "mp3"], hdr: true, hdrFormats: ["hdr10", "hlg"], hlsSegmentContainer: "fmp4", deviceClass: "web" },
  "android-mobile": { ...baseCapabilities, containers: ["mp4"], videoCodecs: ["h264", "hevc", "vp9", "av1"],
    audioCodecs: ["aac", "opus", "mp3"], dash: true, streamingProtocol: "dash", hlsSegmentContainer: "fmp4",
    deviceClass: "mobile" },
  "android-tv": { ...baseCapabilities, containers: ["mp4", "matroska", "webm"], videoCodecs: ["h264", "hevc", "vp9", "av1"],
    audioCodecs: ["aac", "opus", "mp3", "ac3", "eac3"], dash: true, streamingProtocol: "dash",
    maxWidth: 3840, maxHeight: 2160, hdr: true, hdrFormats: ["hdr10", "hlg"], maxAudioChannels: 6,
    immersiveAudioFormats: ["dolby-atmos"], dolbyAtmos: true, hlsSegmentContainer: "fmp4", deviceClass: "tv" },
  windows: { ...baseCapabilities, containers: ["mp4", "matroska", "webm", "mpegts", "avi", "mov"],
    videoCodecs: ["h264", "hevc", "vp9", "av1", "mpeg2video", "vc1"],
    audioCodecs: ["aac", "opus", "mp3", "ac3", "eac3", "flac", "dts", "truehd"],
    maxWidth: 3840, maxHeight: 2160, hdr: true, hdrFormats: ["hdr10", "hlg", "hdr10plus"],
    maxAudioChannels: 8, losslessAudio: true, immersiveAudioFormats: ["dolby-atmos", "dts-x"], dolbyAtmos: true,
    deviceClass: "desktop" },
};

const DURATION = "3";
const VIDEO_SOURCE = `testsrc2=size=1280x720:rate=25:duration=${DURATION}`;
const AUDIO_SOURCE = `sine=frequency=440:duration=${DURATION}`;

function h264(...extra: string[]): string[] {
  return ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", ...extra];
}

export const corpus: CorpusFixture[] = [
  {
    id: "mp4-h264-aac",
    description: "MP4 H.264 / AAC stéréo, cas nominal directement lisible partout",
    properties: ["conteneur", "codec-video", "codec-audio"],
    filename: "mp4-h264-aac.mp4",
    recipe: h264(),
    expectedAudioVideoOffsetMs: 0,
    expectations: [
      { client: "web-chromium", mode: "direct" }, { client: "web-safari", mode: "direct" },
      { client: "android-mobile", mode: "direct" }, { client: "android-tv", mode: "direct" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mkv-h264-aac",
    description: "Matroska H.264 / AAC : conteneur non lisible par un navigateur, vidéo copiable",
    properties: ["conteneur"],
    filename: "mkv-h264-aac.mkv",
    recipe: h264(),
    expectations: [
      { client: "web-chromium", mode: "remux" }, { client: "web-safari", mode: "remux" },
      { client: "android-mobile", mode: "remux" }, { client: "android-tv", mode: "direct" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mpegts-h264-aac",
    description: "MPEG-TS H.264 / AAC, conteneur de diffusion",
    properties: ["conteneur"],
    filename: "mpegts-h264-aac.ts",
    recipe: h264(),
    expectations: [
      { client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "remux" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mp4-hevc-aac",
    description: "MP4 HEVC / AAC : refusé par Chromium, accepté par Safari et les téléviseurs",
    properties: ["codec-video"],
    filename: "mp4-hevc-aac.mp4",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "transcode" }, { client: "web-safari", mode: "direct" },
      { client: "android-tv", mode: "direct" }, { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mp4-mpeg2-aac",
    description: "MPEG-2 vidéo : codec ancien, transcodage attendu partout sauf sur le client Windows",
    properties: ["codec-video"],
    filename: "mp4-mpeg2-aac.mp4",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "mpeg2video", "-q:v", "6", "-c:a", "aac", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "transcode" }, { client: "android-tv", mode: "transcode" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mkv-h264-eac3-51",
    description: "E-AC-3 5.1 : converti pour un navigateur, conservé sur un téléviseur qui l'annonce",
    properties: ["codec-audio", "canaux"],
    filename: "mkv-h264-eac3-51.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "eac3", "-ac", "6", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "direct" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mkv-h264-flac",
    description: "FLAC sans perte : seul un client déclarant le sans-perte le conserve",
    properties: ["codec-audio"],
    filename: "mkv-h264-flac.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "flac", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "remux" },
      { client: "windows", mode: "direct" },
    ],
  },
  {
    id: "mkv-hevc-hdr10",
    description: "HEVC HDR10 PQ / BT.2020 avec mastering display et MaxCLL",
    properties: ["hdr", "codec-video"],
    filename: "mkv-hevc-hdr10.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-vf", "zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=smpte2084:m=bt2020nc:p=bt2020:r=tv:npl=100,format=yuv420p10le",
      "-c:v", "libx265", "-preset", "ultrafast",
      "-x265-params", "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400",
      "-c:a", "aac", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "transcode", outputFormat: "sdr" },
      // Safari n'annonce que le conteneur MP4 : la vidéo HEVC est copiée dans HLS, le HDR10 est conservé.
      { client: "web-safari", mode: "remux", outputFormat: "hdr10" },
      { client: "android-tv", mode: "direct", outputFormat: "hdr10" },
      { client: "windows", mode: "direct", outputFormat: "hdr10" },
    ],
  },
  {
    id: "mkv-hevc-hlg",
    description: "HEVC HLG : transfert de diffusion, accepté par les écrans qui l'annoncent",
    properties: ["hdr"],
    filename: "mkv-hevc-hlg.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-vf", "zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=arib-std-b67:m=bt2020nc:p=bt2020:r=tv:npl=100,format=yuv420p10le",
      "-c:v", "libx265", "-preset", "ultrafast",
      "-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      "-c:a", "aac", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "transcode", outputFormat: "sdr" },
      { client: "android-tv", mode: "direct", outputFormat: "hlg" },
    ],
  },
  {
    id: "mkv-multilingue",
    description: "Trois pistes audio français, anglais et commentaire : la sélection ne doit jamais retenir le commentaire",
    properties: ["codec-audio"],
    filename: "mkv-multilingue.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-f", "lavfi", "-i", AUDIO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-metadata:s:a:0", "language=fra", "-metadata:s:a:1", "language=eng",
      "-metadata:s:a:2", "language=eng", "-metadata:s:a:2", "title=Commentaire du réalisateur",
      "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "remux", audioLanguage: "fra" },
      { client: "android-tv", mode: "direct", audioLanguage: "fra" },
    ],
  },
  {
    id: "cas-piste-defaut-incorrecte",
    description: "Cas limite : le commentaire porte la disposition par défaut, il ne doit pas être choisi",
    properties: ["cas-limite"],
    filename: "cas-piste-defaut-incorrecte.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-map", "0:v", "-map", "1:a", "-map", "2:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
      "-metadata:s:a:0", "language=fra", "-metadata:s:a:1", "language=eng",
      "-metadata:s:a:1", "title=Director commentary",
      "-disposition:a:0", "0", "-disposition:a:1", "default", "-shortest"],
    expectations: [
      { client: "web-chromium", mode: "remux", audioLanguage: "fra" },
      { client: "android-tv", mode: "direct", audioLanguage: "fra" },
    ],
  },
  {
    id: "cas-audio-retarde",
    description: "Cas limite : piste audio décalée de 500 ms à la source",
    properties: ["cas-limite"],
    filename: "cas-audio-retarde.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-itsoffset", "0.5", "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest"],
    expectedAudioVideoOffsetMs: 500,
    expectations: [{ client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "direct" }],
  },
  {
    id: "cas-cadence-variable",
    description: "Cas limite : cadence variable obtenue par suppression d'images identiques",
    properties: ["cadence", "cas-limite"],
    filename: "cas-cadence-variable.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-vf", "mpdecimate", "-vsync", "vfr", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest"],
    expectations: [{ client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "direct" }],
  },
  {
    id: "cas-b-frames",
    description: "Cas limite : GOP avec B-frames et réordonnancement d'images",
    properties: ["cas-limite"],
    filename: "cas-b-frames.mp4",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx264", "-preset", "slow", "-bf", "3", "-b_strategy", "2", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest"],
    expectations: [{ client: "web-chromium", mode: "direct" }, { client: "android-tv", mode: "direct" }],
  },
  {
    id: "cas-fichier-tronque",
    description: "Cas limite : fichier coupé à 60 % de sa taille, comme une copie encore en cours",
    properties: ["cas-limite"],
    filename: "cas-fichier-tronque.mp4",
    // `faststart` place l'index en tête : le fichier tronqué reste analysable, comme un média en cours de copie.
    recipe: h264("-movflags", "+faststart"),
    postProcess: "truncate",
    expectations: [{ client: "web-chromium", mode: "direct" }],
    knownLimitation: "Un fichier encore en cours de copie n'expose que la partie reçue : la durée annoncée peut dépasser les données disponibles.",
  },
  {
    id: "cas-sans-index-ni-duree",
    description: "Cas limite : Matroska écrit en flux, sans index ni durée déclarée, comme une capture en direct",
    properties: ["cas-limite", "conteneur"],
    filename: "cas-sans-index-ni-duree.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-f", "matroska"],
    postProcess: "pipe",
    expectations: [{ client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "direct" }],
    knownLimitation: "Sans index ni durée déclarée, la barre de progression et le seek restent limités tant que le fichier n'est pas finalisé.",
  },
  {
    id: "cas-sous-titres-images",
    description: "Sous-titres texte SRT internes : extraits en WebVTT, jamais incrustés sans raison",
    properties: ["sous-titres"],
    filename: "cas-sous-titres-srt.mkv",
    recipe: ["-f", "lavfi", "-i", VIDEO_SOURCE, "-f", "lavfi", "-i", AUDIO_SOURCE,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
    expectations: [{ client: "web-chromium", mode: "remux" }, { client: "android-tv", mode: "direct" }],
  },
];

export function corpusByProperty(property: CorpusProperty): CorpusFixture[] {
  return corpus.filter((fixture) => fixture.properties.includes(property));
}

/** Toutes les attentes du corpus, aplaties, pour le parcours du banc. */
export function corpusExpectations(): Array<{ fixture: CorpusFixture; expectation: CorpusExpectation }> {
  return corpus.flatMap((fixture) => fixture.expectations.map((expectation) => ({ fixture, expectation })));
}

/** Contrôle d'intégrité du manifeste, exécuté par les tests unitaires avant toute génération. */
export function validateCorpus(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const fixture of corpus) {
    if (seen.has(fixture.id)) problems.push(`Identifiant de fixture dupliqué : ${fixture.id}`);
    seen.add(fixture.id);
    if (!fixture.properties.length) problems.push(`${fixture.id} ne déclare aucune propriété technique`);
    if (!fixture.expectations.length) problems.push(`${fixture.id} ne déclare aucun résultat attendu`);
    if (!fixture.recipe.includes("lavfi")) problems.push(`${fixture.id} n'est pas une fixture synthétique`);
    for (const expectation of fixture.expectations) {
      if (!referenceClients[expectation.client]) problems.push(`${fixture.id} vise un client inconnu : ${expectation.client}`);
    }
  }
  for (const property of ["conteneur", "codec-video", "codec-audio", "hdr", "sous-titres", "cas-limite"] as CorpusProperty[]) {
    if (!corpusByProperty(property).length) problems.push(`Aucune fixture ne couvre la propriété ${property}`);
  }
  return problems;
}
