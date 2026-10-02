import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { dimensionsCible } from "./diffusion-chaine.js";
import type { FormatLive } from "./live-compat-entree.js";

const execFileAsync = promisify(execFile);

/**
 * Le direct vers un téléviseur : copier quand le récepteur sait lire la source, sinon convertir à sa
 * pleine définition, désentrelacé, sans réduire à 720p par principe.
 *
 * Banc du 2 octobre 2026 sur le Philips 58PUS7304 : CNews (H.264 progressif) passe en copie, mais TF1
 * est un H.264 1080 entrelacé (`field_order=tt`), avec un flux de diffusion qui porte des erreurs de
 * référence. Recopié tel quel, le lecteur Cast ne démarre jamais ; la r8 attendait 40 s avant de
 * retomber sur une conversion 720p à 30 images par seconde, lue au bout de 79 s. Une source analysée
 * d'emblée va droit au bon traitement.
 *
 * Une source HLS à plusieurs variantes se lit variante par variante : CNews en propose quatorze, dont la
 * première est un 480×270. `-map 0:v:0` diffusait celle-là ; la variante est désormais choisie pour le
 * récepteur (1080p50 pour le 58PUS7304, 720p25 pour la Pixel Tablet), avec le son de son programme.
 */
export interface VarianteLive {
  /** Indice absolu du flux vidéo dans l'entrée, celui que `-map 0:<indice>` désigne. */
  flux: number | null;
  /** Indice absolu du son du même programme, s'il est connu. */
  fluxAudio: number | null;
  codec: string | null;
  largeur: number;
  hauteur: number;
  entrelace: boolean;
  imagesParSeconde: number;
  /** Débit annoncé par la liste maîtresse, pour départager deux variantes identiques. */
  debit: number;
}

export interface AnalyseLive extends VarianteLive {
  /** Toutes les variantes vidéo de la source ; la première est celle que FFmpeg prendrait seul. */
  variantes: VarianteLive[];
  audio: string | null;
}

/** Les formats qu'une source du direct peut faire ouvrir : les sous-titres WebVTT des listes HLS en sont. */
export const FORMATS_ENTREE_LIVE = "hls,dash,mpegts,mov,aac,webvtt";

export interface RecepteurLive {
  /** La plus haute définition H.264 que le récepteur lit : 1080 ou 720. */
  hauteurMax: number;
  /** Le récepteur lit-il le HEVC en fMP4 ? */
  hevc: boolean;
  /** Un téléviseur DLNA sans HLS reçoit un MPEG-TS continu : la copie en fMP4 lui est interdite. */
  conversionSeule?: boolean;
}

export interface TraitementLive {
  copie: boolean;
  /** Les flux à lire, ou `null` pour laisser FFmpeg prendre le premier. */
  flux: number | null;
  fluxAudio: number | null;
  /** Dimensions de sortie d'une conversion. */
  largeur: number;
  hauteur: number;
  entrelace: boolean;
  encodeur: "vaapi" | "logiciel";
  /** Images par seconde de sortie : 50 pour un 50i désentrelacé trame par trame, sinon la source. */
  imagesParSeconde: number;
  libelle: string;
}

const entier = (valeur: unknown) => { const n = Number(valeur); return Number.isFinite(n) ? n : 0; };
function cadence(texte: unknown): number {
  const [num, den] = String(texte ?? "").split("/").map(Number);
  return num && den ? num / den : 0;
}

/** Une liste maîtresse réduite passe à FFmpeg en `data:` : aucun fichier, et pas de protocole `file` à ouvrir. */
export const estListeReduite = (entree: string) => entree.startsWith("data:");
/** Les protocoles et le format d'entrée que FFmpeg reçoit pour une entrée de diffusion. */
export function optionsEntreeLive(entree: string): { protocoles: string; format: string[] } {
  return estListeReduite(entree) ? { protocoles: "data,http,tcp,crypto", format: ["-f", "hls"] } : { protocoles: "http,tcp,crypto", format: [] };
}

interface VarianteDeclaree extends VarianteLive { uri: string; ligne: string; groupeAudio: string | null }

function attribut(ligne: string, nom: string): string | null {
  const r = new RegExp(`[:,]${nom}=(?:"([^"]*)"|([^,]*))`).exec(ligne);
  return r ? (r[1] ?? r[2] ?? "").trim() : null;
}

/**
 * Les variantes qu'une liste maîtresse déclare, ou `null` si elle n'en déclare pas assez pour choisir
 * sans tout sonder (une variante sans définition annoncée suffit à renoncer).
 */
