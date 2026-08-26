import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ToneMappingBackend,
  ToneMappingBackendId,
  ToneMappingProbe,
  AcceleratorId,
  AcceleratorProbe,
  ActiveSessionCost,
  AdmissionDecision,
  CapacityAlert,
  PlaybackMode,
  ServerCapacityReport,
} from "@flixtunes/contracts";
import { config } from "./config.js";
import { preferencesConversion } from "./preferences-conversion.js";
import { getSetting, setSetting } from "./database.js";
import { toneMappingFilters, toneMappingInputArgs } from "./tone-mapping-filters.js";

const execFileAsync = promisify(execFile);

/**
 * Modèle de coût mesuré sur banc (FFmpeg 8.1, libx264 veryfast, mires `testsrc2`).
 *
 * Le coût par image se décompose en une part fixe — démultiplexage, décodage, cadencement — et une part
 * proportionnelle à la surface encodée. Ajusté sur 720p et 2160p, il prédit exactement les deux points
 * non utilisés pour l'ajustement : 1080p (1,00 attendu / 1,00 mesuré) et une réduction 1080p → 720p
 * (0,66 attendu / 0,66 mesuré). L'unité vaut un transcodage 1080p à 25 images par seconde.
 */
export const COST_FIXED_PER_FRAME = 0.39;
export const COST_PER_MEGAPIXEL = 0.295;
/** Surcoût d'initialisation et de contrôle de débit de chaque variante supplémentaire d'une échelle ABR. */
export const COST_PER_EXTRA_VARIANT = 0.05;
/** Un remux copie la vidéo : mesuré cinq fois moins coûteux qu'un transcodage 1080p. */
export const COST_REMUX = 0.2;
/** Surcoût mesuré du tone mapping, débit amorti sur 600 images. */
export const TONE_MAPPING_COST: Record<string, number> = {
  none: 1, zscale: 1.43, software: 1.43, libplacebo: 1.83, vaapi: 1.2, opencl: 1.2,
};

/**
 * Coût de décodage rapporté au H.264, mesuré en décodage seul à 1080p.
 * Un codec non mesuré garde le facteur neutre plutôt qu'une valeur supposée.
 */
export const DECODE_COST: Record<string, number> = {
  h264: 1, hevc: 1.05, av1: 1.98, mpeg2video: 0.73,
};

export function decodeCostFactor(codec: string | null | undefined): number {
  return DECODE_COST[(codec ?? "").toLowerCase()] ?? 1;
}

export interface SessionCostInput {
  mode: PlaybackMode;
  /** Variantes réellement encodées. Une seule pour un transcodage simple, plusieurs pour une échelle ABR. */
  variants: Array<{ width: number; height: number }>;
  frameRate?: number | null;
  toneMapping?: string;
  /** Codec de la piste source : il pèse sur la part fixe, celle du décodage. */
  sourceCodec?: string | null;
}

/**
 * Coût d'une session en unités 1080p25.
 * Le décodage n'est facturé qu'une fois : une échelle ABR partage la même entrée FFmpeg.
 */
export function estimateSessionCost(input: SessionCostInput): number {
  if (input.mode === "direct") return 0;
  const cadence = Math.max(0.2, Math.min(4, (input.frameRate && input.frameRate > 0 ? input.frameRate : 25) / 25));
  if (input.mode === "remux") return Math.round(COST_REMUX * cadence * 100) / 100;
  const variants = input.variants.length ? input.variants : [{ width: 1920, height: 1080 }];
  const megapixels = variants.reduce((total, variant) => total + Math.max(0, variant.width * variant.height) / 1e6, 0);
  const work = COST_FIXED_PER_FRAME * decodeCostFactor(input.sourceCodec)
    + COST_PER_MEGAPIXEL * megapixels + COST_PER_EXTRA_VARIANT * (variants.length - 1);
  const toneMapping = TONE_MAPPING_COST[input.toneMapping ?? "none"] ?? 1;
  return Math.round(work * cadence * toneMapping * 100) / 100;
}

/** Travail unitaire d'une image à une définition donnée, dans la même échelle que `estimateSessionCost`. */
export function frameWork(width: number, height: number): number {
  return COST_FIXED_PER_FRAME + COST_PER_MEGAPIXEL * (Math.max(0, width * height) / 1e6);
}

/**
 * Convertit le débit mesuré du micro-banc 720p en nombre de sessions 1080p25 soutenables.
 * La réserve protège l'interface, les analyses et les lectures directes d'un transcodage lourd.
 */
export function budgetFromBenchmark(framesPerSecond: number | null, headroom = config.transcodeHeadroom): number {
  if (!framesPerSecond || framesPerSecond <= 0) return 1;
  const sustainable = framesPerSecond * frameWork(1280, 720) / 25;
  return Math.max(1, Math.round(sustainable * Math.max(0.1, Math.min(1, headroom)) * 10) / 10);
}

