import type { MediaStream, PlaybackCapabilities } from "@flixtunes/contracts";

/**
 * Ce que le client de bureau sait décoder — c'est-à-dire ce que VLC sait décoder.
 *
 * C'est la déclaration qui justifie tout le chantier. Un navigateur ne lit ni Matroska, ni HEVC, ni
 * TrueHD : pour la moitié de la médiathèque, il oblige le NAS à convertir, c'est-à-dire à réencoder
 * un film entier avec le processeur d'un boîtier de salon pendant qu'on le regarde. VLC lit tout. En
 * annonçant ce « tout », le client de bureau obtient le fichier **tel quel** et le NAS ne fait plus
 * que le servir.
 *
 * ## Ce qu'on n'annonce pas, et pourquoi
 *
 * Une capacité annoncée est une promesse : le serveur s'y fie et cesse de convertir. Trois promesses
 * ont été écartées faute de pouvoir les tenir aujourd'hui.
 *
 * - **Le choix d'une piste audio dans un fichier servi entier.** VLC en est capable, mais le pont
 *   entre le lecteur Web et VLC ne sait pas encore lui désigner une piste. L'annoncer ferait servir
 *   le fichier entier en laissant au client le soin de choisir — et le menu « Langue » deviendrait
 *   sans effet. On laisse donc le serveur isoler la piste, comme pour un navigateur.
 * - **Dolby Vision.** VLC ne le restitue pas fidèlement ; l'annoncer donnerait une image délavée.
 * - **Dolby Atmos et DTS:X.** Ils voyagent dans un flux TrueHD ou EAC3 dont VLC décode le tronc
 *   commun. Sans transmission directe vers un amplificateur, la promesse serait creuse.
 *
 * La plage dynamique, elle, est mesurée et non supposée : c'est **l'écran** qui décide, et Chromium
 * le sait aussi bien dans la coque que dans un onglet. Annoncer le HDR devant un écran qui ne
 * l'affiche pas donnerait des couleurs ternes, ce qu'aucune conversion ne rattraperait.
 */

/** Les conteneurs que le démultiplexeur de VLC ouvre. Le contrat n'en connaît pas d'autres. */
const CONTENEURS: PlaybackCapabilities["containers"] = ["matroska", "mp4", "mpegts", "avi", "mov", "webm"];

/**
 * Les codecs vidéo, sous les deux noms que le serveur peut avoir relevés.
 *
 * FFmpeg nomme un flux `hevc` quand il l'analyse et `hvc1` ou `hev1` quand il le range dans un MP4.
 * Le serveur compare ce qu'il a relevé à cette liste : y faire figurer les deux formes évite qu'un
 * même fichier soit lu tel quel ou converti selon le conteneur qui l'abrite.
 */
const CODECS_VIDEO = [
  "h264", "avc1", "avc",
  "hevc", "hvc1", "hev1", "h265",
  "av1", "av01",
  "vp9", "vp09", "vp8",
  "mpeg2video", "mpeg2", "mpeg1video",
  "mpeg4", "msmpeg4v3", "div3", "xvid",
  "vc1", "wmv3",
  "theora", "prores",
];

const CODECS_AUDIO = [
  "aac", "mp4a",
  "ac3", "ac-3", "eac3", "ec-3",
  "dts", "dca", "truehd", "mlp",
  "flac", "alac", "mp3", "mp2",
  "opus", "vorbis",
  "pcm_s16le", "pcm_s24le", "pcm_bluray", "pcm_dvd", "lpcm",
];

/**
 * @param modePreference `compatible` est la relance de la dernière chance : on n'annonce alors plus
 *   rien de ce qui pourrait échouer, exactement comme le fait le lecteur du navigateur.
 */
export function capacitesBureau(
  audioStreamIndex: number | null,
  subtitle: MediaStream | null,
  forceTranscode: boolean,
  modePreference: PlaybackCapabilities["modePreference"] = forceTranscode ? "compatible" : "auto",
  externalSubtitleId: number | null = null,
  burnExternalSubtitle = false,
  subtitleOffsetSeconds = 0,
): PlaybackCapabilities {
  const hdr = !forceTranscode && (window.matchMedia?.("(dynamic-range: high)").matches ?? false);
  return {
    containers: forceTranscode ? ["mp4"] : CONTENEURS,
    videoCodecs: forceTranscode ? [] : CODECS_VIDEO,
    audioCodecs: forceTranscode ? ["aac", "mp4a"] : CODECS_AUDIO,
    hls: true,
    dash: false,
    // La définition qu'un décodeur accepte, et non la taille de la fenêtre : VLC réduit une source 4K
    // sur un écran plus petit sans effort, et déclarer l'écran ferait convertir pour rien.
    maxWidth: forceTranscode ? 1920 : 3840,
    maxHeight: forceTranscode ? 1080 : 2160,
    hdr,
    hdrFormats: hdr ? ["hdr10", "hlg"] : [],
    dolbyVisionProfiles: [],
    dolbyAtmos: false,
    immersiveAudioFormats: [],
    maxAudioChannels: forceTranscode ? 2 : 8,
    losslessAudio: !forceTranscode,
    maxVideoBitrate: null,
    audioStreamIndex,
    // Voir l'en-tête : VLC saurait, le pont ne sait pas encore le lui dire.
    directAudioStreamSelection: false,
    subtitleStreamIndex: subtitle?.index ?? null,
    externalSubtitleId,
    burnSubtitles: Boolean((subtitle && !subtitle.canExtractAsWebVtt) || burnExternalSubtitle),
    subtitleOffsetSeconds,
    networkMbps: null,
    hlsSegmentContainer: "fmp4",
    deviceClass: "desktop",
    modePreference,
    adaptiveStreaming: true,
    streamingProtocol: "hls",
  };
}
