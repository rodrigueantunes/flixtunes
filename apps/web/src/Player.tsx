import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem, MediaStream, PlaybackCapabilities, PlaybackInfo, PlaybackNeighbors, PlaybackSession, Profile, SubtitlePreference } from "@flixtunes/contracts";
import type Hls from "hls.js";
import { api } from "./api";
import { deviceId } from "./device-id";
import { decodeSupportSnapshot, probeDecodeSupport } from "./decode-support";
import { debitAnnonce, debitMemorise, memoriserDebit, plafondApresCoupures, REBUFFERS_AVANT_REPLI } from "./debit-reseau";
import { decodageDegrade, type EchantillonDecodage, FENETRES_AVANT_REPLI } from "./qualite-decodage";
import { placerVignette, VIGNETTE_HAUTEUR, VIGNETTE_LARGEUR } from "@flixtunes/contracts";
import { pontBureau } from "./bureau";
import { surfacePartagee, type SurfaceLecture } from "./surface-lecture";
import { capacitesBureau } from "./capacites-bureau";
import { analyserWebVtt, type Replique, repliquesA } from "./sous-titres-bureau";

export function browserCapabilities(audioStreamIndex: number | null, subtitle: MediaStream | null, forceTranscode: boolean,
  modePreference: PlaybackCapabilities["modePreference"] = forceTranscode ? "compatible" : "auto",
  externalSubtitleId: number | null = null, burnExternalSubtitle = false, subtitleOffsetSeconds = 0): PlaybackCapabilities {
  const probe = document.createElement("video");
  const supported = (type: string) => probe.canPlayType(type) !== "";
  // La sonde de décodage a été exécutée au démarrage du lecteur. Tant qu'elle n'a pas répondu, on
  // retombe sur les anciennes vérifications afin de ne jamais bloquer une première lecture.
  const decode = decodeSupportSnapshot();
  const videoCodecs: string[] = decode ? [...decode.videoCodecs] : [];
  const audioCodecs: string[] = [];
  const containers: PlaybackCapabilities["containers"] = decode ? [...decode.containers] : [];
  if (!decode) {
    if (supported('video/mp4; codecs="avc1.42E01E"')) { videoCodecs.push("h264", "avc1"); containers.push("mp4"); }
    if (supported('video/mp4; codecs="hvc1"')) videoCodecs.push("hevc", "hvc1");
    if (supported('video/mp4; codecs="av01.0.05M.08"')) videoCodecs.push("av1", "av01");
    if (supported('video/webm; codecs="vp9"')) { videoCodecs.push("vp9", "vp09"); containers.push("webm"); }
  }
  if (supported('video/webm; codecs="vp8"')) videoCodecs.push("vp8");
  if (supported('audio/mp4; codecs="mp4a.40.2"')) audioCodecs.push("aac", "mp4a");
  if (supported('audio/webm; codecs="opus"')) audioCodecs.push("opus");
  if (supported("audio/mpeg")) audioCodecs.push("mp3");
  /**
   * Dolby Digital et Dolby Digital Plus, que personne ne demandait au navigateur.
   *
   * Ils n'étaient sondés nulle part, alors que Chrome et Edge les lisent sur la plupart des postes
   * Windows. Un film en EAC3 — la piste par défaut de presque tous les Blu-ray — partait donc en
   * remux pour son seul son, là où il pouvait être servi tel quel.
   *
   * La réponse exigée est « probably », plus stricte que le `!== ""` retenu pour le reste. L'asymétrie
   * est voulue : une erreur sur l'image lève une erreur du lecteur, qu'on rattrape ; une erreur sur le
   * son donne un film muet, que rien ne signale et que personne ne rattrape.
   */
  const certainement = (type: string) => probe.canPlayType(type) === "probably";
  if (!forceTranscode && certainement('audio/mp4; codecs="ec-3"')) audioCodecs.push("eac3", "ec-3");
  if (!forceTranscode && certainement('audio/mp4; codecs="ac-3"')) audioCodecs.push("ac3", "ac-3");
  if (forceTranscode) videoCodecs.length = 0;
  const highDynamicRange = window.matchMedia?.("(dynamic-range: high)").matches ?? false;
  const hdrFormats: PlaybackCapabilities["hdrFormats"] = !forceTranscode && highDynamicRange ? ["hdr10", "hlg"] : [];
  if (!forceTranscode && (supported('video/mp4; codecs="dvhe.05.06"') || supported('video/mp4; codecs="dvh1.05.06"'))) hdrFormats.push("dolbyvision");
  const connection = (navigator as Navigator & { connection?: { downlink?: number; type?: string; effectiveType?: string } }).connection;
  // `downlink` est plafonné à 10 Mb/s par les navigateurs et décrit le lien Internet, pas le lien LAN
  // vers le NAS. L'utiliser comme plafond bloquait toute qualité au-dessus de 720p sur un réseau local.
  // Il n'est retenu que sur un réseau mobile, où il traduit une contrainte réelle ; ailleurs l'adaptation
  // se fait à l'exécution sur le débit mesuré par HLS.
  const cellular = connection?.type === "cellular"
    || (connection?.effectiveType != null && ["slow-2g", "2g", "3g"].includes(connection.effectiveType));
  const nativeHls = supported("application/vnd.apple.mpegurl");
  return {
    containers: containers.length ? containers : ["mp4"],
    videoCodecs,
    audioCodecs,
    hls: "MediaSource" in window || supported("application/vnd.apple.mpegurl"),
    dash: false,
    // La définition annoncée décrit ce que l'appareil sait décoder, non la taille de son écran. La
    // dériver de `screen.width` refusait une source 4K sur un écran plus petit — alors que le
    // navigateur la décode et la réduit sans peine — et déclenchait un transcodage inutile, assez
    // lourd pour que l'admission du serveur bride ensuite la lecture à 1080p.
    maxWidth: forceTranscode ? 1920 : decode?.maxWidth ?? 1920,
    maxHeight: forceTranscode ? 1080 : decode?.maxHeight ?? 1080,
    hdr: !forceTranscode && highDynamicRange,
    hdrFormats,
    dolbyVisionProfiles: hdrFormats.includes("dolbyvision") ? [5, 7, 8, 9] : [],
    dolbyAtmos: false,
    immersiveAudioFormats: [],
    maxAudioChannels: 2,
    losslessAudio: false,
    maxVideoBitrate: null,
    audioStreamIndex,
    // Le HTMLVideoElement de Chrome/Edge ne fournit pas de sélection fiable des pistes audio d'un
    // MKV servi entier. Le serveur doit donc isoler la piste demandée dans un remux sans perte.
    directAudioStreamSelection: false,
    subtitleStreamIndex: subtitle?.index ?? null,
    externalSubtitleId,
    burnSubtitles: Boolean((subtitle && !subtitle.canExtractAsWebVtt) || burnExternalSubtitle),
    subtitleOffsetSeconds,
    networkMbps: cellular ? connection?.downlink ?? null : null,
    hlsSegmentContainer: forceTranscode || (nativeHls && !("MediaSource" in window)) ? "mpegts" : "fmp4",
    deviceClass: window.matchMedia?.("(pointer: coarse)").matches ? (window.screen.width >= 1280 ? "tv" : "mobile") : "web",
    modePreference,
    adaptiveStreaming: true,
    streamingProtocol: "hls",
  };
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function resumePosition(duration: number, progressPercent: number, rewindSeconds: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || progressPercent <= 0 || progressPercent >= 90) return 0;
  return Math.max(0, duration * progressPercent / 100 - Math.max(0, rewindSeconds));
}

function languageName(stream: MediaStream): string {
  const language = stream.language?.toLowerCase();
  const label = language?.startsWith("fr") || language === "fra" ? "Français"
    : language?.startsWith("en") || language === "eng" ? "English"
      : stream.language?.toUpperCase() || "Langue inconnue";
  const role = stream.audioRole === "original" ? "Version originale" : stream.audioRole === "dub" ? "Doublage"
    : stream.audioRole === "commentary" ? "Commentaire" : stream.audioRole === "audio-description" ? "Audiodescription" : null;
  return [label, stream.title, role].filter(Boolean).join(" · ");
}

function normalizedLanguage(value: string | null | undefined): string {
  const primary = value?.toLowerCase().replace("_", "-").split("-")[0] ?? "";
  return ({ fra: "fr", fre: "fr", eng: "en", deu: "de", ger: "de", spa: "es", ita: "it", por: "pt" } as Record<string, string>)[primary] ?? primary;
}

function preferredLanguageIndex(preferences: string[], stream: MediaStream): number {
  const language = normalizedLanguage(stream.language);
  const matches = preferences.map((preference) => preference.toLowerCase() === "original"
    ? stream.audioRole === "original" : normalizedLanguage(preference) === language);
  const index = matches.indexOf(true);
  return index < 0 ? 999 : index;
}

/** Un numéro de piste n'a de sens que dans son fichier : l'index 1 peut être VF ici et VO ailleurs. */
function audioPreferenceKey(profileId: string, mediaId: string): string {
  return `flixtunes:${profileId}:${mediaId}:audio`;
}

/** Secondes avant l'enchaînement automatique — la jauge s'en sert pour se vider au bon rythme. */
const DELAI_AUTOPLAY_SECONDES = 10;

const dynamicRangeLabels: Record<MediaStream["hdrFormat"], string> = {
  sdr: "SDR", hdr10: "HDR10", hdr10plus: "HDR10+", hlg: "HLG", dolbyvision: "Dolby Vision",
};

function dolbyVisionBase(video: MediaStream): MediaStream["hdrFormat"] | null {
  const compatibility = video.color?.dolbyVisionBlCompatibilityId;
  if (compatibility === 1 || compatibility === 6) return "hdr10";
  if (compatibility === 4) return "hlg";
  if (compatibility === 2) return "sdr";
  const profile = video.color?.dolbyVisionProfile ?? video.dolbyVisionProfile;
  return profile === 7 || profile === 8 ? "hdr10" : null;
}

export function dynamicRangeChoices(video: MediaStream | undefined, accepted: readonly string[], priority = "auto") {
  if (!video || video.hdrFormat === "sdr") return [];
  const possible = new Set<string>();
  if (accepted.includes(video.hdrFormat)) possible.add(video.hdrFormat);
  for (const format of video.availableHdrFormats ?? []) {
    if (accepted.includes(format)) possible.add(format);
  }
  if (video.hdrFormat === "hdr10plus" && accepted.includes("hdr10")) possible.add("hdr10");
  if (video.hdrFormat === "dolbyvision") {
    const base = dolbyVisionBase(video); if (base && (base === "sdr" || accepted.includes(base))) possible.add(base);
  }
  possible.add("sdr");
  const automatic = priority === "auto" ? "Auto · DV → HDR10+ → HDR10 → HLG → SDR"
    : `Auto · priorité ${dynamicRangeLabels[priority as MediaStream["hdrFormat"]] ?? priority.toUpperCase()}`;
  return [{ value: "auto", label: automatic }, ...(["dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr"] as const)
    .filter((value) => possible.has(value)).map((value) => ({ value, label: value === "sdr" ? "SDR (conversion)" : dynamicRangeLabels[value] }))];
}

function colorPipelineSummary(pipeline: NonNullable<PlaybackSession["colorPipeline"]>): string {
  const source = dynamicRangeLabels[pipeline.sourceFormat];
  const output = dynamicRangeLabels[pipeline.outputFormat];
  if (pipeline.action === "sdr-passthrough") return "SDR sans conversion";
  if (pipeline.action === "preserve" && source === output) return `${source} conservé`;
  return `${source} → ${output}`;
}

function streamTechnology(stream: MediaStream): string {
  if (stream.dolbyAtmos) return "Dolby Atmos";
  if (stream.audioTechnology === "dts-x") return "DTS:X";
  if (stream.audioTechnology === "auro-3d") return "Auro-3D";
  if (stream.hdrFormat === "dolbyvision") return `Dolby Vision${stream.dolbyVisionProfile ? ` P${stream.dolbyVisionProfile}` : ""}`;
  if (stream.hdrFormat === "hdr10plus") return "HDR10+";
  if (stream.hdrFormat === "hdr10") return "HDR10";
  if (stream.hdrFormat === "hlg") return "HLG";
  return `${stream.codec.toUpperCase()}${stream.losslessAudio ? " lossless" : ""}`;
}