const acceleratorCatalog: Array<{ id: AcceleratorId; label: string; vendor: AcceleratorProbe["vendor"]; encoder: string;
  hwaccel: string | null; args: () => string[] }> = [
  { id: "software", label: "Encodage logiciel x264", vendor: "cpu", encoder: "libx264", hwaccel: null,
    args: () => ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"] },
  { id: "nvenc", label: "NVIDIA NVENC", vendor: "nvidia", encoder: "h264_nvenc", hwaccel: "cuda",
    args: () => ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"] },
  { id: "qsv", label: "Intel Quick Sync", vendor: "intel", encoder: "h264_qsv", hwaccel: "qsv",
    // `-q:v` et non `-global_quality` : la seconde demande le mode ICQ, que les puces Intel d'entree
    // de gamme ne savent pas rendre. Sur un N5105, la session materielle s'ouvrait puis l'encodeur
    // refusait — « Selected ratecontrol mode is unsupported » — et Quick Sync etait declare inutilisable
    // alors que seul le mode de controle de debit demande l'etait. `-q:v` force CQP, le seul mode que
    // ce circuit expose.
    args: () => ["-c:v", "h264_qsv", "-preset", "veryfast", "-q:v", "23"] },
  { id: "vaapi", label: "VA-API", vendor: "intel", encoder: "h264_vaapi", hwaccel: "vaapi",
    args: () => ["-vaapi_device", config.hardwareDevice, "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-qp", "23"] },
  { id: "amf", label: "AMD AMF", vendor: "amd", encoder: "h264_amf", hwaccel: null,
    args: () => ["-c:v", "h264_amf", "-quality", "speed"] },
  { id: "v4l2m2m", label: "V4L2 M2M", vendor: "arm", encoder: "h264_v4l2m2m", hwaccel: null,
    args: () => ["-c:v", "h264_v4l2m2m", "-b:v", "4M"] },
];

/**
 * Micro-banc non destructif : encode quatre secondes de mire vers `null`.
 * Aucun fichier n'est écrit et aucun média de l'utilisateur n'est touché.
 */
async function benchmarkEncoder(args: string[]): Promise<{ framesPerSecond: number | null; error: string | null; detail?: string }> {
  const frames = 120;
  const startedAt = Date.now();
  try {
    await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4", ...args, "-f", "null", "-"],
    { windowsHide: true, timeout: 45_000, maxBuffer: 1_000_000 });
    const elapsed = Math.max(1, Date.now() - startedAt);
    return { framesPerSecond: Math.round(frames * 1000 / elapsed), error: null };
  } catch (error) {
    const brut = error instanceof Error ? error.message : String(error);
    // Le message d'origine est conservé à côté du libellé. Sans lui, une panne qui ne correspond à
    // aucun motif connu ne laisse qu'un « le périphérique a refusé », impossible à instruire — et
    // c'est exactement ce qui s'est produit sur un NAS réel.
    return { framesPerSecond: null, error: friendlyAcceleratorError(brut), detail: await detailleEchec(args, brut) };
  }
}

/**
 * Ce qu'on garde d'un échec, et pourquoi ce n'était pas suffisant.
 *
 * Deux défauts se cumulaient, et ils ont fait durer un diagnostic des semaines.
 *
 * **La sortie était tronquée par la fin.** `slice(-400)` conserve les dernières lignes — or celles-ci
 * sont les plus génériques : « Task finished with error code -22 », « Nothing was written into output
 * file ». La ligne qui nomme la cause, elle, est émise par le filtre **avant** ces conclusions, et
 * tombait donc systématiquement. Relevé sur le NAS de référence : le détail conservé commençait par
 * « OF », queue d'un mot coupé au milieu.
 *
 * **La sonde tournait en `-loglevel error`.** Un pilote qui refuse un filtre l'explique souvent en
 * `warning` ou en `verbose` — le code d'erreur, lui, reste un `-22` muet. On ne voyait donc pas la
 * phrase même qu'on cherchait.
 *
 * D'où cette seconde tentative, qui ne coûte rien puisqu'elle n'a lieu qu'en cas d'échec : la même
 * commande, en bavard, et l'on garde les deux bouts plutôt que la fin seule.
 */
async function detailleEchec(args: string[], brut: string): Promise<string> {
  const bavard = await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "verbose",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=1", ...args, "-f", "null", "-"],
  { windowsHide: true, timeout: 45_000, maxBuffer: 2_000_000 })
    .then(() => "")
    .catch((erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur)));
  const source = bavard || brut;
  return extraitSignifiant(source);
}

/** Les deux bouts d'une sortie trop longue : la cause est en tête, la conclusion à la fin. */
export function extraitSignifiant(source: string, tete = 1200, queue = 400): string {
  if (source.length <= tete + queue) return source;
  return `${source.slice(0, tete)}
[…]
${source.slice(-queue)}`;
}

export function friendlyAcceleratorError(message: string): string {
  const normalized = message.toLowerCase();
  // Le nœud de rendu passe **avant** le pilote, et l'ordre décide de tout.
  //
  // « failed to open /dev/dri/renderD128: No such file or directory » est la forme la plus courante de
  // cette panne, et elle tombait sur la règle générique juste en dessous : on annonçait « pilote
  // absent », ce qui envoie installer un pilote alors que le fichier de périphérique manque à
  // l'environnement du service. Deux gestes opposés pour une même phrase.
  //
  // Le simple fait que `/dev/dri` apparaisse dans un message ne dit pas que le nœud est invisible : il
  // apparaît aussi quand le nœud s'ouvre parfaitement et que c'est la suite qui échoue. Le tone mapping
  // VA-API a été annoncé « nœud non visible » alors que l'encodeur VA-API tournait à 408 images/seconde
  // dans le même processus — le diagnostic envoyait vérifier des droits qui n'avaient rien à se
  // reprocher. On n'affirme donc l'invisibilité que si le message la décrit vraiment.
  if (/renderd\d+|\/dev\/dri/.test(normalized)
    && /no such|cannot open|failed to open|not found|unable to open|does not exist/.test(normalized)) {
    return "Le nœud de rendu /dev/dri n'est pas visible depuis le service.";
  }
  if (/failed to open|cannot load|no such file|dll/.test(normalized)) return "Pilote absent ou non chargé sur ce serveur.";
  if (/permission denied|operation not permitted|eacces/.test(normalized)) return "Le périphérique existe mais n'est pas accessible au service FlixTunes.";
  // Messages propres à Intel Quick Sync. Sans eux, la panne la plus fréquente sur un NAS — le nœud de
  // rendu absent de l'environnement du paquet — retombait sur le libellé générique, qui n'indique
  // aucun remède : « refusé » et « absent » appellent pourtant des gestes opposés.
  if (/mfx|libmfx|qsv/.test(normalized) && /session|init|unsupported|not (?:found|supported)/.test(normalized)) {
    return "Quick Sync n'a pas pu ouvrir de session : nœud de rendu absent de l'environnement, ou pilote Intel non chargé.";
  }
  // Le simple fait que `/dev/dri` apparaisse dans un message ne dit pas que le nœud est invisible : il
  // apparaît aussi quand le nœud s'ouvre parfaitement et que c'est la suite qui échoue. Le tone mapping
  // VA-API a été annoncé « nœud non visible » alors que l'encodeur VA-API tournait à 408 images/seconde
  // dans le même processus — le diagnostic envoyait vérifier des droits qui n'avaient rien à se
  // reprocher. On n'affirme donc l'invisibilité que si le message la décrit vraiment.
  /*
   * Le circuit vidéo sait ouvrir une session, mais ne sait pas convertir le HDR.
   *
   * Ce cas s'est fait passer pour tout autre chose pendant des semaines. Le message conservé disait
   * « le périphérique a ouvert la session mais refusé ce filtre » — vrai, et parfaitement inutile :
   * il n'indique aucun remède, et laisse croire à un réglage manquant. La sonde tournant en
   * `-loglevel error` et ne gardant que la **fin** de la sortie, la seule ligne qui nommait la cause
   * n'atteignait jamais l'écran.
   *
   * Relevée en clair sur le NAS de référence, un Celeron N5105 :
   *
   *     [Parsed_tonemap_vaapi_2] VAAPI driver doesn't support HDR
   *
   * Ce n'est ni un droit d'accès, ni un pilote absent : Intel n'expose la conversion HDR de son
   * moteur vidéo qu'à partir de la douzième génération, et ce processeur est de la onzième. Aucune
   * configuration ne la fera apparaître — le dire épargne de chercher.
   */
  if (/driver doesn't support hdr|driver does not support hdr|hdr.*not supported/.test(normalized)) {
    return "Ce circuit vidéo ne sait pas convertir le HDR : Intel ne l'expose qu'à partir de sa 12ᵉ génération.";
  }
  if (/no device|device creation failed|cannot open device|invalid device/.test(normalized)) return "Aucun périphérique compatible n'a répondu.";
  if (/out of memory|cannot allocate/.test(normalized)) return "Mémoire du périphérique insuffisante pour ouvrir une session.";
  if (/timed out|etimedout/.test(normalized)) return "Le périphérique n'a pas répondu dans le temps imparti.";
  if (/unknown encoder|encoder not found/.test(normalized)) return "Encodeur absent de la compilation FFmpeg installée.";
  // Vulkan et OpenCL ne sont pas embarqués par le paquet : le dire, plutôt que de laisser croire à un
  // matériel absent alors que c'est une bibliothèque qui manque.
  if (/libvulkan|vulkan/.test(normalized)) return "Bibliothèque Vulkan absente de cette installation : chemin non disponible.";
  if (/opencl platform|opencl/.test(normalized)) return "Aucun pilote OpenCL installé : chemin non disponible.";
  if (/invalid argument|-22/.test(normalized)) return "Le périphérique a ouvert la session mais refusé ce filtre.";
  return "Le périphérique a refusé la session d'essai.";
}