export function lireListeMaitresse(texte: string): { variantes: VarianteDeclaree[]; medias: string[] } | null {
  const lignes = texte.split(/\r?\n/).map((l) => l.trim());
  const variantes: VarianteDeclaree[] = [], medias: string[] = [];
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]!;
    if (ligne.startsWith("#EXT-X-MEDIA:")) { medias.push(ligne); continue; }
    if (!ligne.startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = lignes.slice(i + 1).find((l) => l && !l.startsWith("#"));
    const resolution = /^(\d+)x(\d+)$/.exec(attribut(ligne, "RESOLUTION") ?? "");
    if (!uri || !resolution) return null;
    const codecs = attribut(ligne, "CODECS") ?? "";
    variantes.push({ flux: variantes.length, fluxAudio: null, uri, ligne, groupeAudio: attribut(ligne, "AUDIO"),
      codec: /\bavc[13]\./.test(codecs) ? "h264" : /\b(?:hvc1|hev1)\./.test(codecs) ? "hevc" : codecs ? "autre" : null,
      largeur: Number(resolution[1]), hauteur: Number(resolution[2]), entrelace: false,
      imagesParSeconde: Number(attribut(ligne, "FRAME-RATE")) || 25, debit: Number(attribut(ligne, "BANDWIDTH")) || 0 });
  }
  return variantes.length ? { variantes, medias } : null;
}

/**
 * La liste maîtresse ramenée à une variante et à un son — le son par défaut de son groupe, hors
 * audiodescription. Les sous-titres en sont retirés : FFmpeg n'a plus qu'une liste vidéo et une liste
 * son à lire au lieu de toutes. CNews : 0,9 s au lieu de 5 s jusqu'au troisième segment.
 */
export function listeReduite(maitre: { medias: string[] }, variante: VarianteDeclaree): string {
  const sons = variante.groupeAudio === null ? []
    : maitre.medias.filter((m) => attribut(m, "TYPE") === "AUDIO" && attribut(m, "GROUP-ID") === variante.groupeAudio);
  const ordinaire = (m: string) => !/describes-video/i.test(attribut(m, "CHARACTERISTICS") ?? "");
  const son = sons.find((m) => ordinaire(m) && attribut(m, "DEFAULT") === "YES") ?? sons.find(ordinaire) ?? sons[0];
  let ligne = retirerAttribut(retirerAttribut(variante.ligne, "SUBTITLES"), "CLOSED-CAPTIONS");
  if (!son) ligne = retirerAttribut(ligne, "AUDIO");
  return ["#EXTM3U", "#EXT-X-INDEPENDENT-SEGMENTS", ...(son ? [son] : []), ligne, variante.uri, ""].join("\n");
}

/** Retire un attribut d'une ligne de liste, où qu'il soit placé. */
export function retirerAttribut(ligne: string, nom: string): string {
  return ligne.replace(new RegExp(`([:,])${nom}=(?:"[^"]*"|[^,]*)(,?)`), (_t, avant: string, apres: string) => (avant === ":" ? ":" : apres ? "," : ""));
}

/** La définition visée d'une conversion : celle du récepteur avec le circuit vidéo, 720p au plus sans lui. */
export function hauteurVisee(recepteur: RecepteurLive, materiel: boolean): number {
  const hauteurMax = Math.min(1080, recepteur.hauteurMax);
  return materiel ? hauteurMax : Math.min(hauteurMax, 720);
}

/**
 * L'entrée d'une diffusion et son analyse. Une liste maîtresse qui annonce ses variantes est réduite à
 * celle qui convient au récepteur avant toute sonde ; sinon toute la source est sondée et la variante
 * choisie parmi les flux trouvés.
 */