function positionSubtitleTrack(track: HTMLTrackElement, position: SubtitlePreference["position"]): void {
  track.addEventListener("load", () => {
    const textTrack = track.track;
    if (!textTrack?.cues) return;
    for (const cue of Array.from(textTrack.cues)) {
      if (!("line" in cue)) continue;
      const webVttCue = cue as VTTCue;
      webVttCue.snapToLines = false;
      webVttCue.line = position === "top" ? 8 : position === "middle" ? 50 : 92;
    }
  }, { once: true });
}

/**
 * Lecteur, indépendant du catalogue.
 *
 * Il ne reçoit qu'un identifiant de média et va chercher lui-même ce dont il a besoin. Auparavant, il
 * exigeait une fiche complète déjà chargée : impossible d'entrer dans le lecteur autrement que depuis
 * une page de catalogue, et un rechargement en cours de film renvoyait à l'accueil.
 *
 * Cette indépendance permet une adresse de lecture propre — la lecture survit alors à un rechargement
 * — et laisse d'autres clients réutiliser le même contrat sans reproduire la forme du catalogue.
 *
 * L'enveloppe ne fait que charger la fiche. Tout le lecteur vit dans `LecteurCharge`, monté seulement
 * quand la fiche est là : sans quoi il faudrait traiter l'absence de durée, de titre et de
 * progression à chaque ligne, pour un état qui ne dure qu'un instant.
 */
export function Player({ mediaId, profile, onClose, onPlayMedia }: {
  mediaId: string; profile: Profile; onClose: () => void; onPlayMedia: (mediaId: string) => void;
}) {
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [erreurFiche, setErreurFiche] = useState<string | null>(null);

  useEffect(() => {
    let abandonne = false;
    setMedia(null); setErreurFiche(null);
    api.media(mediaId, profile.id)
      .then((fiche) => { if (!abandonne) setMedia(fiche); })
      .catch((cause: unknown) => {
        if (!abandonne) setErreurFiche(cause instanceof Error ? cause.message : "Média introuvable");
      });
    return () => { abandonne = true; };
  }, [mediaId, profile.id]);

  if (erreurFiche) {
    return <div className="player-page"><div className="player-message">
      <b>Lecture impossible</b><span>{erreurFiche}</span>
      <div className="player-message-actions"><button onClick={onClose}>Retour</button></div>
    </div></div>;
  }
  if (!media) return <div className="player-page"><div className="player-message"><b>Préparation de la lecture…</b></div></div>;
  return <LecteurCharge media={media} profile={profile} onClose={onClose} onPlayMedia={onPlayMedia} />;
}

