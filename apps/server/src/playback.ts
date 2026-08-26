import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  debutDePlanche, VIGNETTE_COLONNES, VIGNETTE_HAUTEUR, VIGNETTE_INTERVALLE_S, VIGNETTE_LARGEUR,
  VIGNETTE_LIGNES, VIGNETTE_SECONDES_PAR_PLANCHE,
} from "@flixtunes/contracts";
import type {
  ColorPipelinePlan,
  MediaStream,
  PlaybackCapabilities,
  PlaybackInfo,
  PlaybackMode,
  PlaybackSession,
  PlaybackCompatibilityMatrix,
  ServerMediaInventory,
  ToneMappingBackend,
  VideoColorMetadata,
} from "@flixtunes/contracts";
import { pistesApresLesDonneesDuFichier } from "./matroska-entetes.js";
import { marqueursGenerique } from "./generique.js";
import { marqueursDeduits } from "./marqueurs-saison.js";
import { calibratedAccelerator, calibratedToneMapping, currentAdmissionState, decideAdmission, plafondConversions, registerSessionCost, releaseSessionCost } from "./capacity.js";
import { config } from "./config.js";
import { preferencesConversion } from "./preferences-conversion.js";
import { toneMappingFilters, toneMappingInputArgs } from "./tone-mapping-filters.js";

export { toneMappingFilters, toneMappingInputArgs };
import { db } from "./database.js";
import { quarantinedCodecs, withoutQuarantined } from "./codec-quarantine.js";
import { essaiDirectPertinent } from "./essai-direct.js";
import { enrichHdrFrameMetadata, parseProbeOutput, probeMedia } from "./ffprobe.js";
import { displayResolution } from "./video-resolution.js";

const execFileAsync = promisify(execFile);
const transcodeRoot = path.resolve(config.dataDir, "transcode");
const subtitleRoot = path.resolve(config.dataDir, "subtitles");
const thumbnailRoot = path.resolve(config.dataDir, "thumbnails");

interface MediaPlaybackRow {
  id: string;
  /** « movie » ou « episode » : seule une série se voit proposer de passer son introduction. */
  kind: string;
  file_path: string;
  runtime_seconds: number | null;
  embedded_metadata_json: string | null;
}

interface InternalSession extends PlaybackSession {
  /**
   * L'appareil qui a demandé cette session.
   *
   * Il sert un garde-fou simple et qui ne dépend d'aucun client : **un appareil ne regarde qu'une
   * chose à la fois**. Quand il en demande une autre, ses sessions précédentes n'ont plus de
   * spectateur, quoi qu'il ait pu oublier d'annoncer.
   *
   * Ce n'est pas une précaution théorique. Un client qui prépare deux sessions concurrentes — deux
   * avances rapprochées suffisent — ne retient que le dernier identifiant, et ne peut donc plus
   * arrêter les autres. Elles gardaient leur créneau de conversion dix minutes, et le serveur
   * répondait « limite de 2 conversions simultanées atteinte » à quelqu'un qui ne regardait rien.
   */
  deviceId: string | null;
  directory: string;
  process: ChildProcess | null;
  createdAt: number;
  stderr: string;
  cacheKey: string;
  refCount: number;
  /**
   * Dernier instant où un client s'est intéressé à cette session — segment, manifeste ou état.
   *
   * `refCount` ne dit pas si quelqu'un regarde : il n'est décrémenté que par un arrêt **annoncé**.
   * Un onglet fermé, une application tuée, un téléviseur débranché ou un réseau coupé ne l'annoncent
   * jamais, et la session restait alors vivante indéfiniment : FFmpeg convertissait le film jusqu'au
   * bout, son répertoire n'était plus jamais purgé — les deux balayages de `cleanupPlaybackSessions`
   * exigent `refCount === 0` — et sa part de budget de conversion demeurait réservée jusqu'au
   * redémarrage du serveur. Le contrôle d'admission comptait donc des sessions fantômes.
   */
  lastAccess: number;
  /**
   * L'arrêt vient de nous, pas de FFmpeg.
   *
   * Les deux gestionnaires de sortie interprètent un code non nul comme une panne de l'encodeur et,
   * si le chemin était matériel, relancent la session en logiciel. Or arrêter délibérément une
   * session encore en préparation produit exactement ce code : le repli se déclenchait alors sur un
   * répertoire qu'on venait d'effacer, et le FFmpeg relancé — retiré de `sessions` — ne pouvait plus
   * être arrêté par personne.
   */
  arretDemande: boolean;
  /**
   * Vrai dès que le chien de garde a demandé l'arrêt d'une conversion bloquée.
   *
   * Distinct d'`arretDemande`, et la distinction est essentielle : celui-là **empêche** le repli
   * logiciel à la sortie du processus, ce qui est voulu quand on détruit une session, mais serait
   * exactement le contraire de ce qu'on cherche ici. Le chien de garde tue pour **provoquer** ce
   * repli. Il lui faut donc son propre drapeau, dont le seul rôle est de ne mordre qu'une fois : le
   * client interroge la session deux fois par seconde et `kill` ne rend pas la main tout de suite.
   */
  blocageSignale: boolean;
}

const sessions = new Map<string, InternalSession>();
const transcodeCache = new Map<string, string>();
const thumbnailJobs = new Map<string, Promise<string | null>>();
const transcodeDiagnostics: Array<{ at: string; mediaId: string; encoder: string | null; message: string }> = [];
export interface FfmpegSupport {
  version: string | null;
  encoders: Set<string>;
  decoders: Set<string>;
  hwaccels: Set<string>;
  demuxers: Set<string>;
  muxers: Set<string>;
  filters: Set<string>;
}
let ffmpegSupportPromise: Promise<FfmpegSupport> | null = null;

/**
 * Durée d'un segment HLS, en secondes.
 *
 * Ce nombre gouverne deux réglages qui **doivent** s'accorder : la durée demandée au multiplexeur et
 * le rythme des images-clés imposé à l'encodeur. `-hls_time` n'est qu'un souhait — ffmpeg ne peut
 * couper un segment que sur une image-clé. Sans images-clés forcées, l'intervalle par défaut de
 * l'encodeur décide seul : avec libx264, 250 images, soit **10 secondes** à 25 im/s. Le lecteur
 * devait alors télécharger dix secondes avant d'afficher la première image, et ne pouvait se
 * déplacer que par pas de dix secondes.
 *
 * Les deux valeurs étaient écrites séparément ; les tenir d'une seule constante interdit qu'elles
 * divergent à nouveau.
 */
export const SEGMENT_SECONDS = 4;

/** Force une image-clé à chaque frontière de segment. Sans effet en copie de flux. */
/**
 * Arguments de positionnement du transcodage, à placer **avant** `-i`.
 *
 * L'ordre n'est pas un détail : avant `-i`, ffmpeg se déplace dans le conteneur et démarre presque
 * instantanément ; après `-i`, il décode puis jette tout ce qui précède — des minutes d'attente sur
 * un film de deux heures.
 *
 * Le flux produit repart de zéro, et c'est voulu : `startOffsetSeconds` dit au client à quel instant
 * du film cet instant zéro correspond. (Une version antérieure de ce commentaire annonçait `-copyts`,
 * qui n'a jamais été passé — la remarque décrivait une intention, pas le code.)
 */
function startArgs(startSeconds: number): string[] {
  return startSeconds > 0 ? ["-ss", startSeconds.toFixed(3)] : [];
}

/**
 * Numéro de version du moteur, tel que la première ligne de `ffmpeg -version` l'annonce.
 * `null` quand elle ne se lit pas : une construction datée (`ffmpeg version 2026-01-12-git-…`) ne
 * porte aucun numéro, et deviner reviendrait à activer des options qui n'existent peut-être pas.
 */