/**
 * Retient l'accélérateur à utiliser à partir des débits mesurés.
 *
 * Un accélérateur n'est préféré que s'il soutient au moins 80 % du débit logiciel : il libère alors du
 * processeur sans ralentir la lecture. Un pilote qui répond mais reste plus lent que le logiciel — cas
 * observé sur Quick Sync à 84 images/s contre 266 en logiciel — est écarté au lieu d'être imposé.
 */
export function rankAccelerators(probes: AcceleratorProbe[], preference = "auto"): AcceleratorProbe[] {
  const software = probes.find((probe) => probe.id === "software");
  const softwareFps = software?.framesPerSecond ?? null;
  const scored = probes.map((probe) => ({
    ...probe,
    relativeToSoftware: probe.framesPerSecond && softwareFps ? Math.round(probe.framesPerSecond / softwareFps * 100) / 100 : null,
    selected: false,
  }));
  const usable = scored.filter((probe) => probe.usable && probe.framesPerSecond);
  const forced = preference !== "auto" ? usable.find((probe) => probe.id === preference) : null;
  const hardware = usable.filter((probe) => probe.id !== "software")
    .filter((probe) => !softwareFps || probe.framesPerSecond! >= softwareFps * 0.8)
    .sort((left, right) => right.framesPerSecond! - left.framesPerSecond!);
  const winner = forced ?? hardware[0] ?? usable.find((probe) => probe.id === "software") ?? usable[0] ?? null;
  if (winner) winner.selected = true;
  return scored;
}

export interface AdmissionState {
  budgetUnits: number;
  usedUnits: number;
  activeTranscodes: number;
  maximumTranscodes: number;
  freeMemoryBytes: number;
  temperatureCelsius?: number | null;
}

/** Échelle de repli proposée avant de refuser une session. */
const degradationLadder = [2160, 1440, 1080, 720, 480, 360];

/**
 * Décide l'admission d'une session.
 *
 * Une lecture directe ne consomme aucun encodeur : elle est toujours acceptée, même serveur saturé.
 * Au-delà du budget, une définition plus basse est proposée avant tout refus.
 */
export function decideAdmission(request: SessionCostInput & { height?: number | null }, state: AdmissionState): AdmissionDecision {
  const cost = estimateSessionCost(request);
  const base = { costUnits: cost, budgetUnits: state.budgetUnits, usedUnits: state.usedUnits };
  if (request.mode === "direct") {
    return { ...base, accepted: true, degraded: false, maxHeight: null, reason: "Lecture directe : aucun encodeur mobilisé" };
  }
  if (state.activeTranscodes >= state.maximumTranscodes) {
    return { ...base, accepted: false, degraded: false, maxHeight: null,
      reason: `Limite de ${state.maximumTranscodes} conversions simultanées atteinte sur ce serveur.` };
  }
  if (state.freeMemoryBytes > 0 && state.freeMemoryBytes < config.minimumFreeMemoryBytes) {
    return { ...base, accepted: false, degraded: false, maxHeight: null,
      reason: "Mémoire libre insuffisante pour ouvrir une conversion supplémentaire." };
  }
  // Au-delà de la limite thermique, les conversions en cours continuent mais aucune nouvelle n'est ouverte.
  if (state.temperatureCelsius != null && state.temperatureCelsius >= config.thermalLimitCelsius) {
    return { ...base, accepted: false, degraded: false, maxHeight: null,
      reason: `Le serveur est à ${Math.round(state.temperatureCelsius)} °C : aucune nouvelle conversion n'est ouverte tant que la température n'est pas redescendue.` };
  }
  if (state.usedUnits + cost <= state.budgetUnits) {
    return { ...base, accepted: true, degraded: false, maxHeight: null, reason: "Capacité disponible" };
  }
  const sourceHeight = request.height ?? request.variants[0]?.height ?? 1080;
  for (const height of degradationLadder) {
    if (height >= sourceHeight) continue;
    const width = Math.round(height * 16 / 9);
    const degraded = estimateSessionCost({ ...request, variants: [{ width, height }] });
    if (state.usedUnits + degraded <= state.budgetUnits) {
      return { ...base, costUnits: degraded, accepted: true, degraded: true, maxHeight: height,
        reason: `Serveur chargé : cette lecture est limitée à ${height}p pour ne pas dégrader les autres.` };
    }
  }
  return { ...base, accepted: false, degraded: false, maxHeight: null,
    reason: "Le serveur ne dispose plus d'assez de capacité, même à définition réduite. Réessayez dans quelques instants." };
}

/**
 * Concurrence d'analyse effective.
 * Une analyse ne doit jamais affamer une lecture : dès qu'une conversion tourne, elle passe à un seul
 * travailleur, et elle est suspendue quand le budget de conversion est presque saturé.
 */
