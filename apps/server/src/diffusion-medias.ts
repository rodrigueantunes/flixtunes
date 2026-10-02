import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import mime from "mime-types";
import { playbackCapabilitiesSchema, type ContenuDiffuse } from "@flixtunes/contracts";
import { db, getProfile } from "./database.js";
import { getMediaItem } from "./catalog-view.js";
import { chaineDetaillee } from "./television-direct.js";
import { createPlaybackSession, getPlaybackInfo, decidePlayback, getPlaybackSession, getPlaybackFile, stopPlaybackSession } from "./playback.js";
import { commencerConversionLive, fichierConversionLive, arreterConversionLive } from "./live-compat.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { ipv4Privee } from "./diffusion-reseau.js";

export interface MediaDiffuse {
  cle: string; profil: string; contenu: ContenuDiffuse; url: string; mime: string; position: number;
  session: string | null; direct: boolean; fichier: string | null; expire: number; vu: number;
  decalage: number; duree: number;
  requetes?: number; segmentsFmp4?: boolean; qualite?: string;
}
export function contenuAutorise(profil: string, contenu: ContenuDiffuse): ContenuDiffuse | null {
  if (!getProfile(profil)) return null;
  if (contenu.genre === "direct") { const c = chaineDetaillee(contenu.id); return c ? { ...contenu, titre: c.nom } : null; }
  const m = getMediaItem(profil, contenu.id); return m ? { ...contenu, titre: m.title } : null;
}
/** Adresse annoncée au récepteur. On n'utilise jamais localhost ni une origine arbitraire reçue
 * dans le corps d'une requête. Un conteneur peut annoncer l'IP LAN du NAS via cette variable. */