export async function preparerEntreeDiffusion(url: string, format: FormatLive, recepteur: RecepteurLive, materiel: boolean)
  : Promise<{ entree: string; analyse: AnalyseLive | null }> {
  if (format === "hls") {
    const texte = await fetch(url, { signal: AbortSignal.timeout(8_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const maitre = lireListeMaitresse(texte);
    if (maitre && maitre.variantes.length > 1) {
      const declaree = { ...maitre.variantes[0]!, variantes: maitre.variantes, audio: null };
      const { variante } = choisirVariante(declaree, recepteur, hauteurVisee(recepteur, materiel));
      const texteReduit = listeReduite(maitre, maitre.variantes[variante.flux!]!);
      const entree = `data:application/vnd.apple.mpegurl;base64,${Buffer.from(texteReduit).toString("base64")}`;
      const analyse = await analyserEntree(entree, format);
      if (analyse) return { entree, analyse };
    }
  }
  return { entree: url, analyse: await analyserEntree(url, format) };
}

/** Lit les flux d'une source, en dix secondes au plus. Rien n'est conclu d'une source muette. */
export async function analyserEntree(entree: string, format: FormatLive): Promise<AnalyseLive | null> {
  const options = optionsEntreeLive(entree);
  try {
    const { stdout } = await execFileAsync(config.ffprobePath, ["-v", "error",
      "-protocol_whitelist", options.protocoles, "-format_whitelist", FORMATS_ENTREE_LIVE, "-rw_timeout", "8000000",
      ...(format === "hls" ? ["-live_start_index", "-1"] : []), "-analyzeduration", "4000000", "-probesize", "4000000", ...options.format,
      "-show_entries", "program=program_id:program_stream=index,codec_type"
        + ":stream=index,codec_type,codec_name,width,height,field_order,r_frame_rate,avg_frame_rate:stream_tags=variant_bitrate",
      "-of", "json", entree],
    { windowsHide: true, timeout: 10_000, maxBuffer: 4_000_000 });
    return lireAnalyse(JSON.parse(stdout));
  } catch { return null; }
}

type FluxSonde = Record<string, unknown> & { tags?: Record<string, unknown> };

/** Ce que l'analyse retient des flux décrits par `ffprobe` : chaque variante vidéo, avec le son de son programme. */
export function lireAnalyse(sortie: { streams?: FluxSonde[]; programs?: Array<{ streams?: FluxSonde[] }> }): AnalyseLive | null {
  const flux = sortie.streams ?? [];
  const programmes = sortie.programs ?? [];
  const indice = (f: FluxSonde) => (typeof f.index === "number" ? f.index : null);
  const variantes = flux.filter((f) => f.codec_type === "video" && f.codec_name !== "mjpeg" && f.codec_name !== "png").map((video): VarianteLive => {
    const ordre = String(video.field_order ?? "progressive");
    const entrelace = ["tt", "bb", "tb", "bt"].includes(ordre);
    // Un 1080i se déclare souvent à 50 images (une par trame) : la cadence d'images vraie en est la moitié.
    let imagesParSeconde = cadence(video.avg_frame_rate) || cadence(video.r_frame_rate);
    if (entrelace && imagesParSeconde > 30) imagesParSeconde /= 2;
    const programme = indice(video) === null ? undefined
      : programmes.find((p) => p.streams?.some((s) => s.index === video.index));
    const son = programme?.streams?.find((s) => s.codec_type === "audio");
    return { flux: indice(video), fluxAudio: son ? indice(son) : null,
      codec: video.codec_name ? String(video.codec_name) : null, largeur: entier(video.width), hauteur: entier(video.height),
      entrelace, imagesParSeconde: Math.round(imagesParSeconde * 100) / 100 || 25, debit: entier(video.tags?.variant_bitrate) };
  });
  if (!variantes.length) return null;
  return { ...variantes[0]!, variantes, audio: flux.find((f) => f.codec_type === "audio")?.codec_name as string ?? null };
}

/** Le récepteur peut-il recevoir cette variante telle quelle ? */
function copiable(v: VarianteLive, recepteur: RecepteurLive, hauteurMax: number): boolean {
  if (recepteur.conversionSeule || v.entrelace || v.hauteur <= 0) return false;
  if (v.codec === "h264") return v.hauteur <= hauteurMax + 8;
  return v.codec === "hevc" && recepteur.hevc && v.hauteur <= Math.max(hauteurMax, 720) + 8;
}

/** La plus belle d'abord : définition, puis cadence d'images, puis débit annoncé. */
const plusBelle = (a: VarianteLive, b: VarianteLive) => b.hauteur - a.hauteur || b.imagesParSeconde - a.imagesParSeconde || b.debit - a.debit;

/**
 * La variante à lire : la plus belle que le récepteur reçoit telle quelle, sinon celle qui se convertit
 * le mieux — la plus haute jusqu'à la définition visée, ou la plus petite au-dessus d'elle.
 */
export function choisirVariante(analyse: AnalyseLive, recepteur: RecepteurLive, hauteurVisee: number): { variante: VarianteLive; copie: boolean } {
  const hauteurMax = Math.min(1080, recepteur.hauteurMax);
  const variantes = analyse.variantes?.length ? analyse.variantes : [analyse];
  const directes = variantes.filter((v) => copiable(v, recepteur, hauteurMax)).sort(plusBelle);
  if (directes[0]) return { variante: directes[0], copie: true };
  const connues = variantes.filter((v) => v.hauteur > 0);
  if (!connues.length) return { variante: variantes[0]!, copie: false };
  const enDessous = connues.filter((v) => v.hauteur <= hauteurVisee + 8).sort(plusBelle);
  const auDessus = connues.filter((v) => v.hauteur > hauteurVisee + 8).sort((a, b) => -plusBelle(a, b));
  return { variante: enDessous[0] ?? auDessus[0]!, copie: false };
}

/**
 * Le traitement d'une source pour un récepteur.
 *
 * La copie n'est retenue que pour une variante progressive que le récepteur sait lire : H.264 jusqu'à sa
 * définition maximale, ou HEVC en fMP4. Une source entrelacée, un autre codec ou une définition trop
 * haute sont convertis à la définition du récepteur, désentrelacés trame par trame — 50 images par
 * seconde pour un 50i, comme un téléviseur le restitue sans cast.
 */
export function choisirTraitementLive(analyse: AnalyseLive | null, recepteur: RecepteurLive, materiel: boolean): TraitementLive {
  // Sans analyse, le chemin logiciel convertit sans connaître les dimensions : il sait les déduire.
  const encodeur = materiel && analyse && analyse.largeur > 0 && analyse.hauteur > 0 ? "vaapi" as const : "logiciel" as const;
  // Le logiciel ne tient pas un 1080p50 sur un petit processeur : il reste à 720p, et à 30 images au plus.
  const plafond = hauteurVisee(recepteur, encodeur === "vaapi");
  const choix = analyse ? choisirVariante(analyse, recepteur, plafond) : null;
  const source = choix?.variante ?? null;
  if (choix?.copie && source) {
    return { copie: true, flux: source.flux, fluxAudio: source.fluxAudio, largeur: source.largeur, hauteur: source.hauteur,
      entrelace: false, encodeur: "logiciel", imagesParSeconde: source.imagesParSeconde, libelle: "Vidéo source conservée" };
  }
  const sourceL = source?.largeur || 1920, sourceH = source?.hauteur || 1080;
  const { largeur, hauteur } = dimensionsCible(sourceL, sourceH, Math.round(plafond * 16 / 9), plafond);
  const entrelace = !!source?.entrelace;
  const base = source?.imagesParSeconde || 25;
  const imagesParSeconde = encodeur === "vaapi" ? Math.min(60, entrelace ? base * 2 : base) : base > 30 ? base / 2 : base;
  return { copie: false, flux: source?.flux ?? null, fluxAudio: source?.fluxAudio ?? null, largeur, hauteur, entrelace, encodeur,
    imagesParSeconde, libelle: `Conversion ${hauteur}p${Math.round(imagesParSeconde)}${entrelace ? " · désentrelacée" : ""}` };
}

/** Le débit visé d'une conversion du direct : assez pour une image de télévision, sans saturer le Wi-Fi. */
export function debitLive(hauteur: number, imagesParSeconde: number): number {
  const base = hauteur >= 1000 ? 6_000_000 : hauteur >= 700 ? 3_500_000 : 2_000_000;
  return Math.round(base * (imagesParSeconde > 30 ? 1.35 : 1));
}

/** Les arguments de vidéo d'une conversion de direct pour un téléviseur. */
export function argumentsVideoLive(t: TraitementLive): { entree: string[]; sortie: string[] } {
  const debit = debitLive(t.hauteur, t.imagesParSeconde);
  const cles = ["-force_key_frames", "expr:gte(t,n_forced*2)"];
  const debits = ["-b:v", String(debit), "-maxrate", String(Math.round(debit * 1.3)), "-bufsize", String(debit * 2)];
  if (t.encodeur === "vaapi") {
    const filtres = ["format=nv12", "hwupload", ...(t.entrelace ? ["deinterlace_vaapi=rate=field"] : []),
      `scale_vaapi=w=${t.largeur}:h=${t.hauteur}`];
    return { entree: ["-vaapi_device", config.hardwareDevice],
      sortie: ["-vf", filtres.join(","), "-c:v", "h264_vaapi", "-rc_mode", "VBR", ...debits, ...cles] };
  }
  const filtres = [...(t.entrelace ? ["yadif=mode=send_frame:parity=auto:deint=interlaced"] : []),
    `scale=w='min(${t.largeur},iw)':h='min(${t.hauteur},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`];
  return { entree: [], sortie: ["-vf", filtres.join(","), "-r", String(t.imagesParSeconde), "-c:v", "libx264", "-threads", "2", "-preset", "veryfast",
    "-profile:v", "high", "-pix_fmt", "yuv420p", ...debits, ...cles, "-sc_threshold", "0"] };
}

/** Le dossier de travail d'une conversion est-il bien un des nôtres ? Garde-fou avant suppression. */
export function dossierDeConversion(racine: string, dossier: string, id: string): boolean {
  return path.dirname(path.resolve(dossier)) === racine && /^[a-f0-9-]{36}$/.test(id);
}