export function ffmpegVersion(version: string | null | undefined): { major: number; minor: number } | null {
  const match = /version\s+n?(\d+)\.(\d+)/i.exec(version ?? "");
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

/**
 * Bride la vitesse à laquelle une conversion produit son flux.
 *
 * Sans cela FFmpeg encode le film **entier, à fond**, quoi que fasse la personne devant l'écran. Deux
 * conséquences, toutes deux mesurables sur un NAS modeste : le processeur reste saturé bien après que
 * le lecteur a de quoi tenir — ce qui vole le budget des autres lectures et des analyses — et le
 * cache grossit sans borne. Le plafond `transcodeCacheMaxBytes` ne s'applique qu'aux sessions
 * inactives : un remux 4K, qui copie la vidéo à son débit d'origine, écrit donc des dizaines de gigas
 * sans que rien ne l'arrête.
 *
 * `-readrate` est une option **d'entrée** : elle cadence la lecture du fichier, donc tout ce qui
 * suit. La rafale initiale préserve ce qui compte pour la personne — première image et déplacements
 * courts sortent à pleine vitesse — puis la fenêtre encodée continue d'avancer deux fois plus vite
 * que la lecture, ce qui laisse de quoi absorber une pause ou un rebond.
 *
 * `-readrate_initial_burst` n'existe qu'à partir de FFmpeg 6.1. Sans elle, la régulation seule
 * retarderait la première image : on préfère alors ne rien brider et garder le comportement d'avant.
 */
export function regulationDebitArgs(version: string | null | undefined,
  rate = config.readRate, burstSeconds = config.readRateBurstSeconds): string[] {
  const numero = ffmpegVersion(version);
  if (!numero || rate <= 0) return [];
  if (numero.major < 6 || (numero.major === 6 && numero.minor < 1)) return [];
  return ["-readrate", rate.toFixed(2), "-readrate_initial_burst", String(Math.max(1, Math.round(burstSeconds)))];
}

export function keyframeArgs(encoder: string): string[] {
  const args = ["-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SECONDS})`];
  // `-sc_threshold` n'appartient qu'aux encodeurs logiciels x264/x265 ; le passer à un encodeur
  // matériel produit un avertissement sans effet. Sans lui, un changement de plan insère une
  // image-clé supplémentaire et découpe un segment plus court que prévu.
  if (/^libx26[45]$/.test(encoder)) args.push("-sc_threshold", "0");
  return args;
}

function rememberTranscodeFailure(session: InternalSession): void {
  transcodeDiagnostics.unshift({ at: new Date().toISOString(), mediaId: session.mediaId,
    encoder: session.videoEncoder, message: session.stderr.slice(-2000) || session.error || "Erreur FFmpeg inconnue" });
  transcodeDiagnostics.splice(20);
}

function activeTranscodeCount(): number {
  return [...sessions.values()].filter((session) => session.status === "starting" || session.status === "ready").length;
}

export function transcodeScaleFilter(targetWidth: number, targetHeight: number, downscale: boolean): string {
  return downscale
    ? `scale=w=${targetWidth}:h=${targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`
    : "scale=w=trunc(iw/2)*2:h=trunc(ih/2)*2";
}

export interface ColorEngineSupport { filters: Set<string>; hwaccels: Set<string>; encoders: Set<string> }

const hdrLabels: Record<MediaStream["hdrFormat"], string> = {
  sdr: "SDR", hdr10: "HDR10", hdr10plus: "HDR10+", hlg: "HLG", dolbyvision: "Dolby Vision",
};
/**
 * Encodeurs autorisés à reconduire une couche HDR10 lors d'un réencodage.
 * Seul libx265 sait réinjecter mastering display et MaxCLL/MaxFALL, et c'est le seul chemin mesuré :
 * la sortie HEVC HDR accélérée relève de l'étape 49.
 */
const hdrCapableEncoders = ["libx265"];

/**
 * Couche de base rétrocompatible d'un flux Dolby Vision.
 * Le profil 5 n'en expose aucune : il ne peut être lu que par un appareil Dolby Vision.
 */
export function dolbyVisionBaseLayer(color: VideoColorMetadata | null | undefined): "hdr10" | "hlg" | "sdr" | null {
  if (!color || color.dolbyVisionProfile == null) return null;
  switch (color.dolbyVisionBlCompatibilityId) {
    case 1: case 6: return "hdr10";
    case 4: return "hlg";
    case 2: return "sdr";
    default: break;
  }
  // Sans identifiant de compatibilité, seuls les profils 7 et 8 portent une couche de base HDR10 valide.
  return color.dolbyVisionProfile === 7 || color.dolbyVisionProfile === 8 ? "hdr10" : null;
}

/** Luminance crête réelle de la source : mastering display, puis MaxCLL, puis valeur nominale du format. */
export function sourcePeakLuminance(video: MediaStream | null | undefined): number {
  const mastering = video?.color?.masteringDisplay?.maxLuminanceNits;
  if (mastering && mastering >= 100 && mastering <= 10_000) return Math.round(mastering);
  const maxCll = video?.color?.maxContentLightLevel;
  if (maxCll && maxCll >= 100) return Math.min(10_000, maxCll);
  return video?.hdr ? 1000 : 100;
}

/** Dimensions présentées au client une fois la rotation du conteneur appliquée par FFmpeg. */
export function orientedDimensions(video: MediaStream | null | undefined): { width: number; height: number } {
  const width = video?.width ?? 1920;
  const height = video?.height ?? 1080;
  const rotation = video?.color?.rotationDegrees ?? 0;
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

/**
 * Format HDR réellement livrable au client : le flux d'origine, sa couche de base rétrocompatible,
 * ou rien lorsqu'une conversion est indispensable.
 */
export function hdrDeliveryFormat(video: MediaStream | null | undefined, capabilities: PlaybackCapabilities): {
  format: MediaStream["hdrFormat"]; compatible: boolean; viaBaseLayer: boolean;
} {
  if (!video?.hdr) return { format: "sdr", compatible: true, viaBaseLayer: false };
  const accepts = (format: MediaStream["hdrFormat"]) => format === "sdr"
    || capabilities.hdrFormats.includes(format as "hdr10" | "hdr10plus" | "hlg" | "dolbyvision");
  const profile = video.color?.dolbyVisionProfile ?? video.dolbyVisionProfile;
  const dolbyProfileAccepted = video.hdrFormat !== "dolbyvision" || profile == null
    || capabilities.dolbyVisionProfiles.length === 0 || capabilities.dolbyVisionProfiles.includes(profile);
  const candidates: Array<{ format: MediaStream["hdrFormat"]; compatible: boolean; viaBaseLayer: boolean }> = [];
  if (accepts(video.hdrFormat) && dolbyProfileAccepted) {
    candidates.push({ format: video.hdrFormat, compatible: true, viaBaseLayer: false });
  }
  // Un HDR10+ reste un HDR10 valide pour un téléviseur qui ignore les métadonnées dynamiques.
  if (video.hdrFormat === "hdr10plus" && accepts("hdr10")) {
    candidates.push({ format: "hdr10", compatible: true, viaBaseLayer: true });
  }
  // Certains masters profil 8.1 portent à la fois le RPU Dolby Vision et les métadonnées HDR10+.
  // Ce n'est pas une approximation de la couche HDR10 : les deux formats dynamiques sont réellement
  // présents et le choix manuel doit pouvoir sélectionner l'un ou l'autre.
  if (video.hdrFormat === "dolbyvision" && video.availableHdrFormats?.includes("hdr10plus") && accepts("hdr10plus")) {
    candidates.push({ format: "hdr10plus", compatible: true, viaBaseLayer: true });
  }
  const baseLayer = video.hdrFormat === "dolbyvision" ? dolbyVisionBaseLayer(video.color) : null;
  if (baseLayer && accepts(baseLayer)) candidates.push({ format: baseLayer, compatible: true, viaBaseLayer: true });

  const preference = capabilities.dynamicRangePreference ?? "auto";
  if (preference === "sdr") return { format: "sdr", compatible: false, viaBaseLayer: false };
  // Compatibilité ascendante r43/r44 : ce choix expert demandait explicitement le flux HDR source.
  if (preference === "hdr") return { format: video.hdrFormat, compatible: true, viaBaseLayer: false };
  if (preference !== "auto") {
    const requested = candidates.find((candidate) => candidate.format === preference);
    if (requested) return requested;
  }
  // L'ordre est explicite afin que l'ajout futur d'une seconde couche ne dépende jamais de l'ordre
  // accidentel des conditions ci-dessus.
  const automaticOrder: MediaStream["hdrFormat"][] = ["dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr"];
  for (const format of automaticOrder) {
    const candidate = candidates.find((item) => item.format === format);
    if (candidate) return candidate;
  }
  return { format: "sdr", compatible: false, viaBaseLayer: false };
}

/**
 * Marque explicitement une copie Dolby Vision dans le conteneur ISO-BMFF produit par le remux.
 *
 * Sans l'entrée `dvh1`, les octets RPU Dolby Vision restent présents mais Media3 peut annoncer la
 * piste comme un simple HEVC ; la dalle active alors sa couche HDR10/HDR10+ au lieu de Dolby Vision.
 */
export function remuxVideoTag(video: MediaStream | null | undefined): "dvh1" | null {
  return video?.hdrFormat === "dolbyvision" ? "dvh1" : null;
}

/**
 * Un simple FourCC `dvh1` ne suffit pas avec FFmpeg : sans le niveau `unofficial`, le muxer écrit
 * bien l'étiquette mais omet volontairement la boîte `dvcC`/`dvvC`. Le RPU reste alors dans les
 * octets HEVC sans être déclaré au lecteur ; sur une source hybride DV + HDR10+, la dalle choisit
 * donc HDR10+. Cette option n'est ajoutée qu'aux remux Dolby Vision et ne touche aucun encodage.
 */
export function remuxVideoArguments(video: MediaStream | null | undefined,
  outputFormat: MediaStream["hdrFormat"] = video?.hdrFormat ?? "sdr"): string[] {
  const tag = remuxVideoTag(video);
  if (!tag) return [];
  // Une source hybride choisie en HDR10+ doit rester une copie bit à bit mais ne plus annoncer la
  // boîte DV. Le RPU demeure dans le HEVC, simplement ignoré, tandis que les SEI HDR10+ sont lus.
  return outputFormat === "dolbyvision" ? ["-tag:v", tag, "-strict", "unofficial"] : ["-tag:v", "hvc1"];
}

/** Les chemins matériels, et ce que leur présence dans la compilation exige. */
const CHEMINS_MATERIELS: Array<{ backend: "libplacebo" | "vaapi" | "opencl"; filtre: string; accelerateur: string }> = [
  { backend: "libplacebo", filtre: "libplacebo", accelerateur: "vulkan" },
  { backend: "vaapi", filtre: "tonemap_vaapi", accelerateur: "vaapi" },
  { backend: "opencl", filtre: "tonemap_opencl", accelerateur: "opencl" },
];

/**
 * Le chemin de conversion HDR vers SDR.
 *
 * La règle du projet est qu'un chemin matériel non mesuré sur la machine cible n'est jamais retenu
 * automatiquement. Elle tenait en respect un vrai risque : un pilote qui répond mais traîne — tone
 * mapping émulé, périphérique partagé — coûte plus cher que le logiciel qu'il remplace, tout en
 * paraissant être un progrès. Seuls `libplacebo` et le logiciel étaient donc admis en automatique,
 * et un NAS capable de convertir sur son circuit vidéo le faisait quand même sur son processeur.
 *
 * Le calibrage lève l'interdiction plutôt que de la contourner : chaque chemin est mesuré sur cette
 * machine, et « auto » retient celui que la mesure désigne. Un choix explicite continue de primer —
 * c'est le mode expert —, et sans mesure disponible on revient exactement au comportement d'avant.
 */
/**
 * Applique un plafond de définition choisi par l'administrateur.
 *
 * L'appareil annonce déjà ce qu'il sait afficher, et le cas courant s'en contente. Ce réglage sert à
 * le contredire dans les deux sens : brider volontairement sur un réseau chargé, ou refuser qu'une
 * négociation rabaisse un film qu'on veut voir dans sa définition d'origine.
 *
 * Le plafond ne peut que **réduire** ce que l'appareil annonce. L'augmenter reviendrait à lui envoyer
 * une image qu'il ne sait pas décoder, ce qui ne se manifesterait pas par une image plus fine mais par
 * une lecture qui échoue.
 *
 * La largeur suit la hauteur en 16/9 : c'est la forme de la quasi-totalité des films, et un plafond
 * exprimé en hauteur seule laisserait passer une image deux fois trop large sur un format large.
 */
export function plafonnerDefinition(capabilities: PlaybackCapabilities, plafond: string): PlaybackCapabilities {
  const hauteur = Number.parseInt(plafond, 10);
  if (!Number.isFinite(hauteur) || hauteur <= 0) return capabilities;
  const largeur = Math.round(hauteur * 16 / 9);
  if (capabilities.maxHeight <= hauteur && capabilities.maxWidth <= largeur) return capabilities;
  return {
    ...capabilities,
    maxHeight: Math.min(capabilities.maxHeight, hauteur),
    maxWidth: Math.min(capabilities.maxWidth, largeur),
  };
}

export function selectToneMappingBackend(support: ColorEngineSupport, preference: string, forceSoftware = false,
  mesure: ToneMappingBackend | null = null):
{ backend: ToneMappingBackend; hardware: boolean } {
  const explicit = (name: string) => !forceSoftware && preference === name;
  const auto = !forceSoftware && preference === "auto";
  const disponible = (backend: "libplacebo" | "vaapi" | "opencl") => {
    const chemin = CHEMINS_MATERIELS.find((entree) => entree.backend === backend);
    return Boolean(chemin && support.filters.has(chemin.filtre) && support.hwaccels.has(chemin.accelerateur));
  };
  for (const { backend } of CHEMINS_MATERIELS) {
    if (explicit(backend) && disponible(backend)) return { backend, hardware: true };
  }
  // En automatique, la mesure décide — et elle ne désigne un chemin matériel que s'il s'est montré
  // plus rapide que le logiciel sur cette machine précise.
  if (auto && mesure) {
    if (mesure === "libplacebo" || mesure === "vaapi" || mesure === "opencl") {
      if (disponible(mesure)) return { backend: mesure, hardware: true };
    } else if (mesure === "zscale" && support.filters.has("zscale") && support.filters.has("tonemap")) {
      return { backend: "zscale", hardware: false };
    } else if (mesure === "software" && support.filters.has("tonemap")) {
      return { backend: "software", hardware: false };
    }
  }
  // Sans mesure, le comportement d'avant : seul libplacebo est admis sans avoir été éprouvé ici,
  // parce que c'est le seul chemin déjà qualifié par le projet.
  if (auto && disponible("libplacebo")) return { backend: "libplacebo", hardware: true };
  if (support.filters.has("zscale") && support.filters.has("tonemap")) return { backend: "zscale", hardware: false };
  if (support.filters.has("tonemap")) return { backend: "software", hardware: false };
  return { backend: "none", hardware: false };
}

/** Désentrelacement conservant la cadence source : 25i devient 25p, jamais 50p. */
export function deinterlaceFilters(video: MediaStream | null | undefined, support: ColorEngineSupport):
{ mode: ColorPipelinePlan["deinterlace"]; filters: string[] } {
  if (!video?.color?.interlaced) return { mode: "none", filters: [] };
  if (support.filters.has("bwdif")) return { mode: "bwdif", filters: ["bwdif=mode=send_frame:parity=auto:deint=interlaced"] };
  if (support.filters.has("yadif")) return { mode: "yadif", filters: ["yadif=mode=send_frame:parity=auto:deint=interlaced"] };
  return { mode: "none", filters: [] };
}

/**
 * Décide la chaîne colorimétrique complète et l'explique pas à pas.
 * Toute perte de format est renseignée dans `lossNotice` avant que la lecture ne démarre.
 */
export function planColorPipeline(video: MediaStream | null | undefined, capabilities: PlaybackCapabilities,
  support: ColorEngineSupport, mode: PlaybackMode, preference = "auto", forceSoftware = false): ColorPipelinePlan {
  const color = video?.color ?? null;
  const source = video?.hdrFormat ?? "sdr";
  const sourcePeak = sourcePeakLuminance(video);
  const targetPeak = capabilities.displayPeakNits ?? 100;
  const deinterlace = deinterlaceFilters(video, support);
  const steps: string[] = [];
  const filters = [...deinterlace.filters];
  const rotation = color?.rotationDegrees ?? 0;
  if (deinterlace.mode !== "none") steps.push(`Source entrelacée (${color?.fieldOrder ?? "ordre inconnu"}) désentrelacée par ${deinterlace.mode}, cadence source conservée`);
  else if (color?.interlaced) steps.push("Source entrelacée mais aucun filtre de désentrelacement disponible");
  if (rotation) steps.push(`Rotation ${rotation}° du conteneur appliquée avant encodage`);
  const base = {
    sourceFormat: source, sourcePeakNits: source === "sdr" ? null : sourcePeak,
    targetPeakNits: source === "sdr" ? null : targetPeak, deinterlace: deinterlace.mode, rotationDegrees: rotation,
    sourceFrameRate: video?.frameRate ?? null, outputBitDepth: color?.bitDepth ?? null,
  };

  if (source === "sdr") {
    steps.push(`Source SDR ${color?.colorPrimaries ?? "bt709"} / ${color?.colorRange ?? "tv"} transmise sans conversion colorimétrique`);
    return { ...base, outputFormat: "sdr", action: "sdr-passthrough", toneMapping: "none", toneMappingHardware: false,
      preservesStaticMetadata: true, preservesDynamicMetadata: true, lossNotice: null, steps, filters };
  }

  const delivery = hdrDeliveryFormat(video, capabilities);
  const canCopyVideo = mode !== "transcode";
  if (delivery.compatible && canCopyVideo) {
    const preservesDynamic = delivery.format === source || (delivery.format !== "sdr"
      && Boolean(video?.availableHdrFormats?.includes(delivery.format)));
    steps.push(delivery.viaBaseLayer
      ? `${hdrLabels[source]} non géré par l'appareil : sa couche de base ${hdrLabels[delivery.format]} est lue telle quelle`
      : `${hdrLabels[source]} accepté par l'appareil : flux vidéo copié, primaires ${color?.colorPrimaries ?? "bt2020"} et transfert ${color?.colorTransfer ?? "smpte2084"} conservés`);
    if (color?.masteringDisplay) steps.push(`Mastering display ${Math.round(color.masteringDisplay.maxLuminanceNits)} nits conservé${color.maxContentLightLevel ? ` · MaxCLL ${color.maxContentLightLevel} / MaxFALL ${color.maxFrameAverageLightLevel ?? "?"}` : ""}`);
    return { ...base, outputFormat: delivery.format,
      action: delivery.viaBaseLayer && delivery.format !== "sdr" ? "hdr-base-layer" : "preserve",
      toneMapping: "none", toneMappingHardware: false, preservesStaticMetadata: true, preservesDynamicMetadata: preservesDynamic,
      lossNotice: preservesDynamic ? null
        : `${hdrLabels[source]} n'est pas géré par cet appareil : la couche ${hdrLabels[delivery.format]} est lue, sans métadonnées dynamiques.`,
      steps, filters };
  }

  // Réencodage : seul un encodeur HEVC 10 bits qualifié peut reconduire une couche HDR10 statique.
  const hevcAvailable = hdrCapableEncoders.some((encoder) => support.encoders.has(encoder));
  const clientHevc = codecSupported(capabilities.videoCodecs, "hevc");
  const hdr10Target = source === "hdr10plus" ? "hdr10" : source;
  if (mode === "transcode" && source !== "dolbyvision" && hevcAvailable && clientHevc
    && capabilities.hdrFormats.includes(hdr10Target as "hdr10" | "hlg")) {
    steps.push(`Réencodage HEVC 10 bits conservant ${hdrLabels[hdr10Target]}, primaires bt2020 et transfert ${color?.colorTransfer ?? "smpte2084"}`);
    if (color?.masteringDisplay) steps.push("Mastering display et MaxCLL/MaxFALL réinjectés dans le flux encodé");
    return { ...base, outputFormat: hdr10Target, action: "preserve", toneMapping: "none", toneMappingHardware: false,
      preservesStaticMetadata: Boolean(color?.masteringDisplay), preservesDynamicMetadata: false,
      lossNotice: source === "hdr10plus"
        ? "Les métadonnées dynamiques HDR10+ ne survivent pas au réencodage : la couche HDR10 statique est conservée."
        : null,
      steps, filters };
  }

  const { backend, hardware } = selectToneMappingBackend(support, preference, forceSoftware, calibratedToneMapping());
  filters.push(...toneMappingFilters(backend, sourcePeak, targetPeak));
  steps.push(backend === "none"
    ? `${hdrLabels[source]} doit être converti en SDR mais aucun filtre de tone mapping n'est disponible`
    : `${hdrLabels[source]} ${sourcePeak} nits converti en SDR BT.709 ${targetPeak} nits par ${backend}${hardware ? " (matériel)" : " (logiciel)"}`);
  steps.push("Sous-titres composés après la conversion SDR pour éviter toute surexposition");
  return { ...base, outputFormat: "sdr", action: "hdr-to-sdr", toneMapping: backend, toneMappingHardware: hardware,
    preservesStaticMetadata: false, preservesDynamicMetadata: false,
    lossNotice: backend === "none"
      ? `Le moteur installé ne peut pas convertir ${hdrLabels[source]} en SDR : les couleurs seront délavées. Installez un FFmpeg avec zscale ou libplacebo.`
      : `Cet appareil n'accepte pas ${hdrLabels[source]} : l'image est convertie en SDR, avec une perte de contraste et de couleurs.`,
    steps, filters };
}

export function friendlyTranscodeError(stderr: string): string {
  const normalized = stderr.toLowerCase();
  if (/not divisible by 2|width not divisible|height not divisible/.test(normalized)) return "La géométrie de la vidéo n'est pas compatible avec l'encodeur.";
  if (/no space left on device|disk full/.test(normalized)) return "Le cache de transcodage ne dispose plus d'espace libre.";
  if (/permission denied|operation not permitted/.test(normalized)) return "FFmpeg n'a pas l'autorisation de lire le média ou d'écrire dans son cache.";
  if (/device or resource busy|device busy/.test(normalized)) return "L'accélérateur vidéo est momentanément occupé.";
  if (/cannot allocate memory|out of memory/.test(normalized)) return "Le serveur ne dispose pas d'assez de mémoire pour ce transcodage.";
  if (/no decoder found for|unknown decoder/.test(normalized)) return "Le moteur multimédia installé ne contient pas le décodeur requis. Installez la mise à jour FlixTunes avec FFmpeg intégré.";
  if (/invalid data found|could not find codec parameters/.test(normalized)) return "Le conteneur ou une piste du média est endommagé ou non reconnu.";
  return "Le transcodage a échoué. Le diagnostic détaillé est disponible dans l'administration.";
}

export function getServerMediaInventory(): ServerMediaInventory {
  const rows = db.prepare("SELECT embedded_metadata_json FROM media_items WHERE available = 1 AND embedded_metadata_json IS NOT NULL").all() as Array<{ embedded_metadata_json: string }>;
  const result: ServerMediaInventory = { mediaCount: rows.length, streamCount: 0, videoCodecs: {}, audioCodecs: {}, subtitleCodecs: {}, dynamicRanges: {}, immersiveAudio: {} };
  const increment = (target: Record<string, number>, key: string) => { target[key] = (target[key] ?? 0) + 1; };
  for (const row of rows) {
    try {
      for (const stream of parseProbeOutput(JSON.parse(row.embedded_metadata_json)).streams) {
        result.streamCount += 1;
        increment(stream.type === "video" ? result.videoCodecs : stream.type === "audio" ? result.audioCodecs : result.subtitleCodecs, stream.codec);
        if (stream.type === "video") increment(result.dynamicRanges, stream.hdrFormat);
        if (stream.type === "audio" && stream.audioTechnology && stream.audioTechnology !== "standard") increment(result.immersiveAudio, stream.audioTechnology);
      }
    } catch { /* inventaire partiel si un ancien probe est illisible */ }
  }
  return result;
}

function containerFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if ([".mp4", ".m4v", ".mov"].includes(extension)) return "mp4";
  if (extension === ".webm") return "webm";
  if ([".ts", ".m2ts"].includes(extension)) return "mpegts";
  return "matroska";
}

export interface AdaptiveProfile { width: number; height: number; videoBitrate: number }
const adaptiveProfiles: AdaptiveProfile[] = [
  { width: 3840, height: 2160, videoBitrate: 20_000_000 }, { width: 2560, height: 1440, videoBitrate: 12_000_000 },
  { width: 1920, height: 1080, videoBitrate: 8_000_000 }, { width: 1280, height: 720, videoBitrate: 4_000_000 },
  { width: 854, height: 480, videoBitrate: 2_000_000 }, { width: 640, height: 360, videoBitrate: 900_000 },
];
export function selectAdaptiveProfile(capabilities: PlaybackCapabilities, sourceWidth = 1920, sourceHeight = 1080): AdaptiveProfile {
  const availableBits = capabilities.networkMbps ? capabilities.networkMbps * 1_000_000 * 0.72 : (capabilities.maxVideoBitrate ?? 20_000_000);
  return adaptiveProfiles.find((profile) => profile.width <= capabilities.maxWidth && profile.height <= capabilities.maxHeight
    && profile.width <= sourceWidth && profile.height <= sourceHeight && profile.videoBitrate <= availableBits)
    ?? { width: Math.min(640, capabilities.maxWidth, sourceWidth), height: Math.min(360, capabilities.maxHeight, sourceHeight), videoBitrate: 600_000 };
}

/**
 * Marge en deçà de laquelle le débit disponible devient le goulot de la lecture.
 *
 * Deux fois et demie le débit du flux servi. Au-dessus, un creux passager est absorbé par le tampon
 * et une échelle ne servirait qu'à dépenser du processeur ; en dessous, la marge est trop mince pour
 * qu'un seul débit tienne d'un bout à l'autre, et pouvoir descendre d'un cran vaut son coût.
 */
export const MARGE_ECHELLE_ADAPTATIVE = 2.5;

/**
 * L'échelle adaptative n'a d'intérêt que là où le débit est réellement le goulot.
 *
 * Encoder quatre définitions au lieu d'une, c'est dépenser quatre fois le processeur pour laisser au
 * lecteur le choix d'un débit. Sur un réseau local vers un NAS, ce choix ne sert à rien : la bande
 * passante n'y est pas la ressource rare — c'est le processeur qui l'est. Le lecteur Web le disait
 * déjà de son côté en désactivant `capLevelToPlayerSize`.
 *
 * Le critère ne peut pas être « l'appareil annonce un débit » : depuis que le client mesure vraiment
 * le chemin jusqu'au NAS, il en annonce un **toujours**, y compris trois cents mégabits sur un câble.
 * C'est le rapport qui compte, pas la présence : on compare ce qui est disponible à ce que coûte le
 * flux qu'on s'apprête à servir. Trois cents mégabits pour un flux de vingt, c'est un lien qui ne
 * sera jamais le problème ; trente pour le même flux, c'est celui qui coupe.
 *
 * Sans aucune annonce, pas d'échelle : rien ne prouve alors que le débit manque, et l'échelle serait
 * un coût certain contre un bénéfice supposé.
 */
export function echelleAdaptativeUtile(capabilities: PlaybackCapabilities, cible: AdaptiveProfile): boolean {
  if (!capabilities.adaptiveStreaming) return false;
  const disponible = capabilities.networkMbps != null
    ? capabilities.networkMbps * 1_000_000
    : capabilities.maxVideoBitrate;
  if (disponible == null || !(disponible > 0)) return false;
  return disponible < cible.videoBitrate * MARGE_ECHELLE_ADAPTATIVE;
}

/**
 * L'échelle est-elle retenue pour cette session ?
 *
 * Une seule fonction pour les deux appelants — l'admission, qui estime le coût avant de démarrer, et
 * le démarrage, qui choisit le chemin. Les deux conditions vivaient séparément et pouvaient diverger :
 * l'admission facturait alors une échelle là où une seule variante allait être produite.
 */
export function echelleAdaptativeRetenue(capabilities: PlaybackCapabilities, mode: PlaybackMode,
  colorPipeline: ColorPipelinePlan, sourceWidth = 1920, sourceHeight = 1080): boolean {
  return echelleAdaptativeUtile(capabilities, selectAdaptiveProfile(capabilities, sourceWidth, sourceHeight))
    && mode === "transcode" && !colorPipeline.filters.length
    && colorPipeline.outputFormat === "sdr" && colorPipeline.action !== "hdr-to-sdr"
    && !capabilities.burnSubtitles && !capabilities.audioNormalization && !capabilities.nightMode
    && (capabilities.audioOutputMode == null || capabilities.audioOutputMode === "auto"
      || capabilities.audioOutputMode === "aac");
}

export function selectAdaptiveLadder(capabilities: PlaybackCapabilities, sourceWidth = 1920, sourceHeight = 1080): AdaptiveProfile[] {
  const ceiling = selectAdaptiveProfile(capabilities, sourceWidth, sourceHeight);
  const eligible = adaptiveProfiles.filter((profile) => profile.width <= ceiling.width && profile.height <= ceiling.height
    && profile.width <= sourceWidth && profile.height <= sourceHeight);
  const spread = eligible.filter((profile, index) => index === 0 || index === eligible.length - 1
    || profile.videoBitrate <= eligible[0]!.videoBitrate / 2).slice(0, 4);
  if (!spread.some((profile) => profile.height <= 360)) spread.push({ width: Math.min(640, sourceWidth), height: Math.min(360, sourceHeight), videoBitrate: 600_000 });
  return [...new Map(spread.map((profile) => [`${profile.width}x${profile.height}`, profile])).values()]
    .sort((left, right) => right.videoBitrate - left.videoBitrate);
}

/**
 * L'échelle adaptative, encodée par le circuit vidéo quand il y en a un.
 *
 * Ce chemin écrivait `libx264` en dur et n'appelait jamais `chooseVideoEncoder` : ni Quick Sync, ni
 * VA-API, ni le calibrage de l'étape 56 ne l'atteignaient. Sur le NAS de référence, cela revenait à
 * troquer 191 images par seconde contre 57 — et à les multiplier par le nombre de variantes.
 *
 * Le contrôle d'admission aggravait la chose sans le savoir : son budget se déduit du débit mesuré de
 * l'accélérateur **retenu**, alors que ce chemin encodait sur le processeur. Il admettait donc environ
 * trois fois trop, et la mise en mémoire tampon qui s'ensuivait ne se rattachait à aucune cause
 * visible.
 *
 * Les filtres propres à l'encodeur — `format=nv12,hwupload` pour VA-API — sont raccrochés à la fin de
 * **chaque** branche, après le redimensionnement : c'est le même ordre que sur le chemin à variante
 * unique, et le seul qui laisse le processeur préparer l'image que le circuit vidéo encodera.
 */
async function startAdaptiveFfmpegSession(session: InternalSession, filePath: string, info: PlaybackInfo,
  capabilities: PlaybackCapabilities, video: MediaStream, audio: MediaStream, forceSoftware = false): Promise<void> {
  const oriented = orientedDimensions(video);
  const ladder = selectAdaptiveLadder(capabilities, oriented.width, oriented.height);
  const support = await detectFfmpegSupport();
  const encoder = await chooseVideoEncoder(forceSoftware);
  session.variants = ladder; session.videoEncoder = encoder.encoder; session.audioEncoder = "aac";
  const splits = ladder.map((_, index) => `[split${index}]`).join("");
  const suffixe = encoder.filterSuffix.length ? `,${encoder.filterSuffix.join(",")}` : "";
  const filters = [`[0:${video.index}]split=${ladder.length}${splits}`,
    ...ladder.map((profile, index) => `[split${index}]${transcodeScaleFilter(profile.width, profile.height, true)}${suffixe}[v${index}]`)];
  const args = ["-nostdin", "-hide_banner", "-loglevel", "warning", "-y", ...encoder.inputArgs,
    ...regulationDebitArgs(support.version), ...startArgs(session.startOffsetSeconds ?? 0), "-i", filePath, "-filter_complex", filters.join(";"),
    ...ladder.flatMap((_, index) => ["-map", `[v${index}]`, "-map", `0:${audio.index}`]),
    "-c:v", encoder.encoder, ...encoder.outputArgs,
    ...(encoder.softwarePixels !== false ? ["-pix_fmt", "yuv420p"] : []), ...keyframeArgs(encoder.encoder),
    "-c:a", "aac", "-ac", String(Math.min(2, capabilities.maxAudioChannels, audio.channels ?? 2)), "-b:a", "160k",
    ...ladder.flatMap((profile, index) => [`-b:v:${index}`, String(profile.videoBitrate), `-maxrate:v:${index}`, String(Math.round(profile.videoBitrate * 1.08)), `-bufsize:v:${index}`, String(profile.videoBitrate * 2)]),
    "-sn"];
  const dash = capabilities.dash && capabilities.streamingProtocol === "dash";
  if (dash) {
    session.url = `/api/playback/${session.id}/manifest.mpd`; session.protocol = "dash"; session.segmentContainer = null;
    args.push("-f", "dash", "-seg_duration", String(SEGMENT_SECONDS), "-use_timeline", "1", "-use_template", "1",
      "-adaptation_sets", "id=0,streams=v id=1,streams=a", path.join(session.directory, "manifest.mpd"));
  } else {
    session.protocol = "hls";
    args.push("-avoid_negative_ts", "make_zero",
      "-f", "hls", "-hls_time", String(SEGMENT_SECONDS), "-hls_list_size", "0", "-hls_flags", "independent_segments+temp_file");
  const mpegTs = capabilities.hlsSegmentContainer === "mpegts";
  args.push("-hls_segment_type", mpegTs ? "mpegts" : "fmp4");
  if (!mpegTs) args.push("-hls_fmp4_init_filename", "v%v_init.mp4");
  args.push("-master_pl_name", "manifest.m3u8", "-var_stream_map",
    ladder.map((profile, index) => `v:${index},a:${index},name:${profile.height}p`).join(" "),
    "-hls_segment_filename", path.join(session.directory, `v%v_segment_%05d.${mpegTs ? "ts" : "m4s"}`),
    path.join(session.directory, "v%v_index.m3u8"));
  }
  const child = spawn(config.ffmpegPath, args, { cwd: session.directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  session.process = child; child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { session.stderr = `${session.stderr}${chunk}`.slice(-5000); });
  child.once("error", (error) => { session.status = "failed"; session.stderr = error.message; session.error = friendlyTranscodeError(error.message); rememberTranscodeFailure(session); });
  child.once("exit", (code) => {
    session.process = null;
    if (session.arretDemande) return;
    if (code === 0) {
      if (session.id) releaseSessionCost(session.id);
      if (session.status !== "failed") session.status = "completed";
      return;
    }
    // Même repli que sur le chemin à variante unique : un encodeur matériel qui refuse de démarrer
    // ramène la session sur le processeur au lieu de la faire échouer. Ce repli manquait ici, si bien
    // qu'un pilote défaillant se traduisait par « le transcodage a échoué » sans seconde chance.
    if (!forceSoftware && session.status === "starting" && encoder.encoder !== "libx264") {
      session.stderr = "";
      void (async () => {
        await rm(session.directory, { recursive: true, force: true });
        await startAdaptiveFfmpegSession(session, filePath, info, capabilities, video, audio, true);
      })().catch((error) => { session.status = "failed"; session.error = error instanceof Error ? error.message : String(error); });
      return;
    }
    if (session.id) releaseSessionCost(session.id);
    session.status = "failed"; session.error = friendlyTranscodeError(session.stderr); rememberTranscodeFailure(session);
  });
}

function mediaRow(mediaId: string): MediaPlaybackRow | null {
  return db.prepare(`
    SELECT id, kind, file_path, runtime_seconds, embedded_metadata_json FROM media_items
    WHERE id = ? AND available = 1 AND file_path IS NOT NULL
  `).get(mediaId) as MediaPlaybackRow | undefined ?? null;
}

export async function getPlaybackInfo(mediaId: string): Promise<PlaybackInfo | null> {
  const row = mediaRow(mediaId);
  if (!row) return null;
  let metadata = null;
  if (row.embedded_metadata_json) {
    try { metadata = parseProbeOutput(JSON.parse(row.embedded_metadata_json)); } catch { metadata = null; }
  }
  const hasStableIndexes = metadata?.streams.length
    && new Set(metadata.streams.map((stream) => stream.index)).size === metadata.streams.length;
  if (!hasStableIndexes) metadata = await probeMedia(row.file_path);
  else if (metadata) metadata = await enrichHdrFrameMetadata(metadata, row.file_path);
  const externalSubtitles = await findExternalSubtitles(row.file_path);
  const video = metadata?.streams.find((stream) => stream.type === "video") ?? null;
  const audio = metadata?.streams.filter((stream) => stream.type === "audio") ?? [];
  const subtitleFormats = [...new Set([...(metadata?.streams.filter((stream) => stream.type === "subtitle").map((stream) => stream.codec) ?? []),
    ...externalSubtitles.map((subtitle) => subtitle.format)])];
  const dynamicRange = video?.hdrFormat === "dolbyvision" ? "Dolby Vision" : video?.hdrFormat === "hdr10plus" ? "HDR10+"
    : video?.hdrFormat === "hdr10" ? "HDR10" : video?.hdrFormat === "hlg" ? "HLG" : "SDR";
  /**
   * Langue de tournage du film, ou `null` si le fournisseur ne l'a pas donnée.
   *
   * Elle sert au client à honorer la préférence audio « langue originale ». Sans elle, ce réglage
   * restait sans effet en lecture directe : le lecteur reçoit toutes les pistes et n'a aucun moyen de
   * savoir laquelle est l'originale — le japonais d'un film japonais ressemble en tout point au
   * japonais d'un doublage.
   */
  const originalLanguage = (db.prepare(`SELECT c.original_language AS langue
    FROM media_items m JOIN catalog_items c ON c.id = m.catalog_id WHERE m.id = ?`)
    .get(mediaId) as { langue: string | null } | undefined)?.langue ?? null;

  // Coûte deux à quatre millisecondes : quelques en-têtes lus, jamais les données.
  const container = containerFromPath(row.file_path);
  const trackHeadersAfterData = container === "matroska" || container === "webm"
    ? await pistesApresLesDonneesDuFichier(row.file_path) : false;

  /**
   * Passer le générique n'a de sens que sur une série.
   *
   * Un film n'en a qu'un, on le regarde ou on avance soi-même ; c'est l'épisode qu'on enchaîne vingt
   * fois de suite et dont l'introduction finit par lasser. La règle est posée ici, une fois, plutôt
   * que dans chacun des deux clients.
   */
  const marqueurs = marqueursGenerique(metadata?.chapters, metadata?.durationSeconds ?? row.runtime_seconds);
  /*
   * Ce que le fichier ne dit pas, la saison l'a peut-être déjà dit.
   *
   * Les chapitres passent en premier : ils sont dans le fichier, gratuits à relire, et toujours plus
   * sûrs qu'une déduction. Quand ils manquent, on lit ce qu'une passe de scan a établi depuis les
   * épisodes voisins. **On ne calcule rien ici** : un repère absent reste absent, et le lecteur ne
   * propose simplement rien plutôt que de faire attendre.
   */
  const deduits = marqueurs.creditsStartSeconds == null || marqueurs.intro == null
    ? marqueursDeduits(mediaId) : null;
  const creditsStartSeconds = marqueurs.creditsStartSeconds ?? deduits?.creditsStartSeconds ?? null;
  /*
   * Une introduction de provenance « chapitre » rangée en base n'est jamais servie ici.
   *
   * C'est une copie que la passe de repérage écrit pour sa file d'attente, pas une source. Si le
   * fichier a ses chapitres, ils ont déjà répondu deux lignes plus haut ; s'il ne les a plus — un
   * remultiplexage, un fichier remplacé —, la copie est périmée par définition. L'écarter coûte une
   * condition et évite de proposer un saut à un endroit qui n'existe plus.
   */
  const introDeduite = deduits?.sourceIntro !== "chapitre"
    && deduits?.introStartSeconds != null && deduits.introEndSeconds != null
    ? { startSeconds: deduits.introStartSeconds, endSeconds: deduits.introEndSeconds } : null;
  const intro = row.kind === "episode" ? marqueurs.intro ?? introDeduite : null;

  return {
    mediaId,
    container,
    trackHeadersAfterData,
    creditsStartSeconds,
    intro,
    durationSeconds: metadata?.durationSeconds ?? row.runtime_seconds,
    streams: metadata?.streams ?? [],
    formatLongName: metadata?.formatLongName ?? null,
    fileSize: metadata?.fileSize ?? null,
    overallBitRate: metadata?.overallBitRate ?? null,
    chapters: metadata?.chapters ?? [],
    externalSubtitles,
    originalLanguage,
    technologies: {
      resolution: !video ? null : displayResolution(video.width, video.height),
      dynamicRange, videoCodec: video?.codec ?? null,
      immersiveAudio: [...new Set(audio.flatMap((stream) => stream.audioTechnology === "dolby-atmos" ? ["Dolby Atmos" as const]
        : stream.audioTechnology === "dts-x" ? ["DTS:X" as const] : stream.audioTechnology === "auro-3d" ? ["Auro-3D" as const] : []))],
      audioCodecs: [...new Set(audio.map((stream) => stream.codec))], subtitleFormats,
      closedCaptions: Boolean(video?.closedCaptions),
    },
  };
}

/**
 * La planche de vignettes qui couvre un instant du film, produite en un seul passage.
 *
 * Chaque survol déclenchait auparavant son propre FFmpeg sur une tranche de dix secondes : jusqu'à
 * sept cent vingt processus pour balayer un film de deux heures, chacun avec une recherche dans un
 * fichier lourd, et précisément au moment où le NAS convertit déjà.
 *
 * Une planche regroupe cent vignettes — mille secondes de film. Le balayage d'un film entier coûte
 * donc huit processus au lieu de sept cent vingt, et le second passage ne coûte rien.
 *
 * La production reste **à la demande** plutôt qu'anticipée à l'analyse : préparer les planches de
 * toute la médiathèque ferait relire chaque fichier en entier, pour des films que personne
 * n'ouvrira. Une planche se fabrique quand on survole la portion qu'elle couvre.
 */
export async function getTimelineSheet(mediaId: string, planche: number): Promise<string | null> {
  const row = mediaRow(mediaId); if (!row) return null;
  const rang = Math.max(0, Math.floor(planche));
  const debutSecondes = debutDePlanche(rang);
  const duree = Math.max(0, row.runtime_seconds ?? 0);
  // Une planche entièrement au-delà de la fin n'a rien à montrer : la produire donnerait une image
  // noire, et la mettre en cache la rendrait définitive.
  if (duree > 0 && debutSecondes >= duree) return null;
  const directory = path.join(thumbnailRoot, mediaId.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const output = path.join(directory, `planche-${rang}.jpg`);
  try { await access(output); return output; } catch { /* génération nécessaire */ }
  const active = thumbnailJobs.get(output); if (active) return active;
  const job = (async () => {
    await mkdir(directory, { recursive: true });
    try {
      // `-ss` avant `-i` : la recherche se fait alors sur le conteneur plutôt qu'en décodant depuis le
      // début, ce qui est toute la différence entre une seconde et une minute sur un film de 4 Gio.
      //
      // Les vignettes sont mises à l'échelle **puis complétées de bandes** pour occuper exactement une
      // case : sans cela, la découpe côté interface dépendrait du rapport d'image de chaque film.
      await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", String(debutSecondes), "-t", String(VIGNETTE_SECONDES_PAR_PLANCHE), "-i", row.file_path,
        "-vf", `fps=1/${VIGNETTE_INTERVALLE_S},scale=${VIGNETTE_LARGEUR}:${VIGNETTE_HAUTEUR}:force_original_aspect_ratio=decrease,`
          + `pad=${VIGNETTE_LARGEUR}:${VIGNETTE_HAUTEUR}:(ow-iw)/2:(oh-ih)/2,tile=${VIGNETTE_COLONNES}x${VIGNETTE_LIGNES}`,
        "-frames:v", "1", "-q:v", "4", "-y", output],
      { windowsHide: true, timeout: 60_000, maxBuffer: 1_000_000 });
      return output;
    } catch { return null; }
    finally { thumbnailJobs.delete(output); }
  })();
  thumbnailJobs.set(output, job); return job;
}

const textSubtitleExtensions = new Set([".srt", ".ass", ".ssa", ".vtt", ".ttml", ".dfxp", ".smi", ".sami", ".sbv", ".mpl2", ".sub"]);
const imageSubtitleExtensions = new Set([".idx", ".sup"]);
const subtitleExtensions = new Set([...textSubtitleExtensions, ...imageSubtitleExtensions]);
const languageAliases: Record<string, string> = {
  fre: "fr", fra: "fr", eng: "en", ger: "de", deu: "de", spa: "es", ita: "it", por: "pt",
  dut: "nl", nld: "nl", jpn: "ja", kor: "ko", chi: "zh", zho: "zh", rus: "ru", ara: "ar",
  pol: "pl", tur: "tr", cze: "cs", ces: "cs", hun: "hu", rum: "ro", ron: "ro", swe: "sv",
  nor: "no", dan: "da", fin: "fi", ukr: "uk", heb: "he", gre: "el", ell: "el",
};

export function normalizeSubtitleLanguage(value: string | null | undefined): string | null {
  const candidate = value?.trim().replace(/_/g, "-");
  if (!candidate || /^(?:und|unknown|mul|zxx)$/i.test(candidate)) return null;
  const match = /^([a-z]{2,3})(?:-([a-z]{2}|\d{3}))?$/i.exec(candidate);
  if (!match) return null;
  const baseLanguage = match[1]!.toLowerCase();
  const primary = languageAliases[baseLanguage] ?? baseLanguage;
  return match[2] ? `${primary}-${match[2].toUpperCase()}` : primary;
}

export function detectSubtitleEncoding(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return "utf-8"; } catch { return "windows-1252"; }
}

function subtitleTimestamp(seconds: number): string {
  const bounded = Math.max(0, seconds);
  const milliseconds = Math.round((bounded % 1) * 1000);
  const totalSeconds = Math.floor(bounded);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function parseSubtitleTimestamp(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (/^\d+(?:\.\d+)?ms$/i.test(normalized)) return Number.parseFloat(normalized) / 1000;
  if (/^\d+(?:\.\d+)?s$/i.test(normalized)) return Number.parseFloat(normalized);
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop()); const minutes = Number(parts.pop()); const hours = parts.length ? Number(parts.pop()) : 0;
  return [seconds, minutes, hours].every(Number.isFinite) ? hours * 3600 + minutes * 60 + seconds : null;
}

function decodeSubtitleEntities(value: string): string {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/<(?!\/?(?:i|b|u|c)(?:\s|>|\.))[^>]+>/gi, "").trim();
}