export function origineDiffusion(host: string, protocole = "http", adresseLocale?: string, portLocal?: number): string {
  const url = new URL(process.env.FLIXTUNES_CAST_BASE_URL || `${protocole === "https" ? "https" : "http"}://${host}`);
  const ipLocale = adresseLocale?.replace(/^::ffff:/, "");
  // Une application ouverte par un nom local ne doit pas annoncer ce nom à un téléviseur qui
  // utilise un autre DNS. L'adresse vient de la socket acceptée par le NAS, jamais du corps client.
  if (!process.env.FLIXTUNES_CAST_BASE_URL && !ipv4Privee(url.hostname) && ipLocale && ipv4Privee(ipLocale) && protocole !== "https") {
    url.hostname = ipLocale; if (portLocal) url.port = String(portLocal);
  }
  if (!ipv4Privee(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Ouvrez FlixTunes par l’adresse IP locale du NAS, ou configurez FLIXTUNES_CAST_BASE_URL.");
  }
  return url.origin;
}
export class MediasDiffusion {
  private medias = new Map<string, MediaDiffuse>(); private reservations = 0;
  private timer = setInterval(() => { void this.purger(); }, 30_000);
  constructor() { this.timer.unref(); }
  async preparer(profil: string, demande: ContenuDiffuse, origine: string, position: number, options: { compatible?: boolean; qualiteSource?: boolean } = {}): Promise<MediaDiffuse> {
    const contenu = contenuAutorise(profil, demande); if (!contenu) throw new Error("Contenu inaccessible à ce profil");
    await this.purger();
    if (this.medias.size + this.reservations >= 12) throw new Error("Trop de diffusions simultanées");
    this.reservations++;
    const cle = randomBytes(32).toString("hex");
    let session: string | null = null;
    const direct = contenu.genre === "direct";
    try {
      let fichier: string | null = null, nom = "index.m3u8", type = "application/vnd.apple.mpegurl", decalage = 0;
      if (direct) {
        const sources = chaineDetaillee(contenu.id)?.sources.slice(0, 3) ?? [];
        if (!sources.length) throw new Error("Aucune source disponible pour cette chaîne");
        const signal = AbortSignal.timeout(45_000); let derniereErreur: unknown;
        for (const source of sources) {
          try { const s = await commencerConversionLive(profil, contenu.id, source.url, `cast-${randomUUID()}`, signal, { copieVideo: options.qualiteSource === true }); session = s.id; break; }
          catch (e) { derniereErreur = e; if (/occupée|insuffisante/i.test(e instanceof Error ? e.message : "")) throw e; if (signal.aborted) break; }
        }
        if (!session) throw new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE", derniereErreur instanceof Error ? derniereErreur.message : "Aucune source de cette chaîne ne démarre", true);
        nom = "live.m3u8";
      } else {
        const caps = playbackCapabilitiesSchema.parse({ containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac", "mp3"],
          hls: true, hdr: false, maxWidth: 1920, maxHeight: 1080, maxAudioChannels: 2,
          hlsSegmentContainer: "mpegts", streamingProtocol: "hls", adaptiveStreaming: false,
          deviceClass: "tv", seekableTrackHeaders: false, dynamicRangePreference: "sdr",
          ...(options.qualiteSource ? { containers: ["mp4", "webm"], videoCodecs: ["h264", "hevc", "vp9", "vp8", "av1"],
            hdr: true, hdrFormats: ["hdr10", "hlg"], maxWidth: 3840, maxHeight: 2160,
            hlsSegmentContainer: "fmp4", dynamicRangePreference: "auto" } : {}),
          ...(options.compatible ? { modePreference: "compatible", audioOutputMode: "aac", maxWidth: 1280, maxHeight: 720, maxVideoBitrate: 4_000_000 } : {}),
          deviceId: `cast-${cle}`, startSeconds: Math.min(position, 86400),
          preferredAudioLanguages: getProfile(profil)?.preferredAudioLanguages });
        if (options.qualiteSource) {
          const info = await getPlaybackInfo(contenu.id);
          if (!info || decidePlayback(info, caps).transcodeVideo) throw new ErreurPreparationDiffusion(
            "CAST_PREPARATION_ECHOUEE", "Cette source nécessite une conversion compatible.", true);
        }
        let s = await createPlaybackSession(contenu.id, caps, { essaiDirect: false, diffusion: true }); if (!s) throw new Error("Média indisponible");
        session = s.id;
        const limite = Date.now() + (options.qualiteSource ? 30_000 : 90_000);
        let tamponPret = s.mode === "direct";
        while (session && ["starting", "ready", "completed"].includes(s.status) && Date.now() < limite) {
          if (s.status !== "starting" && s.url) {
            const manifeste = getPlaybackFile(session, "manifest.m3u8");
            if (manifeste) {
              try {
                const texte = await readFile(manifeste.path, "utf8");
                const durees = [...texte.matchAll(/^#EXTINF:([0-9.]+),/gm)].map(m => Number(m[1]));
                const secondes = durees.reduce((a, b) => a + b, 0);
                // Un premier segment seul peut faire annoncer PLAYING puis vider aussitôt le tampon.
                tamponPret = secondes >= 6 || (secondes > 0 && texte.includes("#EXT-X-ENDLIST"));
              } catch { /* Manifeste en cours de publication. */ }
            }
            if (tamponPret) break;
          }
          await new Promise((r) => setTimeout(r, 400)); s = await getPlaybackSession(session) ?? { ...s, status: "failed", error: "La session de conversion a disparu." };
        }
        if (!s.url || !["ready", "completed"].includes(s.status) || !tamponPret) {
          if (["starting", "ready", "completed"].includes(s.status) && session) throw new ErreurPreparationDiffusion("CAST_PREPARATION_DELAI",
            "Le NAS n’a pas préparé assez de vidéo pour démarrer sans vider immédiatement le tampon.", !!session);
          throw new ErreurPreparationDiffusion(session ? "CAST_PREPARATION_ECHOUEE" : "CAST_PREPARATION_REFUSEE",
            s.error || "Le NAS n’a pas pu préparer cette vidéo.", !!session);
        }
        if (s.mode === "direct") {
          const row = db.prepare("SELECT file_path FROM media_items WHERE id = ? AND available = 1").get(contenu.id) as { file_path: string } | undefined;
          if (!row?.file_path) throw new Error("Fichier indisponible"); fichier = row.file_path; nom = "media.mp4"; type = mime.lookup(fichier) || "video/mp4";
        } else { nom = new URL(s.url, "http://local").pathname.split("/").at(-1)!; decalage = s.startOffsetSeconds ?? 0; }
      }
      const media: MediaDiffuse = { cle, profil, contenu, session, direct, fichier, mime: type, position: direct ? 0 : Math.max(0, position - decalage), decalage,
        duree: direct ? 0 : getMediaItem(profil, contenu.id)?.runtimeSeconds ?? 0,
        segmentsFmp4: !!options.qualiteSource && !fichier, qualite: options.qualiteSource ? "Vidéo source conservée" : options.compatible || direct ? "Conversion compatible · 720p maximum" : "Conversion · 1080p maximum",
        url: `${origine}/api/diffusion/flux/${cle}/${nom}`, expire: Date.now() + 12 * 3600_000, vu: Date.now() };
      this.medias.set(cle, media); return media;
    } catch (e) { if (session) { if (direct) await arreterConversionLive(profil, session); else await stopPlaybackSession(session); } throw e; }
    finally { this.reservations--; }
  }
  async servir(cle: string, nom: string, request: FastifyRequest, reply: FastifyReply) {
    const m = this.medias.get(cle);
    if (!m || m.expire < Date.now() || !contenuAutorise(m.profil, m.contenu) || !/^[\w.-]{1,160}$/.test(nom) || nom.includes("..")) {
      return reply.code(404).send({ message: "Diffusion expirée" });
    }
    m.vu = Date.now();
    m.requetes = (m.requetes ?? 0) + 1;
    const file = m.fichier ? (nom === "media.mp4" ? { path: m.fichier, contentType: m.mime } : null)
      : m.direct ? await fichierConversionLive(m.profil, m.session!, nom).then((f) => f && ({ path: f.chemin, contentType: f.type }))
      : getPlaybackFile(m.session!, nom);
    if (!file) return reply.code(404).send();
    reply.header("Access-Control-Allow-Origin", "*").header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
      .header("Cache-Control", "private, no-store").header("Referrer-Policy", "no-referrer").type(file.contentType);
    try {
      const info = await stat(file.path);
      if (nom.endsWith(".m3u8")) {
        if (info.size > 1024 * 1024) return reply.code(502).send();
        // FFmpeg écrit des chemins relatifs. On refuse tout URI externe : le jeton est limité à
        // cette conversion, jamais à une URL que le lecteur pourrait choisir lui-même.
        const texte = await readFile(file.path, "utf8");
        for (const ligne of texte.split(/\r?\n/)) {
          if (ligne && !ligne.startsWith("#") && !/^[\w.-]+$/.test(ligne)) return reply.code(502).send();
          for (const match of ligne.matchAll(/URI="([^"]+)"/g)) if (!/^[\w.-]+$/.test(match[1]!)) return reply.code(502).send();
        }
        return reply.send(texte);
      }
      reply.header("Accept-Ranges", "bytes");
      const range = request.headers.range;
      if (!range) return reply.header("Content-Length", info.size).send(createReadStream(file.path));
      const r = /^bytes=(\d*)-(\d*)$/.exec(range);
      const debut = r?.[1] ? Number(r[1]) : Math.max(0, info.size - Number(r?.[2]));
      const fin = r?.[1] && r[2] ? Math.min(Number(r[2]), info.size - 1) : info.size - 1;
      if (!r || (!r[1] && !r[2]) || !Number.isSafeInteger(debut) || !Number.isSafeInteger(fin) || debut < 0 || debut > fin || debut >= info.size) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
      return reply.code(206).header("Content-Range", `bytes ${debut}-${fin}/${info.size}`).header("Content-Length", fin - debut + 1).send(createReadStream(file.path, { start: debut, end: fin }));
    } catch { return reply.code(404).send(); }
  }
  async retirer(cle: string) {
    const m = this.medias.get(cle); this.medias.delete(cle); if (!m?.session) return;
    if (m.direct) await arreterConversionLive(m.profil, m.session); else await stopPlaybackSession(m.session);
  }
  async retirerPourProfil(cle: string, profil: string): Promise<boolean> {
    if (this.medias.get(cle)?.profil !== profil) return false;
    await this.retirer(cle); return true;
  }
  private async purger() { for (const m of this.medias.values()) if (m.expire < Date.now() || (!m.fichier && Date.now() - m.vu > 10 * 60_000)) await this.retirer(m.cle); }
  async fermer() { clearInterval(this.timer); await Promise.all([...this.medias.keys()].map((cle) => this.retirer(cle))); }
}