export function effectiveScanConcurrency(configured: number, activeTranscodes: number, budgetUsedRatio: number): number {
  if (budgetUsedRatio >= 0.85) return 0;
  if (activeTranscodes > 0) return 1;
  return Math.max(1, configured);
}

export function buildCapacityAlerts(input: {
  accelerators: AcceleratorProbe[];
  budgetUnits: number; usedUnits: number;
  freeMemoryBytes: number; totalMemoryBytes: number;
  temperatureCelsius: number | null;
  scanPaused: boolean;
  calibrating?: boolean;
}): CapacityAlert[] {
  const alerts: CapacityAlert[] = [];
  if (input.calibrating) {
    return [{ level: "info", message: "Le micro-banc matériel est en cours.",
      action: "Le tableau se complétera dans moins d'une minute ; la lecture reste possible entre-temps." }];
  }
  const selected = input.accelerators.find((probe) => probe.selected);
  const rejected = input.accelerators.filter((probe) => probe.compiled && !probe.usable && probe.id !== "software");
  const slower = input.accelerators.filter((probe) => probe.usable && probe.id !== "software"
    && probe.relativeToSoftware != null && probe.relativeToSoftware < 0.8);
  if (!selected) {
    alerts.push({ level: "critical", message: "Aucun encodeur n'a réussi le micro-banc de démarrage.",
      action: "Vérifiez l'installation de FFmpeg : aucune conversion n'est possible." });
  } else if (selected.id === "software" && input.accelerators.some((probe) => probe.compiled && probe.id !== "software")) {
    alerts.push({ level: "info", message: "Les conversions se font sur le processeur malgré un accélérateur détecté.",
      action: "Consultez le détail par accélérateur ci-dessous pour connaître la raison exacte." });
  }
  // Un accélérateur refusé n'est une alerte que s'il manque vraiment quelque chose.
  //
  // Le tableau listait « NVIDIA NVENC est compilé mais inutilisable — installez le pilote » sur une
  // machine sans carte NVIDIA, et de même pour AMD et pour l'encodeur des puces ARM. Trois conseils
  // impossibles à suivre, qui noyaient la seule ligne utile. FFmpeg compile tous ces encodeurs
  // d'office : leur présence ne dit rien du matériel installé, et leur refus non plus.
  //
  // Dès qu'un accélérateur matériel fonctionne, les autres ne sont plus un problème à résoudre mais
  // du matériel absent. Ils restent dans le tableau, avec leur raison, pour qui veut vérifier — ils
  // ne réclament simplement plus une action.
  const materielRetenu = Boolean(selected && selected.id !== "software");
  for (const probe of materielRetenu ? [] : rejected) {
    alerts.push({ level: "warning", message: `${probe.label} est compilé mais inutilisable : ${probe.error ?? "raison inconnue"}`,
      action: "Installez ou exposez le pilote correspondant, ou ignorez cet accélérateur." });
  }
  for (const probe of slower) {
    alerts.push({ level: "warning",
      message: `${probe.label} répond mais reste plus lent que le processeur (${Math.round((probe.relativeToSoftware ?? 0) * 100)} % du débit logiciel).`,
      action: "FlixTunes l'écarte volontairement. Mettez le pilote à jour pour en tirer parti." });
  }
  if (input.budgetUnits > 0 && input.usedUnits / input.budgetUnits >= 0.85) {
    alerts.push({ level: "warning", message: "Le budget de conversion est presque saturé.",
      action: "Les nouvelles lectures seront proposées à définition réduite avant d'être refusées." });
  }
  if (input.scanPaused) {
    alerts.push({ level: "info", message: "Les analyses de bibliothèque sont suspendues pendant les conversions en cours.",
      action: "Elles repartiront automatiquement dès que la charge de lecture baissera." });
  }
  if (input.totalMemoryBytes > 0 && input.freeMemoryBytes / input.totalMemoryBytes < 0.1) {
    alerts.push({ level: "critical", message: "Moins de 10 % de mémoire libre sur le serveur.",
      action: "Réduisez le nombre de conversions simultanées ou augmentez la mémoire du NAS." });
  }
  if (input.temperatureCelsius != null && input.temperatureCelsius >= config.thermalLimitCelsius) {
    alerts.push({ level: "critical", message: `Température processeur de ${Math.round(input.temperatureCelsius)} °C.`,
      action: "FlixTunes limite les nouvelles conversions. Vérifiez la ventilation du NAS." });
  }
  return alerts;
}

let lastTemperature: number | null = null;
/** Dernière température connue, sans lecture disque : le contrôle d'admission doit rester synchrone. */
export function lastKnownTemperature(): number | null { return lastTemperature; }
export async function refreshTemperature(): Promise<number | null> {
  lastTemperature = await readCpuTemperature();
  return lastTemperature;
}

/** Température la plus élevée exposée par le noyau Linux. Retourne null ailleurs. */
export async function readCpuTemperature(): Promise<number | null> {
  try {
    const zones = await readdir("/sys/class/thermal");
    const readings = await Promise.all(zones.filter((zone) => zone.startsWith("thermal_zone")).map(async (zone) => {
      try { return Number(await readFile(`/sys/class/thermal/${zone}/temp`, "utf8")) / 1000; } catch { return Number.NaN; }
    }));
    const valid = readings.filter((value) => Number.isFinite(value) && value > 0 && value < 150);
    return valid.length ? Math.max(...valid) : null;
  } catch { return null; }
}

interface Calibration {
  signature: string;
  /**
   * La même signature **sans la révision du paquet** : elle décrit le matériel et le moteur, pas
   * l'emballage. C'est la clé sous laquelle les meilleurs relevés survivent à une mise à jour.
   */
  materiel?: string;
  measuredAt: string;
  probes: AcceleratorProbe[];
}

const CALIBRATION_KEY = "hardware_calibration";
let calibrationPromise: Promise<Calibration> | null = null;
let calibrationCache: Calibration | null = null;
const activeCosts = new Map<string, ActiveSessionCost>();

/** Calibrage déjà connu, sans jamais attendre le micro-banc : une lecture ne doit pas patienter. */
export function calibrationIfReady(): Calibration | null { return calibrationCache; }

/**
 * Budget de conversion courant. Tant que le micro-banc n'a pas rendu son verdict, une estimation
 * prudente de deux cœurs par session 1080p25 est appliquée.
 */