interface SubtitleCue { start: number; end: number; text: string }
function cuesToWebVtt(cues: SubtitleCue[], offsetSeconds: number): string {
  return `WEBVTT\n\n${cues.filter((cue) => cue.end > cue.start).map((cue) =>
    `${subtitleTimestamp(cue.start + offsetSeconds)} --> ${subtitleTimestamp(cue.end + offsetSeconds)}\n${decodeSubtitleEntities(cue.text)}`)
    .join("\n\n")}\n`;
}

export function convertTextSubtitleToWebVtt(format: string, source: string, offsetSeconds = 0, frameRate = 25): string | null {
  const normalizedFormat = format.toLowerCase();
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues: SubtitleCue[] = [];
  if (["srt", "vtt", "webvtt"].includes(normalizedFormat)) {
    const timing = /^((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const match = timing.exec(lines[index]!.trim()); if (!match) continue;
      const start = parseSubtitleTimestamp(match[1]!); const end = parseSubtitleTimestamp(match[2]!); const body: string[] = [];
      while (++index < lines.length && lines[index]!.trim()) body.push(lines[index]!);
      if (start != null && end != null) cues.push({ start, end, text: body.join("\n") });
    }
  } else if (normalizedFormat === "sbv" || normalizedFormat === "subviewer") {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^([^,]+),([^,]+)$/.exec(lines[index]!.trim()); if (!match) continue;
      const start = parseSubtitleTimestamp(match[1]!); const end = parseSubtitleTimestamp(match[2]!); const body: string[] = [];
      while (++index < lines.length && lines[index]!.trim()) body.push(lines[index]!);
      if (start != null && end != null) cues.push({ start, end, text: body.join("\n") });
    }
  } else if (normalizedFormat === "sub" || normalizedFormat === "microdvd") {
    for (const line of text.split("\n")) {
      const match = /^\{(\d+)\}\{(\d+)\}(.*)$/.exec(line); if (!match) continue;
      cues.push({ start: Number(match[1]) / frameRate, end: Number(match[2]) / frameRate, text: match[3]!.replace(/\|/g, "\n") });
    }
  } else if (normalizedFormat === "mpl2") {
    for (const line of text.split("\n")) {
      const match = /^\[(\d+)\]\[(\d+)\](.*)$/.exec(line); if (!match) continue;
      cues.push({ start: Number(match[1]) / 10, end: Number(match[2]) / 10, text: match[3]!.replace(/\|/g, "\n") });
    }
  } else if (["ttml", "dfxp"].includes(normalizedFormat)) {
    for (const match of text.matchAll(/<p\b[^>]*\bbegin=["']([^"']+)["'][^>]*\bend=["']([^"']+)["'][^>]*>([\s\S]*?)<\/p>/gi)) {
      const start = parseSubtitleTimestamp(match[1]!); const end = parseSubtitleTimestamp(match[2]!);
      if (start != null && end != null) cues.push({ start, end, text: match[3]! });
    }
  } else if (["smi", "sami"].includes(normalizedFormat)) {
    const syncs = [...text.matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync\b|$)/gi)];
    for (let index = 0; index < syncs.length; index += 1) {
      const start = Number(syncs[index]![1]) / 1000;
      const nextStart = syncs[index + 1] ? Number(syncs[index + 1]![1]) / 1000 : start + 4;
      const body = syncs[index]![2]!.replace(/<p\b[^>]*>/gi, "");
      if (!/&nbsp;\s*$/i.test(body.trim())) cues.push({ start, end: nextStart, text: body });
    }
  } else return null;
  return cues.length ? cuesToWebVtt(cues, normalizedSubtitleOffset(offsetSeconds)) : null;
}

