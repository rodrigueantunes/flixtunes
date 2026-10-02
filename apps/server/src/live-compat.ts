import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { freemem } from "node:os";
import { config } from "./config.js";
import { calibratedAccelerator, currentAdmissionState, decideAdmission, registerSessionCost, releaseSessionCost } from "./capacity.js";
import { formatLive, ouvrirEntreeLive, type FormatLive } from "./live-compat-entree.js";
import { argumentsVideoLive, choisirTraitementLive, FORMATS_ENTREE_LIVE, optionsEntreeLive, preparerEntreeDiffusion,
  type RecepteurLive, type TraitementLive } from "./live-diffusion.js";

const racine = path.resolve(config.dataDir, "live-compat");
const maximum = Math.max(0, Math.min(2, Number(process.env.FLIXTUNES_LIVE_CONVERSIONS ?? 1) || 0));

/** Une passe de FFmpeg d'une diffusion : chaque relance écrit dans son propre dossier. */
interface Passe { numero: number; dossier: string; processus?: ChildProcess; debut: number; segments: number }
interface SegmentDiffuse { passe: number; nom: string; duree: number }
interface Conversion {
  id: string; profil: string; chaine: string; source: string; lecture: string; dossier: string;
  processus?: ChildProcess; entree?: Awaited<ReturnType<typeof ouvrirEntreeLive>>;
  acces: number; arretee: boolean; timer?: ReturnType<typeof setInterval>; nettoyage?: Promise<void>; copieVideo?: boolean;
  /** Pour un téléviseur : les sources de secours, le traitement retenu et la liste composée. */
  diffusion?: {
    sources: string[]; rang: number; format: FormatLive; traitement: TraitementLive;
    /** Le conteneur des segments, fixé pour la session : une liste ne mêle pas fMP4 et MPEG-TS. */
    fmp4: boolean; recepteur: RecepteurLive; materiel: boolean;
    /** Ce que FFmpeg lit : l'adresse du relais, ou la liste maîtresse réduite à la variante retenue. */
    entree: string;
    passes: Passe[]; segments: SegmentDiffuse[]; retires: number; ruptures: number; relances: number[];
    dernierSegment: number; lecteur?: ReturnType<typeof setInterval>;
  };
}
const sessions = new Map<string, Conversion>();

/**
 * Les segments de la source repris en arrière pour un téléviseur.
 *
 * Partie du dernier segment, la conversion produit exactement au temps réel : le récepteur Cast n'a
 * jamais d'avance, attend chaque segment et saute ceux qu'il croit perdus. Banc du 2 octobre 2026 sur
 * la Pixel Tablet, CNews : lecture et attente en alternance toutes les trois secondes. Repartir cinq
 * segments en arrière laisse la conversion rattraper ce retard à pleine vitesse et se constituer une
 * réserve, au prix d'un léger différé, sans effet sur un téléviseur.
 */
export const RETARD_SOURCE_DIFFUSION = 5;
/** Segments gardés dans la liste servie au téléviseur : une minute de reprise possible. */
const FENETRE_DIFFUSION = 30;
/** Sans nouveau segment pendant ce temps, la passe est relancée. */
const SILENCE_MAX_MS = 15_000;