/**
 * Le nombre de conversions 1080p que la mesure dit soutenir sur cette machine.
 *
 * C'est le chiffre à proposer à l'administrateur, et la valeur du mode automatique. Il vaut sept sur
 * l'AS5404T avec VA-API, deux avec le seul processeur : aucune constante écrite dans le code ne
 * pouvait convenir aux deux.
 */
export function plafondRecommande(): number {
  const cout = estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }] });
  return Math.max(1, Math.min(16, Math.floor(currentBudgetUnits() / Math.max(0.01, cout))));
}

/**
 * Le plafond réellement appliqué : le choix de l'administrateur, ou la recommandation mesurée.
 *
 * Il ne remplace pas le budget, il s'y ajoute. Deux sessions 4K coûtent à elles seules tout le budget
 * et resteront refusées quel que soit ce nombre ; la limite thermique et la réserve d'interface aussi.
 */
export function plafondConversions(): number {
  const choix = preferencesConversion().conversionsSimultanees;
  return choix === "auto" ? plafondRecommande() : choix;
}

export function currentBudgetUnits(): number {
  const measured = calibrationCache?.probes.find((probe) => probe.selected)?.framesPerSecond;
  if (measured) return budgetFromBenchmark(measured);
  return Math.max(1, Math.round(os.cpus().length / 2 * config.transcodeHeadroom * 10) / 10);
}

export function currentAdmissionState(): AdmissionState {
  return {
    budgetUnits: currentBudgetUnits(),
    usedUnits: usedCapacityUnits(),
    activeTranscodes: activeSessionCosts().filter((session) => session.mode !== "direct").length,
    maximumTranscodes: plafondConversions(),
    freeMemoryBytes: os.freemem(),
    temperatureCelsius: lastTemperature,
  };
}

/** Signature du moteur : le calibrage est refait dès que FFmpeg ou la liste des accélérateurs change. */
/**
 * Signature du calibrage : ce qui, en changeant, doit faire refaire les mesures.
 *
 * L'environnement du pilote en fait partie, et son absence a coûté cher. Le calibrage est conservé
 * dans les réglages ; tant que la signature ne bouge pas, le verdict enregistré est réutilisé sans
 * rejouer la moindre sonde. Or corriger l'accès au pilote ne change ni la version de FFmpeg, ni la
 * liste des encodeurs : la signature restait identique, et un « Quick Sync inutilisable » mesuré
 * avant la correction survivait à celle-ci. L'accélération semblait refuser de fonctionner alors
 * qu'elle n'avait simplement jamais été réessayée.
 */
export function calibrationSignature(engineVersion: string | null, hwaccels: string[], encoders: string[]): string {
  const relevant = encoders.filter((name) => acceleratorCatalog.some((entry) => entry.encoder === name)).sort();
  const pilote = [process.env.LIBVA_DRIVERS_PATH ?? "", process.env.LIBVA_DRIVER_NAME ?? ""].join(">");
  // La révision du paquet en fait partie, et son absence a coûté une journée.
  //
  // Un paquet apporte son propre FFmpeg et son propre étage pilote. Deux révisions peuvent donc
  // annoncer la même version de FFmpeg, la même liste d'encodeurs et le même environnement de pilote,
  // tout en embarquant des bibliothèques différentes — c'est exactement ce qu'ont fait les révisions
  // qui ont ajouté `libva-drm`. La signature ne bougeait pas, et un « VA-API inutilisable » mesuré
  // avant la correction survivait à celle-ci : le tableau affichait des chiffres vieux de plusieurs
  // révisions en les présentant comme le verdict de la version installée.
  const revision = config.packageRevision ?? "";
  return [engineVersion ?? "inconnu", [...hwaccels].sort().join("+"), relevant.join("+"), os.arch(), pilote, revision].join("|");
}

/**
 * Conserve, pour chaque accélérateur, le meilleur débit jamais mesuré sous la même signature.
 *
 * **Un micro-banc ne peut que sous-estimer.** Rien de ce qui tourne à côté ne rendra l'encodeur plus
 * rapide qu'il n'est ; en revanche une analyse de médiathèque, une extraction de paquet ou un second
 * banc lancé en parallèle le feront paraître deux fois plus lent. Le maximum observé est donc l'estimation
 * la plus proche de la vérité, et la seule qui ne se dégrade pas toute seule.
 *
 * Ce n'est pas une précaution théorique : l'installation de r60 a déclenché une mesure **pendant** que
 * le paquet extrayait deux cents mégaoctets et changeait le propriétaire de tout le partage. VA-API est
 * passé de 471 à 408 images/seconde et le budget de 7,5 à 6,5 — sans que rien ne se soit dégradé sur la
 * machine. Le tableau annonçait une perte de capacité qui n'existait pas.
 *
 * La signature reste le garde-fou : un pilote corrigé, une bibliothèque ajoutée par une révision de
 * paquet la font changer, et l'historique est alors abandonné — ce qui est correct, puisque le matériel
 * n'est plus le même. « Mesurer à nouveau » depuis l'écran de capacité efface tout, y compris ce
 * maximum, pour repartir d'une page blanche.
 */
export function retenirLeMeilleur(brut: string | null, signature: string, mesures: AcceleratorProbe[]): AcceleratorProbe[] {
  if (!brut) return mesures;
  const materiel = signatureMaterielle(signature);
  let anciennes: AcceleratorProbe[];
  try {
    const parsed = JSON.parse(brut) as Calibration;
    // On compare le matériel, pas la révision : une mise à jour de paquet re-mesure, mais n'efface
    // pas ce qui a été observé de mieux sur la même machine avec le même moteur.
    const materielAncien = parsed.materiel ?? signatureMaterielle(parsed.signature ?? "");
    if (materielAncien !== materiel || !Array.isArray(parsed.probes)) return mesures;
    anciennes = parsed.probes;
  } catch {
    return mesures;
  }
  return mesures.map((mesure) => {
    const avant = anciennes.find((probe) => probe.id === mesure.id);
    if (!avant?.framesPerSecond || !mesure.framesPerSecond) return mesure;
    return avant.framesPerSecond > mesure.framesPerSecond
      ? { ...mesure, framesPerSecond: avant.framesPerSecond, usable: true, error: null }
      : mesure;
  });
}