export function parseExternalSubtitleName(mediaBase: string, filename: string): Omit<NonNullable<PlaybackInfo["externalSubtitles"]>[number], "id" | "encoding"> | null {
  const extension = path.extname(filename).toLowerCase();
  const stem = path.basename(filename, extension);
  if (!subtitleExtensions.has(extension) || !stem.toLowerCase().startsWith(mediaBase.toLowerCase())) return null;
  const suffix = stem.slice(mediaBase.length).replace(/^[. _-]+/, "");
  const tokens = suffix.split(/[. _]+/).filter(Boolean);
  const attributeTokens = new Set(["forced", "force", "forcé", "forc", "sdh", "hi", "cc", "sme", "default", "commentary"]);
  const language = tokens.filter((token) => !attributeTokens.has(token.toLowerCase()))
    .map(normalizeSubtitleLanguage).find(Boolean) ?? null;
  const kind = imageSubtitleExtensions.has(extension) ? "image" : "text";
  const format = extension === ".idx" ? "vobsub" : extension === ".sup" ? "pgs" : extension === ".dfxp" ? "ttml" : extension.slice(1);
  return {
    name: filename, format, kind, language,
    forced: tokens.some((token) => /^(?:forced?|forc[eé])$/i.test(token)),
    hearingImpaired: tokens.some((token) => /^(?:sdh|hi|cc|sme)$/i.test(token)),
    canConvertToWebVtt: kind === "text",
  };
}

export async function findExternalSubtitles(filePath: string): Promise<NonNullable<PlaybackInfo["externalSubtitles"]>> {
  const directory = path.dirname(filePath); const mediaBase = path.basename(filePath, path.extname(filePath));
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
    const discovered = await Promise.all(entries.flatMap((entry) => {
      if (!entry.isFile()) return [];
      const extension = path.extname(entry.name).toLowerCase();
      const stem = path.basename(entry.name, extension);
      if (extension === ".sub" && names.has(`${stem.toLowerCase()}.idx`)) return [];
      const parsed = parseExternalSubtitleName(mediaBase, entry.name);
      if (!parsed) return [];
      return [async () => ({ ...parsed, encoding: parsed.kind === "text"
        ? detectSubtitleEncoding(await readFile(path.join(directory, entry.name))) : null })];
    }).map((factory) => factory()));
    return discovered.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
      .map((subtitle, id) => ({ ...subtitle, id }));
  } catch { return []; }
}

/**
 * Borne du décalage de sous-titres, en secondes.
 *
 * Elle valait dix minutes, ce qui convient à un réglage de synchronisation — l'interface ne propose
 * d'ailleurs pas davantage. Mais ce même paramètre porte aussi le décalage de la **fenêtre encodée**
 * : après un saut à une heure trente de film, le client demande un décalage de −5400 secondes pour
 * ramener les sous-titres au temps du flux. La borne à dix minutes l'écrasait silencieusement, et les
 * sous-titres restaient décalés de tout le reste.
 *
 * Vingt-quatre heures couvre n'importe quelle position dans n'importe quel film, tout en gardant une
 * valeur bornée — le nombre finit dans un nom de fichier de cache.
 */
function normalizedSubtitleOffset(offsetSeconds: number | undefined): number {
  return Math.max(-86400, Math.min(86400, Number.isFinite(offsetSeconds) ? offsetSeconds ?? 0 : 0));
}

export async function extractExternalSubtitle(mediaId: string, subtitleId: number, offsetSeconds = 0,
  encodingOverride: string | undefined = "auto"): Promise<{ path: string; contentType: string } | null> {
  const row = mediaRow(mediaId); if (!row) return null;
  const subtitles = await findExternalSubtitles(row.file_path); const subtitle = subtitles.find((item) => item.id === subtitleId);
  if (!subtitle?.canConvertToWebVtt) return null;
  const inputPath = path.join(path.dirname(row.file_path), subtitle.name);
  if (path.dirname(inputPath) !== path.dirname(row.file_path)) return null;
  await mkdir(subtitleRoot, { recursive: true });
  const offset = normalizedSubtitleOffset(offsetSeconds);
  const offsetKey = Math.round(offset * 1000);
  const allowedEncodings = new Set(["utf-8", "utf-16le", "utf-16be", "windows-1252"]);
  const encoding = allowedEncodings.has(encodingOverride) ? encodingOverride : subtitle.encoding;
  const encodingKey = (encoding ?? "auto").replace(/[^a-z0-9-]/g, "");
  const outputPath = path.resolve(subtitleRoot, `${mediaId}-external-${subtitleId}-${offsetKey}-${encodingKey}.vtt`);
  try { await access(outputPath); return { path: outputPath, contentType: "text/vtt; charset=utf-8" }; } catch { /* conversion */ }
  const encodingArgs = encoding && encoding !== "utf-8" ? ["-sub_charenc", encoding] : [];
  if (["srt", "vtt", "webvtt", "sbv", "sub", "mpl2", "ttml", "smi", "sami"].includes(subtitle.format)) {
    const bytes = await readFile(inputPath);
    const decoded = new TextDecoder(encoding ?? "utf-8").decode(bytes);
    const converted = convertTextSubtitleToWebVtt(subtitle.format, decoded, offset);
    if (!converted) return null;
    await writeFile(outputPath, converted, "utf8");
    return { path: outputPath, contentType: "text/vtt; charset=utf-8" };
  }
  const { stdout } = await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", ...encodingArgs,
    ...(offset ? ["-itsoffset", String(offset)] : []), "-i", inputPath, "-f", "webvtt", "pipe:1"],
    { windowsHide: true, timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  await writeFile(outputPath, stdout, "utf8");
  return { path: outputPath, contentType: "text/vtt; charset=utf-8" };
}

function streamByIndex(streams: MediaStream[], index: number | null, type: MediaStream["type"]): MediaStream | null {
  const candidates = streams.filter((stream) => stream.type === type);
  if (index != null) return candidates.find((stream) => stream.index === index) ?? null;
  return candidates.find((stream) => stream.isDefault) ?? candidates[0] ?? null;
}

export function selectPreferredAudioStream(streams: MediaStream[], preferredLanguages: string[] = []): MediaStream | null {
  const audio = streams.filter((stream) => stream.type === "audio");
  if (!audio.length) return null;
  for (const requested of preferredLanguages.map((value) => value.trim().toLowerCase())) {
    if (requested === "commentary") {
      const match = audio.find((stream) => stream.audioRole === "commentary"); if (match) return match;
      continue;
    }
    if (["audio-description", "audiodescription", "description"].includes(requested)) {
      const match = audio.find((stream) => stream.audioRole === "audio-description"); if (match) return match;
      continue;
    }
    if (requested === "original") {
      const match = audio.find((stream) => stream.audioRole === "original");
      if (match) return match;
      continue;
    }
    const language = normalizeSubtitleLanguage(requested);
    const match = audio.find((stream) => normalizeSubtitleLanguage(stream.language) === language
      && stream.audioRole !== "commentary" && stream.audioRole !== "audio-description");
    if (match) return match;
  }
  const normal = audio.filter((stream) => stream.audioRole !== "commentary" && stream.audioRole !== "audio-description");
  return normal.find((stream) => stream.isDefault) ?? normal.find((stream) => stream.audioRole === "original") ?? normal[0] ?? audio[0] ?? null;
}

function codecSupported(list: string[], codec: string | undefined): boolean {
  if (!codec) return true;
  const aliases: Record<string, string[]> = {
    h264: ["h264", "avc1"], hevc: ["hevc", "h265", "hvc1", "hev1"], av1: ["av1", "av01"],
    vp9: ["vp9", "vp09"], vp8: ["vp8", "vp08"], aac: ["aac", "mp4a"], eac3: ["eac3", "ec-3"],
    ac3: ["ac3", "ac-3"], opus: ["opus"], vorbis: ["vorbis"], mp3: ["mp3"], flac: ["flac"],
  };
  const accepted = new Set(list.map((item) => item.toLowerCase()));
  return (aliases[codec] ?? [codec]).some((alias) => accepted.has(alias));
}

/**
 * Ce que la négociation seule a le droit de décider.
 *
 * L'essai de lecture directe — servir le fichier tel quel malgré un désaccord annoncé — n'est proposé
 * que sur le chemin de négociation, et jamais lorsqu'une session est déjà lancée.
 *
 * La raison est mécanique : `startFfmpegSession` recalcule la décision pour construire sa ligne de
 * commande. Si « direct » pouvait en sortir, aucune branche ne poserait `-c:v copy` ni ne choisirait
 * d'encodeur, et ffmpeg réencoderait au hasard de ses défauts. Une fois la session créée, la question
 * de l'essai est tranchée : la rouvrir n'apporterait rien et casserait la commande.
 */
export interface OptionsDecision {
  /** Codecs déjà mis en quarantaine sur cet appareil, avant tout filtrage des capacités. */
  codecsEnQuarantaine?: string[];
  /** Autoriser un essai direct malgré un désaccord franc. Réservé à la négociation. */
  autoriserEssaiDirect?: boolean;
  /** Le plafond de définition a été abaissé par un réglage, et non annoncé par le client. */
  plafondDefinitionImpose?: boolean;
}