export function argumentsConversionLive(entree: string, dossier: string, format: FormatLive, copieVideo = false, diffusion = false,
  traitement?: TraitementLive, fmp4?: boolean): string[] {
  const video = traitement && !traitement.copie ? argumentsVideoLive(traitement) : null;
  const copie = traitement ? traitement.copie : copieVideo;
  const segmentsFmp4 = fmp4 ?? copie;
  const options = optionsEntreeLive(entree);
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-filter_threads", "1",
    ...(video?.entree ?? []),
    "-protocol_whitelist", options.protocoles, "-format_whitelist", FORMATS_ENTREE_LIVE, "-rw_timeout", "20000000",
    ...(format === "hls" ? ["-live_start_index", diffusion ? String(-RETARD_SOURCE_DIFFUSION) : "-1"] : []),
    ...(format === "ts" || format === "mp4" ? ["-re"] : []),
    // Les flux de diffusion portent des erreurs de référence : les ignorer vaut mieux qu'un arrêt.
    ...(diffusion ? ["-fflags", "+discardcorrupt+genpts", "-err_detect", "ignore_err"] : []),
    // La variante retenue par l'analyse, et le son de son programme ; sinon le premier flux venu.
    ...options.format, "-i", entree, "-map", traitement?.flux != null ? `0:${traitement.flux}` : "0:v:0",
    "-map", traitement?.fluxAudio != null ? `0:${traitement.fluxAudio}?` : "0:a:0?", "-sn", "-dn",
    ...(copie ? ["-c:v", "copy"] : video ? video.sortie : ["-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-r", "30", "-c:v", "libx264", "-threads", "2",
    "-preset", "veryfast", "-pix_fmt", "yuv420p", "-profile:v", "main", "-b:v", "2200k",
    "-maxrate", "2600k", "-bufsize", "5200k", "-g", "120", "-keyint_min", "120", "-sc_threshold", "0"]),
    "-c:a", "aac", "-ac", "2", "-b:a", "160k", "-f", "hls", "-hls_time", video ? "2" : "4",
    ...(segmentsFmp4 ? ["-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4"] : []),
    "-hls_list_size", "18", "-hls_delete_threshold", "2", "-hls_flags", "delete_segments+temp_file+independent_segments",
    "-hls_segment_filename", path.join(dossier, segmentsFmp4 ? "segment%09d.m4s" : "segment%09d.ts"), path.join(dossier, "live.m3u8")];
}

async function tuer(processus: ChildProcess | undefined) {
  if (!processus || processus.exitCode !== null || processus.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    processus.once("close", resolve);
    processus.kill("SIGKILL");
    const timer = setTimeout(resolve, 3_000); timer.unref();
  });
}

async function arreter(session: Conversion): Promise<void> {
  if (session.nettoyage) return session.nettoyage;
  session.arretee = true;
  clearInterval(session.timer);
  if (session.diffusion) clearInterval(session.diffusion.lecteur);
  session.nettoyage = (async () => {
    await tuer(session.processus);
    for (const passe of session.diffusion?.passes ?? []) await tuer(passe.processus);
    await session.entree?.fermer();
    // Seul un sous-dossier créé par ce module peut être supprimé.
    if (path.dirname(path.resolve(session.dossier)) === racine && /^[a-f0-9-]{36}$/.test(session.id)) {
      await rm(session.dossier, { recursive: true, force: true }).catch(() => undefined);
    }
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    releaseSessionCost(session.id);
  })();
  return session.nettoyage;
}

/** Les segments nouveaux d'une passe, lus dans la liste que FFmpeg tient pour elle. */
export function segmentsDeLaListe(texte: string): Array<{ nom: string; duree: number }> {
  const lignes = texte.split(/\r?\n/), segments: Array<{ nom: string; duree: number }> = [];
  for (let i = 0; i < lignes.length; i++) {
    const r = /^#EXTINF:([0-9.]+)/.exec(lignes[i]!);
    if (r && lignes[i + 1] && !lignes[i + 1]!.startsWith("#")) segments.push({ nom: lignes[i + 1]!.trim(), duree: Number(r[1]) });
  }
  return segments;
}

/**
 * La liste servie au téléviseur : les segments des passes successives, avec une rupture déclarée à
 * chaque relance. Le récepteur continue sur la nouvelle passe sans s'arrêter, comme un lecteur local
 * qui change de source sans couper l'image.
 */