function LecteurCharge({ media, profile, onClose, onPlayMedia }: {
  media: MediaItem; profile: Profile; onClose: () => void; onPlayMedia: (mediaId: string) => void;
}) {

  /**
   * Où la lecture a lieu.
   *
   * Deux références, et la distinction porte tout le client de bureau. `videoRef` est la **surface**
   * de lecture : une balise vidéo dans un navigateur, VLC dans la coque. C'est elle que le lecteur
   * commande — lis, mets en pause, va à telle seconde — et elle seule. `elementVideoRef` est la
   * balise elle-même, et vaut `null` quand VLC décode : elle ne sert qu'aux quelques gestes qui
   * n'ont de sens que dans le DOM — poser une piste de sous-titres, incruster la vidéo dans un coin
   * de l'écran.
   *
   * Le partage est fait de telle sorte que le chemin du navigateur ne change pas d'un iota :
   * `HTMLVideoElement` satisfait `SurfaceLecture` tel quel, sans adaptateur ni indirection.
   */
  const videoRef = useRef<SurfaceLecture | null>(null);
  const elementVideoRef = useRef<HTMLVideoElement | null>(null);
  /**
   * VLC, s'il est là.
   *
   * La coque n'expose le pont de lecture que lorsque VLC est réellement installé, et la surface est
   * partagée : il n'y a qu'un VLC et qu'un lecteur à la fois. Dans un navigateur, `null` — et rien
   * de ce qui suit ne change quoi que ce soit au chemin existant.
   */
  const surfaceVlc = surfacePartagee();
  // L'affectation se fait pendant le rendu, et non dans un effet : les effets qui lisent cette
  // référence s'exécutent dès le premier passage, et ils la trouveraient vide.
  if (surfaceVlc) videoRef.current = surfaceVlc;
  const pageRef = useRef<HTMLDivElement | null>(null);
  // Les commandes s'effacent après un temps d'inactivité : en plein écran, une barre permanente
  // recouvre le bas de l'image et transforme un film en interface. Elles reviennent au moindre
  // mouvement, à la moindre touche, et restent affichées tant que la lecture est en pause — c'est
  // alors qu'on en a besoin.
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const hlsRecoveryRef = useRef(0);
  /** Reprises de session déjà accordées à l'incident en cours. Remis à zéro par un segment reçu. */
  const renegociationsRef = useRef(0);
  /**
   * Redemande une session au serveur, au point courant du film.
   *
   * Passe par une référence plutôt que par un appel direct : `attachSource` est défini avant `start`,
   * et `start` l'appelle. Les faire dépendre l'un de l'autre créerait un cycle que React ne sait pas
   * mémoriser.
   */
  const renegocierRef = useRef<(() => void) | null>(null);
  const audioIndexRef = useRef<number | null>(null);
  const subtitleIndexRef = useRef<number | null>(null);
  const externalSubtitleIndexRef = useRef<number | null>(null);
  const subtitleOffsetRef = useRef(0);
  const subtitleEncodingRef = useRef<SubtitlePreference["encodingOverride"]>("auto");
  const subtitlePositionRef = useRef<SubtitlePreference["position"]>("bottom");
  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  /**
   * La fiche technique du média, lisible depuis un écouteur d'événement.
   *
   * Les écouteurs posés sur l'élément vidéo sont installés une fois et capturent la valeur qu'avait
   * `info` à cet instant — `null` au montage. Le repli après coupures s'en sert pour renégocier :
   * sans référence, il ne renégocierait jamais.
   */
  const infoRef = useRef<PlaybackInfo | null>(null);
  useEffect(() => { infoRef.current = info; }, [info]);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  /**
   * La session en cours, lisible depuis un écouteur d'événement — même raison que `infoRef`.
   *
   * Les écouteurs de l'élément vidéo ne sont réinstallés qu'au changement de média : ils capturent
   * `session` telle qu'elle était alors, c'est-à-dire `null`, puisque la négociation n'a pas encore
   * eu lieu. Tout ce qui dépend du mode retenu — le démenti de quarantaine à la première image, le
   * repli sur décodage saccadé — se croyait donc en permanence hors lecture directe.
   */
  const sessionRef = useRef<PlaybackSession | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const [externalSubtitleIndex, setExternalSubtitleIndex] = useState<number | null>(null);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [subtitleSize, setSubtitleSize] = useState<"small" | "normal" | "large">("normal");
  const [subtitleBackground, setSubtitleBackground] = useState(false);
  const [subtitleColor, setSubtitleColor] = useState<SubtitlePreference["color"]>("white");
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePreference["position"]>("bottom");
  const [subtitleFont, setSubtitleFont] = useState<SubtitlePreference["fontFamily"]>("sans");
  const [subtitleEncoding, setSubtitleEncoding] = useState<SubtitlePreference["encodingOverride"]>("auto");
  /**
   * Les sous-titres quand c'est VLC qui décode.
   *
   * Il n'y a plus de balise vidéo à qui accrocher une piste : le lecteur charge donc lui-même le
   * WebVTT — **exactement celui que le navigateur aurait chargé**, décalage de session compris — et
   * affiche la réplique du moment. VLC est lancé sans sous-titres pour qu'il n'y en ait jamais deux
   * jeux superposés.
   */
  const [urlSousTitreBureau, setUrlSousTitreBureau] = useState<string | null>(null);
  const [repliquesBureau, setRepliquesBureau] = useState<Replique[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>("Préparation de la lecture…");
  const [directRetry, setDirectRetry] = useState(false);
  const [neighbors, setNeighbors] = useState<PlaybackNeighbors>({ previous: null, next: null });
  const [currentTime, setCurrentTime] = useState(0);
  /**
   * Décalage entre le début du flux servi et le début du film, en secondes.
   *
   * Un transcodage part du début et encode linéairement : on ne pouvait se déplacer que dans la
   * portion déjà encodée. Le serveur sait maintenant démarrer une session à un point donné ; l'instant
   * 0 du flux ne correspond alors plus à l'instant 0 du film.
   *
   * Deux échelles de temps coexistent donc. Celle du **film** est la seule qui compte pour la personne
   * qui regarde : c'est elle que porte l'état `currentTime`, elle qu'on enregistre en progression, et
   * elle qu'attend `seekTo`. La traduction vers le flux est confinée aux quelques endroits qui
   * touchent réellement à l'élément vidéo.
   */
  const startOffsetRef = useRef(0);
  /** Minuterie qui attend l'immobilisation du curseur avant de redemander une session au serveur. */
  const seekRestartRef = useRef<number | null>(null);
  /** Durée déclarée par le média en cours de lecture. En transcodage HLS, elle ne couvre que la partie déjà encodée. */
  const [mediaDuration, setMediaDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0); const [paused, setPaused] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(profile.defaultPlaybackRate ?? 1);
  const [sleepMinutes, setSleepMinutes] = useState(0); const sleepTimerRef = useRef<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false); const [droppedFrames, setDroppedFrames] = useState(0);
  const [colorNoticeDismissed, setColorNoticeDismissed] = useState(false);
  const [resumePrompt, setResumePrompt] = useState(false); const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  /**
   * Durée que couvre la jauge de la carte d'enchaînement.
   *
   * Elle vaut le générique de fin quand le fichier le nomme — la carte s'ouvre alors dès le générique
   * et la jauge se vide jusqu'à la fin — et [DELAI_AUTOPLAY_SECONDES] sinon, l'ancien comportement.
   */
  const [nextTotal, setNextTotal] = useState(DELAI_AUTOPLAY_SECONDES);
  /** « Annuler » vaut pour tout le reste de l'épisode : la carte ne doit pas revenir à la fin. */
  const autoplayEcarteRef = useRef(false);
  /** Vrai quand la carte a été ouverte par le générique, et non par la fin du média. */
  const carteParGeneriqueRef = useRef(false);
  /** Introduction déjà passée ou refusée : le bouton ne réapparaît pas. */
  const [introEcartee, setIntroEcartee] = useState(false);
  const [timelinePreview, setTimelinePreview] = useState<number | null>(null);
  const [qualityLevels, setQualityLevels] = useState<Array<{ index: number; height: number; bitrate: number }>>([]);
  const [qualityLevel, setQualityLevel] = useState(-1); const [estimatedMbps, setEstimatedMbps] = useState<number | null>(null);
  const [rebufferCount, setRebufferCount] = useState(0); const playbackStartedAtRef = useRef(performance.now());
  // Le débit mesuré et le nombre de coupures servent à la **prochaine** négociation : les garder dans
  // des références évite de relancer un rendu à chaque segment chargé, et surtout d'aller les lire
  // dans un état périmé au moment où l'on redemande une session.
  const mesureDebitRef = useRef<number | null>(debitMemorise(window.location.host));
  /** Ce que le navigateur veut bien dire de la connexion — utile seulement en cellulaire. */
  const connexionAnnoncee = () =>
    (navigator as Navigator & { connection?: { downlink?: number; type?: string; effectiveType?: string } }).connection ?? null;
  const coupuresRef = useRef(0);
  /**
   * Les relevés d'images perdues, qui disent si le décodeur tient la cadence.
   *
   * Le serveur peut désormais servir un fichier tel quel malgré un désaccord annoncé — un conteneur
   * qu'il ne déclare pas, une définition au-dessus du plafond qu'il annonce. Ce pari n'est acceptable
   * que parce que son échec se mesure ici : sans ces relevés, une image hachée passerait inaperçue du
   * lecteur, et la personne conclurait simplement que le film saccade.
   *
   * Dans une référence et non un état : un relevé par seconde relancerait autant de rendus pour une
   * mesure que rien n'affiche.
   */
  const echantillonsDecodageRef = useRef<EchantillonDecodage[]>([]);
  /** Le démenti de quarantaine n'a de sens qu'une fois par lecture : le serveur efface une ligne. */
  const dementiEnvoyeRef = useRef(false);
  const autoplayTimerRef = useRef<number | null>(null);
  const reconnectPositionRef = useRef(0);
  const modePreferenceRef = useRef<PlaybackCapabilities["modePreference"]>("auto");
  // La plage dynamique choisie survit aux renégociations : changer de piste audio ne doit pas
  // ramener silencieusement le rendu automatique que la personne venait d'écarter.
  const [dynamicRange, setDynamicRange] = useState<NonNullable<PlaybackCapabilities["dynamicRangePreference"]>>("auto");
  const dynamicRangeRef = useRef<NonNullable<PlaybackCapabilities["dynamicRangePreference"]>>("auto");

  /**
   * Durée réelle du média, mesurée par FFprobe côté serveur.
   * Le flux HLS ne déclare que la portion déjà encodée : s'y fier ferait sauter la barre de progression
   * et renverrait la reprise au début du fichier.
   */
  const trueDuration = info?.durationSeconds ?? media.runtimeSeconds ?? 0;
  const trueDurationRef = useRef(media.runtimeSeconds ?? 0);
  useEffect(() => { trueDurationRef.current = trueDuration || mediaDuration; }, [mediaDuration, trueDuration]);

  // Le plein écran se quitte aussi par Échap ou par un geste du système : sans écoute, le libellé du
  // bouton resterait « Quitter le plein écran » alors qu'on en est déjà sorti.
  useEffect(() => {
    /*
     * Deux plein écran, et un seul est celui du navigateur.
     *
     * Dans la coque de bureau, c'est une fenêtre du système qui s'agrandit — la fenêtre vidéo, que
     * l'interface suit. Le document, lui, ne passe jamais en plein écran : `fullscreenchange` ne se
     * déclenche pas, et le bouton serait resté sur son icône d'agrandissement pour toujours. La
     * coque annonce donc son propre état, et elle l'annonce aussi quand la touche F11 est venue de
     * l'extérieur de la page.
     */
    const coque = pontBureau();
    if (coque) return coque.surPleinEcran(setFullScreen);
    const suivre = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", suivre);
    return () => document.removeEventListener("fullscreenchange", suivre);
  }, []);
  /** Échelle de la barre : la durée réelle si elle est connue, sinon ce que le média déclare. */
  const timelineDuration = trueDuration || mediaDuration;
  /** Fin de la portion déjà encodée par le serveur. En lecture directe, tout le fichier est disponible. */
  const encodedEnd = session?.mode === "direct" ? timelineDuration : Math.min(mediaDuration || 0, timelineDuration || Infinity);
  const percentOf = (seconds: number) => (timelineDuration > 0 ? Math.max(0, Math.min(100, seconds / timelineDuration * 100)) : 0);

  /**
   * Un sous-titre image, ou texte non convertible, impose une incrustation donc une nouvelle session.
   *
   * Sauf quand VLC décode : un sous-titre **du fichier** est alors dessiné par lui, et c'est la
   * conversion la plus chère de toutes qui disparaît — le NAS réencodait le film entier pour y
   * incruster des images qui ne peuvent pas devenir du texte. Un sous-titre **externe** reste à
   * incruster : c'est un fichier à part, que VLC ne trouvera pas dans le flux qu'on lui donne.
   */
  const requiresBurnIn = useCallback((playbackInfo: PlaybackInfo, streamIndex: number | null, externalId: number | null) => {
    if (streamIndex != null) {
      if (surfaceVlc) return false;
      const stream = playbackInfo.streams.find((candidate) => candidate.type === "subtitle" && candidate.index === streamIndex);
      return Boolean(stream && !stream.canExtractAsWebVtt);
    }
    if (externalId != null) {
      const external = playbackInfo.externalSubtitles?.find((candidate) => candidate.id === externalId);
      return Boolean(external && !external.canConvertToWebVtt);
    }
    return false;
  }, []);

  /**
   * Reconstruit les pistes WebVTT du lecteur sans toucher au flux vidéo en cours.
   *
   * Le décalage envoyé au serveur additionne deux choses de nature différente :
   *
   * - celui que la personne a réglé, qui corrige un fichier dont les sous-titres avancent ou
   *   retardent ;
   * - **moins le début de la session**, parce qu'un flux qui ne commence pas au début du film compte
   *   à partir de zéro. Une lecture reprise à huit minutes affichait ainsi des sous-titres écrits pour
   *   la huitième minute alors que la balise vidéo en était à sa huitième *seconde* : ils étaient
   *   chargés, sélectionnés, et n'apparaissaient jamais. Tout le reste de l'interface faisait déjà
   *   cette addition — l'horloge, la barre, les chapitres —, la piste de sous-titres était la seule
   *   à l'oublier.
   */
  const applySubtitleTracks = useCallback((playbackInfo: PlaybackInfo) => {
    const decalage = subtitleOffsetRef.current - startOffsetRef.current;
    const internalChoisi = playbackInfo.streams.find((stream) => stream.type === "subtitle" && stream.index === subtitleIndexRef.current);
    const externalChoisi = playbackInfo.externalSubtitles?.find((subtitle) => subtitle.id === externalSubtitleIndexRef.current);
    const video = elementVideoRef.current;
    if (!video) {
      /*
       * VLC décode : il n'y a pas de balise vidéo, donc pas de piste à y accrocher.
       *
       * On retient l'adresse du WebVTT — le même que celui d'un navigateur, avec le même décalage —
       * et le lecteur l'affichera lui-même par-dessus l'image. Une seule piste à la fois : le
       * navigateur empile les balises et n'en montre qu'une, autant le dire clairement ici.
       */
      const interne = internalChoisi?.canExtractAsWebVtt
        ? api.subtitleUrl(media.id, internalChoisi.index, profile.id, decalage) : null;
      const externe = externalChoisi?.canConvertToWebVtt
        ? api.externalSubtitleUrl(media.id, externalChoisi.id, profile.id, decalage, subtitleEncodingRef.current) : null;
      setUrlSousTitreBureau(interne ?? externe);
      /*
       * Un sous-titre image du fichier, confié à VLC.
       *
       * Il ne peut pas devenir du texte : le lecteur ne saurait pas le dessiner, et le faire
       * incruster par le serveur coûterait un réencodage du film entier. VLC le dessine à sa façon —
       * les réglages de taille et de couleur n'y peuvent rien, mais ils n'y pouvaient rien non plus
       * sur une incrustation.
       */
      const image = internalChoisi && !internalChoisi.canExtractAsWebVtt ? internalChoisi.index : -1;
      surfaceVlc?.choisirPisteSousTitre(image);
      return;
    }
    video.querySelectorAll("track").forEach((track) => track.remove());
    const internal = internalChoisi;
    if (internal?.canExtractAsWebVtt) {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = languageName(internal);
      track.srclang = internal.language?.slice(0, 2) || "und";
      track.src = api.subtitleUrl(media.id, internal.index, profile.id, decalage);
      track.default = true;
      positionSubtitleTrack(track, subtitlePositionRef.current);
      video.append(track);
    }
    const external = externalChoisi;
    if (external?.canConvertToWebVtt) {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = external.name;
      track.srclang = external.language?.slice(0, 2) || "und";
      track.src = api.externalSubtitleUrl(media.id, external.id, profile.id, decalage, subtitleEncodingRef.current);
      track.default = true;
      positionSubtitleTrack(track, subtitlePositionRef.current);
      video.append(track);
    }
    // Le navigateur conserve parfois l'ancienne piste masquée : la sélection est réappliquée explicitement.
    for (const textTrack of Array.from(video.textTracks)) {
      textTrack.mode = video.querySelector("track") ? "showing" : "disabled";
    }
  }, [media.id, surfaceVlc]);

  const attachSource = useCallback(async (playback: PlaybackSession, playbackInfo: PlaybackInfo) => {
    const video = videoRef.current;
    if (!video || !playback.url) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const source = api.playbackUrl(playback.url);
    if (reconnectPositionRef.current > 0) video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(Math.max(0, reconnectPositionRef.current - startOffsetRef.current), Math.max(0, video.duration - .25)); reconnectPositionRef.current = 0;
    }, { once: true });
    /*
     * VLC décode : il ouvre le flux lui-même, et il n'y a plus de hls.js.
     *
     * Ce n'est pas une perte. hls.js existe pour donner au navigateur ce qu'il ne sait pas faire —
     * découper un flux adaptatif et le pousser dans un `MediaSource`. VLC lit HLS nativement, et
     * surtout il lit **le fichier tel quel**, ce qui est tout l'intérêt : la plupart des lectures du
     * client de bureau ne passent plus par HLS du tout.
     *
     * Reste que le menu de qualité vient des paliers déclarés par hls.js : il est donc vide ici, et
     * c'est honnête — une lecture directe n'a pas de paliers, et sur un flux converti c'est VLC qui
     * choisit.
     */
    const surface = surfaceVlc;
    if (surface) {
      setQualityLevels([]);
      setQualityLevel(-1);
      /*
       * Les pistes voulues partent **avec** l'ouverture, et deux défauts constatés l'expliquent.
       *
       * En annonçant que le client sait choisir, on a dispensé le serveur d'isoler la piste : il sert
       * le fichier entier, toutes langues comprises. Ne rien désigner faisait démarrer le film dans
       * la première langue du fichier — en anglais alors que le profil demande le français. Le
       * désigner juste après l'ouverture le faisait démarrer **sans son**, VLC n'ayant pas encore lu
       * le format du flux audio.
       *
       * Seulement en lecture directe : un flux converti ne porte que la piste que le serveur a
       * retenue, et il n'y a rien à choisir.
       */
      const direct = playback.mode === "direct";
      const sousTitreImage = playbackInfo.streams.find((flux) => flux.type === "subtitle"
        && flux.index === subtitleIndexRef.current && !flux.canExtractAsWebVtt);
      const reponse = await surface.ouvrir(source, direct
        ? { audio: audioIndexRef.current, sousTitre: sousTitreImage?.index ?? -1 }
        : {});
      setMessage(reponse.ok ? null : reponse.message ?? "Lecture impossible");
      applySubtitleTracks(playbackInfo);
      return;
    }
    // Passé ce point, la lecture est celle d'un navigateur : hls.js et la source se posent sur la
    // balise vidéo, qui existe forcément puisque VLC vient d'être écarté.
    const element = elementVideoRef.current;
    if (!element) return;
    const HlsClass = playback.mode !== "direct" && "MediaSource" in window ? (await import("hls.js")).default : null;
    if (HlsClass?.isSupported()) {
      // `capLevelToPlayerSize` plafonnait la qualité aux dimensions rendues de l'élément vidéo. Dans
      // une fenêtre qui n'occupe pas tout un écran 1080p — le cas ordinaire —, l'élément mesure moins
      // de 1920 pixels et le plafond tombait mécaniquement à 720p, quel que soit le débit disponible.
      // Sur un réseau local vers un NAS, la bande passante n'est pas la ressource rare : on laisse
      // l'adaptation se décider sur le débit mesuré, et le choix manuel reste offert au lecteur.
      const hls = new HlsClass({ enableWorker: true, backBufferLength: 90, maxBufferLength: 45, maxMaxBufferLength: 90,
        // Sans `#EXT-X-ENDLIST`, hls.js tient la playlist pour un direct — c'est le cas tant que
        // FFmpeg écrit — et démarre alors au **bord** du flux, à trois segments de la fin, au lieu du
        // début. En transcodage la fenêtre encodée est courte et le bord se confond avec le début ;
        // en remux, où la copie va des dizaines de fois plus vite que le temps réel, la playlist
        // porte déjà une minute au moment où le lecteur la lit : le film commençait une minute trop
        // loin. Le décalage de démarrage voulu est porté par la session, jamais par le lecteur.
        startPosition: 0,
        // Le tampon est plafonné par le premier des deux critères atteints. Les 60 Mio par défaut
        // ramenaient les 45 s demandées à moins de 25 s dès qu'un flux dépassait 20 Mb/s — c'est-à-dire
        // exactement sur les fichiers dont la lecture est la plus fragile.
        maxBufferSize: 120 * 1000 * 1000,
        capLevelToPlayerSize: false, startLevel: -1, abrEwmaDefaultEstimate: 8_000_000, abrBandWidthFactor: .8, abrBandWidthUpFactor: .65 });
      hls.loadSource(source);
      hls.attachMedia(element);
      hls.on(HlsClass.Events.MANIFEST_PARSED, () => { hlsRecoveryRef.current = 0; setMessage(null);
        setQualityLevels(hls.levels.map((level, index) => ({ index, height: level.height, bitrate: level.bitrate }))); void video.play().catch(() => undefined); });
      hls.on(HlsClass.Events.LEVEL_SWITCHED, (_event, data) => { if (hls.autoLevelEnabled) setQualityLevel(-1); else setQualityLevel(data.level); });
      hls.on(HlsClass.Events.FRAG_LOADED, () => { const estimate = (hls as Hls & { bandwidthEstimate?: number }).bandwidthEstimate;
        if (estimate) {
          const mbps = estimate / 1_000_000;
          setEstimatedMbps(mbps);
          // Conservée pour la prochaine lecture : sans mémoire, la première négociation d'une séance se
          // fait toujours à l'aveugle — et c'est elle qui décide de recopier le fichier ou de le convertir.
          mesureDebitRef.current = mbps;
          memoriserDebit(window.location.host, mbps);
        }
        // Un segment reçu prouve que la lecture est repartie : c'est le seul moment honnête pour
        // rendre son crédit de reprises à l'incident suivant.
        renegociationsRef.current = 0;
      });
      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // Le serveur reprend les sessions dont plus personne ne demande de segment, et il en va de
        // même s'il redémarre : le flux se dérobe alors avec un 404. Réessayer la même adresse ne
        // rendra jamais rien — il faut redemander une session, au point où l'on en était.
        const codeHttp = (data as { response?: { code?: number } }).response?.code;
        const sessionDisparue = playback.mode !== "direct" && (codeHttp === 404 || codeHttp === 410);
        if (!sessionDisparue && data.type === HlsClass.ErrorTypes.NETWORK_ERROR && hlsRecoveryRef.current < 3) {
          hlsRecoveryRef.current += 1; setMessage(`Reconnexion au serveur (${hlsRecoveryRef.current}/3)…`); hls.startLoad(); return;
        }
        if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && hlsRecoveryRef.current < 2) {
          hlsRecoveryRef.current += 1; setMessage("Récupération du décodeur vidéo…"); hls.recoverMediaError(); return;
        }
        // Deux reprises au plus, et le crédit ne revient qu'après un segment réellement reçu : sans
        // cette borne, une session qu'on ne peut plus obtenir ferait boucler le lecteur en silence.
        if (playback.mode !== "direct" && renegociationsRef.current < 2 && renegocierRef.current) {
          renegociationsRef.current += 1;
          setMessage("Reprise de la session de lecture…");
          renegocierRef.current();
          return;
        }
        setMessage("La lecture HLS a été interrompue. Vous pouvez relancer en mode compatible.");
      });
      hlsRef.current = hls;
    } else {
      element.src = source;
      setMessage(null);
    }
    applySubtitleTracks(playbackInfo);
  }, [applySubtitleTracks]);

  const start = useCallback(async (playbackInfo: PlaybackInfo, modePreference: PlaybackCapabilities["modePreference"] = "auto", startSeconds = 0) => {
    const forceTranscode = modePreference === "compatible";
    modePreferenceRef.current = modePreference;
    // Une nouvelle session, un nouveau décodage : les relevés de la précédente ne disent rien de
    // celle-ci, et les conserver ferait conclure à un décrochage sur des images déjà oubliées.
    echantillonsDecodageRef.current = [];
    dementiEnvoyeRef.current = false;
    setColorNoticeDismissed(false);
    setMessage(forceTranscode ? "Compatibilité maximale, transcodage…" : modePreference === "direct" ? "Tentative de lecture directe…" : "Négociation avec le serveur…");
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    reconnectPositionRef.current = startOffsetRef.current + (video?.currentTime ?? 0);
    video?.pause();
    // Vider la balise de sa source et de ses pistes n'a de sens que s'il y en a une. Quand VLC
    // décode, c'est l'ouverture du flux suivant qui remplace le précédent, et les sous-titres sont
    // effacés ici pour qu'aucune réplique du film d'avant ne survive à la bascule.
    const element = elementVideoRef.current;
    if (element) { element.removeAttribute("src"); element.querySelectorAll("track").forEach((track) => track.remove()); element.load(); }
    else { setUrlSousTitreBureau(null); setRepliquesBureau([]); }
    if (sessionIdRef.current) {
      void api.stopPlayback(sessionIdRef.current).catch(() => undefined);
      sessionIdRef.current = null;
    }
    try {
      // La sonde de décodage précède la négociation : c'est elle qui décide des codecs, des
      // conteneurs et de la définition annoncés. Elle ne s'exécute qu'une fois par session et son
      // échec éventuel est sans conséquence — la négociation retombe alors sur les sondes anciennes.
      // La sonde interroge le navigateur : elle n'apprend rien quand c'est VLC qui décode, et ce
      // qu'elle mesure n'entre alors dans aucune décision.
      if (!surfaceVlc) await probeDecodeSupport().catch(() => undefined);
      const external = playbackInfo.externalSubtitles?.find((subtitle) => subtitle.id === externalSubtitleIndexRef.current) ?? null;
      const declarer = surfaceVlc ? capacitesBureau : browserCapabilities;
      const clientCapabilities = declarer(audioIndexRef.current, playbackInfo.streams.find((stream) => stream.index === subtitleIndexRef.current) ?? null,
        forceTranscode, modePreference, external?.id ?? null, external?.kind === "image", subtitleOffsetRef.current);
      clientCapabilities.dynamicRangePreference = dynamicRangeRef.current === "auto"
        ? profile.dynamicRangePriority ?? "auto" : dynamicRangeRef.current;
      clientCapabilities.preferredAudioLanguages = profile.preferredAudioLanguages;
      clientCapabilities.preferredSubtitleLanguages = profile.preferredSubtitleLanguages;
      clientCapabilities.audioOutputMode = profile.audioOutputMode;
      clientCapabilities.audioNormalization = profile.audioNormalization;
      clientCapabilities.nightMode = profile.nightMode;
      // Ce que le chemin jusqu'au NAS supporte réellement, et non ce que le lien local déclare.
      //
      // Sans annonce, le serveur suppose une bande passante illimitée et sert le fichier tel quel.
      // Relevé sur une lecture réelle : source à 26,5 Mb/s, chemin mesuré à 29,4 Mb/s — onze pour cent
      // de marge, et ça coupe. L'adaptation à l'exécution devait couvrir ce cas, mais un remux ne
      // porte aucune échelle adaptative : un seul flux, au débit de la source, à prendre ou à laisser.
      //
      // La mesure vient de la lecture précédente sur ce serveur, puis de celle-ci dès le premier
      // segment chargé.
      clientCapabilities.networkMbps = debitAnnonce(mesureDebitRef.current, connexionAnnoncee())
        ?? clientCapabilities.networkMbps;
      // Après deux coupures, insister sur le même débit ne sert plus à rien : le plafond fait convertir
      // le serveur au lieu de recopier un flux qui ne passe pas.
      clientCapabilities.maxVideoBitrate = plafondApresCoupures(mesureDebitRef.current, coupuresRef.current)
        ?? clientCapabilities.maxVideoBitrate;
      // L'identifiant permet au serveur de retenir ce qui a échoué sur cet appareil, et de cesser de
      // proposer un codec que son décodeur refuse. Sans lui, la même erreur se répète à chaque lecture.
      clientCapabilities.deviceId = deviceId();
      // Le serveur démarre l'encodage à ce point : la navigation devient immédiate sur toute la durée
      // du film, au lieu d'être bornée à ce que l'encodeur a déjà produit.
      if (startSeconds > 0) clientCapabilities.startSeconds = Math.floor(startSeconds);
      let next = await api.startPlayback(
        media.id,
        clientCapabilities,
        profile.id,
      );
      setSession(next);
      sessionIdRef.current = next.id;
      for (let attempt = 0; next.status === "starting" && next.id && attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        next = await api.playbackSession(next.id);
        setSession(next);
      }
      if (next.status === "failed") throw new Error(next.error ?? "Préparation de la lecture impossible");
      if (next.status === "starting") throw new Error("Le transcodage met trop de temps à démarrer");
      startOffsetRef.current = next.startOffsetSeconds ?? 0;
      await attachSource(next, playbackInfo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lecture impossible");
    }
  }, [attachSource, media.id, profile]);

  // La reprise redemande une session **au point courant du film**, et non au début : c'est la seule
  // position qui ait un sens pour la personne, et le serveur sait démarrer un encodage n'importe où.
  useEffect(() => {
    renegocierRef.current = info
      ? () => {
        const position = startOffsetRef.current + (videoRef.current?.currentTime ?? 0);
        void start(info, modePreferenceRef.current, position);
      }
      : null;
  }, [info, start]);

  /**
   * Fermer l'onglet est une façon de partir comme une autre.
   *
   * Le nettoyage de React ne s'exécute pas alors : la session restait vivante sur le NAS, à convertir
   * un film que plus personne ne regardait. `pagehide` couvre la fermeture, la navigation et la mise
   * en cache arrière du navigateur ; la requête part avec `keepalive`, seule façon qu'elle survive à
   * la page.
   */
  useEffect(() => {
    const partir = () => { if (sessionIdRef.current) api.stopPlaybackOnUnload(sessionIdRef.current); };
    window.addEventListener("pagehide", partir);
    return () => window.removeEventListener("pagehide", partir);
  }, []);

  const persistSubtitlePreference = useCallback((playbackInfo: PlaybackInfo) => {
    const external = playbackInfo.externalSubtitles?.find((subtitle) => subtitle.id === externalSubtitleIndexRef.current);
    const selectionType: SubtitlePreference["selectionType"] = subtitleIndexRef.current != null ? "internal" : external ? "external" : "off";
    const preference: SubtitlePreference = { selectionType, streamIndex: selectionType === "internal" ? subtitleIndexRef.current : null,
      externalName: selectionType === "external" ? external?.name ?? null : null, offsetSeconds: subtitleOffsetRef.current,
      size: subtitleSize, background: subtitleBackground, color: subtitleColor, position: subtitlePosition, fontFamily: subtitleFont,
      encodingOverride: subtitleEncodingRef.current };
    void api.saveSubtitlePreference(media.id, profile.id, preference).catch(() => undefined);
  }, [media.id, profile.id, subtitleBackground, subtitleColor, subtitleFont, subtitlePosition, subtitleSize]);

  useEffect(() => {
    let active = true;
    Promise.all([api.playbackInfo(media.id, profile.id), api.subtitlePreference(media.id, profile.id).catch(() => null),
      api.playbackNeighbors(media.id, profile.id).catch(() => ({ previous: null, next: null }))]).then(([next, savedPreference, adjacent]) => {
      if (!active) return;
      setInfo(next);
      setNeighbors(adjacent);
      subtitleIndexRef.current = null; externalSubtitleIndexRef.current = null; setSubtitleIndex(null); setExternalSubtitleIndex(null);
      const preferredAudio = profile.preferredAudioLanguages ?? [];
      const defaultAudio = next.streams.filter((stream) => stream.type === "audio").sort((left, right) => {
        const leftRole = left.audioRole === "commentary" || left.audioRole === "audio-description" ? 1000 : 0;
        const rightRole = right.audioRole === "commentary" || right.audioRole === "audio-description" ? 1000 : 0;
        return leftRole - rightRole || preferredLanguageIndex(preferredAudio, left) - preferredLanguageIndex(preferredAudio, right)
          || Number(right.isDefault) - Number(left.isDefault);
      })[0] ?? next.streams.find((stream) => stream.type === "audio" && stream.isDefault)
        ?? next.streams.find((stream) => stream.type === "audio");
      const storedAudioValue = sessionStorage.getItem(audioPreferenceKey(profile.id, media.id));
      const storedAudio = storedAudioValue == null ? null : Number(storedAudioValue);
      const selectedAudio = storedAudio != null && Number.isInteger(storedAudio)
        && next.streams.some((stream) => stream.type === "audio" && stream.index === storedAudio)
        ? storedAudio : defaultAudio?.index ?? null;
      audioIndexRef.current = selectedAudio; setAudioIndex(selectedAudio);
      if (savedPreference) {
        subtitleOffsetRef.current = savedPreference.offsetSeconds; setSubtitleOffset(savedPreference.offsetSeconds);
        subtitleEncodingRef.current = savedPreference.encodingOverride; setSubtitleEncoding(savedPreference.encodingOverride);
        setSubtitleSize(savedPreference.size); setSubtitleBackground(savedPreference.background); setSubtitleColor(savedPreference.color);
        subtitlePositionRef.current = savedPreference.position; setSubtitlePosition(savedPreference.position); setSubtitleFont(savedPreference.fontFamily);
        if (savedPreference.selectionType === "internal" && next.streams.some((stream) => stream.type === "subtitle" && stream.index === savedPreference.streamIndex)) {
          subtitleIndexRef.current = savedPreference.streamIndex; setSubtitleIndex(savedPreference.streamIndex);
        } else if (savedPreference.selectionType === "external") {
          const external = next.externalSubtitles?.find((subtitle) => subtitle.name === savedPreference.externalName);
          externalSubtitleIndexRef.current = external?.id ?? null; setExternalSubtitleIndex(external?.id ?? null);
        }
      } else if (profile.subtitleMode !== "off") {
        const preferredSubtitles = profile.preferredSubtitleLanguages ?? [];
        const subtitle = next.streams.filter((stream) => stream.type === "subtitle"
          && (profile.subtitleMode === "always" || stream.isForced)).sort((left, right) => {
            return preferredLanguageIndex(preferredSubtitles, left) - preferredLanguageIndex(preferredSubtitles, right);
          })[0];
        subtitleIndexRef.current = subtitle?.index ?? null; setSubtitleIndex(subtitle?.index ?? null);
        if (!subtitle) {
          const external = next.externalSubtitles?.filter((candidate) => profile.subtitleMode === "always" || candidate.forced)
            .sort((left, right) => {
              const li = preferredSubtitles.map(normalizedLanguage).indexOf(normalizedLanguage(left.language));
              const ri = preferredSubtitles.map(normalizedLanguage).indexOf(normalizedLanguage(right.language));
              return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri);
            })[0];
          externalSubtitleIndexRef.current = external?.id ?? null; setExternalSubtitleIndex(external?.id ?? null);
        }
      }
      /**
       * La session est demandée **au point de reprise**, et non au début.
       *
       * Le serveur encode une fenêtre qui part de là où on la lui demande. Ouvrir au début puis
       * placer le curseur plus loin fait tomber ce curseur hors de cette fenêtre : il faut alors
       * relancer une seconde session au bon endroit. Le NAS encode deux fois, la personne attend deux
       * fois, et le premier encodage — celui que personne ne regardera — occupe un créneau de
       * conversion pendant ce temps.
       *
       * Le mode « demander » reste au début, et volontairement : tant que la question n'a pas été
       * posée, on ignore si la personne veut reprendre ou repartir de zéro, et deviner ferait encoder
       * le mauvais bout du film une fois sur deux.
       */
      const reprise = profile.resumeMode === "continue"
        ? resumePosition(next.durationSeconds ?? 0, media.progressPercent, profile.resumeRewindSeconds ?? 5)
        : 0;
      void start(next, "auto", reprise);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Analyse du média impossible"));
    return () => {
      active = false;
      hlsRef.current?.destroy();
      if (sessionIdRef.current) void api.stopPlayback(sessionIdRef.current).catch(() => undefined);
    };
    // La session initiale ne doit être créée qu'une fois par média.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      // La reprise se calcule sur la durée réelle du média. En transcodage, `video.duration` ne couvre
      // que la partie déjà encodée : l'utiliser renverrait la lecture au début du fichier.
      const reference = trueDurationRef.current;
      video.playbackRate = profile.defaultPlaybackRate ?? 1; setPlaybackRate(video.playbackRate);
      // Une session démarrée à un point choisi est déjà positionnée : le flux commence exactement là
      // où la personne a demandé. Reproposer une reprise la renverrait où elle ne veut pas aller.
      if (startOffsetRef.current > 0) { void video.play().catch(() => undefined); return; }
      const target = profile.resumeMode === "restart" ? 0 : resumePosition(reference, media.progressPercent, profile.resumeRewindSeconds ?? 5);
      if (target > 0 && profile.resumeMode === "ask") { video.pause(); setResumePrompt(true); }
      else { video.currentTime = target; void video.play().catch(() => undefined); }
    };
    const persist = () => {
      const reference = trueDurationRef.current;
      if (reference > 0) void api.saveProgress(media.id, profile.id, startOffsetRef.current + video.currentTime, reference);
    };
    const timer = window.setInterval(persist, 10_000);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("pause", persist);
    return () => { window.clearInterval(timer); video.removeEventListener("loadedmetadata", onLoaded); video.removeEventListener("pause", persist); persist(); };
  }, [media, profile.defaultPlaybackRate, profile.id, profile.resumeMode, profile.resumeRewindSeconds]);

  useEffect(() => {
    const video = videoRef.current; if (!video) return;
    const update = () => {
      // Tout ce qui s'affiche est ramené à l'échelle du film : la barre, l'horloge, les boutons de
      // saut et la mesure de tampon en héritent sans avoir à connaître le décalage.
      const offset = startOffsetRef.current;
      setCurrentTime(offset + (video.currentTime || 0)); setMediaDuration(Number.isFinite(video.duration) ? video.duration : 0); setPaused(video.paused);
      setBufferedEnd(video.buffered.length ? offset + video.buffered.end(video.buffered.length - 1) : 0);
      const quality = video.getVideoPlaybackQuality?.();
      if (quality) { setDroppedFrames(quality.droppedVideoFrames); releverDecodage(quality); }
      const position = offset + (video.currentTime || 0);
      annoncerAuGenerique(position);
      if (carteParGeneriqueRef.current && trueDurationRef.current) {
        setNextCountdown(Math.max(0, Math.round(trueDurationRef.current - position)));
      }
    };
    /**
     * L'épisode suivant s'annonce dès le générique de fin, et non l'écran déjà noir.
     *
     * Le point vient des chapitres du fichier, que le serveur a lus (`creditsStartSeconds`) — 1 701
     * fichiers de la médiathèque de référence en portent un, commençant en médiane à 97 % du film.
     * Faute de chapitre, rien ne change : la carte reste posée à la fin, avec son décompte de dix
     * secondes.
     *
     * Le départ, lui, ne bouge pas : il reste la fin du média. Avancer sur la jauge couperait un
     * générique que l'on regarde peut-être.
     */
    const annoncerAuGenerique = (position: number) => {
      if (autoplayEcarteRef.current || carteParGeneriqueRef.current) return;
      const debut = infoRef.current?.creditsStartSeconds;
      const duree = trueDurationRef.current;
      const suivant = neighbors.next;
      if (debut == null || !duree || !suivant || !profile.autoplayNext || position < debut) return;
      const compte = Number(sessionStorage.getItem(`flixtunes:${profile.id}:autoplay-count`) ?? 0);
      if (compte >= (profile.autoplayLimit ?? 3)) return;
      carteParGeneriqueRef.current = true;
      setNextTotal(Math.max(1, duree - debut));
      setNextCountdown(Math.max(0, Math.round(duree - position)));
    };
    /**
     * Le décodeur ne tient pas la cadence : on redemande une session convertie.
     *
     * C'est le filet de l'essai de lecture directe. Le serveur accepte désormais de servir un fichier
     * tel quel malgré un désaccord annoncé — conteneur qu'aucun navigateur ne déclare, définition
     * au-dessus du plafond d'une sonde prudente — parce que ces désaccords échouent bruyamment quand
     * ils échouent. Sauf celui-ci : le décodeur accepte le flux puis jette des images, sans erreur ni
     * coupure. Personne ne le remarquerait.
     *
     * Le repli force la conversion plutôt qu'un simple plafond de débit : le problème n'est pas la
     * quantité d'octets qui arrive mais la capacité à les décoder. Et l'échec est signalé au serveur,
     * pour que la mémoire de l'appareil épargne l'essai à la lecture suivante.
     */
    const replierSurDecodageSaccade = () => {
      const codec = infoRef.current?.streams.find((flux) => flux.type === "video")?.codec;
      if (codec) void api.reportCodecFailure(deviceId(), codec, "Décodage saccadé en lecture directe");
      if (renegociationsRef.current >= 2 || !renegocierRef.current) return;
      renegociationsRef.current += 1;
      modePreferenceRef.current = "compatible";
      setMessage("Décodage saccadé : la lecture passe en mode compatible.");
      renegocierRef.current();
    };
    /**
     * Un relevé d'images perdues, et ce qu'on en conclut.
     *
     * Deux conclusions opposées sortent de la même mesure, ce qui justifie de les traiter ensemble :
     * un décodage qui décroche fait basculer en conversion, un décodage qui tient lève la quarantaine
     * du codec. Cette seconde conclusion ne peut pas être tirée de la seule première image — voir
     * `joue` — sans quoi l'échec constaté trois secondes plus tard serait effacé avant d'être compté,
     * et l'appareil retenterait indéfiniment ce qui ne marche pas chez lui.
     */
    const releverDecodage = (quality: VideoPlaybackQuality) => {
      if (sessionRef.current?.mode !== "direct") return;
      const echantillons = echantillonsDecodageRef.current;
      echantillons.push({ total: quality.totalVideoFrames, perdues: quality.droppedVideoFrames });
      // On ne garde que de quoi juger : la série est glissante, l'historique complet ne sert à rien.
      if (echantillons.length > FENETRES_AVANT_REPLI + 1) echantillons.shift();
      if (decodageDegrade(echantillons)) { echantillonsDecodageRef.current = []; replierSurDecodageSaccade(); return; }
      if (echantillons.length > FENETRES_AVANT_REPLI) confirmerCodec();
    };
    /**
     * Une coupure de lecture, et ce qu'on en fait au bout de la deuxième.
     *
     * Compter ne suffisait pas : le chiffre s'affichait dans le panneau d'infos et rien d'autre. Une
     * coupure isolée arrive — un creux passager, une autre machine qui télécharge — et insister est
     * alors la bonne réponse. Deux coupures disent autre chose : le débit demandé ne passe pas, et
     * réessayer à l'identique ne fera que répéter le hoquet.
     *
     * On redemande donc une session en annonçant un plafond, ce qui fait convertir le serveur au lieu
     * de recopier un flux trop lourd. La position est conservée : c'est le même chemin que le
     * changement de plage dynamique, qui doit lui aussi renégocier sans perdre le fil.
     */
    const waiting = () => {
      if (performance.now() - playbackStartedAtRef.current <= 1500) return;
      coupuresRef.current += 1;
      setRebufferCount(coupuresRef.current);
      if (coupuresRef.current !== REBUFFERS_AVANT_REPLI) return;
      if (plafondApresCoupures(mesureDebitRef.current, coupuresRef.current) == null) return;
      // La reprise passe par le mécanisme existant : il redemande une session au point courant du
      // film et se borne lui-même à deux essais. En écrire un second aurait dédoublé la garde, et
      // deux compteurs de reprise finissent toujours par diverger.
      if (renegociationsRef.current >= 2 || !renegocierRef.current) return;
      renegociationsRef.current += 1;
      setMessage("Débit insuffisant : la qualité est ajustée.");
      renegocierRef.current();
    };
    /**
     * Une lecture directe qui tient la cadence vaut démenti.
     *
     * Le codec fonctionne, quelle qu'ait été la conclusion tirée d'un échec précédent. Sans ce
     * démenti, un incident isolé — un fichier abîmé, une coupure — finirait par priver l'appareil de
     * lecture directe jusqu'à l'oubli automatique.
     */
    const confirmerCodec = () => {
      if (dementiEnvoyeRef.current) return;
      const codec = infoRef.current?.streams.find((flux) => flux.type === "video")?.codec;
      if (!codec) return;
      dementiEnvoyeRef.current = true;
      void api.reportCodecSuccess(deviceId(), codec);
    };
    /**
     * La première image ne suffit plus à lever la quarantaine.
     *
     * Elle le faisait, et cela devenait dangereux dès lors que le serveur tente la lecture directe :
     * le démenti efface la ligne de quarantaine, si bien qu'un décodage qui décroche trois secondes
     * plus tard repartait d'un compteur remis à zéro. Deux échecs étant nécessaires pour retenir la
     * leçon, elle n'aurait jamais été retenue — l'appareil aurait retenté à chaque lecture ce qui ne
     * marche pas chez lui, ce que la quarantaine existe précisément pour éviter.
     *
     * Le démenti part donc de `releverDecodage`, une fois la cadence tenue. Reste le cas des
     * navigateurs sans `getVideoPlaybackQuality` : là, rien ne se mesure, et la première image
     * redevient la meilleure preuve disponible.
     */
    const joue = () => {
      if (sessionRef.current?.mode !== "direct") return;
      if (!video.getVideoPlaybackQuality) confirmerCodec();
    };
    video.addEventListener("playing", joue, { once: true });
    const ended = () => {
      const reference = trueDurationRef.current || video.duration;
      void api.saveProgress(media.id, profile.id, reference, reference, true);
      const next = neighbors.next; if (!next || !profile.autoplayNext || autoplayEcarteRef.current) return;
      const key = `flixtunes:${profile.id}:autoplay-count`; const count = Number(sessionStorage.getItem(key) ?? 0);
      if (count >= (profile.autoplayLimit ?? 3)) { setMessage("Lecture automatique suspendue : confirmez que vous regardez toujours."); return; }
      // La carte a déjà couru pendant tout le générique : le décompte a eu lieu, on enchaîne.
      if (carteParGeneriqueRef.current) { sessionStorage.setItem(key, String(count + 1)); onPlayMedia(next.id); return; }
      setNextCountdown(DELAI_AUTOPLAY_SECONDES); setNextTotal(DELAI_AUTOPLAY_SECONDES); let remaining = DELAI_AUTOPLAY_SECONDES;
      autoplayTimerRef.current = window.setInterval(() => { remaining -= 1; setNextCountdown(remaining);
        if (remaining <= 0) { if (autoplayTimerRef.current) window.clearInterval(autoplayTimerRef.current);
          sessionStorage.setItem(key, String(count + 1)); onPlayMedia(next.id); }
      }, 1000);
    };
    for (const event of ["timeupdate", "progress", "play", "pause", "ratechange"] as const) video.addEventListener(event, update);
    video.addEventListener("ended", ended); video.addEventListener("waiting", waiting); update();
    return () => { for (const event of ["timeupdate", "progress", "play", "pause", "ratechange"] as const) video.removeEventListener(event, update);
      video.removeEventListener("ended", ended); video.removeEventListener("waiting", waiting); if (autoplayTimerRef.current) window.clearInterval(autoplayTimerRef.current); };
  }, [media.id, neighbors.next, onPlayMedia, profile.autoplayLimit, profile.autoplayNext, profile.id]);

  // Un nouvel épisode repart sans mémoire du précédent : ni carte écartée, ni introduction passée.
  useEffect(() => {
    autoplayEcarteRef.current = false; carteParGeneriqueRef.current = false;
    setIntroEcartee(false); setNextCountdown(null); setNextTotal(DELAI_AUTOPLAY_SECONDES);
  }, [media.id]);

  /** Réaffiche les commandes et relance le compte à rebours d'effacement. */
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    const video = videoRef.current;
    // En pause, rien ne s'efface : masquer des commandes qu'on s'apprête à utiliser serait absurde.
    if (video?.paused) return;
    idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), 3000);
  }, []);

  useEffect(() => {
    wakeChrome();
    const page = pageRef.current;
    if (!page) return;
    const evenements: Array<keyof HTMLElementEventMap> = ["pointermove", "pointerdown", "keydown", "wheel"];
    for (const nom of evenements) page.addEventListener(nom, wakeChrome);
    // Une reprise ou une mise en pause change la règle : on réévalue immédiatement.
    const video = videoRef.current;
    video?.addEventListener("play", wakeChrome);
    video?.addEventListener("pause", wakeChrome);
    return () => {
      for (const nom of evenements) page.removeEventListener(nom, wakeChrome);
      video?.removeEventListener("play", wakeChrome);
      video?.removeEventListener("pause", wakeChrome);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [wakeChrome]);

  useEffect(() => () => { if (seekRestartRef.current) window.clearTimeout(seekRestartRef.current); }, []);

  const registerInteraction = () => { sessionStorage.setItem(`flixtunes:${profile.id}:autoplay-count`, "0"); };
  /**
   * Se déplacer dans le film — et non dans le flux.
   *
   * Un flux transcodé ne contient que ce que l'encodeur a déjà produit, à partir du point où il a
   * démarré. Tant que la cible est dans cette fenêtre, un simple déplacement suffit. Au-delà, le
   * lecteur attendait indéfiniment que l'encodeur le rattrape ; on redemande donc au serveur une
   * session qui commence au point visé.
   *
   * Une lecture directe garde tout le fichier à disposition : sa fenêtre couvre le film entier et
   * cette seconde branche ne se déclenche jamais.
   */
  const seekTo = (seconds: number) => {
    const video = videoRef.current; if (!video) return;
    registerInteraction();
    const cible = Math.max(0, Math.min(timelineDuration || seconds, seconds));
    const debut = startOffsetRef.current;
    const fin = debut + (Number.isFinite(video.duration) ? video.duration : 0);
    if (cible >= debut && cible <= fin) { video.currentTime = cible - debut; return; }
    if (!info || session?.mode === "direct") { video.currentTime = Math.max(0, cible - debut); return; }
    // La barre de progression émet un événement à chaque pixel parcouru. Redémarrer une session à
    // chaque fois lancerait des dizaines de transcodages pour un seul glissement — insoutenable sur
    // le processeur d'un NAS. Seule la position où le curseur s'immobilise déclenche la relance.
    setMessage("Déplacement dans le film…");
    setCurrentTime(cible);
    if (seekRestartRef.current) window.clearTimeout(seekRestartRef.current);
    seekRestartRef.current = window.setTimeout(() => {
      seekRestartRef.current = null;
      void start(info, modePreferenceRef.current, cible);
    }, 350);
  };
  const togglePlayback = () => { const video = videoRef.current; if (!video) return; registerInteraction(); if (video.paused) void video.play(); else video.pause(); };
  const changeRate = (rate: number) => { const video = videoRef.current; if (!video) return; video.playbackRate = rate; setPlaybackRate(rate); registerInteraction(); };
  const changeQuality = (level: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = level; setQualityLevel(level); registerInteraction(); };

  // Le choix de plage dynamique n'a de sens que sur une source qui en possède une : l'offrir sur un
  // fichier SDR laisserait croire qu'on peut en fabriquer, ce qui n'est pas le cas.
  const sourceIsHdr = info?.streams.some((stream) => stream.type === "video" && stream.hdrFormat !== "sdr") ?? false;
  const sourceVideo = info?.streams.find((stream) => stream.type === "video");
  const menuCapabilities = sourceIsHdr ? (surfaceVlc ? capacitesBureau : browserCapabilities)(null, null, false) : null;
  const dynamicRanges = dynamicRangeChoices(sourceVideo, menuCapabilities?.hdrFormats ?? [], profile.dynamicRangePriority);

  /**
   * Change la plage dynamique en cours de lecture.
   *
   * Contrairement à la qualité, que hls.js bascule sans interruption, la plage dynamique se décide au
   * moment de la négociation : le serveur doit reconstruire la session. On relance donc la lecture en
   * conservant la position, comme le fait déjà le changement de mode.
   */
  const changeDynamicRange = (preference: NonNullable<PlaybackCapabilities["dynamicRangePreference"]>) => {
    if (!info || preference === dynamicRangeRef.current) return;
    dynamicRangeRef.current = preference;
    setDynamicRange(preference);
    reconnectPositionRef.current = startOffsetRef.current + (videoRef.current?.currentTime ?? 0);
    registerInteraction();
    void start(info, modePreferenceRef.current, reconnectPositionRef.current);
  };
  const startSleepTimer = (minutes: number) => { if (sleepTimerRef.current) window.clearTimeout(sleepTimerRef.current); setSleepMinutes(minutes);
    if (minutes > 0) sleepTimerRef.current = window.setTimeout(() => { videoRef.current?.pause(); setSleepMinutes(0); setMessage("Minuteur terminé : lecture mise en pause."); }, minutes * 60_000); };
  /**
   * Plein écran sur le **conteneur**, jamais sur la vidéo seule.
   *
   * Les commandes natives du navigateur étaient actives en plus des nôtres : deux barres superposées,
   * dont l'une affichait la durée du flux transcodé — 1:31 au lieu de 1:41:51 — parce qu'elle ne
   * connaît que ce qui a été encodé jusque-là. Elles sont retirées. Reste à fournir le plein écran
   * qu'elles assuraient : en agrandissant la vidéo seule, le navigateur laissait nos commandes en
   * dehors et rétablissait les siennes, avec la même durée fausse. C'est le conteneur qui est agrandi.
   */
  const toggleFullScreen = async () => {
    registerInteraction();
    // Dans la coque, c'est la fenêtre qui s'agrandit, pas le document : voir l'effet qui suit l'état.
    const coque = pontBureau();
    if (coque) { await coque.pleinEcran(); return; }
    const page = pageRef.current;
    if (!page) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await page.requestFullscreen?.().catch(() => undefined);
  };

  /**
   * L'incrustation dans un coin de l'écran est un service du navigateur, rendu à une balise vidéo.
   *
   * Quand VLC décode, il n'y a pas de balise : le bouton n'est pas offert plutôt que d'être offert
   * sans effet. L'équivalent existe côté système — une fenêtre toujours au-dessus — et viendra avec
   * l'empaquetage, si le besoin s'en fait sentir.
   */
  const incrustationOfferte = !surfaceVlc && "pictureInPictureEnabled" in document;
  const togglePiP = async () => { const video = elementVideoRef.current; if (!video || !incrustationOfferte) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); };

  /**
   * La piste audio est choisie par le serveur : elle exige une nouvelle session.
   * La position est conservée et le mode de lecture demandé par l'utilisateur est réutilisé.
   */
  const changeAudioTrack = (streamIndex: number) => {
    if (!info || audioIndexRef.current === streamIndex) return;
    audioIndexRef.current = streamIndex;
    setAudioIndex(streamIndex);
    sessionStorage.setItem(audioPreferenceKey(profile.id, media.id), String(streamIndex));
    registerInteraction();
    /*
     * Quand VLC lit le fichier tel quel, changer de langue est immédiat.
     *
     * Toutes les pistes sont là : il suffit de lui désigner la bonne. Le chemin d'avant redemandait
     * une session au serveur, qui recopiait le film pour isoler une piste — quelques secondes
     * d'attente et un flux de plus à produire, pour un geste qui ne coûte rien.
     *
     * Sur un flux converti, en revanche, la piste a été choisie à l'encodage : il n'y en a qu'une, et
     * il faut bien redemander. Même chose si VLC ne connaît pas ce numéro.
     */
    if (surfaceVlc && session?.mode === "direct" && surfaceVlc.choisirPisteAudio(streamIndex)) {
      setMessage(null);
      return;
    }
    setMessage("Changement de piste audio…");
    void start(info, modePreferenceRef.current);
  };

  /**
   * Un sous-titre texte est échangé sans recréer le flux ; seule une incrustation impose une nouvelle session.
   */
  const changeSubtitleSelection = (streamIndex: number | null, externalId: number | null) => {
    if (!info) return;
    const wasBurned = requiresBurnIn(info, subtitleIndexRef.current, externalSubtitleIndexRef.current);
    subtitleIndexRef.current = streamIndex;
    externalSubtitleIndexRef.current = externalId;
    setSubtitleIndex(streamIndex);
    setExternalSubtitleIndex(externalId);
    registerInteraction();
    if (wasBurned || requiresBurnIn(info, streamIndex, externalId)) {
      setMessage("Changement de sous-titres…");
      void start(info, modePreferenceRef.current);
      return;
    }
    applySubtitleTracks(info);
  };

  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => persistSubtitlePreference(info), 350);
    return () => window.clearTimeout(timer);
  }, [externalSubtitleIndex, info, persistSubtitlePreference, subtitleBackground, subtitleColor, subtitleEncoding, subtitleFont,
    subtitleIndex, subtitleOffset, subtitlePosition, subtitleSize]);

  // Décalage, encodage et position changent l'URL de la piste : ils s'appliquent sans relancer la lecture.
  useEffect(() => {
    if (!info || requiresBurnIn(info, subtitleIndexRef.current, externalSubtitleIndexRef.current)) return;
    const timer = window.setTimeout(() => applySubtitleTracks(info), 350);
    return () => window.clearTimeout(timer);
  }, [applySubtitleTracks, info, requiresBurnIn, subtitleEncoding, subtitleOffset, subtitlePosition]);

  /**
   * Le repli après un échec de lecture directe, en deux marches et non en une.
   *
   * Il n'y en avait qu'une : tout échec direct partait en `compatible`, donc en transcodage. C'était
   * sans conséquence tant que la lecture directe n'était retenue que sur un accord complet — un échec
   * y était forcément un défaut de décodeur. Depuis que le serveur tente le direct sur un conteneur
   * non déclaré, la cause la plus probable est tout autre : Firefox et Safari ne lisent pas le
   * Matroska, et l'échec survient avant la moindre image.
   *
   * Envoyer ce cas au transcodage serait le pire des dénouements — on aurait remplacé un remux, qui
   * copie l'image au bit près, par une conversion complète que le NAS peine à produire. D'où la
   * première marche : le remux, qui range le même flux dans un conteneur que le lecteur accepte. La
   * seconde n'est atteinte que s'il échoue à son tour, et là c'est bien le décodeur qui est en cause.
   *
   * Le repli vaut pour les deux surfaces. VLC échoue rarement — c'est tout l'intérêt de le mettre là
   * — mais il échoue : un fichier tronqué, un partage réseau qui se dérobe. Priver le client de
   * bureau de ce filet reviendrait à lui offrir un écran noir là où le Web se rattrape.
   */
  const surEchecDeLecture = useCallback(() => {
    if (session?.mode === "direct" && info && !directRetry) {
      // Le serveur ne peut pas constater cet échec : en lecture directe il n'a fait que servir le
      // fichier, et tout s'est produit dans le lecteur. On le lui dit avant de replier.
      const codec = info.streams.find((flux) => flux.type === "video")?.codec;
      if (codec) void api.reportCodecFailure(deviceId(), codec, "Lecture directe interrompue par le lecteur");
      setDirectRetry(true);
      void start(info, "remux");
    }
    else if (session?.mode === "remux" && info && directRetry) {
      // Le remux a échoué après un repli : le conteneur n'était donc pas seul en cause.
      setMessage("Conversion complète, le flux n'a pas pu être lu tel quel.");
      void start(info, "compatible");
    }
    else setMessage("Le lecteur n'a pas pu décoder ce flux.");
  }, [directRetry, info, session, start]);

  // La balise vidéo reçoit l'échec par une propriété de JSX ; VLC n'en a pas, il l'annonce comme un
  // événement. C'est le seul endroit du lecteur où les deux surfaces se branchent différemment.
  useEffect(() => {
    if (!surfaceVlc) return;
    surfaceVlc.addEventListener("error", surEchecDeLecture);
    return () => surfaceVlc.removeEventListener("error", surEchecDeLecture);
  }, [surEchecDeLecture, surfaceVlc]);

  /**
   * Charge le fichier de sous-titres que la balise `<track>` aurait chargé.
   *
   * Le même fichier, la même adresse, le même décalage : ce qui change est seulement qui le lit. Un
   * échec est silencieux — le film continue sans sous-titres, ce qui vaut mieux qu'un message par
   * dessus l'image.
   */
  useEffect(() => {
    if (!surfaceVlc) return;
    if (!urlSousTitreBureau) { setRepliquesBureau([]); return; }
    let vivant = true;
    void fetch(urlSousTitreBureau).then((reponse) => (reponse.ok ? reponse.text() : ""))
      .then((texte) => { if (vivant) setRepliquesBureau(analyserWebVtt(texte)); })
      .catch(() => { if (vivant) setRepliquesBureau([]); });
    return () => { vivant = false; };
  }, [surfaceVlc, urlSousTitreBureau]);

  /**
   * Le fond de la page s'efface pour laisser voir la vidéo, et VLC s'arrête quand on quitte.
   *
   * L'interface du client de bureau vit dans une fenêtre transparente posée au-dessus de la fenêtre
   * vidéo. Le catalogue y est opaque, comme il doit l'être ; le lecteur, lui, doit devenir un
   * simple vitrage — sans quoi il masquerait exactement ce qu'il sert à regarder.
   *
   * La classe va sur `html` **autant que** sur `body` : la feuille de style donne un fond aux deux,
   * `:root` portant `#080b12` sous le dégradé de `body`. N'en effacer qu'un laissait l'autre, et la
   * fenêtre restait opaque — du bleu-noir précisément là où la vidéo jouait.
   */
  useEffect(() => {
    if (!surfaceVlc) return;
    document.documentElement.classList.add("bureau-video");
    document.body.classList.add("bureau-video");
    return () => {
      document.documentElement.classList.remove("bureau-video");
      document.body.classList.remove("bureau-video");
      surfaceVlc.fermer();
    };
  }, [surfaceVlc]);

  const audioStreams = info?.streams.filter((stream) => stream.type === "audio") ?? [];
  const subtitleStreams = info?.streams.filter((stream) => stream.type === "subtitle") ?? [];
  /**
   * Le sous-titre retenu est-il une **image** ?
   *
   * Un PGS de Blu-ray n'est pas du texte : c'est une suite d'images, déjà composées avec leur police
   * et leur couleur. Aucun des six réglages d'apparence ne peut s'y appliquer — ni ici, où VLC les
   * dessine, ni sur le Web, où le serveur les incruste. Les proposer quand même faisait promettre à
   * l'interface ce qu'elle ne pouvait pas tenir : on tourne le bouton « Taille » et rien ne bouge.
   */
  const sousTitreEstImage = Boolean(
    (subtitleIndex != null && subtitleStreams.some((flux) => flux.index === subtitleIndex && !flux.canExtractAsWebVtt))
    || (externalSubtitleIndex != null
      && info?.externalSubtitles?.some((externe) => externe.id === externalSubtitleIndex && !externe.canConvertToWebVtt)));
  // Les répliques du moment, calculées sur la position **dans le flux** : c'est l'échelle du fichier
  // WebVTT, que le serveur a déjà décalé du début de session.
  const repliquesVisibles = surfaceVlc ? repliquesA(repliquesBureau, currentTime - startOffsetRef.current) : [];
  const habillageSousTitres = `subtitles-${subtitleSize} subtitles-${subtitlePosition} subtitles-font-${subtitleFont} subtitles-color-${subtitleColor}${subtitleBackground ? " subtitles-background" : ""}`;

  return (
    <div className={`player-page${chromeVisible ? "" : " chrome-hidden"}${surfaceVlc ? " player-page-bureau" : ""}`} ref={pageRef} onFocus={wakeChrome}>
      {/*
        Quand VLC décode, il n'y a pas de balise vidéo : l'image est peinte par un autre processus,
        dans la fenêtre du dessous, et cette page est transparente par-dessus. Tout le reste du
        lecteur — commandes, carte d'enchaînement, menus — est rigoureusement le même.
      */}
      {!surfaceVlc && <video ref={(element) => { elementVideoRef.current = element; videoRef.current = element; }}
        className={habillageSousTitres} autoPlay playsInline onError={surEchecDeLecture} />}
      {surfaceVlc && repliquesVisibles.length > 0 && (
        <div className={`sous-titres-bureau ${habillageSousTitres}`} aria-live="off">
          {repliquesVisibles.map((texte, rang) => <p key={`${rang}-${texte}`}>{texte}</p>)}
        </div>
      )}
      <div className="player-top">
        <button className="player-icon-button" onClick={onClose} aria-label="Fermer le lecteur">←</button>
        {/*
          * Une video de plateforme porte le nom de sa chaine en titre et le sien en sous-titre — sans
          * numerotation, qui n'aurait aucun sens : son numero d'episode est un nombre de jours, et le
          * lecteur annoncait « S1 E20024 ».
          */}
        <div><b>{media.showTitle ?? media.title}</b>{media.showTitle && <span>{media.kind === "video"
          ? media.title
          : <>S{media.seasonNumber} E{media.episodeNumber} · {media.title}</>}</span>}</div>
        {/* « Épisode » n'a pas de sens dans une chaîne : ce qui suit une vidéo est une vidéo. */}
        {neighbors.previous && <button className="player-compact-button player-icon-button" onClick={() => onPlayMedia(neighbors.previous!.id)} aria-label={neighbors.previous.kind === "video" ? "Vidéo précédente" : "Épisode précédent"}>|◀</button>}
        {neighbors.next && <button className="player-compact-button player-icon-button" onClick={() => onPlayMedia(neighbors.next!.id)} aria-label={neighbors.next.kind === "video" ? "Vidéo suivante" : "Épisode suivant"}>▶|</button>}
        <button className="player-compact-button" onClick={() => setInfoOpen((open) => !open)} aria-expanded={infoOpen}>Infos</button>
        <button className="player-tracks-button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>Pistes</button>
        {session && <span className={`playback-mode ${session.mode}`}>{session.mode === "direct" ? "Direct Play" : session.mode === "remux" ? "Remux HLS" : "Transcodage HLS"}</span>}
      </div>
      <div className="player-controls" onPointerDown={registerInteraction}>
        <div className="timeline-wrap" onPointerLeave={() => setTimelinePreview(null)} onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setTimelinePreview(Math.max(0, Math.min(timelineDuration, (event.clientX - bounds.left) / bounds.width * timelineDuration)));
        }}>
          {timelinePreview != null && (() => {
            // La vignette est découpée dans une planche de cent, chargée une fois pour mille secondes
            // de film. Auparavant chaque survol demandait sa propre image, ce qui déclenchait un FFmpeg
            // par tranche de dix secondes — jusqu'à sept cent vingt pour balayer un film de deux heures.
            const placement = placerVignette(timelinePreview);
            return <div className="timeline-preview" style={{ left: `${percentOf(timelinePreview)}%` }}>
              <i style={{
                width: VIGNETTE_LARGEUR, height: VIGNETTE_HAUTEUR,
                backgroundImage: `url(${api.timelineSheetUrl(media.id, placement.planche, profile.id)})`,
                backgroundPosition: `${placement.decalageX}px ${placement.decalageY}px`,
              }} />
              <span>{formatPlaybackTime(timelinePreview)}</span>
            </div>;
          })()}
          {/* Trois niveaux superposés : la portion encodée par le serveur, celle déjà chargée, et la position lue. */}
          <div className="timeline-track" aria-hidden="true">
            <i className="timeline-encoded" style={{ width: `${percentOf(encodedEnd)}%` }} />
            <i className="timeline-buffered" style={{ width: `${percentOf(bufferedEnd)}%` }} />
            <i className="timeline-played" style={{ width: `${percentOf(currentTime)}%` }} />
          </div>
          <input aria-label="Position de lecture" type="range" min="0" max={Math.max(1, timelineDuration)} step="0.1"
            value={Math.min(currentTime, timelineDuration || currentTime)}
            aria-valuetext={`${formatPlaybackTime(currentTime)} sur ${formatPlaybackTime(timelineDuration)}`}
            onChange={(event) => seekTo(Number(event.target.value))} />
          {info?.chapters?.map((chapter) => <button key={chapter.index} className="chapter-mark" style={{ left: `${percentOf(chapter.startSeconds)}%` }}
            aria-label={`Chapitre ${chapter.title ?? chapter.index + 1}`} title={`${chapter.title ?? `Chapitre ${chapter.index + 1}`} · ${formatPlaybackTime(chapter.startSeconds)}`}
            onClick={() => seekTo(chapter.startSeconds)} />)}
        </div>
        <div className="player-command-row">
          <button className="player-icon-button" onClick={togglePlayback} aria-label={paused ? "Lire" : "Pause"}>{paused ? "▶" : "Ⅱ"}</button>
          <button onClick={() => seekTo(currentTime - 10)} aria-label="Reculer de 10 secondes">−10</button>
          <button onClick={() => seekTo(currentTime + 10)} aria-label="Avancer de 10 secondes">+10</button>
          <span className="player-clock">{formatPlaybackTime(currentTime)} / {formatPlaybackTime(timelineDuration)}
            {encodedEnd > 0 && timelineDuration - encodedEnd > 1
              ? <small title="Portion déjà encodée par le serveur"> · encodé {formatPlaybackTime(encodedEnd)}</small> : null}</span>
          <label>Vitesse <select aria-label="Vitesse de lecture" value={playbackRate} onChange={(event) => changeRate(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
          {qualityLevels.length > 1 && <label>Qualité <select aria-label="Qualité vidéo" value={qualityLevel} onChange={(event) => changeQuality(Number(event.target.value))}><option value="-1">Auto</option>{qualityLevels.map((level) => <option key={level.index} value={level.index}>{level.height}p · {(level.bitrate / 1_000_000).toFixed(1)} Mb/s</option>)}</select></label>}
          {info && sourceIsHdr && <label>Image <select aria-label="Plage dynamique" value={dynamicRange}
            onChange={(event) => changeDynamicRange(event.target.value as NonNullable<PlaybackCapabilities["dynamicRangePreference"]>)}>
            {dynamicRanges.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select></label>}
          <label>Minuteur <select aria-label="Minuteur de lecture" value={sleepMinutes} onChange={(event) => startSleepTimer(Number(event.target.value))}><option value="0">Désactivé</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label>
          <button className="player-icon-button" onClick={() => void toggleFullScreen()} aria-label={fullScreen ? "Quitter le plein écran" : "Plein écran"}>
            {fullScreen ? "⤡" : "⤢"}</button>
          {incrustationOfferte && <button onClick={() => void togglePiP()} aria-label="Image dans l’image">PiP</button>}
        </div>
      </div>
      {infoOpen && <aside className="playback-info" aria-label="Informations de lecture">
        <header><b>Infos lecture</b><button onClick={() => setInfoOpen(false)}>×</button></header>
        <dl><dt>Mode</dt><dd>{session?.mode ?? "négociation"}</dd><dt>Conteneur</dt><dd>{info?.container ?? "—"}</dd>
          <dt>Vidéo</dt><dd>{info?.streams.find((stream) => stream.type === "video") ? streamTechnology(info.streams.find((stream) => stream.type === "video")!) : "—"}</dd>
          <dt>Audio</dt><dd>{info?.streams.find((stream) => stream.index === audioIndex)?.codec.toUpperCase() ?? "—"}</dd>
          <dt>Débit source</dt><dd>{info?.overallBitRate ? `${(info.overallBitRate / 1_000_000).toFixed(1)} Mb/s` : "—"}</dd>
          <dt>Buffer</dt><dd>{Math.max(0, bufferedEnd - currentTime).toFixed(1)} s</dd><dt>Réseau estimé</dt><dd>{estimatedMbps ? `${estimatedMbps.toFixed(1)} Mb/s` : "—"}</dd>
          <dt>Rebuffer</dt><dd>{rebufferCount}</dd><dt>Images perdues</dt><dd>{droppedFrames}</dd>
          <dt>Sortie</dt><dd>{session?.targetWidth ? `${session.targetWidth}×${session.targetHeight} · ${session.targetVideoBitrate ? `${(session.targetVideoBitrate / 1_000_000).toFixed(1)} Mb/s` : "auto"}` : "Source"}</dd>
          {session?.colorPipeline?.sourceFormat && <><dt>Signal HDR</dt><dd>{session.colorPipeline.sourceFormat === session.colorPipeline.outputFormat
            ? session.colorPipeline.sourceFormat : `${session.colorPipeline.sourceFormat} → ${session.colorPipeline.outputFormat ?? "SDR"}`}</dd></>}
          {session?.colorPipeline && <><dt>Colorimétrie</dt><dd>{colorPipelineSummary(session.colorPipeline)}</dd>
            <dt>Tone mapping</dt><dd>{session.colorPipeline.toneMapping === "none" ? "Aucun"
              : `${session.colorPipeline.toneMapping}${session.colorPipeline.toneMappingHardware ? " (matériel)" : " (logiciel)"}`}</dd>
            {session.colorPipeline.sourcePeakNits ? <><dt>Luminance source</dt><dd>{session.colorPipeline.sourcePeakNits} nits</dd></> : null}
            {session.colorPipeline.deinterlace !== "none" ? <><dt>Désentrelacement</dt><dd>{session.colorPipeline.deinterlace}</dd></> : null}
            {session.colorPipeline.rotationDegrees ? <><dt>Rotation</dt><dd>{session.colorPipeline.rotationDegrees}°</dd></> : null}</>}
        </dl>
        {session?.colorPipeline?.steps.length ? <><b className="pipeline-title">Chaîne colorimétrique</b>
          <ol className="color-pipeline">{session.colorPipeline.steps.map((step) => <li key={step}>{step}</li>)}</ol></> : null}
        {session?.decisionReasons?.length ? <ul>{session.decisionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>{session?.reason}</p>}
      </aside>}
      {session?.colorPipeline?.lossNotice && !colorNoticeDismissed && <div className="color-notice" role="status">
        <b>Conversion d’image</b><span>{session.colorPipeline.lossNotice}</span>
        <div><button onClick={() => setInfoOpen(true)}>Voir la chaîne</button><button onClick={() => setColorNoticeDismissed(true)}>Compris</button></div>
      </div>}
      {resumePrompt && <div className="player-message"><b>Reprendre la lecture ?</b><span>Vous étiez à {media.progressPercent} %.</span><div className="player-message-actions">
        <button onClick={() => { seekTo(resumePosition(trueDurationRef.current, media.progressPercent, profile.resumeRewindSeconds ?? 5)); setResumePrompt(false); void videoRef.current?.play(); }}>Reprendre</button>
        <button onClick={() => { seekTo(0); setResumePrompt(false); void videoRef.current?.play(); }}>Depuis le début</button></div></div>}
      {/*
        * Passer l'introduction : proposé, jamais imposé.
        *
        * Le segment vient des chapitres du fichier, que le serveur a lus — et il ne l'expose que pour
        * les épisodes : un film n'a qu'une introduction, c'est l'épisode qu'on enchaîne vingt fois de
        * suite. Le bouton se retire dès qu'on l'a utilisé ou que le générique est passé, et la carte
        * d'enchaînement lui reprend sa place le moment venu.
        */}
      {!introEcartee && nextCountdown == null && info?.intro
        && currentTime >= info.intro.startSeconds && currentTime < info.intro.endSeconds - 1
        && <button className="player-skip" onClick={() => { setIntroEcartee(true); seekTo(info.intro!.endSeconds); }}>
          Passer le générique
        </button>}
      {/*
        * L'enchaînement s'annonce, et le temps qui reste se voit plutôt qu'il ne se lit.
        *
        * La jauge se vide sur les dix secondes du décompte : d'un coup d'œil on sait s'il reste le
        * temps d'attraper « Annuler », sans avoir à lire un chiffre. La carte reste hors du champ de
        * l'image, en bas à droite, et au-dessus de la barre de progression.
        */}
      {nextCountdown != null && neighbors.next && <div className="player-next">
        <span>{neighbors.next.kind === "video" ? "Vidéo suivante" : "Épisode suivant"}</span>
        <b>{neighbors.next.title}</b>
        {neighbors.next.kind !== "video" && neighbors.next.showTitle
          && neighbors.next.seasonNumber != null && neighbors.next.episodeNumber != null
          && <em>S{neighbors.next.seasonNumber} E{neighbors.next.episodeNumber}</em>}
        <div className="player-next-jauge" role="timer" aria-live="off"
          aria-label={`Lecture dans ${nextCountdown} secondes`}>
          <i style={{ transform: `scaleX(${Math.max(0, nextCountdown) / nextTotal})` }} />
        </div>
        <div className="player-next-actions">
          <button className="player-next-lancer" onClick={() => { if (autoplayTimerRef.current) window.clearInterval(autoplayTimerRef.current); onPlayMedia(neighbors.next!.id); }}>Lire maintenant</button>
          <button className="player-next-annuler" onClick={() => { if (autoplayTimerRef.current) window.clearInterval(autoplayTimerRef.current); autoplayEcarteRef.current = true; carteParGeneriqueRef.current = false; setNextCountdown(null); }}>Annuler</button>
        </div>
      </div>}
      {settingsOpen && info && <aside className="player-tracks" aria-label="Pistes audio et sous-titres">
        <h3>Audio</h3>
        {audioStreams.map((stream) => <label key={stream.index}><input type="radio" name="audio" checked={audioIndex === stream.index} onChange={() => changeAudioTrack(stream.index)} />{languageName(stream)} <small>{streamTechnology(stream)} · {stream.channels ?? "?"} canaux</small></label>)}
        <h3>Sous-titres</h3>
        <label><input type="radio" name="subtitle" checked={subtitleIndex == null && externalSubtitleIndex == null} onChange={() => changeSubtitleSelection(null, null)} />Désactivés</label>
        {subtitleStreams.map((stream) => <label key={stream.index}><input type="radio" name="subtitle" checked={subtitleIndex === stream.index} onChange={() => changeSubtitleSelection(stream.index, null)} />{languageName(stream)} <small>{stream.canExtractAsWebVtt ? "Texte" : surfaceVlc ? "Image" : "Incrustation vidéo"}{stream.isForced ? " · forcé" : ""}{stream.hearingImpaired ? " · SME" : ""}</small></label>)}
        {info.externalSubtitles?.map((subtitle) => <label key={`external-${subtitle.id}`}><input type="radio" name="subtitle" checked={externalSubtitleIndex === subtitle.id} onChange={() => changeSubtitleSelection(null, subtitle.id)} />{subtitle.language?.toUpperCase() || "Externe"} <small>{subtitle.name} · {subtitle.kind === "image" ? "incrustation vidéo" : `${subtitle.format.toUpperCase()} · ${subtitle.encoding ?? "encodage auto"}`}{subtitle.forced ? " · forcé" : ""}{subtitle.hearingImpaired ? " · SME" : ""}</small></label>)}
        <div className="subtitle-controls">
          {sousTitreEstImage && <small className="subtitle-controls-note">Ce sous-titre est une image, déjà composée dans le fichier : ni taille, ni couleur, ni police ne s'y appliquent.</small>}
          <label>Synchronisation <output>{subtitleOffset > 0 ? "+" : ""}{subtitleOffset.toFixed(1)} s</output><input disabled={sousTitreEstImage} type="range" min="-30" max="30" step="0.5" value={Math.max(-30, Math.min(30, subtitleOffset))} onChange={(event) => { const value = Number(event.target.value); subtitleOffsetRef.current = value; setSubtitleOffset(value); }} /><input disabled={sousTitreEstImage} aria-label="Décalage précis en secondes" type="number" min="-600" max="600" step="0.1" value={subtitleOffset} onChange={(event) => { const value = Math.max(-600, Math.min(600, Number(event.target.value))); subtitleOffsetRef.current = value; setSubtitleOffset(value); }} /></label>
          <label>Taille <select disabled={sousTitreEstImage} value={subtitleSize} onChange={(event) => setSubtitleSize(event.target.value as typeof subtitleSize)}><option value="small">Petite</option><option value="normal">Normale</option><option value="large">Grande</option></select></label>
          <label>Couleur <select disabled={sousTitreEstImage} value={subtitleColor} onChange={(event) => setSubtitleColor(event.target.value as SubtitlePreference["color"])}><option value="white">Blanc</option><option value="yellow">Jaune</option><option value="cyan">Cyan</option><option value="green">Vert</option></select></label>
          <label>Position <select disabled={sousTitreEstImage} value={subtitlePosition} onChange={(event) => { const value = event.target.value as SubtitlePreference["position"]; subtitlePositionRef.current = value; setSubtitlePosition(value); }}><option value="bottom">Bas</option><option value="middle">Milieu</option><option value="top">Haut</option></select></label>
          <label>Police <select disabled={sousTitreEstImage} value={subtitleFont} onChange={(event) => setSubtitleFont(event.target.value as SubtitlePreference["fontFamily"])}><option value="sans">Sans sérif</option><option value="serif">Sérif</option><option value="mono">Monospace</option></select></label>
          <label>Encodage <select disabled={sousTitreEstImage} value={subtitleEncoding} onChange={(event) => { const value = event.target.value as SubtitlePreference["encodingOverride"]; subtitleEncodingRef.current = value; setSubtitleEncoding(value); }}><option value="auto">Automatique</option><option value="utf-8">UTF-8</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option><option value="windows-1252">Windows-1252</option></select></label>
          <label><input disabled={sousTitreEstImage} type="checkbox" checked={subtitleBackground} onChange={(event) => setSubtitleBackground(event.target.checked)} />Fond sombre (transparent par défaut)</label>
        </div>
        <div className="playback-choice-actions">
          <button className="primary" onClick={() => { persistSubtitlePreference(info); setSettingsOpen(false); void start(info, "auto"); }}>Lecture automatique</button>
          <button onClick={() => { persistSubtitlePreference(info); setSettingsOpen(false); void start(info, "direct"); }}>Lire directement</button>
          <button onClick={() => { persistSubtitlePreference(info); setSettingsOpen(false); void start(info, "remux"); }}>Remux sans perte</button>
          <button onClick={() => { persistSubtitlePreference(info); setSettingsOpen(false); void start(info, "compatible"); }}>Mode compatible</button>
        </div>
      </aside>}
      {message && <div className="player-message"><span className="player-spinner" />{message}{session?.decisionReasons?.length ? <ul>{session.decisionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}<div className="player-message-actions">{info && <button onClick={() => void start(info, "direct")}>Essayer en direct</button>}{info && <button onClick={() => void start(info, "compatible")}>Relancer en mode compatible</button>}<button onClick={onClose}>Retour</button></div></div>}
    </div>
  );
}