export function decidePlayback(info: PlaybackInfo, capabilities: PlaybackCapabilities, options: OptionsDecision = {}): {
  mode: PlaybackMode;
  reason: string;
  video: MediaStream | null;
  audio: MediaStream | null;
  subtitle: MediaStream | null;
  toneMap: boolean;
  reasons: string[];
  transcodeVideo: boolean;
  transcodeAudio: boolean;
} {
  const video = streamByIndex(info.streams, null, "video");
  const audio = capabilities.audioStreamIndex != null ? streamByIndex(info.streams, capabilities.audioStreamIndex, "audio")
    : selectPreferredAudioStream(info.streams, capabilities.preferredAudioLanguages);
  const firstAudio = info.streams.find((stream) => stream.type === "audio") ?? null;
  // Un navigateur reçoit toutes les pistes pendant un Direct Play, mais Chrome/Edge ne proposent
  // aucune API fiable pour en activer une. Ils jouent alors la première, même si une autre piste est
  // marquée `default` dans le MKV. Le remux est obligatoire dès que la piste voulue diffère ; la
  // vidéo reste copiée bit pour bit. Media3 annonce explicitement qu'il sait faire cette sélection.
  const directAudioSelectionCompatible = capabilities.directAudioStreamSelection !== false
    || !audio || !firstAudio || audio.index === firstAudio.index;
  // Le HTMLVideoElement ne sait pas imposer une piste secondaire du MKV. L'isoler dans un fMP4
  // corrige bien la langue, mais recopier son E-AC-3 tel quel a révélé un second défaut sur
  // Chrome/Edge : MediaSource l'accepte, puis le restitue avec un retard audible alors que les PTS
  // produits par FFmpeg sont identiques à ceux de l'image. The Drama est notre preuve de référence :
  // ses VO/VF sont corrélées à 0 ms dans la source et le HLS commence les deux flux à 83 ms.
  //
  // La normalisation ne concerne donc que ce cas navigateur très précis. La vidéo reste copiée bit
  // pour bit et Media3, qui sait sélectionner une piste du MKV, ne passe jamais par cette branche.
  const secondaryBrowserAudioNeedsStableTimeline = capabilities.directAudioStreamSelection === false
    && Boolean(audio && firstAudio && audio.index !== firstAudio.index);
  const subtitle = streamByIndex(info.streams, capabilities.subtitleStreamIndex, "subtitle");
  const hdrDelivery = hdrDeliveryFormat(video, capabilities);
  // Une demande explicite de la personne l'emporte sur la négociation automatique. « sdr » force la
  // conversion d'une source HDR — un rendu HDR peut paraître délavé sur un écran mal étalonné.
  // « hdr » conserve la plage dynamique même si l'appareil ne l'annonce pas : un écran peut être
  // compatible sans que le navigateur le déclare, et la personne le sait mieux que la sonde.
  const hdrOverride = capabilities.dynamicRangePreference ?? "auto";
  const requiresHdrSignalingRemux = !["auto", "hdr", "sdr"].includes(hdrOverride)
    && hdrDelivery.compatible && hdrDelivery.format !== video?.hdrFormat;
  const sourceIsHdr = Boolean(video?.hdr);
  const hdrCompatible = hdrOverride === "sdr" && sourceIsHdr ? false
    : hdrOverride === "hdr" && sourceIsHdr ? true
      : hdrDelivery.compatible;
  const mediaBitrate = info.overallBitRate ?? video?.bitRate ?? null;
  /**
   * Le débit annoncé ne décide plus de la compatibilité ; seul un plafond constaté le fait.
   *
   * La règle appliquait un coussin de vingt pour cent à `networkMbps` — un fichier de 26,5 Mb/s était
   * donc refusé sur un chemin mesuré à 29,4, qui le portait sans peine. Et ce chiffre est relevé par
   * hls.js **pendant la session en cours** : pendant une conversion il mesure la vitesse de l'encodeur
   * et non celle du réseau. Le refus fermait donc un cercle — on convertit, c'est lent, donc le réseau
   * est déclaré insuffisant, donc on convertit — dont rien ne pouvait sortir.
   *
   * Le coût de l'erreur était maximal : ce verdict entre dans `videoCompatible`, si bien qu'il
   * écartait le remux, qui **copie** l'image, au profit d'un transcodage complet. Le NAS se voyait
   * confier le travail le plus lourd à cause d'une estimation qu'il avait lui-même faussée.
   *
   * `maxVideoBitrate`, lui, reste : le client ne le pose qu'après deux coupures réelles pendant une
   * lecture réelle. Il consigne un fait, non une prudence. Et si le réseau ne suit vraiment pas, c'est
   * ce même mécanisme qui le constatera en deux coupures et redemandera une session plafonnée.
   */
  const bitrateCompatible = !capabilities.maxVideoBitrate || !video?.bitRate
    || video.bitRate <= capabilities.maxVideoBitrate;
  const videoCodecCompatible = codecSupported(capabilities.videoCodecs, video?.codec);
  const resolutionCompatible = (video?.width ?? 0) <= capabilities.maxWidth && (video?.height ?? 0) <= capabilities.maxHeight;
  const videoCompatible = videoCodecCompatible && resolutionCompatible && hdrCompatible && bitrateCompatible;
  const immersiveCompatible = !audio || !audio.audioTechnology || audio.audioTechnology === "standard"
    || capabilities.immersiveAudioFormats.includes(audio.audioTechnology);
  const audioProcessingRequested = Boolean(capabilities.audioNormalization || capabilities.nightMode
    || (capabilities.audioOutputMode && !["auto", "copy"].includes(capabilities.audioOutputMode)));
  const audioCompatible = codecSupported(capabilities.audioCodecs, audio?.codec)
    && (!audio?.dolbyAtmos || capabilities.dolbyAtmos)
    && immersiveCompatible
    && (!audio?.losslessAudio || capabilities.losslessAudio) && !audioProcessingRequested
    && !secondaryBrowserAudioNeedsStableTimeline;
  /**
   * Un fichier dont les pistes sont définies après les données ne se lit pas en direct partout.
   *
   * Media3 analyse le flux linéairement : il atteint les données sans avoir vu la moindre définition
   * de piste, et joue alors une image noire, sans son et sans avance rapide — **sans lever d'erreur**,
   * donc sans qu'aucun repli ne se déclenche. FFmpeg et les navigateurs, eux, suivent le renvoi du
   * `SeekHead` et n'y voient que du feu ; c'est pourquoi le même épisode marche sur le Web.
   *
   * Le repli est un remux : l'image et le son sont copiés au bit près, seul l'en-tête est réécrit en
   * tête de flux. Aucune conversion, aucune perte.
   *
   * Un client qui ne dit rien est présumé savoir faire — c'était le cas de tous jusqu'à r68. La
   * présomption s'inverse pour Android, dont on sait qu'il ne sait pas : ses versions antérieures
   * sont ainsi corrigées par le serveur seul, sans attendre une mise à jour de l'application.
   */
  const demultiplexeurLineaire = capabilities.seekableTrackHeaders === false
    || (capabilities.seekableTrackHeaders == null && ["mobile", "tv"].includes(capabilities.deviceClass ?? ""));
  const entetesInaccessibles = Boolean(info.trackHeadersAfterData) && demultiplexeurLineaire;
  const containerCompatible = capabilities.containers.includes(info.container as "mp4" | "webm" | "mpegts" | "matroska" | "avi" | "mov")
    && !entetesInaccessibles;
  const requiresBurn = Boolean((subtitle || capabilities.externalSubtitleId != null) && capabilities.burnSubtitles);
  const reasons: string[] = [];
  if (entetesInaccessibles) reasons.push("Pistes définies en fin de fichier : ce lecteur ne les y trouverait pas");
  else if (!containerCompatible) reasons.push(`Conteneur ${info.container} non pris en charge`);
  if (!videoCodecCompatible) reasons.push(`Codec vidéo ${video?.codec ?? "inconnu"} non pris en charge`);
  if (!resolutionCompatible) reasons.push(`Définition supérieure à ${capabilities.maxWidth}×${capabilities.maxHeight}`);
  if (!hdrCompatible) reasons.push(`${hdrLabels[video?.hdrFormat ?? "hdr10"]} non pris en charge par cet appareil`);
  else if (hdrDelivery.viaBaseLayer) reasons.push(`${hdrLabels[video!.hdrFormat]} lu via sa couche de base ${hdrLabels[hdrDelivery.format]}`);
  if (!bitrateCompatible) reasons.push("Débit au-dessus du plafond posé après des coupures");
  if (!codecSupported(capabilities.audioCodecs, audio?.codec)) reasons.push(`Codec audio ${audio?.codec ?? "inconnu"} non pris en charge`);
  if (!immersiveCompatible || (audio?.dolbyAtmos && !capabilities.dolbyAtmos)) reasons.push("Audio immersif non pris en charge");
  if (audio?.losslessAudio && !capabilities.losslessAudio) reasons.push("Audio sans perte non pris en charge");
  if (capabilities.audioNormalization) reasons.push("Normalisation audio demandée");
  if (capabilities.nightMode) reasons.push("Mode nuit demandé");
  if (capabilities.audioOutputMode && !["auto", "copy"].includes(capabilities.audioOutputMode)) reasons.push(`Conversion audio ${capabilities.audioOutputMode.toUpperCase()} demandée`);
  if (!directAudioSelectionCompatible) reasons.push("Le lecteur Web ne peut pas imposer cette piste dans le fichier servi entier");
  if (secondaryBrowserAudioNeedsStableTimeline) reasons.push("Piste Web secondaire convertie en AAC pour garantir la synchronisation");
  if (requiresBurn) reasons.push("Sous-titres à incruster");
  if (requiresHdrSignalingRemux) reasons.push(`Signal ${hdrLabels[hdrDelivery.format]} demandé explicitement`);

  if (capabilities.modePreference === "direct" && !requiresBurn && !requiresHdrSignalingRemux
    && directAudioSelectionCompatible && !entetesInaccessibles) {
    return { mode: "direct", reason: "Lecture directe demandée par l'utilisateur",
      reasons: reasons.length ? ["Tentative directe malgré :", ...reasons] : ["Tous les flux sélectionnés sont compatibles"],
      video, audio, subtitle, toneMap: false, transcodeVideo: false, transcodeAudio: false };
  }

  if (capabilities.modePreference !== "compatible" && capabilities.modePreference !== "remux"
    && containerCompatible && videoCompatible && audioCompatible && directAudioSelectionCompatible
    && !requiresBurn && !requiresHdrSignalingRemux) {
    return { mode: "direct", reason: "Lecture directe sans conversion", reasons: ["Tous les flux sélectionnés sont compatibles"],
      video, audio, subtitle, toneMap: false, transcodeVideo: false, transcodeAudio: false };
  }
  // L'essai de lecture directe, quand le désaccord annoncé mérite d'être mis à l'épreuve.
  //
  // Il se place **avant** le remux, sans quoi il ne servirait à rien dans le cas le plus fréquent :
  // un MKV dont l'image et le son conviennent part aujourd'hui en remux pour le seul conteneur, et
  // c'est ce remux — copie d'une source 4K, des dizaines de gigaoctets écrits sur le NAS — qu'on
  // cherche à éviter. `essaiDirectPertinent` porte la limite : voir ce module pour ce qui se parie et
  // ce qui ne se parie jamais.
  if (options.autoriserEssaiDirect && capabilities.modePreference !== "compatible"
    && capabilities.modePreference !== "remux" && !requiresHdrSignalingRemux) {
    const essai = essaiDirectPertinent({
      entetesEnFinDeFichier: entetesInaccessibles,
      sousTitresAIncruster: requiresBurn,
      traitementAudioDemande: audioProcessingRequested,
      // Sur Media3, un choix manuel non défaut doit être respecté. Sur le Web, même une piste marquée
      // par défaut n'est pas sûre si elle n'est pas la première : Chrome/Edge l'ont démontré sur
      // The Drama. Dans les deux cas le remux copie la vidéo et isole exactement la piste voulue.
      pisteAudioImposee: !directAudioSelectionCompatible
        || (capabilities.audioStreamIndex != null && Boolean(audio) && !audio!.isDefault),
      // Le nombre de canaux est délibérément absent : il décrit la sortie de l'appareil, pas son
      // décodeur, et le lecteur mixe lui-même comme le ferait le serveur. Ne restent que les cas où
      // aucun son ne sortirait.
      codecAudioDecodable: codecSupported(capabilities.audioCodecs, audio?.codec)
        && (!audio?.dolbyAtmos || capabilities.dolbyAtmos)
        && immersiveCompatible
        && (!audio?.losslessAudio || capabilities.losslessAudio),
      definitionCompatible: resolutionCompatible,
      plafondDefinitionChoisi: Boolean(options.plafondDefinitionImpose),
      // La quarantaine est consultée ici sur la liste **brute**, et non sur les capacités déjà
      // filtrées : `withoutQuarantined` a retiré le codec défaillant, ce qui le fait justement
      // ressembler à un codec « non déclaré » — le cas même où l'on voudrait parier. Sans cette
      // vérification séparée, l'essai retenterait à chaque lecture ce dont l'échec est établi.
      codecEnQuarantaine: Boolean(video?.codec
        && (options.codecsEnQuarantaine ?? []).includes(video.codec.toLowerCase())),
      // `networkMbps` est délibérément absent : relevé pendant une session convertie, il mesure
      // l'encodeur et non le réseau. Seul le plafond posé après des coupures constatées fait foi.
      debitSousLePlafondConstate:
        !capabilities.maxVideoBitrate || !video?.bitRate || video.bitRate <= capabilities.maxVideoBitrate,
    });
    if (essai.tenter) {
      return { mode: "direct", reason: "Lecture directe tentée d'abord", reasons: [essai.motif, ...reasons],
        video, audio, subtitle, toneMap: false, transcodeVideo: false, transcodeAudio: false };
    }
  }

  if (capabilities.modePreference !== "compatible" && capabilities.hls && videoCompatible && !requiresBurn) {
    return {
      mode: "remux",
      reason: audioCompatible ? "Vidéo et audio copiés dans un conteneur HLS"
        : `Vidéo copiée et audio converti en ${(capabilities.audioOutputMode && !["auto", "copy"].includes(capabilities.audioOutputMode)) ? capabilities.audioOutputMode.toUpperCase() : "AAC"}`,
      reasons, video, audio, subtitle, toneMap: false, transcodeVideo: false, transcodeAudio: !audioCompatible,
    };
  }
  return {
    mode: "transcode",
    reason: requiresBurn ? "Sous-titres incrustés dans l'image" : "Codec, définition ou HDR non compatible avec le client",
    reasons, video, audio, subtitle, toneMap: Boolean(video?.hdr && !hdrCompatible), transcodeVideo: true, transcodeAudio: !audioCompatible,
  };
}

export function parseFfmpegComponentList(output: string): Set<string> {
  const result = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const component = line.match(/^\s*[A-Z.]{2,6}\s+([a-zA-Z0-9_,-]+)/)?.[1];
    if (component) for (const name of component.split(",")) result.add(name.toLowerCase());
  }
  return result;
}

export function parseFfmpegFormats(output: string): { demuxers: Set<string>; muxers: Set<string> } {
  const demuxers = new Set<string>(); const muxers = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([D ])([E ])\s+([a-zA-Z0-9_,-]+)/);
    if (!match) continue;
    for (const name of match[3]!.split(",")) {
      if (match[1] === "D") demuxers.add(name.toLowerCase());
      if (match[2] === "E") muxers.add(name.toLowerCase());
    }
  }
  return { demuxers, muxers };
}

function hasAny(values: Set<string>, aliases: string[]): boolean { return aliases.some((alias) => values.has(alias)); }

export function buildCompatibilityMatrix(support: FfmpegSupport): PlaybackCompatibilityMatrix {
  const capability = (id: string, label: string, component: "decoder" | "encoder" | "demuxer" | "muxer" | "filter",
    aliases: string[], fallback: string | null) => ({ id, label, component, available: hasAny(
      component === "decoder" ? support.decoders : component === "encoder" ? support.encoders
        : component === "demuxer" ? support.demuxers : component === "muxer" ? support.muxers : support.filters,
      aliases,
    ), fallback });
  const video = [
    capability("h264", "H.264 / AVC", "decoder", ["h264"], "H.264"),
    capability("hevc", "HEVC / H.265", "decoder", ["hevc"], "H.264"),
    capability("av1", "AV1", "decoder", ["av1", "libdav1d"], "H.264"),
    capability("vp9", "VP9", "decoder", ["vp9"], "H.264"),
    capability("vp8", "VP8", "decoder", ["vp8"], "H.264"),
    capability("mpeg2video", "MPEG-2 Video", "decoder", ["mpeg2video"], "H.264"),
    capability("vc1", "VC-1", "decoder", ["vc1"], "H.264"),
    capability("prores", "Apple ProRes", "decoder", ["prores"], "H.264"),
    capability("theora", "Theora", "decoder", ["theora"], "H.264"),
  ];
  const audio = [
    capability("aac", "AAC", "decoder", ["aac"], "AAC"),
    capability("mp3", "MP3", "decoder", ["mp3", "mp3float"], "AAC"),
    capability("opus", "Opus", "decoder", ["opus", "libopus"], "AAC"),
    capability("vorbis", "Vorbis", "decoder", ["vorbis"], "AAC"),
    capability("flac", "FLAC", "decoder", ["flac"], "AAC"),
    capability("alac", "ALAC", "decoder", ["alac"], "AAC"),
    capability("pcm", "PCM", "decoder", ["pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le"], "AAC"),
    capability("ac3", "Dolby Digital / AC-3", "decoder", ["ac3"], "AAC"),
    capability("eac3", "Dolby Digital Plus / E-AC-3", "decoder", ["eac3"], "AAC"),
    capability("truehd", "Dolby TrueHD / Atmos", "decoder", ["truehd"], "AAC multicanal"),
    capability("dts", "DTS / DTS-HD / DTS:X", "decoder", ["dca", "dts"], "AAC multicanal"),
  ];
  const containers = [
    capability("mov", "MP4 / MOV / M4V", "demuxer", ["mov", "mp4", "m4a", "3gp"], "HLS"),
    capability("matroska", "MKV / Matroska", "demuxer", ["matroska", "webm"], "HLS"),
    capability("webm", "WebM", "demuxer", ["matroska", "webm"], "HLS"),
    capability("avi", "AVI", "demuxer", ["avi"], "HLS"),
    capability("mpegts", "MPEG-TS / M2TS", "demuxer", ["mpegts"], "HLS"),
    capability("ogg", "OGG / OGM", "demuxer", ["ogg"], "HLS"),
  ];
  const subtitles = [
    capability("srt", "SRT / SubRip", "decoder", ["subrip", "srt"], "WebVTT"),
    capability("ass", "ASS / SSA", "decoder", ["ass", "ssa"], "WebVTT ou incrustation"),
    capability("webvtt", "WebVTT", "decoder", ["webvtt"], "WebVTT"),
    capability("mov_text", "Timed Text", "decoder", ["mov_text"], "WebVTT"),
    capability("pgs", "PGS", "decoder", ["pgssub", "hdmv_pgs_subtitle"], "Incrustation"),
    capability("dvd", "VobSub", "decoder", ["dvdsub", "dvd_subtitle"], "Incrustation"),
    capability("dvb", "DVB Subtitle", "decoder", ["dvbsub", "dvb_subtitle"], "Incrustation"),
    capability("cea", "CEA-608 / CEA-708", "decoder", ["cc_dec", "eia_608"], "Extraction ou incrustation"),
  ];
  const processing = [
    capability("h264-output", "Sortie H.264", "encoder", ["libx264", "h264_nvenc", "h264_qsv", "h264_vaapi", "h264_amf"], null),
    capability("aac-output", "Sortie AAC", "encoder", ["aac", "libfdk_aac"], null),
    capability("ac3-output", "Sortie Dolby Digital / AC-3", "encoder", ["ac3", "ac3_fixed"], "AAC multicanal"),
    capability("opus-output", "Sortie Opus", "encoder", ["libopus", "opus"], "AAC multicanal"),
    capability("hls-output", "Sortie HLS", "muxer", ["hls"], null),
    capability("scale", "Redimensionnement", "filter", ["scale", "scale_vaapi", "scale_qsv", "scale_cuda"], null),
    capability("subtitles", "Rendu sous-titres texte", "filter", ["subtitles", "ass"], "Incrustation image"),
    capability("overlay", "Composition sous-titres image", "filter", ["overlay"], null),
    capability("tonemap", "Tone mapping HDR → SDR", "filter", ["tonemap", "tonemap_vaapi", "tonemap_opencl", "libplacebo"], "Lecture HDR directe"),
    capability("loudnorm", "Normalisation EBU R128", "filter", ["loudnorm"], "Volume source"),
    capability("audio-dynamics", "Mode nuit et anti-écrêtage", "filter", ["acompressor", "alimiter"], "Conversion sans traitement dynamique"),
  ];
  const vulkan = support.hwaccels.has("vulkan");
  const colorPipelines = [
    { id: "tonemap-libplacebo", label: "Tone mapping libplacebo / Vulkan", component: "filter" as const,
      available: support.filters.has("libplacebo") && vulkan, fallback: "zscale logiciel" },
    { id: "tonemap-vaapi", label: "Tone mapping VA-API", component: "filter" as const,
      available: support.filters.has("tonemap_vaapi") && support.hwaccels.has("vaapi"), fallback: "zscale logiciel" },
    { id: "tonemap-opencl", label: "Tone mapping OpenCL", component: "filter" as const,
      available: support.filters.has("tonemap_opencl") && support.hwaccels.has("opencl"), fallback: "zscale logiciel" },
    { id: "tonemap-zscale", label: "Tone mapping logiciel zscale", component: "filter" as const,
      available: support.filters.has("zscale") && support.filters.has("tonemap"), fallback: "Lecture HDR directe uniquement" },
    { id: "hdr10-output", label: "Sortie HEVC 10 bits HDR10", component: "encoder" as const,
      available: hdrCapableEncoders.some((name) => support.encoders.has(name)), fallback: "Tone mapping SDR" },
    { id: "deinterlace", label: "Désentrelacement à cadence conservée", component: "filter" as const,
      available: support.filters.has("bwdif") || support.filters.has("yadif"), fallback: "Image entrelacée transmise telle quelle" },
  ];
  const critical = [...video.filter((item) => item.id === "h264"), ...audio.filter((item) => ["aac", "eac3"].includes(item.id)),
    ...processing.filter((item) => ["h264-output", "aac-output", "hls-output", "scale"].includes(item.id))];
  const missingCritical = critical.filter((item) => !item.available).map((item) => item.label);
  return { generatedAt: new Date().toISOString(), engineVersion: support.version, healthy: missingCritical.length === 0,
    missingCritical, video, audio, containers, subtitles, processing, colorPipelines };
}