/**
 * Les micro-bancs passent un par un, jamais ensemble.
 *
 * `getCapacityReport` lançait le calibrage des encodeurs **et** celui du tone mapping par deux `void`
 * successifs. Les deux mesurent le même GPU : le banc d'encodage VA-API tournait donc pendant que le
 * banc de tone mapping occupait le même nœud de rendu, et chacun mesurait une machine que l'autre
 * saturait.
 *
 * L'effet était spectaculaire et trompeur : VA-API annoncé à 265 images/seconde au lieu de 471, tandis
 * que l'encodage logiciel — qui ne touche pas au GPU — revenait à sa valeur normale. Un tableau qui
 * montre le processeur intact et l'accélérateur effondré fait chercher une panne de pilote ou de
 * droits ; il n'y en avait aucune.
 *
 * Une file suffit, et elle vaut aussi pour le bouton « mesurer à nouveau » : deux clics rapprochés
 * produisaient le même faux effondrement.
 */
let fileDeBanc: Promise<unknown> = Promise.resolve();

function aLaSuite<T>(travail: () => Promise<T>): Promise<T> {
  const suivant = fileDeBanc.then(travail, travail);
  fileDeBanc = suivant.catch(() => undefined);
  return suivant;
}

/**
 * La signature du matériel, sans la révision du paquet.
 *
 * La signature complète inclut la révision, et pour une bonne raison : deux révisions peuvent annoncer
 * le même FFmpeg en embarquant des bibliothèques différentes, et un « VA-API inutilisable » mesuré
 * avant une correction ne doit pas survivre à celle-ci. Une mise à jour **doit** donc re-mesurer.
 *
 * Mais re-mesurer et **oublier** sont deux choses distinctes, et les confondre a coûté deux fois le
 * même faux diagnostic : la mesure de r61 a été prise pendant l'installation de r61, VA-API est
 * tombé de 471 à 396 images/seconde, et le meilleur relevé conservé sous la signature de r60 avait
 * été jeté avec elle. Le tableau annonçait une perte de capacité qui n'existait pas.
 *
 * L'historique est donc gardé sous cette signature-ci, qui ne bouge pas d'une révision à l'autre,
 * pendant que la signature complète continue de déclencher une nouvelle mesure. Un banc ne pouvant
 * que sous-estimer, garder le maximum reste l'estimation la plus juste. « Refaire les mesures »
 * efface tout, y compris cet historique, pour qui veut repartir d'une page blanche.
 */
export function signatureMaterielle(signature: string): string {
  const morceaux = signature.split("|");
  return morceaux.slice(0, -1).join("|");
}

export async function calibrateHardware(support: { version: string | null; encoders: Set<string>; hwaccels: Set<string> }):
Promise<Calibration> {
  const signature = calibrationSignature(support.version, [...support.hwaccels], [...support.encoders]);
  if (calibrationCache?.signature === signature) return calibrationCache;
  const stored = getSetting(CALIBRATION_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Calibration;
      if (parsed.signature === signature && Array.isArray(parsed.probes)) { calibrationCache = parsed; return parsed; }
    } catch { /* calibrage illisible : il sera refait */ }
  }
  calibrationPromise ??= aLaSuite(async () => {
    const probes: AcceleratorProbe[] = [];
    for (const entry of acceleratorCatalog) {
      const compiled = support.encoders.has(entry.encoder) && (!entry.hwaccel || support.hwaccels.has(entry.hwaccel));
      if (!compiled) {
        probes.push({ id: entry.id, label: entry.label, vendor: entry.vendor, encoder: entry.encoder, compiled: false,
          usable: false, framesPerSecond: null, relativeToSoftware: null, selected: false,
          error: "Absent de la compilation FFmpeg installée." });
        continue;
      }
      const result = await benchmarkEncoder(entry.args());
      probes.push({ id: entry.id, label: entry.label, vendor: entry.vendor, encoder: entry.encoder, compiled: true,
        usable: result.framesPerSecond != null, framesPerSecond: result.framesPerSecond, relativeToSoftware: null,
        selected: false, error: result.error, detail: result.detail ?? null });
    }
    const calibration: Calibration = { signature, materiel: signatureMaterielle(signature),
      measuredAt: new Date().toISOString(),
      probes: rankAccelerators(retenirLeMeilleur(stored, signature, probes), config.hardwareAcceleration) };
    calibrationCache = calibration;
    try { setSetting(CALIBRATION_KEY, JSON.stringify(calibration)); } catch { /* calibrage non persisté */ }
    calibrationPromise = null;
    return calibration;
  });
  return calibrationPromise;
}

/**
 * Micro-banc des chemins de tone mapping HDR vers SDR.
 *
 * Le tone mapping est le filtre le plus coûteux de la chaîne : sur le NAS de référence, la conversion
 * d'un film HDR passait par `zscale` puis `tonemap=hable` en logiciel, et c'était de loin ce qui
 * mettait le processeur à genoux — davantage que l'encodage. La règle du projet interdit pourtant de
 * choisir automatiquement un chemin matériel qui n'a pas été mesuré sur la machine cible : VA-API et
 * OpenCL restaient donc derrière un réglage d'administrateur, et l'installation par défaut convertissait
 * en logiciel même là où le matériel savait faire mieux.
 *
 * Mesurer lève cette interdiction sans l'enfreindre. Le banc reprend celui des encodeurs : quatre
 * secondes de mire, aucun fichier écrit, aucun média touché.
 */
const toneMappingCatalog: Array<{ id: ToneMappingBackendId; label: string; hardware: boolean;
  filtre: string; accelerateur: string | null }> = [
  { id: "libplacebo", label: "Tone mapping libplacebo / Vulkan", hardware: true,
    filtre: "libplacebo", accelerateur: "vulkan" },
  { id: "vaapi", label: "Tone mapping VA-API", hardware: true, filtre: "tonemap_vaapi", accelerateur: "vaapi" },
  { id: "opencl", label: "Tone mapping OpenCL", hardware: true, filtre: "tonemap_opencl", accelerateur: "opencl" },
  { id: "zscale", label: "Tone mapping logiciel zscale", hardware: false, filtre: "zscale", accelerateur: null },
  { id: "software", label: "Tone mapping logiciel", hardware: false, filtre: "tonemap", accelerateur: null },
];

/**
 * Construit un minuscule vrai flux HDR10 pour le micro-banc.
 *
 * Une mire `lavfi` suivie de `setparams` porte les primaires BT.2020 et la courbe PQ, mais pas le
 * bloc `Mastering display` attaché aux images. `tonemap_vaapi` exige précisément ce side-data HDR10
 * et répond EINVAL s'il manque : l'ancien banc déclarait donc VA-API cassé alors que le pilote et
 * l'encodeur VA-API fonctionnaient. Le HEVC ci-dessous contient les SEI Mastering Display et MaxCLL,
 * exactement comme un fichier HDR10 réel. Il vit dans le dossier temporaire et est supprimé après
 * les cinq mesures ; aucun média utilisateur n'est lu ni modifié.
 */
