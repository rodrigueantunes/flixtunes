/**
 * Ce que ce navigateur sait réellement décoder.
 *
 * La détection reposait sur `canPlayType` avec des chaînes de codec incomplètes — `codecs="hvc1"` —
 * que la plupart des navigateurs rejettent même lorsque le décodage matériel existe, et sur
 * `screen.width × devicePixelRatio` pour la définition maximale. Ces deux choix produisaient des
 * refus faux : un fichier MKV/HEVC/Dolby Vision que le navigateur lit sans peine était annoncé
 * illisible, ce qui déclenchait un transcodage 4K inutile, lequel saturait l'admission du serveur et
 * bridait la lecture à 1080p. Une seule cause, quatre symptômes.
 *
 * Deux principes désormais :
 *
 * 1. **La définition d'affichage n'est pas la capacité de décodage.** Un navigateur décode du 4K et
 *    le réduit pour l'écran ; plafonner à la taille de l'écran force un transcodage sans bénéfice.
 * 2. **On demande au navigateur plutôt que de deviner.** `mediaCapabilities.decodingInfo` répond
 *    précisément « décodable », « fluide » et « économe » pour un codec et une définition donnés.
 *    `canPlayType` et `MediaSource.isTypeSupported` servent de repli sur les navigateurs anciens.
 */

export interface DecodeCandidate {
  /** Nom court transmis au serveur. */
  codec: string;
  /** Alias supplémentaires attendus par le serveur pour le même codec. */
  aliases: string[];
  /** Type MIME complet, paramètres de profil compris — c'est leur absence qui faussait la sonde. */
  mimeType: string;
  width: number;
  height: number;
  /** Conteneur à déclarer si ce candidat passe. */
  container?: "mp4" | "webm" | "matroska";
}

/**
 * Les configurations éprouvées.
 *
 * Chaque codec est sondé en 1080p **et** en 2160p : un décodeur peut être fluide dans l'une et pas
 * dans l'autre, et c'est cette différence qui doit fixer la définition annoncée.
 */
export const DECODE_CANDIDATES: DecodeCandidate[] = [
  { codec: "h264", aliases: ["avc1"], mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, container: "mp4" },
  { codec: "h264", aliases: ["avc1"], mimeType: 'video/mp4; codecs="avc1.640033"', width: 3840, height: 2160, container: "mp4" },
  { codec: "hevc", aliases: ["hvc1", "h265"], mimeType: 'video/mp4; codecs="hvc1.1.6.L93.B0"', width: 1920, height: 1080, container: "mp4" },
  { codec: "hevc", aliases: ["hvc1", "h265"], mimeType: 'video/mp4; codecs="hvc1.1.6.L153.B0"', width: 3840, height: 2160, container: "mp4" },
  // `hev1` et `hvc1` désignent le même codec, rangé différemment : le premier porte ses paramètres
  // dans le flux, le second dans l'en-tête du conteneur. Les navigateurs n'acceptent pas les mêmes, et
  // ne sonder que `hvc1` faisait conclure « HEVC non pris en charge » sur une machine dont Chrome
  // lisait pourtant du HEVC 4K en lecture directe forcée. Un seul mot d'écart, et le film partait en
  // conversion 4K au lieu d'un remux qui copie l'image.
  { codec: "hevc", aliases: ["hev1", "h265"], mimeType: 'video/mp4; codecs="hev1.1.6.L93.B0"', width: 1920, height: 1080, container: "mp4" },
  { codec: "hevc", aliases: ["hev1", "h265"], mimeType: 'video/mp4; codecs="hev1.1.6.L153.B0"', width: 3840, height: 2160, container: "mp4" },
  { codec: "av1", aliases: ["av01"], mimeType: 'video/mp4; codecs="av01.0.05M.08"', width: 1920, height: 1080, container: "mp4" },
  { codec: "av1", aliases: ["av01"], mimeType: 'video/mp4; codecs="av01.0.13M.10"', width: 3840, height: 2160, container: "mp4" },
  { codec: "vp9", aliases: ["vp09"], mimeType: 'video/webm; codecs="vp09.00.10.08"', width: 1920, height: 1080, container: "webm" },
  { codec: "vp9", aliases: ["vp09"], mimeType: 'video/webm; codecs="vp09.00.51.08"', width: 3840, height: 2160, container: "webm" },
  // Le conteneur Matroska n'est annoncé par aucun navigateur, mais plusieurs le lisent en lecture
  // directe. On le sonde au lieu de le refuser d'office : c'est le format de la plupart des fichiers.
  { codec: "h264", aliases: [], mimeType: 'video/x-matroska; codecs="avc1.640028"', width: 1920, height: 1080, container: "matroska" },
  { codec: "hevc", aliases: [], mimeType: 'video/x-matroska; codecs="hvc1.1.6.L153.B0"', width: 3840, height: 2160, container: "matroska" },
  { codec: "hevc", aliases: [], mimeType: 'video/x-matroska; codecs="hev1.1.6.L153.B0"', width: 3840, height: 2160, container: "matroska" },
];

export interface CandidateVerdict {
  candidate: DecodeCandidate;
  supported: boolean;
  /** Le décodage suit la cadence. Faux sur un décodage logiciel poussif. */
  smooth: boolean;
}