export function composerListe(d: { segments: SegmentDiffuse[]; retires: number; ruptures: number; fmp4: boolean }): string {
  const cible = Math.max(2, Math.ceil(Math.max(0, ...d.segments.map((s) => s.duree))));
  const lignes = ["#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${cible}`, `#EXT-X-MEDIA-SEQUENCE:${d.retires}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${d.ruptures}`, "#EXT-X-INDEPENDENT-SEGMENTS"];
  let passe = -1;
  for (const s of d.segments) {
    if (s.passe !== passe) {
      if (passe !== -1) lignes.push("#EXT-X-DISCONTINUITY");
      if (d.fmp4) lignes.push(`#EXT-X-MAP:URI="p${s.passe}-init.mp4"`);
      passe = s.passe;
    }
    lignes.push(`#EXTINF:${s.duree.toFixed(6)},`, `p${s.passe}-${s.nom}`);
  }
  return lignes.join("\n") + "\n";
}

/** Lance une passe de FFmpeg pour une diffusion, sur la source courante. */
async function lancerPasse(session: Conversion) {
  const d = session.diffusion!;
  const numero = (d.passes.at(-1)?.numero ?? -1) + 1;
  const dossier = path.join(session.dossier, `p${numero}`);
  await mkdir(dossier, { recursive: true });
  const source = d.sources[d.rang]!;
  if (!session.entree || session.source !== source) {
    await session.entree?.fermer().catch(() => undefined);
    session.source = source;
    d.format = await formatLive(source);
    session.entree = await ouvrirEntreeLive(source);
    // Une autre source a ses propres variantes : elle est analysée à son tour, dans le conteneur de la
    // session — une session en MPEG-TS ne passe pas à la copie en cours de route.
    const recepteur = { ...d.recepteur, conversionSeule: d.recepteur.conversionSeule || !d.fmp4 };
    const preparee = await preparerEntreeDiffusion(session.entree.url, d.format, recepteur, d.materiel);
    d.entree = preparee.entree;
    d.traitement = choisirTraitementLive(preparee.analyse, recepteur, d.materiel);
  }
  if (session.arretee) return;
  const passe: Passe = { numero, dossier, debut: Date.now(), segments: 0 };
  const processus = spawn(config.ffmpegPath, argumentsConversionLive(d.entree, dossier, d.format, false, true, d.traitement, d.fmp4),
    { cwd: dossier, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  passe.processus = processus;
  processus.stderr?.resume();
  d.passes.push(passe);
  session.processus = processus;
  d.dernierSegment = Date.now();
  processus.once("exit", () => { if (!session.arretee && session.processus === processus) void relancer(session, passe); });
  processus.once("error", () => { if (!session.arretee && session.processus === processus) void relancer(session, passe); });
}

/**
 * Une passe s'est arrêtée ou s'est tue : la diffusion repart, sur la même source puis la suivante.
 * Une conversion matérielle qui n'a produit aucun segment repart en logiciel. Au-delà de six relances
 * en deux minutes, la chaîne est déclarée injoignable.
 */
async function relancer(session: Conversion, passe: Passe) {
  const d = session.diffusion!;
  if (session.arretee) return;
  await tuer(passe.processus);
  const maintenant = Date.now();
  d.relances = [...d.relances.filter((t) => maintenant - t < 120_000), maintenant];
  if (d.relances.length > 6) { void arreter(session); return; }
  if (passe.segments === 0 && d.traitement.encodeur === "vaapi") {
    // Le circuit vidéo a refusé ce flux : le même traitement en logiciel, à 720p au plus.
    d.traitement = { ...d.traitement, ...choisirTraitementLive(null, { hauteurMax: d.traitement.hauteur, hevc: false }, false),
      flux: d.traitement.flux, fluxAudio: d.traitement.fluxAudio, entrelace: d.traitement.entrelace };
  } else if (passe.segments === 0 || maintenant - passe.debut < 20_000) {
    d.rang = (d.rang + 1) % d.sources.length;
  }
  try { await lancerPasse(session); } catch { void arreter(session); }
}

/** Relève les nouveaux segments de la passe courante, borne la fenêtre et surveille le silence. */
async function releverSegments(session: Conversion) {
  const d = session.diffusion!, passe = d.passes.at(-1);
  if (!passe || session.arretee) return;
  const texte = await readFile(path.join(passe.dossier, "live.m3u8"), "utf8").catch(() => "");
  const connus = new Set(d.segments.filter((s) => s.passe === passe.numero).map((s) => s.nom));
  for (const s of segmentsDeLaListe(texte)) {
    if (connus.has(s.nom)) continue;
    d.segments.push({ passe: passe.numero, ...s }); passe.segments++; d.dernierSegment = Date.now();
  }
  while (d.segments.length > FENETRE_DIFFUSION) {
    const retire = d.segments.shift()!; d.retires++;
    if (d.segments[0] && d.segments[0].passe !== retire.passe) d.ruptures++;
  }
  // Les passes dont plus aucun segment n'est servi sont effacées.
  const actives = new Set(d.segments.map((s) => s.passe));
  for (const ancienne of d.passes.filter((p) => p !== passe && !actives.has(p.numero))) {
    d.passes = d.passes.filter((p) => p !== ancienne);
    await rm(ancienne.dossier, { recursive: true, force: true }).catch(() => undefined);
  }
  if (Date.now() - d.dernierSegment > SILENCE_MAX_MS && session.processus === passe.processus) void relancer(session, passe);
}

export interface OptionsConversionLive {
  copieVideo?: boolean;
  /** La conversion est destinée à un téléviseur : réserve, relances et liste composée. */
  diffusion?: boolean;
  /** Ce que le récepteur lit : la source est alors analysée, puis copiée ou convertie pour lui. */
  recepteur?: RecepteurLive;
  /** Les autres sources de la chaîne, essayées quand la première se tait. */
  secours?: string[];
}

export async function commencerConversionLive(profil: string, chaine: string, source: string, lecture: string, signal?: AbortSignal, options: OptionsConversionLive = {}) {
  signal?.throwIfAborted();
  for (const s of sessions.values()) if (Date.now() - s.acces > 60_000) await arreter(s);
  for (const s of sessions.values()) if (s.profil === profil && s.lecture === lecture) await arreter(s);
  if (sessions.size >= maximum || freemem() < 512 * 1024 * 1024) throw new Error("Conversion occupée ou mémoire insuffisante");
  const admission = decideAdmission({ mode: options.copieVideo ? "remux" : "transcode", variants: [{ width: 1280, height: 720 }], frameRate: 30 }, currentAdmissionState());
  if (!admission.accepted || admission.degraded) throw new Error("Capacité de conversion insuffisante");
  const id = randomUUID();
  const session: Conversion = { id, profil, chaine, source, lecture, dossier: path.join(racine, id), acces: Date.now(), arretee: false, copieVideo: options.copieVideo };
  // Réservation avant le premier await : deux demandes ne peuvent pas dépasser la limite.
  sessions.set(id, session);
  registerSessionCost(id, { id, mediaId: chaine, mode: options.copieVideo ? "remux" : "transcode", encoder: options.copieVideo ? "copy" : "libx264", costUnits: admission.costUnits });
  try {
    await mkdir(session.dossier, { recursive: true });
    signal?.throwIfAborted();
    const format = await formatLive(source);
    signal?.throwIfAborted();
    if (session.arretee) throw new Error("Conversion annulée");
    session.entree = await ouvrirEntreeLive(source);
    signal?.throwIfAborted();
    if (session.arretee) { await session.entree.fermer(); throw new Error("Conversion annulée"); }
    if (options.recepteur) return await commencerDiffusion(session, format, options, signal);
    const processus = spawn(config.ffmpegPath, argumentsConversionLive(session.entree.url, session.dossier, format, options.copieVideo, options.diffusion), {
      cwd: session.dossier, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    });
    session.processus = processus;
    // Les messages FFmpeg peuvent contenir des URL privées : ils ne sont ni journalisés ni retournés.
    processus.stderr?.resume();
    let erreur = false;
    processus.once("error", () => { erreur = true; void arreter(session); });
    processus.once("exit", () => { erreur = true; if (!session.arretee) void arreter(session); });
    session.timer = setInterval(() => {
      if (Date.now() - session.acces > 60_000) { void arreter(session); return; }
      // Le stockage reste borné même si le fournisseur empêche la rotation normale des segments.
      void readdir(session.dossier).then(async (noms) => {
        const tailles = await Promise.all(noms.map((nom) => stat(path.join(session.dossier, nom)).then((s) => s.size).catch(() => 0)));
        if (tailles.reduce((a, b) => a + b, 0) > (session.copieVideo ? 1024 : 128) * 1024 * 1024) await arreter(session);
      }).catch(() => undefined);
    }, 10_000); session.timer.unref();
    const limite = Date.now() + 30_000;
    while (!session.arretee && !erreur && Date.now() < limite) {
      signal?.throwIfAborted();
      const manifeste = await readFile(path.join(session.dossier, "live.m3u8"), "utf8").catch(() => "");
      // Un téléviseur démarre avec trois segments d'avance, le lecteur local avec deux comme avant.
      if ((manifeste.match(/#EXTINF/g) ?? []).length >= (options.diffusion ? 3 : 2)) return { id, url: `/api/live/compat/${id}/live.m3u8`, mode: "compatibilite" as const };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Ce flux ne peut pas être converti");
  } catch (cause) { await arreter(session); throw cause; }
}

/** Une conversion pour un téléviseur : analyse de la source, traitement choisi, relances surveillées. */
async function commencerDiffusion(session: Conversion, format: FormatLive, options: OptionsConversionLive, signal?: AbortSignal) {
  const materiel = calibratedAccelerator() === "vaapi";
  const { entree, analyse } = await preparerEntreeDiffusion(session.entree!.url, format, options.recepteur!, materiel);
  signal?.throwIfAborted();
  const traitement = choisirTraitementLive(analyse, options.recepteur!, materiel);
  session.copieVideo = traitement.copie;
  session.diffusion = { sources: [session.source, ...(options.secours ?? []).filter((s) => s !== session.source)], rang: 0, format,
    traitement, fmp4: traitement.copie, recepteur: options.recepteur!, materiel, entree,
    passes: [], segments: [], retires: 0, ruptures: 0, relances: [], dernierSegment: Date.now() };
  await lancerPasse(session);
  session.diffusion.lecteur = setInterval(() => { void releverSegments(session).catch(() => undefined); }, 1000);
  session.diffusion.lecteur.unref();
  session.timer = setInterval(() => { if (Date.now() - session.acces > 60_000) void arreter(session); }, 10_000); session.timer.unref();
  const limite = Date.now() + 45_000;
  while (!session.arretee && Date.now() < limite) {
    signal?.throwIfAborted();
    // Trois segments d'avance avant de lancer le téléviseur, comme pour la r7.
    if (session.diffusion.segments.length >= 3) {
      return { id: session.id, url: `/api/live/compat/${session.id}/live.m3u8`, mode: "compatibilite" as const,
        qualite: session.diffusion.traitement.libelle, fmp4: session.diffusion.fmp4 };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Ce flux ne peut pas être converti");
}

/** La liste composée d'une diffusion, ou `null` pour une conversion locale qui garde celle de FFmpeg. */
export function listeConversionLive(profil: string, id: string): string | null {
  const session = sessions.get(id);
  if (!session?.diffusion || session.profil !== profil || session.arretee) return null;
  session.acces = Date.now();
  return composerListe(session.diffusion);
}

/** Les segments servis à un téléviseur, dans l'ordre : de quoi faire un MPEG-TS continu en DLNA. */
export function segmentsConversionLive(profil: string, id: string): Array<{ nom: string; chemin: string }> | null {
  const session = sessions.get(id);
  if (!session?.diffusion || session.profil !== profil || session.arretee) return null;
  session.acces = Date.now();
  return session.diffusion.segments.map((s) => ({ nom: `p${s.passe}-${s.nom}`, chemin: path.join(session.dossier, `p${s.passe}`, s.nom) }));
}

export async function fichierConversionLive(profil: string, id: string, fichier: string) {
  const session = sessions.get(id);
  if (!session || session.profil !== profil || session.arretee) return null;
  const passe = /^p(\d{1,6})-(init\.mp4|segment\d{9}\.(?:ts|m4s))$/.exec(fichier);
  if (session.diffusion && passe) {
    session.acces = Date.now();
    return { chemin: path.join(session.dossier, `p${passe[1]}`, passe[2]!), type: passe[2]!.endsWith(".ts") ? "video/mp2t" : "video/mp4" };
  }
  if (!/^(live\.m3u8|init\.mp4|segment\d{9}\.(?:ts|m4s))$/.test(fichier)) return null;
  session.acces = Date.now();
  return { chemin: path.join(session.dossier, fichier), type: fichier.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : fichier.endsWith(".ts") ? "video/mp2t" : "video/mp4" };
}
export async function arreterConversionLive(profil: string, id: string) {
  const session = sessions.get(id);
  if (session?.profil === profil) await arreter(session);
}
export async function fermerConversionsLive() { await Promise.all([...sessions.values()].map(arreter)); }