async function creerSourceHdrCalibration(): Promise<{ fichier: string; nettoyer: () => Promise<void> }> {
  const dossier = await mkdtemp(path.join(os.tmpdir(), "flixtunes-hdr-"));
  const fichier = path.join(dossier, "mire-hdr10.mkv");
  try {
    await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=1",
      "-vf", "format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc",
      "-frames:v", "30", "-an", "-c:v", "libx265", "-preset", "ultrafast",
      "-x265-params", "hdr-opt=1:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400",
      fichier], { windowsHide: true, timeout: 45_000, maxBuffer: 1_000_000 });
    return { fichier, nettoyer: () => rm(dossier, { recursive: true, force: true }) };
  } catch (erreur) {
    await rm(dossier, { recursive: true, force: true }).catch(() => undefined);
    throw erreur;
  }
}

/** Micro-banc d'un chemin de tone mapping : quatre secondes de mire HDR converties vers `null`. */
async function benchmarkToneMapping(entree: { id: ToneMappingBackendId; accelerateur: string | null }, sourceHdr: string):
Promise<{ framesPerSecond: number | null; error: string | null; detail?: string }> {
  const frames = 120;
  const prefixe = toneMappingInputArgs(entree.id as ToneMappingBackend);
  // Mille nits en source, cent en sortie : le cas courant d'un master HDR10 rendu sur un écran SDR.
  const filtres = toneMappingFilters(entree.id as ToneMappingBackend, 1000, 100).join(",");
  const startedAt = Date.now();
  try {
    await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", ...prefixe,
      "-stream_loop", "-1", "-i", sourceHdr, "-t", "4", "-vf", filtres,
      "-c:v", "rawvideo", "-f", "null", "-"],
    { windowsHide: true, timeout: 45_000, maxBuffer: 1_000_000 });
    const elapsed = Math.max(1, Date.now() - startedAt);
    return { framesPerSecond: Math.round(frames * 1000 / elapsed), error: null };
  } catch (error) {
    const brut = error instanceof Error ? error.message : String(error);
    // Même raison qu'au micro-banc d'encodage : un pilote qui refuse un filtre l'explique en
    // `verbose`, et la ligne qui le dit est en tête de sortie, pas à la fin.
    const bavard = await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "verbose", ...prefixe,
      "-stream_loop", "-1", "-i", sourceHdr, "-t", "1", "-vf", filtres, "-c:v", "rawvideo", "-f", "null", "-"],
    { windowsHide: true, timeout: 45_000, maxBuffer: 2_000_000 })
      .then(() => "")
      .catch((erreur: unknown) => (erreur instanceof Error ? erreur.message : String(erreur)));
    return { framesPerSecond: null, error: friendlyAcceleratorError(brut),
      detail: extraitSignifiant(bavard || brut) };
  }
}

/**
 * Classe les chemins mesurés et désigne celui que « auto » retiendra.
 *
 * Un chemin matériel n'est préféré que s'il est **mesuré plus rapide** que le logiciel. La nuance
 * compte : un pilote qui répond mais traîne — cas d'un tone mapping matériel émulé — coûterait plus
 * cher que le chemin qu'il remplace, tout en paraissant être un progrès.
 */
export function rankToneMapping(probes: ToneMappingProbe[]): ToneMappingProbe[] {
  const reference = probes.find((probe) => probe.id === "zscale" && probe.usable)
    ?? probes.find((probe) => !probe.hardware && probe.usable);
  const base = reference?.framesPerSecond ?? null;
  const notes = probes.map((probe) => ({
    ...probe,
    relativeToSoftware: base && probe.framesPerSecond ? Math.round(probe.framesPerSecond / base * 100) / 100 : null,
    selected: false,
  }));
  const utilisables = notes.filter((probe) => probe.usable && probe.framesPerSecond);
  utilisables.sort((a, b) => (b.framesPerSecond ?? 0) - (a.framesPerSecond ?? 0));
  const gagnant = utilisables[0] ?? notes.find((probe) => probe.usable);
  if (gagnant) gagnant.selected = true;
  return notes;
}

let toneMappingCache: ToneMappingCalibration | null = null;
let toneMappingPromise: Promise<ToneMappingCalibration> | null = null;
const TONE_MAPPING_KEY = "capacity.toneMapping";

export interface ToneMappingCalibration {
  signature: string;
  measuredAt: string;
  probes: ToneMappingProbe[];
}

/**
 * Mesure les chemins de tone mapping, une fois, et retient le verdict.
 *
 * Même signature que le calibrage des encodeurs : elle inclut l'environnement du pilote, faute de quoi
 * un « inutilisable » mesuré avant la correction d'un accès survivrait à celle-ci.
 */
export async function calibrateToneMapping(support: { version: string | null; filters: Set<string>; hwaccels: Set<string> }):
Promise<ToneMappingCalibration> {
  // Le suffixe invalide les faux verdicts persistés par l'ancienne mire sans Mastering Display.
  const signature = `${calibrationSignature(support.version, [...support.hwaccels], [...support.filters])}|hdr10-sei-v2`;
  if (toneMappingCache?.signature === signature) return toneMappingCache;
  const stored = getSetting(TONE_MAPPING_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ToneMappingCalibration;
      if (parsed.signature === signature && Array.isArray(parsed.probes)) { toneMappingCache = parsed; return parsed; }
    } catch { /* calibrage illisible : il sera refait */ }
  }
  toneMappingPromise ??= aLaSuite(async () => {
    const probes: ToneMappingProbe[] = [];
    const source = await creerSourceHdrCalibration();
    try { for (const entree of toneMappingCatalog) {
      const compiled = support.filters.has(entree.filtre)
        && (!entree.accelerateur || support.hwaccels.has(entree.accelerateur));
      if (!compiled) {
        probes.push({ id: entree.id, label: entree.label, hardware: entree.hardware, compiled: false,
          usable: false, framesPerSecond: null, relativeToSoftware: null, selected: false,
          error: "Absent de la compilation FFmpeg installée." });
        continue;
      }
      const resultat = await benchmarkToneMapping(entree, source.fichier);
      probes.push({ id: entree.id, label: entree.label, hardware: entree.hardware, compiled: true,
        usable: resultat.framesPerSecond != null, framesPerSecond: resultat.framesPerSecond,
        relativeToSoftware: null, selected: false, error: resultat.error, detail: resultat.detail ?? null });
    } } finally { await source.nettoyer().catch(() => undefined); }
    const calibration: ToneMappingCalibration = { signature, measuredAt: new Date().toISOString(),
      probes: rankToneMapping(probes) };
    toneMappingCache = calibration;
    try { setSetting(TONE_MAPPING_KEY, JSON.stringify(calibration)); } catch { /* calibrage non persisté */ }
    toneMappingPromise = null;
    return calibration;
  });
  return toneMappingPromise;
}