export interface DecodeSupport {
  videoCodecs: string[];
  containers: Array<"mp4" | "webm" | "matroska">;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Traduit les verdicts en capacités annoncées au serveur.
 *
 * Un codec décodable est déclaré, et **sa définition avec** — y compris lorsque le navigateur ne se
 * dit pas certain de la fluidité.
 *
 * Ce second point était l'inverse auparavant : la définition n'était relevée que sur un verdict
 * `smooth`, pour éviter des saccades sur un décodage poussif. L'intention était juste, la conséquence
 * ne l'était pas. `decodingInfo` répond très souvent `supported: true, smooth: false` pour du HEVC 4K
 * alors que le décodage matériel existe — c'est un indice prudent sur la cadence, pas un refus. Le
 * plafond restait donc à 1080p, le serveur concluait « définition supérieure à 1920×1080 » et partait
 * en conversion 4K. Relevé sur un NAS Celeron : cette conversion ne produisait pas une image, quand le
 * même fichier se lisait directement sans peine.
 *
 * Le mauvais côté de l'erreur n'est pas symétrique. Un faux négatif impose au serveur un travail qu'il
 * ne peut pas fournir — donc aucune lecture. Un faux positif donne une lecture imparfaite, et deux
 * garde-fous la rattrapent : la quarantaine de codecs retient ce que l'appareil a réellement échoué à
 * décoder, et le lecteur redemande une session plafonnée après deux coupures. Ce second filet
 * n'existait pas quand la règle `smooth` a été écrite : c'était une précaution faute de mesure, on a
 * maintenant la mesure.
 *
 * Fonction pure : elle s'éprouve sans navigateur.
 */
export function summariseDecodeSupport(verdicts: CandidateVerdict[]): DecodeSupport {
  const videoCodecs = new Set<string>();
  const containers = new Set<"mp4" | "webm" | "matroska">();
  let maxWidth = 1920;
  let maxHeight = 1080;

  for (const verdict of verdicts) {
    if (!verdict.supported) continue;
    videoCodecs.add(verdict.candidate.codec);
    for (const alias of verdict.candidate.aliases) videoCodecs.add(alias);
    if (verdict.candidate.container) containers.add(verdict.candidate.container);
    maxWidth = Math.max(maxWidth, verdict.candidate.width);
    maxHeight = Math.max(maxHeight, verdict.candidate.height);
  }

  // Sans aucun verdict positif, on n'annonce rien d'exotique mais on garde le socle universel :
  // refuser H.264 en MP4 rendrait toute lecture impossible, y compris celle que le serveur produit.
  if (!videoCodecs.size) { videoCodecs.add("h264"); videoCodecs.add("avc1"); }
  if (!containers.size) containers.add("mp4");

  return {
    videoCodecs: [...videoCodecs],
    containers: [...containers],
    maxWidth,
    maxHeight,
  };
}

type MediaCapabilitiesLike = {
  decodingInfo(configuration: unknown): Promise<{ supported: boolean; smooth: boolean; powerEfficient: boolean }>;
};

/** Interroge le navigateur sur une configuration, en retombant sur les sondes anciennes si besoin. */
async function judge(candidate: DecodeCandidate, probe: HTMLVideoElement): Promise<CandidateVerdict> {
  const capabilities = (navigator as Navigator & { mediaCapabilities?: MediaCapabilitiesLike }).mediaCapabilities;
  if (capabilities?.decodingInfo) {
    try {
      const info = await capabilities.decodingInfo({
        type: "file",
        video: { contentType: candidate.mimeType, width: candidate.width, height: candidate.height, bitrate: 12_000_000, framerate: 24 },
      });
      if (info.supported) return { candidate, supported: true, smooth: info.smooth };
    } catch {
      // Configuration refusée par le navigateur — type inconnu, paramètre hors domaine. On retombe
      // sur les sondes historiques plutôt que de conclure à une absence de support.
    }
  }
  const mediaSource = (globalThis as { MediaSource?: { isTypeSupported(type: string): boolean } }).MediaSource;
  const viaMse = mediaSource?.isTypeSupported?.(candidate.mimeType) ?? false;
  const viaElement = probe.canPlayType(candidate.mimeType) !== "";
  // `canPlayType` ne dit rien de la fluidité : on ne relève pas la définition sur cette seule foi.
  return { candidate, supported: viaMse || viaElement, smooth: viaMse && candidate.height <= 1080 };
}

let cached: DecodeSupport | null = null;

/** Sonde le navigateur une fois par session : le résultat ne change pas en cours de route. */
export async function probeDecodeSupport(): Promise<DecodeSupport> {
  if (cached) return cached;
  const probe = document.createElement("video");
  const verdicts = await Promise.all(DECODE_CANDIDATES.map((candidate) => judge(candidate, probe)));
  cached = summariseDecodeSupport(verdicts);
  return cached;
}

/** Ce que la sonde a conclu, ou `null` tant qu'elle n'a pas été exécutée. */
export function decodeSupportSnapshot(): DecodeSupport | null {
  return cached;
}

/** Réservé aux tests : oublie la sonde précédente. */
export function resetDecodeSupport(): void {
  cached = null;
}