export async function detectFfmpegSupport(): Promise<FfmpegSupport> {
  ffmpegSupportPromise ??= (async () => {
    try {
      const [{ stdout: encoders }, { stdout: decoders }, { stdout: hwaccels }, { stdout: formats }, { stdout: filters }, { stdout: version }] = await Promise.all([
        execFileAsync(config.ffmpegPath, ["-hide_banner", "-encoders"], { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 }),
        execFileAsync(config.ffmpegPath, ["-hide_banner", "-decoders"], { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 }),
        execFileAsync(config.ffmpegPath, ["-hide_banner", "-hwaccels"], { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 }),
        execFileAsync(config.ffmpegPath, ["-hide_banner", "-formats"], { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 }),
        execFileAsync(config.ffmpegPath, ["-hide_banner", "-filters"], { windowsHide: true, timeout: 15_000, maxBuffer: 4_000_000 }),
        execFileAsync(config.ffmpegPath, ["-version"], { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 }),
      ]);
      const parsedFormats = parseFfmpegFormats(formats);
      return {
        version: version.split(/\r?\n/)[0]?.trim() || null,
        encoders: parseFfmpegComponentList(encoders),
        decoders: parseFfmpegComponentList(decoders),
        hwaccels: new Set(hwaccels.split(/\r?\n/).map((item) => item.trim().toLowerCase()).filter((item) => item && !/hardware acceleration methods/i.test(item))),
        demuxers: parsedFormats.demuxers,
        muxers: parsedFormats.muxers,
        filters: parseFfmpegComponentList(filters),
      };
    } catch {
      return { version: null, encoders: new Set<string>(), decoders: new Set<string>(), hwaccels: new Set<string>(),
        demuxers: new Set<string>(), muxers: new Set<string>(), filters: new Set<string>() };
    }
  })();
  return ffmpegSupportPromise;
}

interface VideoEncoderSelection {
  encoder: string; inputArgs: string[]; outputArgs: string[]; filterSuffix: string[]; softwarePixels: boolean;
}

/**
 * Le codec de sortie d'une conversion.
 *
 * Convertir un film HEVC vers H.264 coute cher deux fois : en debit — il faut environ le double pour
 * la meme qualite — et en travail, puisque l'image doit etre reencodee dans un codec moins efficace.
 * Sur une source 4K HDR, c'est la difference entre un flux tenable sur un reseau domestique et un flux
 * qui ne l'est pas.
 *
 * La regle est donc etroite et defendable : on ne conserve le HEVC que si la source l'emploie **et**
 * que l'appareil l'annonce. Jamais de conversion vers un codec que le client n'a pas demande, jamais
 * de passage de H.264 a HEVC — un appareil qui annonce HEVC ne le decode pas toujours aussi bien que
 * du H.264, et la quarantaine de codecs existe precisement parce que cette declaration ment parfois.
 */
export function codecDeSortie(
  accepte: readonly string[],
  codecSource: string | null | undefined,
  conteneurSegment: string | null | undefined,
  preference = "auto",
): "h264" | "hevc" {
  if (preference === "h264" || preference === "hevc") return preference;
  // Le HEVC ne se transporte pas en MPEG-TS chez tous les lecteurs : la sortie fMP4 est exigee.
  if (conteneurSegment === "mpegts") return "h264";
  if (codecSource !== "hevc") return "h264";
  return accepte.includes("hevc") ? "hevc" : "h264";
}