/** Les chemins mesurés, ou une liste vide tant que la mesure n'a pas abouti. */
export function toneMappingProbes(): ToneMappingProbe[] {
  return toneMappingCache?.probes ?? [];
}

/** Le chemin retenu par la mesure, ou `null` tant qu'aucune mesure n'a eu lieu. */
export function calibratedToneMapping(): ToneMappingBackendId | null {
  return toneMappingCache?.probes.find((probe) => probe.selected)?.id ?? null;
}

/**
 * Oublie les mesures enregistrées, pour qu'elles soient refaites au prochain rapport.
 *
 * Le calibrage est conservé tant que sa signature ne bouge pas, et c'est voulu : rejouer les
 * micro-bancs à chaque consultation coûterait cher pour rien. Mais la signature ne peut pas tout
 * voir — une correction d'accès au pilote, une bibliothèque ajoutée par une révision de paquet, un
 * droit modifié sur le nœud de rendu. Le verdict d'avant survit alors à ce qui le corrige, et le
 * tableau affiche des chiffres périmés en les présentant comme l'état courant. C'est arrivé : des
 * mesures de trois révisions antérieures montrées comme le verdict de la version installée.
 *
 * Un bouton vaut mieux qu'une signature toujours plus fine : il ne demande de deviner ni ce qui a
 * changé, ni quand.
 */
export function oublierCalibrages(): void {
  calibrationCache = null;
  calibrationPromise = null;
  toneMappingCache = null;
  toneMappingPromise = null;
  try { setSetting(CALIBRATION_KEY, ""); } catch { /* rien a oublier */ }
  try { setSetting(TONE_MAPPING_KEY, ""); } catch { /* rien a oublier */ }
}

export function registerSessionCost(key: string, cost: ActiveSessionCost): void { activeCosts.set(key, cost); }
export function releaseSessionCost(key: string): void { activeCosts.delete(key); }
export function activeSessionCosts(): ActiveSessionCost[] { return [...activeCosts.values()]; }
export function usedCapacityUnits(): number {
  return Math.round([...activeCosts.values()].reduce((total, session) => total + session.costUnits, 0) * 100) / 100;
}

export async function getCapacityReport(
  support: { version: string | null; encoders: Set<string>; hwaccels: Set<string>; filters?: Set<string> },
  scanStats: { active: number; queued: number; concurrency: number }): Promise<ServerCapacityReport> {
  // Le tableau ne doit jamais attendre le micro-banc : il se complète au calibrage suivant.
  const ready = calibrationIfReady();
  // Le tableau ne doit jamais attendre le micro-banc : il se complète au calibrage suivant. Mais les
  // deux bancs se suivent au lieu de se chevaucher — voir `fileDeBanc`.
  const filtres = support.filters;
  const toneMapping = () => filtres
    ? calibrateToneMapping({ version: support.version, filters: filtres, hwaccels: support.hwaccels })
    : Promise.resolve(undefined);
  if (!ready) {
    void calibrateHardware(support).then(toneMapping).catch(() => undefined);
  } else if (filtres) {
    void toneMapping().catch(() => undefined);
  }
  const calibration: Calibration = ready ?? { signature: "en cours", measuredAt: "", probes: [] };
  const calibrating = !ready;
  const selected = calibration.probes.find((probe) => probe.selected) ?? null;
  const budgetUnits = currentBudgetUnits();
  const usedUnits = usedCapacityUnits();
  const activeTranscodes = activeSessionCosts().filter((session) => session.mode !== "direct").length;
  const temperatureCelsius = await refreshTemperature();
  const effective = effectiveScanConcurrency(scanStats.concurrency, activeTranscodes, budgetUnits ? usedUnits / budgetUnits : 0);
  const cpus = os.cpus();
  const simultaneous = [
    { label: "1080p H.264", height: 1080, width: 1920 },
    { label: "1080p HDR converti en SDR", height: 1080, width: 1920, toneMapping: "zscale" },
    { label: "4K H.264", height: 2160, width: 3840 },
  ].map((entry) => ({ label: entry.label,
    sessions: Math.floor(budgetUnits / Math.max(0.01, estimateSessionCost({ mode: "transcode",
      variants: [{ width: entry.width, height: entry.height }], toneMapping: entry.toneMapping }))) }));
  return {
    generatedAt: new Date().toISOString(),
    calibration: { signature: calibration.signature, measuredAt: calibration.measuredAt || null,
      source: selected?.framesPerSecond ? "mesure" : "estimation" },
    architecture: os.arch(), cpuModel: cpus[0]?.model?.trim() ?? "processeur inconnu", cpuCores: cpus.length,
    totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(),
    loadAverage1: os.platform() === "win32" ? null : Math.round(os.loadavg()[0]! * 100) / 100,
    temperatureCelsius,
    accelerators: calibration.probes, toneMapping: toneMappingProbes(), selectedEncoder: selected?.encoder ?? null,
    budgetUnits, usedUnits, headroomRatio: config.transcodeHeadroom,
    simultaneous,
    // Le plafond appliqué et celui que la mesure recommande, pour que l'écran puisse proposer un
    // chiffre au lieu de laisser deviner.
    plafondConversions: plafondConversions(),
    plafondRecommande: plafondRecommande(),
    plafondAutomatique: preferencesConversion().conversionsSimultanees === "auto",
    scans: { configured: scanStats.concurrency, effective, pausedByPlayback: effective < scanStats.concurrency },
    activeSessions: activeSessionCosts(),
    alerts: buildCapacityAlerts({ accelerators: calibration.probes, budgetUnits, usedUnits,
      freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem(), temperatureCelsius,
      scanPaused: effective < scanStats.concurrency, calibrating }),
  };
}

/**
 * Accélérateur retenu par le calibrage déjà mesuré.
 * Retourne null tant que le micro-banc n'a pas abouti : la sélection par présence reste alors en vigueur.
 */
export function calibratedAccelerator(): AcceleratorId | null {
  return calibrationCache?.probes.find((probe) => probe.selected)?.id ?? null;
}
