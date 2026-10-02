import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { freemem } from "node:os";
import { config } from "./config.js";
import { currentAdmissionState, decideAdmission, registerSessionCost, releaseSessionCost } from "./capacity.js";
import { formatLive, ouvrirEntreeLive, type FormatLive } from "./live-compat-entree.js";

const racine = path.resolve(config.dataDir, "live-compat");
const maximum = Math.max(0, Math.min(2, Number(process.env.FLIXTUNES_LIVE_CONVERSIONS ?? 1) || 0));
interface Conversion {
  id: string; profil: string; chaine: string; source: string; lecture: string; dossier: string;
  processus?: ChildProcess; entree?: Awaited<ReturnType<typeof ouvrirEntreeLive>>;
  acces: number; arretee: boolean; timer?: ReturnType<typeof setInterval>; nettoyage?: Promise<void>; copieVideo?: boolean;
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

export function argumentsConversionLive(entree: string, dossier: string, format: FormatLive, copieVideo = false, diffusion = false): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-filter_threads", "1",
    "-protocol_whitelist", "http,tcp,crypto", "-format_whitelist", "hls,dash,mpegts,mov,aac", "-rw_timeout", "20000000",
    ...(format === "hls" ? ["-live_start_index", diffusion ? String(-RETARD_SOURCE_DIFFUSION) : "-1"] : []),
    ...(format === "ts" || format === "mp4" ? ["-re"] : []),
    "-i", entree, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    ...(copieVideo ? ["-c:v", "copy"] : ["-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-r", "30", "-c:v", "libx264", "-threads", "2",
    "-preset", "veryfast", "-pix_fmt", "yuv420p", "-profile:v", "main", "-b:v", "2200k",
    "-maxrate", "2600k", "-bufsize", "5200k", "-g", "120", "-keyint_min", "120", "-sc_threshold", "0"]),
    "-c:a", "aac", "-ac", "2", "-b:a", "128k", "-f", "hls", "-hls_time", "4",
    ...(copieVideo ? ["-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4"] : []),
    "-hls_list_size", "18", "-hls_delete_threshold", "2", "-hls_flags", "delete_segments+temp_file+independent_segments",
    "-hls_segment_filename", path.join(dossier, copieVideo ? "segment%09d.m4s" : "segment%09d.ts"), path.join(dossier, "live.m3u8")];
}

async function arreter(session: Conversion): Promise<void> {
  if (session.nettoyage) return session.nettoyage;
  session.arretee = true;
  clearInterval(session.timer);
  session.nettoyage = (async () => {
    const processus = session.processus;
    if (processus && processus.exitCode === null && processus.signalCode === null) {
      await new Promise<void>((resolve) => {
        processus.once("close", resolve);
        processus.kill("SIGKILL");
        const timer = setTimeout(resolve, 3_000); timer.unref();
      });
    }
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

export async function commencerConversionLive(profil: string, chaine: string, source: string, lecture: string, signal?: AbortSignal, options: { copieVideo?: boolean; diffusion?: boolean } = {}) {
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

export async function fichierConversionLive(profil: string, id: string, fichier: string) {
  const session = sessions.get(id);
  if (!session || session.profil !== profil || session.arretee || !/^(live\.m3u8|init\.mp4|segment\d{9}\.(?:ts|m4s))$/.test(fichier)) return null;
  session.acces = Date.now();
  return { chemin: path.join(session.dossier, fichier), type: fichier.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : fichier.endsWith(".ts") ? "video/mp2t" : "video/mp4" };
}
export async function arreterConversionLive(profil: string, id: string) {
  const session = sessions.get(id);
  if (session?.profil === profil) await arreter(session);
}
export async function fermerConversionsLive() { await Promise.all([...sessions.values()].map(arreter)); }