export function selectVideoEncoder(
  support: { encoders: Set<string>; hwaccels: Set<string> },
  preference: string,
  forceSoftware = false,
  sortie: "h264" | "hevc" = "h264",
): VideoEncoderSelection {
  const allowed = (name: string) => preference === "auto" || preference === name;
  if (sortie === "hevc") {
    // Meme ordre de preference que pour H.264, et meme repli : un encodeur HEVC absent ramene au
    // H.264 plutot qu'a une erreur, car le flux doit sortir dans tous les cas.
    if (!forceSoftware && allowed("vaapi") && support.encoders.has("hevc_vaapi") && support.hwaccels.has("vaapi")) {
      return { encoder: "hevc_vaapi", inputArgs: ["-vaapi_device", config.hardwareDevice],
        outputArgs: ["-qp", "25"], filterSuffix: ["format=nv12", "hwupload"], softwarePixels: false };
    }
    if (!forceSoftware && allowed("qsv") && support.encoders.has("hevc_qsv") && support.hwaccels.has("qsv")) {
      return { encoder: "hevc_qsv", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-preset", "veryfast", "-global_quality", "25"],
        filterSuffix: [], softwarePixels: true };
    }
    if (!forceSoftware && allowed("nvenc") && support.encoders.has("hevc_nvenc") && support.hwaccels.has("cuda")) {
      return { encoder: "hevc_nvenc", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-preset", "p4", "-cq", "25"],
        filterSuffix: [], softwarePixels: true };
    }
    if (support.encoders.has("libx265")) {
      return { encoder: "libx265", inputArgs: [], outputArgs: ["-preset", "veryfast", "-crf", "24"], filterSuffix: [], softwarePixels: true };
    }
  }
  if (!forceSoftware && allowed("nvenc") && support.encoders.has("h264_nvenc") && support.hwaccels.has("cuda")) {
    return { encoder: "h264_nvenc", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-preset", "p4", "-cq", "22"], filterSuffix: [], softwarePixels: true };
  }
  if (!forceSoftware && allowed("qsv") && support.encoders.has("h264_qsv") && support.hwaccels.has("qsv")) {
    return { encoder: "h264_qsv", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-preset", "veryfast", "-global_quality", "23"], filterSuffix: [], softwarePixels: true };
  }
  if (!forceSoftware && allowed("amf") && support.encoders.has("h264_amf")) {
    return { encoder: "h264_amf", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-quality", "speed", "-qp_i", "22", "-qp_p", "24"], filterSuffix: [], softwarePixels: true };
  }
  if (!forceSoftware && allowed("vaapi") && support.encoders.has("h264_vaapi") && support.hwaccels.has("vaapi")) {
    // Le decodage reste sur le processeur, et ce retrait est deliberé.
    //
    // `-hwaccel vaapi -hwaccel_device <noeud>` avait ete ajoute **en plus** de `-vaapi_device <noeud>`,
    // ce qui fait creer deux peripheriques VA-API sur le meme noeud de rendu dans un seul processus.
    // Releve sur le NAS : la conversion d'un simple 1080p ne produisait plus aucun segment, la session
    // restait en preparation, et le client abandonnait au bout de trente secondes. Rien dans le journal
    // ne le disait — la sortie d'erreur de FFmpeg n'etait ecrite nulle part.
    //
    // Le gain mesure vient du micro-banc, qui **encode** une mire : il n'exerce aucun decodage. Ce
    // chemin-la n'a donc jamais ete mesure, et la regle du projet veut qu'il ne soit pas emprunte
    // d'office. Il reviendra quand un banc le qualifiera, avec la forme canonique — `-hwaccel vaapi`
    // s'appuyant sur le peripherique de `-vaapi_device`, sans en creer un second.
    return { encoder: "h264_vaapi", inputArgs: ["-vaapi_device", config.hardwareDevice],
      outputArgs: ["-qp", "23"], filterSuffix: ["format=nv12", "hwupload"], softwarePixels: false };
  }
  return { encoder: "libx264", inputArgs: [], outputArgs: ["-preset", "veryfast", "-crf", "21"], filterSuffix: [], softwarePixels: true };
}

/**
 * Encodeur utilisé uniquement lorsqu'un réencodage doit conserver la couche HDR10.
 * Volontairement limité à libx265 : c'est le seul encodeur dont la réinjection du mastering display
 * et de MaxCLL/MaxFALL a été vérifiée sur les segments produits.
 */
export function selectHdrVideoEncoder(support: { encoders: Set<string>; hwaccels?: Set<string> },
  preference: string, forceSoftware = false): VideoEncoderSelection | null {
  const permis = (nom: string) => preference === "auto" || preference === nom;
  const accelerateurs = support.hwaccels ?? new Set<string>();
  if (!forceSoftware && permis("vaapi") && support.encoders.has("hevc_vaapi") && accelerateurs.has("vaapi")) {
    // `main10` est exigé : la couche HDR est en dix bits, et un profil huit bits l'écrêterait
    // silencieusement — l'image sortirait délavée sans qu'aucune erreur ne le signale.
    return { encoder: "hevc_vaapi", inputArgs: ["-vaapi_device", config.hardwareDevice],
      outputArgs: ["-profile:v", "main10", "-qp", "24"], filterSuffix: ["format=p010", "hwupload"], softwarePixels: false };
  }
  if (!forceSoftware && permis("qsv") && support.encoders.has("hevc_qsv") && accelerateurs.has("qsv")) {
    return { encoder: "hevc_qsv", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-profile:v", "main10", "-q:v", "24"],
      filterSuffix: [], softwarePixels: true };
  }
  if (!forceSoftware && permis("nvenc") && support.encoders.has("hevc_nvenc") && accelerateurs.has("cuda")) {
    return { encoder: "hevc_nvenc", inputArgs: ["-hwaccel", "auto"], outputArgs: ["-profile:v", "main10", "-cq", "24"],
      filterSuffix: [], softwarePixels: true };
  }
  // `libx265` n'est plus retenu automatiquement.
  //
  // Il l'était seul, et le résultat était inexploitable : sur un Celeron N5105, encoder du HEVC 4K en
  // logiciel tourne autour de deux images par seconde. FFmpeg n'échouait pas — il n'écrivait rien sur
  // sa sortie d'erreur — il n'arrivait simplement jamais à produire le premier segment, et le client
  // abandonnait sur un délai dépassé. Relevé sur le NAS, sur un Dolby Vision de 26,5 Mb/s.
  //
  // Rendre `null` ici n'abandonne pas la lecture : la chaîne repart alors sur la conversion HDR vers
  // SDR, qui dispose d'un encodeur matériel et fonctionne. On perd la couche HDR, on gagne un film
  // qui se regarde — et l'arbitrage est annoncé dans le panneau d'infos.
  //
  // Le choix reste accessible : `preference` valant `software` le rétablit, pour une machine dont le
  // processeur en a les moyens.
  if (preference === "software" && support.encoders.has("libx265")) {
    return { encoder: "libx265", inputArgs: [], outputArgs: ["-preset", "veryfast", "-crf", "22"], filterSuffix: [], softwarePixels: true };
  }
  return null;
}

/** Réinjecte primaires, transfert, matrice, mastering display et MaxCLL/MaxFALL dans le flux encodé. */
export function hdrEncoderArguments(encoder: string, video: MediaStream | null | undefined, plan: ColorPipelinePlan): string[] {
  const color = video?.color ?? null;
  const transfer = color?.colorTransfer || (plan.outputFormat === "hlg" ? "arib-std-b67" : "smpte2084");
  const primaries = color?.colorPrimaries || "bt2020";
  const matrix = color?.colorSpace || "bt2020nc";
  const args = ["-pix_fmt", "yuv420p10le", "-color_primaries", primaries, "-color_trc", transfer,
    "-colorspace", matrix, "-color_range", color?.colorRange === "pc" ? "pc" : "tv"];
  if (encoder !== "libx265") return args;
  const params = ["hdr-opt=1", "repeat-headers=1", `colorprim=${primaries}`, `transfer=${transfer}`, `colormatrix=${matrix}`];
  const mastering = color?.masteringDisplay;
  if (mastering) {
    const point = (x: number, y: number) => `(${Math.round(x * 50_000)},${Math.round(y * 50_000)})`;
    params.push(`master-display=G${point(mastering.greenX, mastering.greenY)}B${point(mastering.blueX, mastering.blueY)}`
      + `R${point(mastering.redX, mastering.redY)}WP${point(mastering.whitePointX, mastering.whitePointY)}`
      + `L(${Math.round(mastering.maxLuminanceNits * 10_000)},${Math.round(mastering.minLuminanceNits * 10_000)})`);
  }
  if (color?.maxContentLightLevel) params.push(`max-cll=${color.maxContentLightLevel},${color.maxFrameAverageLightLevel ?? 0}`);
  return [...args, "-x265-params", params.join(":")];
}

async function chooseVideoEncoder(forceSoftware = false, sortie: "h264" | "hevc" = "h264"): Promise<VideoEncoderSelection> {
  const support = await detectFfmpegSupport();
  const preferences = preferencesConversion();
  if (forceSoftware) return selectVideoEncoder(support, preferences.accelerateur, true, sortie);
  // Le calibrage mesuré prime sur le simple ordre de présence : un pilote plus lent que le processeur est écarté.
  const calibrated = preferences.accelerateur === "auto" ? calibratedAccelerator() : null;
  if (calibrated === "software") return selectVideoEncoder(support, "auto", true, sortie);
  return selectVideoEncoder(support, calibrated ?? preferences.accelerateur, false, sortie);
}

export function selectAudioOutputEncoder(capabilities: PlaybackCapabilities, copyCompatible: boolean,
  encoders: Set<string>): "copy" | "aac" | "ac3" | "libopus" {
  const requested = capabilities.audioOutputMode ?? "auto";
  const processing = Boolean(capabilities.audioNormalization || capabilities.nightMode);
  if (copyCompatible && !processing && (requested === "auto" || requested === "copy")) return "copy";
  if (requested === "ac3" && encoders.has("ac3")) return "ac3";
  if (requested === "opus" && capabilities.hlsSegmentContainer !== "mpegts" && (encoders.has("libopus") || encoders.has("opus"))) {
    return encoders.has("libopus") ? "libopus" : "aac";
  }
  return "aac";
}

/**
 * Faut-il refuser la copie d'un E-AC-3 parce que la sortie est un fMP4 ?
 *
 * Le mode est déjà arrêté quand cette question se pose : seul l'encodeur de la piste audio est en jeu,
 * à l'intérieur d'une session qui convertissait déjà. Les trois refus sont délibérés — la lecture
 * directe, où l'E-AC-3 part au récepteur tel quel ; le Dolby Atmos, jamais sacrifié ; et les segments
 * MPEG-TS, dont la restitution ne montre pas ce défaut.
 */
export function eac3ARenormaliser(mode: PlaybackMode, audio: MediaStream | null | undefined,
  capabilities: PlaybackCapabilities): boolean {
  return mode !== "direct"
    && capabilities.hlsSegmentContainer !== "mpegts"
    && audio?.codec?.toLowerCase() === "eac3"
    && !audio.dolbyAtmos;
}

/** Verdict unique avant `-c:a copy`, y compris quand la négociation exige une timeline AAC stable. */
export function canCopySelectedAudio(audio: MediaStream | null | undefined, capabilities: PlaybackCapabilities,
  transcodeRequired = false): boolean {
  return Boolean(!transcodeRequired && audio && codecSupported(capabilities.audioCodecs, audio.codec)
    && (!audio.dolbyAtmos || capabilities.dolbyAtmos)
    && (!audio.audioTechnology || audio.audioTechnology === "standard"
      || capabilities.immersiveAudioFormats.includes(audio.audioTechnology))
    && (!audio.losslessAudio || capabilities.losslessAudio));
}

export function audioFilterChain(capabilities: PlaybackCapabilities, inputChannels: number, outputChannels: number): string[] {
  const filters: string[] = [];
  if (capabilities.nightMode) filters.push("acompressor=threshold=-18dB:ratio=4:attack=20:release=250:makeup=2dB");
  if (capabilities.audioNormalization) filters.push("loudnorm=I=-16:LRA=11:TP=-1.5");
  if (inputChannels > outputChannels || capabilities.audioNormalization || capabilities.nightMode) filters.push("alimiter=limit=0.95:attack=5:release=50");
  return filters;
}

function subtitleOrdinal(streams: MediaStream[], index: number): number {
  return streams.filter((stream) => stream.type === "subtitle").findIndex((stream) => stream.index === index);
}

/**
 * Une ligne par session : ce que le serveur a décidé, et sur quoi.
 *
 * Trois révisions ont été dépensées à deviner ce que le mobile recevait, faute de cette ligne. Le
 * journal enregistrait les requêtes — donc qu'une session avait été créée — mais rien du choix fait :
 * ni le mode, ni le codec de sortie, ni le point de départ. La cause du décalage audio n'a fini par
 * apparaître que dans l'URL des sous-titres, où le décalage de fenêtre transparaît par accident.
 *
 * Le format est fait pour être lisible d'un `grep` : un préfixe stable et des couples `clé=valeur`.
 */
function journaliserDecision(session: InternalSession, decision: ReturnType<typeof decidePlayback>, capabilities: PlaybackCapabilities): void {
  const audio = decision.audio;
  console.info(`[FlixTunes] Décision de lecture — session ${session.id}, média ${session.mediaId}, `
    + `mode=${decision.mode}, motif=${decision.reason}, `
    + `video=${decision.video?.codec ?? "aucune"}→${session.videoEncoder ?? "aucun"}, `
    + `audio=${audio?.codec ?? "aucune"}/${audio?.channels ?? 0}ch→${session.audioEncoder ?? "aucun"}, `
    + `depart=${(capabilities.startSeconds ?? 0).toFixed(1)}s, conteneur=${capabilities.hlsSegmentContainer ?? "fmp4"}, `
    + `appareil=${capabilities.deviceClass ?? "inconnu"}`);
}

async function startFfmpegSession(
  session: InternalSession,
  filePath: string,
  info: PlaybackInfo,
  capabilities: PlaybackCapabilities,
  forceSoftware = false,
): Promise<void> {
  const decision = decidePlayback(info, capabilities);
  const source = orientedDimensions(decision.video);
  const adaptive = selectAdaptiveProfile(capabilities, source.width, source.height);
  const support = await detectFfmpegSupport();
  const colorPipeline = planColorPipeline(decision.video, capabilities, support, decision.mode, preferencesConversion().toneMapping, forceSoftware);
  session.colorPipeline = colorPipeline;
  const externalSubtitles = capabilities.externalSubtitleId != null ? await findExternalSubtitles(filePath) : [];
  const externalSubtitle = externalSubtitles.find((subtitle) => subtitle.id === capabilities.externalSubtitleId) ?? null;
  const externalSubtitlePath = externalSubtitle ? path.join(path.dirname(filePath), externalSubtitle.name) : null;
  if (externalSubtitlePath && path.dirname(externalSubtitlePath) !== path.dirname(filePath)) throw new Error("Chemin de sous-titre externe invalide");
  const imageSubtitleBurn = Boolean(capabilities.burnSubtitles
    && ((!decision.subtitle?.canExtractAsWebVtt && decision.subtitle) || externalSubtitle?.kind === "image"));
  const toneMapping = colorPipeline.action === "hdr-to-sdr" && colorPipeline.toneMapping !== "none";
  // Un réencodage qui conserve la couche HDR10 exige un encodeur HEVC 10 bits.
  const hdrEncoder = decision.mode === "transcode" && colorPipeline.action === "preserve" && colorPipeline.outputFormat !== "sdr"
    ? selectHdrVideoEncoder(support, preferencesConversion().accelerateur, forceSoftware) : null;
  const encoder = decision.mode !== "transcode" ? null
    // Le tone mapping ne force plus l'encodage logiciel.
    //
    // Il le faisait sans qu'aucun commentaire ni test ne l'explique, et la consequence etait lourde :
    // **toute** conversion HDR vers SDR — le cas le plus frequent et le plus couteux — se retrouvait
    // encodee par le processeur, meme sur une machine dont l'encodeur materiel fonctionnait. Releve sur
    // le NAS de reference : un film HDR converti en 480p par `libx264`, avec le tone mapping logiciel
    // par-dessus, alors que les deux auraient pu etre soulages.
    //
    // Rien ne s'y opposait : les filtres de l'encodeur — `format=nv12,hwupload` — sont raccroches en
    // dernier, apres le tone mapping et le redimensionnement, ce qui est exactement l'ordre attendu
    // pour encoder sur le circuit video ce que le processeur vient de convertir.
    //
    // L'incrustation d'un sous-titre image reste, elle, une vraie contrainte : la composition se fait
    // en `filter_complex`, ou le transfert vers le peripherique tomberait *avant* la superposition —
    // et `overlay` ne sait pas travailler sur des images deja transferees.
    : hdrEncoder ?? await chooseVideoEncoder(forceSoftware || imageSubtitleBurn,
      codecDeSortie(capabilities.videoCodecs, decision.video?.codec, capabilities.hlsSegmentContainer, preferencesConversion().codecSortie));
  session.videoEncoder = decision.mode === "remux" ? "copy" : encoder?.encoder ?? null;
  /**
   * L'E-AC-3 recopié dans un fMP4 se restitue avec du retard dès qu'on se déplace.
   *
   * Même signature que le défaut corrigé en r53 pour Chrome/Edge : le retard s'entend **alors que les
   * horodatages produits sont identiques à ceux de l'image**. Trois séries de mesures le confirment —
   * sur un épisode HEVC + E-AC-3 avec et sans `-avoid_negative_ts`, en copie comme en réencodage, puis
   * sur 146 segments d'un remux fMP4 où l'écart image/son reste entre 19 et 41 ms sans jamais dériver,
   * soit la quantification d'une trame E-AC-3 de 32 ms. Le décalage ne naît donc pas du flux, mais de
   * sa restitution. La r53 avait explicitement laissé Android de côté.
   *
   * **La condition de r64 était trop étroite.** Elle exigeait une fenêtre ouverte par un saut
   * (`startSeconds > 0`) alors qu'un saut *à l'intérieur* de la fenêtre déjà encodée ne relance aucune
   * session : le flux garde son E-AC-3 recopié, et c'est le cas le plus fréquent. Le journal du
   * service le montre — sur quatre sessions d'un même film depuis un mobile en accès distant, une
   * seule était décalée (`offset=-610.541`), les trois autres partaient de zéro (`offset=-0.0`). La
   * règle ne s'appliquait donc qu'à une session sur quatre.
   *
   * **Placée ici, et non dans la décision de mode.** Mise dans `audioCompatible`, elle aurait fait
   * basculer en remux un fichier qui avait droit à la lecture directe. Le mode est déjà arrêté quand
   * on arrive ici — seul l'encodeur de la piste audio change, à l'intérieur d'une session qui
   * convertissait déjà.
   *
   * Ce qu'elle ne touche pas, et c'est délibéré : la lecture directe, où l'E-AC-3 va au récepteur tel
   * quel ; le Dolby Atmos, jamais sacrifié ; et les segments MPEG-TS, dont la restitution ne montre
   * pas ce défaut. Le nombre de canaux est conservé — `maxAudioChannels` vaut la sortie réelle sur un
   * téléviseur, et deux sur un mobile, qui redescend de toute façon en stéréo.
   */
  const eac3CopieDansFmp4 = eac3ARenormaliser(decision.mode, decision.audio, capabilities);
  const audioCopyCompatible = canCopySelectedAudio(decision.audio, capabilities, decision.transcodeAudio)
    && !eac3CopieDansFmp4;
  session.audioEncoder = decision.audio ? selectAudioOutputEncoder(capabilities, audioCopyCompatible, support.encoders) : null;
  journaliserDecision(session, decision, capabilities);
  await mkdir(session.directory, { recursive: true });
  // L'échelle ABR produit du H.264 SDR : elle est écartée dès qu'une conversion colorimétrique est
  // nécessaire, et n'est construite que sur un lien contraint — voir `echelleAdaptativeUtile`.
  const adaptiveEligible = echelleAdaptativeRetenue(capabilities, decision.mode, colorPipeline, source.width, source.height)
    && !imageSubtitleBurn && decision.video && decision.audio;
  if (adaptiveEligible) {
    await startAdaptiveFfmpegSession(session, filePath, info, capabilities, decision.video!, decision.audio!, forceSoftware); return;
  }
  // Ce chemin écrit du HLS, et la session doit le dire.
  //
  // Le DASH n'est produit que par l'échelle adaptative. Ici, quoi que le client ait demandé, FFmpeg
  // écrit `manifest.m3u8`. Or la session gardait le protocole réclamé — `dash` pour Android — et le
  // serveur attendait donc `manifest.mpd` : un fichier que rien ne crée. La session restait en
  // préparation, le client l'interrogeait trente secondes puis abandonnait, et rien dans le journal ne
  // désignait la cause.
  //
  // Seul Android demandait du DASH : le navigateur, qui prend du HLS, ne rencontrait jamais le cas.
  // Et un remux n'étant jamais éligible à l'adaptative, c'était un blocage garanti sur mobile.
  session.protocol = "hls";
  const manifestPath = path.join(session.directory, "manifest.m3u8");
  const segmentPattern = path.join(session.directory, "segment_%05d.m4s");
  const args = ["-nostdin", "-hide_banner", "-loglevel", "warning", "-y",
    ...(toneMapping ? toneMappingInputArgs(colorPipeline.toneMapping) : []), ...(encoder?.inputArgs ?? []),
    ...regulationDebitArgs(support.version), ...startArgs(session.startOffsetSeconds ?? 0), "-i", filePath];
  const subtitleOffset = normalizedSubtitleOffset(capabilities.subtitleOffsetSeconds);
  if (externalSubtitle?.kind === "image" && externalSubtitlePath && capabilities.burnSubtitles) {
    args.push(...(subtitleOffset ? ["-itsoffset", String(subtitleOffset)] : []), "-i", externalSubtitlePath);
  }

  // Désentrelacement puis tone mapping d'abord : les sous-titres sont composés ensuite, sur une image déjà convertie.
  const videoFilters: string[] = [...colorPipeline.filters];
  if (decision.mode === "transcode" && decision.video) {
    const downscale = adaptive.width < source.width || adaptive.height < source.height;
    videoFilters.push(transcodeScaleFilter(adaptive.width, adaptive.height, downscale));
  }

  let complexVideoFilter: string | null = null;
  if (externalSubtitle && externalSubtitlePath && capabilities.burnSubtitles) {
    if (externalSubtitle.kind === "text") {
      const escapedPath = externalSubtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
      const charEncoding = externalSubtitle.encoding && externalSubtitle.encoding !== "utf-8"
        ? `:charenc=${externalSubtitle.encoding}` : "";
      videoFilters.push(`subtitles='${escapedPath}'${charEncoding}`);
      args.push("-map", decision.video ? `0:${decision.video.index}` : "0:v:0");
    } else {
      const baseFilters = [...videoFilters, ...(encoder?.filterSuffix ?? [])];
      complexVideoFilter = baseFilters.length
        ? `[0:v:0]${baseFilters.join(",")}[base];[base][1:s:0]overlay[vout]`
        : "[0:v:0][1:s:0]overlay[vout]";
      args.push("-filter_complex", complexVideoFilter, "-map", "[vout]");
      videoFilters.length = 0;
    }
  } else if (decision.subtitle && capabilities.burnSubtitles) {
    const ordinal = subtitleOrdinal(info.streams, decision.subtitle.index);
    if (decision.subtitle.canExtractAsWebVtt) {
      const escapedPath = filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
      videoFilters.push(`subtitles='${escapedPath}':si=${ordinal}`);
      args.push("-map", "0:v:0");
    } else {
      const baseFilters = [...videoFilters, ...(encoder?.filterSuffix ?? [])];
      const subtitleInput = subtitleOffset
        ? `[0:s:${ordinal}]setpts=PTS${subtitleOffset >= 0 ? "+" : ""}${subtitleOffset}/TB[shifted]`
        : null;
      complexVideoFilter = baseFilters.length
        ? `${subtitleInput ? `${subtitleInput};` : ""}[0:v:0]${baseFilters.join(",")}[base];[base]${subtitleInput ? "[shifted]" : `[0:s:${ordinal}]`}overlay[vout]`
        : `${subtitleInput ? `${subtitleInput};` : ""}[0:v:0]${subtitleInput ? "[shifted]" : `[0:s:${ordinal}]`}overlay[vout]`;
      args.push("-filter_complex", complexVideoFilter, "-map", "[vout]");
      videoFilters.length = 0;
    }
  } else {
    args.push("-map", decision.video ? `0:${decision.video.index}` : "0:v:0");
  }
  if (!complexVideoFilter) videoFilters.push(...(encoder?.filterSuffix ?? []));
  if (videoFilters.length) args.push("-vf", videoFilters.join(","));
  if (decision.audio) args.push("-map", `0:${decision.audio.index}`);
  else args.push("-an");

  if (decision.mode === "remux") {
    args.push("-c:v", "copy");
    args.push(...remuxVideoArguments(decision.video, colorPipeline.outputFormat));
  }
  else {
    const chosenEncoder = encoder?.encoder ?? "libx264";
    args.push("-c:v", chosenEncoder, ...(encoder?.outputArgs ?? []));
    args.push(...keyframeArgs(chosenEncoder));
    args.push("-b:v", String(adaptive.videoBitrate), "-maxrate", String(Math.round(adaptive.videoBitrate * 1.08)), "-bufsize", String(adaptive.videoBitrate * 2));
    if (hdrEncoder) args.push(...hdrEncoderArguments(hdrEncoder.encoder, decision.video, colorPipeline), "-tag:v", "hvc1");
    else {
      if (encoder?.softwarePixels !== false) args.push("-pix_fmt", "yuv420p");
      // Sans `hvc1`, un fMP4 portant du HEVC est refuse par les lecteurs Apple comme par Media3 :
      // ils n'y reconnaissent pas la piste, et la lecture echoue sans message utile.
      if (/^(hevc|libx265)/.test(chosenEncoder)) args.push("-tag:v", "hvc1");
    }
  }
  if (decision.audio) {
    if (session.audioEncoder === "copy") args.push("-c:a", "copy");
    else {
      const codecChannels = session.audioEncoder === "libopus" ? 8 : 6;
      const outputChannels = Math.max(1, Math.min(codecChannels, capabilities.maxAudioChannels, decision.audio.channels ?? 2));
      const surround = outputChannels > 2;
      const bitrate = session.audioEncoder === "libopus" ? (surround ? "384k" : "160k")
        : session.audioEncoder === "ac3" ? (surround ? "640k" : "192k") : (surround ? "384k" : "192k");
      args.push("-c:a", session.audioEncoder ?? "aac", "-b:a", bitrate, "-ac", String(outputChannels));
      const audioFilters = audioFilterChain(capabilities, decision.audio.channels ?? outputChannels, outputChannels);
      if (audioFilters.length) args.push("-af", audioFilters.join(","));
    }
  }
  const mpegTs = capabilities.hlsSegmentContainer === "mpegts";
  const segmentPath = mpegTs ? path.join(session.directory, "segment_%05d.ts") : segmentPattern;
  /*
   * Horodatages ramenés à zéro sans écraser l'écart entre les pistes.
   *
   * `-ss` est placé avant `-i` pour que le déplacement soit instantané — c'est le bon choix, et il
   * reste. Mais en **copie de flux**, il fait démarrer la vidéo à l'image-clé qui précède la cible
   * tandis que l'audio démarre à la cible : le début du flux porte alors des horodatages négatifs.
   * Faute d'instruction, le multiplexeur les ramène à zéro **par piste**, ce qui supprime l'écart
   * réel entre l'image et le son — et l'on entend le décalage après chaque avance, en remux
   * seulement, jamais en transcodage. C'est exactement le symptôme relevé sur mobile et tablette.
   *
   * `make_zero` décale toutes les pistes du **même** montant : le flux commence bien à zéro, et le
   * rapport entre image, son et sous-titres est conservé tel quel.
   */
  args.push("-sn", "-max_muxing_queue_size", "2048", "-avoid_negative_ts", "make_zero",
    "-f", "hls", "-hls_time", String(SEGMENT_SECONDS), "-hls_list_size", "0",
    "-hls_segment_type", mpegTs ? "mpegts" : "fmp4", "-hls_flags", "independent_segments+temp_file");
  if (!mpegTs) args.push("-hls_fmp4_init_filename", "init.mp4");
  args.push("-hls_segment_filename", segmentPath, manifestPath);

  const child = spawn(config.ffmpegPath, args, { cwd: session.directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  session.process = child;
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => { session.stderr = `${session.stderr}${chunk}`.slice(-5000); });
  child.once("error", (error) => { session.status = "failed"; session.stderr = error.message; session.error = friendlyTranscodeError(error.message); rememberTranscodeFailure(session); });
  child.once("exit", (code) => {
    session.process = null;
    if (session.arretDemande) return;
    if (code === 0) {
      // Le processus est terminé : sa part de budget de conversion est rendue même si la session reste en cache.
      if (session.id) releaseSessionCost(session.id);
      if (session.status !== "failed") session.status = "completed";
    } else if (!forceSoftware && session.status === "starting"
      && ((encoder && encoder.encoder !== "libx264") || colorPipeline.toneMappingHardware)) {
      session.stderr = "";
      void (async () => {
        await rm(session.directory, { recursive: true, force: true });
        await startFfmpegSession(session, filePath, info, capabilities, true);
      })().catch((error) => { session.status = "failed"; session.error = error instanceof Error ? error.message : String(error); });
    } else {
      if (session.id) releaseSessionCost(session.id);
      session.status = "failed";
      session.error = friendlyTranscodeError(session.stderr);
      rememberTranscodeFailure(session);
    }
  });
}

export async function createPlaybackSession(mediaId: string, capabilities: PlaybackCapabilities): Promise<PlaybackSession | null> {
  const row = mediaRow(mediaId);
  const info = await getPlaybackInfo(mediaId);
  if (!row || !info) return null;
  /**
   * Les codecs qu'un appareil a déjà échoué à décoder ne lui sont plus proposés.
   *
   * Sans cette mémoire, la même erreur se reproduit à chaque lecture : le serveur repropose le codec
   * annoncé, le client échoue à nouveau, et rien n'apprend. Le filtre s'applique avant la négociation,
   * de sorte que tout le raisonnement qui suit — lecture directe, remultiplexage, conversion — porte
   * sur ce que l'appareil sait réellement faire.
   */
  const capacitesAnnoncees: PlaybackCapabilities = {
    ...capabilities,
    videoCodecs: withoutQuarantined(capabilities.videoCodecs, capabilities.deviceId),
    audioCodecs: withoutQuarantined(capabilities.audioCodecs, capabilities.deviceId),
  };
  const capacitesReelles = plafonnerDefinition(capacitesAnnoncees, preferencesConversion().resolutionMax);
  const decision = decidePlayback(info, capacitesReelles, {
    codecsEnQuarantaine: quarantinedCodecs(capabilities.deviceId),
    autoriserEssaiDirect: true,
    // Identité et non égalité : `plafonnerDefinition` rend l'objet reçu, tel quel, lorsque le réglage
    // ne s'applique pas. Deux objets distincts signifient donc qu'il a réellement abaissé le plafond,
    // et que ce plafond est une consigne — pas une annonce du client qu'on aurait le droit d'éprouver.
    plafondDefinitionImpose: capacitesReelles !== capacitesAnnoncees,
  });
  const support = await detectFfmpegSupport();
  // La couleur doit suivre les capacités *effectives*, après plafond et quarantaine. Employer
  // l'annonce brute pouvait réencoder en HEVC HDR pour un appareil dont le HEVC venait précisément
  // d'être mis en quarantaine, puis reproduire le même échec à chaque seek.
  const colorPipeline = planColorPipeline(decision.video, capacitesReelles, support, decision.mode, config.toneMapping);
  if (decision.mode === "direct") {
    const oriented = orientedDimensions(decision.video);
    return {
      id: null, mediaId, mode: "direct", status: "ready", url: `/api/media/${mediaId}/stream`,
      videoEncoder: "copy", audioEncoder: "copy", reason: decision.reason, error: null,
      decisionReasons: decision.reasons,
      targetWidth: decision.video ? oriented.width : null, targetHeight: decision.video ? oriented.height : null,
      targetVideoBitrate: decision.video?.bitRate ?? null, segmentContainer: null,
      // Une lecture directe n'est jamais décalée : le fichier est servi entier et le navigateur s'y
      // déplace lui-même, sans que le serveur ait à réencoder quoi que ce soit.
      protocol: "direct", colorPipeline, startOffsetSeconds: 0,
    };
  }
  if (!capabilities.hls && !(capabilities.dash && capabilities.streamingProtocol === "dash")) {
    return {
      id: null, mediaId, mode: decision.mode, status: "failed", url: null, videoEncoder: null, audioEncoder: null,
      reason: decision.reason, error: "Ce client ne prend pas en charge HLS et le fichier n'est pas directement compatible",
      decisionReasons: decision.reasons,
      targetWidth: null, targetHeight: null, targetVideoBitrate: null, segmentContainer: null,
      protocol: capabilities.dash && capabilities.streamingProtocol === "dash" ? "dash" : "hls", colorPipeline,
    };
  }
  await cleanupPlaybackSessions(config.transcodeCacheHours * 60 * 60 * 1000);
  const cacheKey = JSON.stringify([mediaId, capabilities]);
  const cachedId = transcodeCache.get(cacheKey); const cached = cachedId ? sessions.get(cachedId) : null;
  if (cached && cached.status !== "failed") { cached.refCount += 1; cached.createdAt = Date.now(); cached.lastAccess = Date.now(); return publicSession(cached); }
  if (cachedId) transcodeCache.delete(cacheKey);

  // Un appareil ne regarde qu'une chose à la fois : ce qu'il regardait avant n'a plus de spectateur.
  //
  // Placé ici, et pas plus haut : au-dessus se trouve la réutilisation du cache, qu'il ne faut surtout
  // pas détruire — c'est la même session que le client redemande. En dessous, en revanche, une
  // nouvelle session va naître, et tout ce que cet appareil laissait derrière lui est révolu.
  //
  // Avant cela, le créneau restait pris dix minutes. Un client qui prépare deux sessions concurrentes
  // ne retient que le dernier identifiant et ne peut plus arrêter les autres : le serveur répondait
  // « limite de 2 conversions simultanées atteinte » à quelqu'un qui venait de fermer son lecteur.
  await libererSessionsDeLAppareil(capabilities.deviceId);

  // Contrôle d'admission : le coût estimé de la session est confronté à la capacité mesurée du serveur.
  const oriented = orientedDimensions(decision.video);
  const plannedVariants = echelleAdaptativeRetenue(capacitesReelles, decision.mode, colorPipeline, oriented.width, oriented.height)
    ? selectAdaptiveLadder(capacitesReelles, oriented.width, oriented.height)
    : [selectAdaptiveProfile(capacitesReelles, oriented.width, oriented.height)];
  const admission = decideAdmission({
    mode: decision.mode, variants: plannedVariants, frameRate: decision.video?.frameRate ?? null,
    toneMapping: colorPipeline.action === "hdr-to-sdr" ? colorPipeline.toneMapping : "none",
    sourceCodec: decision.video?.codec ?? null, height: oriented.height,
  }, currentAdmissionState());
  if (!admission.accepted) {
    return { id: null, mediaId, mode: decision.mode, status: "failed", url: null, videoEncoder: null, audioEncoder: null,
      reason: decision.reason, decisionReasons: [...decision.reasons, admission.reason],
      error: admission.reason,
      targetWidth: null, targetHeight: null, targetVideoBitrate: null, segmentContainer: null, colorPipeline };
  }
  // Dégradation avant échec : la définition est plafonnée plutôt que la lecture refusée.
  const admitted: PlaybackCapabilities = admission.degraded && admission.maxHeight
    ? { ...capacitesReelles, maxHeight: Math.min(capacitesReelles.maxHeight, admission.maxHeight),
      maxWidth: Math.min(capacitesReelles.maxWidth, Math.round(admission.maxHeight * 16 / 9)) }
    : capacitesReelles;

  const id = randomUUID();
  const directory = path.resolve(transcodeRoot, id);
  if (!directory.startsWith(`${transcodeRoot}${path.sep}`)) throw new Error("Répertoire de session invalide");
  const profile = selectAdaptiveProfile(admitted, oriented.width, oriented.height);
  const session: InternalSession = {
    id, mediaId, mode: decision.mode, status: "starting", url: `/api/playback/${id}/manifest.m3u8`,
    videoEncoder: null, audioEncoder: null, reason: decision.reason, error: null,
    decisionReasons: admission.degraded ? [...decision.reasons, admission.reason] : decision.reasons,
    deviceId: capabilities.deviceId?.trim() || null,
    directory, process: null, createdAt: Date.now(), lastAccess: Date.now(), stderr: "", cacheKey, refCount: 1,
    arretDemande: false, blocageSignale: false,
    // En remux, la vidéo est **copiée** : le profil adaptatif est calculé pour l'admission, mais aucun
    // filtre d'échelle n'est posé et l'encodeur reste `copy`. Rapporter la définition de ce profil
    // faisait croire à un rabaissement qui n'a pas lieu — un film 4K servi tel quel s'annonçait
    // « Sortie 2560×1440 · 12 Mb/s » alors qu'il sortait en 3840×2160 à son débit d'origine. La
    // lecture directe rapportait déjà la source ; le remux fait de même.
    ...(decision.mode === "remux"
      ? { targetWidth: decision.video ? oriented.width : null,
        targetHeight: decision.video ? oriented.height : null,
        targetVideoBitrate: decision.video?.bitRate ?? null }
      : { targetWidth: profile.width, targetHeight: profile.height, targetVideoBitrate: profile.videoBitrate }),
    segmentContainer: capabilities.hlsSegmentContainer, protocol: capabilities.dash && capabilities.streamingProtocol === "dash" ? "dash" : "hls",
    colorPipeline,
    // Le flux commence là où la personne a demandé : le lecteur ajoutera ce décalage à la position
    // du flux pour afficher la position réelle dans le film.
    startOffsetSeconds: capabilities.startSeconds ?? 0,
  };
  sessions.set(id, session);
  transcodeCache.set(cacheKey, id);
  registerSessionCost(id, { id, mediaId, mode: decision.mode, encoder: null, costUnits: admission.costUnits });
  await startFfmpegSession(session, row.file_path, info, admitted);
  registerSessionCost(id, { id, mediaId, mode: decision.mode, encoder: session.videoEncoder, costUnits: admission.costUnits });
  return publicSession(session);
}

function publicSession(session: InternalSession): PlaybackSession {
  const { directory: _directory, process: _process, createdAt: _createdAt, stderr: _stderr,
    cacheKey: _cacheKey, refCount: _refCount, lastAccess: _lastAccess, ...result } = session;
  return result;
}

/**
 * Au-delà de ce délai sans manifeste, la conversion est considérée comme bloquée.
 *
 * Vingt secondes laissent largement le temps à un premier segment de sortir, y compris sur un NAS
 * modeste et une source lourde ; le client, lui, abandonne à trente.
 */
export const DELAI_BLOCAGE_MS = 20_000;

/**
 * Au-delà de ce silence, une conversion qui n'a **encore rien produit** a perdu son spectateur.
 *
 * Le délai d'inactivité ordinaire est de dix minutes, et il a de bonnes raisons de l'être : un lecteur
 * en pause cesse de demander des segments dès que son tampon est plein, et le brusquer couperait la
 * conversion d'un film qu'on regarde encore.
 *
 * Ce raisonnement ne vaut pas au démarrage. Une session encore en préparation n'a pas de tampon à
 * remplir : son client l'interroge sans relâche, puis abandonne au bout de trente secondes. Passé une
 * minute de silence, il n'y a plus personne — mais le créneau de conversion, lui, restait réservé dix
 * minutes.
 *
 * Constaté sur Android : deux tentatives infructueuses sur un film 4K suffisaient à faire répondre
 * « limite de 2 conversions simultanées atteinte » alors qu'aucune lecture n'était en cours. Le
 * serveur refusait donc de démarrer à cause de ses propres échecs, ce qui rendait le défaut d'origine
 * impossible à distinguer d'une panne de capacité.
 */
export const DELAI_ABANDON_DEMARRAGE_MS = 60_000;

export async function getPlaybackSession(id: string): Promise<PlaybackSession | null> {
  const session = sessions.get(id);
  if (!session) return null;
  session.lastAccess = Date.now();
  if (session.status === "starting") {
    try { await access(path.join(session.directory, session.protocol === "dash" ? "manifest.mpd" : "manifest.m3u8")); session.status = "ready"; } catch { /* segment en préparation */ }
  }
  // Une conversion bloquée ne se dénonce jamais d'elle-même.
  //
  // Le repli vers l'encodage logiciel existe, mais il est accroché à la **fin** du processus FFmpeg.
  // Un FFmpeg qui se bloque ne se termine pas : la session restait en préparation, le client
  // l'interrogeait toutes les demi-secondes pendant trente secondes, puis abandonnait — et le journal
  // du serveur ne montrait que des `200`, sans rien sur la cause. Relevé sur le NAS avec un simple
  // 1080p, quand deux périphériques VA-API étaient créés sur le même nœud de rendu.
  //
  // Passé le délai, le processus est arrêté. Sa terminaison réveille le repli déjà en place, qui
  // relance la session sur le processeur : la lecture démarre au lieu d'échouer.
  //
  // L'arrêt n'est demandé qu'une fois : `kill` ne rend pas la main immédiatement, et le client
  // interroge la session deux fois par seconde. Sans ce garde-fou, le même blocage était signalé à
  // chaque interrogation — relevé trois fois pour une seule session dans le journal du NAS, ce qui
  // laisse croire à trois incidents là où il n'y en a qu'un.
  if (session.status === "starting" && session.process && !session.blocageSignale
    && Date.now() - session.createdAt > DELAI_BLOCAGE_MS) {
    session.blocageSignale = true;
    // La sortie d'erreur est conservée avant d'être écrasée par la relance : c'est la seule trace de
    // ce qui a bloqué, et sans elle le diagnostic repart de zéro.
    // Écrit en clair plutôt qu'en JSON : ce message se lit dans `server.log` au milieu des traces
    // d'accès, et c'est la première chose qu'on cherche quand une lecture ne démarre pas.
    console.warn(`[FlixTunes] Conversion bloquée, arrêt et repli logiciel — session ${session.id}, `
      + `encodeur ${session.videoEncoder ?? "?"}, mode ${session.mode}
`
      + (session.stderr.slice(-1500) || "(FFmpeg n'a rien écrit sur sa sortie d'erreur)"));
    session.process.kill("SIGKILL");
  }
  return publicSession(session);
}

export function getPlaybackFile(id: string, filename: string): { path: string; contentType: string } | null {
  const session = sessions.get(id);
  if (!session || !/^(?:manifest\.(?:m3u8|mpd)|init\.mp4|segment_\d{5}\.(?:m4s|ts)|v\d+_(?:index\.m3u8|init\.mp4|segment_\d{5}\.(?:m4s|ts))|init-stream\d+\.m4s|chunk-stream\d+-\d+\.m4s)$/.test(filename)) return null;
  const filePath = path.resolve(session.directory, filename);
  if (!filePath.startsWith(`${session.directory}${path.sep}`)) return null;
  // Une requête de segment est la seule preuve qu'un client regarde encore.
  session.lastAccess = Date.now();
  return { path: filePath, contentType: filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : filename.endsWith(".mpd") ? "application/dash+xml" : filename.endsWith(".ts") ? "video/mp2t" : "video/mp4" };
}

export async function extractSubtitle(mediaId: string, streamIndex: number, offsetSeconds = 0): Promise<{ path: string; contentType: string } | null> {
  const row = mediaRow(mediaId);
  const info = await getPlaybackInfo(mediaId);
  const stream = info?.streams.find((candidate) => candidate.type === "subtitle" && candidate.index === streamIndex);
  if (!row || !stream?.canExtractAsWebVtt) return null;
  await mkdir(subtitleRoot, { recursive: true });
  const offset = normalizedSubtitleOffset(offsetSeconds);
  const offsetKey = Math.round(offset * 1000);
  const outputPath = path.resolve(subtitleRoot, `${mediaId}-${streamIndex}-${offsetKey}.vtt`);
  if (!outputPath.startsWith(`${subtitleRoot}${path.sep}`)) throw new Error("Répertoire de sous-titres invalide");
  try { await access(outputPath); return { path: outputPath, contentType: "text/vtt; charset=utf-8" }; } catch { /* extraction nécessaire */ }
  const { stdout } = await execFileAsync(
    config.ffmpegPath,
    ["-nostdin", "-hide_banner", "-loglevel", "error", ...(offset ? ["-itsoffset", String(offset)] : []),
      "-i", row.file_path, "-map", `0:${streamIndex}`, "-f", "webvtt", "pipe:1"],
    { windowsHide: true, timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
  );
  await writeFile(outputPath, stdout, "utf8");
  return { path: outputPath, contentType: "text/vtt; charset=utf-8" };
}

export async function stopPlaybackSession(id: string): Promise<boolean> {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.refCount > 1) { session.refCount -= 1; return true; }
  session.refCount = 0;
  if (session.status === "completed") { session.createdAt = Date.now(); return true; }
  return destroyPlaybackSession(session);
}

/**
 * Arrête ce qu'un appareil laisse derrière lui quand il demande autre chose.
 *
 * Le garde-fou ne dépend d'aucun client, et c'est tout son intérêt : un lecteur peut oublier
 * d'annoncer un arrêt — application tuée, réseau coupé, deux préparations concurrentes dont une seule
 * est retenue — mais il ne peut pas demander une session sans se nommer.
 */
async function libererSessionsDeLAppareil(deviceId: string | null | undefined): Promise<void> {
  const appareil = deviceId?.trim();
  if (!appareil) return;
  const anciennes = [...sessions.values()].filter((session) => session.deviceId === appareil);
  for (const session of anciennes) {
    console.warn(`[FlixTunes] L'appareil ${appareil} demande une autre lecture, arrêt de la session `
      + `${session.id} — média ${session.mediaId}, mode ${session.mode}`);
    session.refCount = 0;
    await destroyPlaybackSession(session);
  }
}

async function destroyPlaybackSession(session: InternalSession): Promise<boolean> {
  const child = session.process;
  session.arretDemande = true;
  sessions.delete(session.id!); releaseSessionCost(session.id!);
  if (transcodeCache.get(session.cacheKey) === session.id) transcodeCache.delete(session.cacheKey);
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
    }
  }
  const resolved = path.resolve(session.directory);
  if (resolved.startsWith(`${transcodeRoot}${path.sep}`)) {
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return true;
}

/**
 * Abandonne les sessions dont plus personne ne se soucie.
 *
 * `stopPlaybackSession` n'est appelé que par un client qui s'en va proprement. Tout le reste — onglet
 * fermé, application tuée, téléviseur débranché, réseau coupé, serveur du lecteur rechargé — laissait
 * `refCount` à 1, et les deux balayages de `cleanupPlaybackSessions` exigent `refCount === 0`. La
 * session survivait donc à son spectateur : FFmpeg convertissait le film jusqu'au bout, le répertoire
 * n'était jamais purgé, et le budget de conversion restait réservé jusqu'au redémarrage du serveur.
 *
 * Le délai est franc plutôt que court. Un lecteur en pause cesse de demander des segments dès que son
 * tampon est plein : le brusquer reviendrait à couper la conversion d'un film qu'on regarde encore.
 * Passé dix minutes sans la moindre requête, en revanche, il n'y a plus de doute raisonnable — et le
 * client sait revenir : il redemande une session au point courant lorsque le flux se dérobe.
 */
/**
 * Cette session a-t-elle perdu son spectateur ?
 *
 * Deux délais, parce que deux situations que rien ne rapproche. Une session **en lecture** peut se
 * taire longtemps sans être abandonnée : en pause, son tampon plein, elle ne demande plus rien. Une
 * session **en préparation** n'a pas de tampon à remplir — son client l'interroge sans relâche jusqu'à
 * ce qu'elle démarre, ou abandonne. Un silence d'une minute n'y laisse aucun doute.
 *
 * Fonction pure : elle s'éprouve sans session, sans processus et sans horloge réelle.
 */
export function sessionAbandonnee(
  session: { status: PlaybackSession["status"]; lastAccess: number },
  maintenant: number,
  idleMs: number,
  delaiDemarrageMs = DELAI_ABANDON_DEMARRAGE_MS,
): boolean {
  const silence = maintenant - session.lastAccess;
  if (silence >= idleMs) return true;
  return session.status === "starting" && silence >= delaiDemarrageMs;
}

export async function cleanupIdleSessions(idleMs = config.sessionIdleMinutes * 60_000): Promise<void> {
  const maintenant = Date.now();
  const abandonnees = [...sessions.values()].filter((session) => sessionAbandonnee(session, maintenant, idleMs));
  for (const session of abandonnees) {
    console.warn(`[FlixTunes] Session de lecture abandonnée, arrêt — ${session.id}, média ${session.mediaId}, `
      + `mode ${session.mode}, sans requête depuis ${Math.round((Date.now() - session.lastAccess) / 1000)} s`);
    session.refCount = 0;
    await destroyPlaybackSession(session);
  }
}

export async function cleanupPlaybackSessions(maxAgeMs = 6 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all([...sessions.values()].filter((session) => session.createdAt < cutoff && session.refCount === 0).map(destroyPlaybackSession));
  const cached = [...sessions.values()].filter((session) => session.refCount === 0).sort((left, right) => left.createdAt - right.createdAt);
  const sizeOf = async (directory: string): Promise<number> => { try { const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async (entry) => { const item = path.join(directory, entry.name);
      return entry.isDirectory() ? sizeOf(item) : (await stat(item)).size; }))).reduce((sum, size) => sum + size, 0); } catch { return 0; } };
  let total = (await Promise.all(cached.map((session) => sizeOf(session.directory)))).reduce((sum, size) => sum + size, 0);
  for (const session of cached) { if (total <= config.transcodeCacheMaxBytes) break; const size = await sizeOf(session.directory);
    await destroyPlaybackSession(session); total -= size; }
}

export async function getPlaybackSystemInfo(): Promise<{
  ffmpegAvailable: boolean;
  encoders: string[];
  decoders: string[];
  hardwareAccelerators: string[];
  compatibility: PlaybackCompatibilityMatrix;
  selectedVideoEncoder: string | null;
  activeSessions: number;
  adaptiveSessions: number;
  cachedSessions: number;
  cacheLimitBytes: number;
  activeTranscodes: number;
  maximumTranscodes: number;
  recentFailures: Array<{ at: string; mediaId: string; encoder: string | null; message: string }>;
}> {
  const support = await detectFfmpegSupport();
  let selectedVideoEncoder: string | null = null;
  try { selectedVideoEncoder = (await chooseVideoEncoder()).encoder; } catch { /* FFmpeg absent */ }
  return {
    ffmpegAvailable: support.version !== null,
    encoders: [...support.encoders],
    decoders: [...support.decoders],
    hardwareAccelerators: [...support.hwaccels],
    compatibility: buildCompatibilityMatrix(support),
    selectedVideoEncoder,
    activeSessions: sessions.size,
    adaptiveSessions: [...sessions.values()].filter((session) => (session.variants?.length ?? 0) > 1).length,
    cachedSessions: [...sessions.values()].filter((session) => session.refCount === 0 && session.status === "completed").length,
    cacheLimitBytes: config.transcodeCacheMaxBytes,
    activeTranscodes: activeTranscodeCount(),
    maximumTranscodes: plafondConversions(),
    recentFailures: [...transcodeDiagnostics],
  };
}

export async function readPlaybackFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}
