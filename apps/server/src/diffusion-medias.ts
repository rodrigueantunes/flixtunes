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
import { commencerConversionLive, fichierConversionLive, arreterConversionLive, listeConversionLive, segmentsConversionLive } from "./live-compat.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { ipv4Privee } from "./diffusion-reseau.js";
import type { MetadonneesDiffusion } from "./diffusion-cast.js";

/** Ce que la préparation doit produire pour un niveau du plan de qualité. */
export interface OptionsPreparation {
  compatible?: boolean; qualiteSource?: boolean;
  /** Plafond de la conversion H.264 : 1080 ou 720, selon ce que le récepteur accepte. */
  hauteurMax?: number;
  /** Pour la copie : jusqu'où le récepteur lit le HEVC, et s'il lit le HDR. */
  hevcHauteurMax?: number; hdr?: boolean;
  /** Le flux est destiné à un téléviseur DLNA qui ne lit pas le HLS : MPEG-TS continu. */
  tsContinu?: boolean;
  /** Le fichier d'origine, servi tel quel : le téléviseur DLNA a déclaré savoir lire son conteneur. */
  fichierTelQuel?: boolean;
  signal?: AbortSignal;
}

export interface MediaDiffuse {
  cle: string; profil: string; contenu: ContenuDiffuse; url: string; mime: string; position: number;
  session: string | null; direct: boolean; fichier: string | null; expire: number; vu: number;
  decalage: number; duree: number;
  requetes?: number; segmentsFmp4?: boolean; qualite?: string;
  /** Ce que le téléviseur affiche : affiche, titre, épisode ou chaîne. */
  metadonnees?: MetadonneesDiffusion;
  /** Le nom sous lequel le fichier d'origine est servi, extension comprise. */
  nomFichier?: string;
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
  async preparer(profil: string, demande: ContenuDiffuse, origine: string, position: number, options: OptionsPreparation = {}): Promise<MediaDiffuse> {
    const contenu = contenuAutorise(profil, demande); if (!contenu) throw new Error("Contenu inaccessible à ce profil");
    // Caster depuis le générique de fin repart du début : une conversion lancée au-delà de la dernière
    // image ne produit rien, et la préparation attendait son délai complet sur un écran figé.
    position = positionDeDepart(position, contenu.genre === "direct" ? 0 : getMediaItem(profil, contenu.id)?.runtimeSeconds ?? 0);
    await this.purger();
    if (this.medias.size + this.reservations >= 12) throw new Error("Trop de diffusions simultanées");
    this.reservations++;
    const cle = randomBytes(32).toString("hex");
    let session: string | null = null;
    const direct = contenu.genre === "direct";
    try {
      let fichier: string | null = null, nom = "index.m3u8", type = "application/vnd.apple.mpegurl", decalage = 0;
      let qualiteLive: string | undefined, fmp4Live = false;
      if (options.fichierTelQuel && !direct) {
        const row = db.prepare("SELECT file_path FROM media_items WHERE id = ? AND available = 1").get(contenu.id) as { file_path: string } | undefined;
        if (!row?.file_path) throw new Error("Fichier indisponible");
        fichier = row.file_path; nom = nomDuFichier(fichier); type = mimeDuFichier(fichier);
      } else if (direct) {
        const toutes = chaineDetaillee(contenu.id)?.sources ?? [];
        const sources = toutes.slice(0, 3);
        if (!sources.length) throw new Error("Aucune source disponible pour cette chaîne");
        // Pour un téléviseur, la source est analysée puis copiée ou convertie pour lui ; les autres
        // sources servent de secours si elle se tait pendant la lecture.
        const secours = toutes.slice(0, 8).map((s) => s.url);
        const recepteur = { hauteurMax: Math.min(1080, options.hauteurMax ?? 1080), hevc: (options.hevcHauteurMax ?? 0) >= 1080,
          conversionSeule: !!options.tsContinu };
        const signal = options.signal ? AbortSignal.any([AbortSignal.timeout(45_000), options.signal]) : AbortSignal.timeout(45_000);
        let derniereErreur: unknown;
        for (const source of sources) {
          try {
            const s = await commencerConversionLive(profil, contenu.id, source.url, `cast-${randomUUID()}`, signal,
              options.qualiteSource ? { diffusion: true, recepteur, secours } : { copieVideo: false, diffusion: true });
            session = s.id; qualiteLive = "qualite" in s ? s.qualite : undefined; fmp4Live = "fmp4" in s ? s.fmp4 : false; break;
          }
          catch (e) { derniereErreur = e; options.signal?.throwIfAborted(); if (/occupée|insuffisante/i.test(e instanceof Error ? e.message : "")) throw e; if (signal.aborted) break; }
        }
        if (!session) throw new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE", derniereErreur instanceof Error ? derniereErreur.message : "Aucune source de cette chaîne ne démarre", true);
        nom = "live.m3u8";
      } else {
        const hauteur = Math.min(1080, options.hauteurMax ?? 1080), largeur = Math.round(hauteur * 16 / 9);
        const hevcHauteur = options.hevcHauteurMax ?? 2160;
        const caps = playbackCapabilitiesSchema.parse({ containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac", "mp3"],
          hls: true, hdr: false, maxWidth: largeur, maxHeight: hauteur, maxAudioChannels: 2,
          hlsSegmentContainer: "mpegts", streamingProtocol: "hls", adaptiveStreaming: false,
          deviceClass: "tv", seekableTrackHeaders: false, dynamicRangePreference: "sdr",
          ...(options.qualiteSource ? { containers: ["mp4", "webm"], videoCodecs: ["h264", "hevc", "vp9", "vp8", "av1"],
            hdr: options.hdr !== false, hdrFormats: options.hdr === false ? [] : ["hdr10", "hlg"],
            maxWidth: Math.round(hevcHauteur * 16 / 9), maxHeight: hevcHauteur,
            hlsSegmentContainer: "fmp4", dynamicRangePreference: options.hdr === false ? "sdr" : "auto" } : {}),
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
                if (secondes === 0 && texte.includes("#EXT-X-ENDLIST")) throw new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE",
                  "La conversion s’est terminée sans produire d’image à cette position.", false);
              } catch (e) { if (e instanceof ErreurPreparationDiffusion) throw e; /* Manifeste en cours de publication. */ }
            } else if (s.status === "completed") {
              throw new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE", "La conversion s’est terminée sans produire de vidéo.", false);
            }
            if (tamponPret) break;
          }
          options.signal?.throwIfAborted();
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
          if (!row?.file_path) throw new Error("Fichier indisponible"); fichier = row.file_path; nom = nomDuFichier(fichier); type = mimeDuFichier(fichier);
        } else { nom = new URL(s.url, "http://local").pathname.split("/").at(-1)!; decalage = s.startOffsetSeconds ?? 0; }
      }
      const media: MediaDiffuse = { cle, profil, contenu, session, direct, fichier, mime: type, position: direct ? 0 : Math.max(0, position - decalage), decalage,
        duree: direct ? 0 : getMediaItem(profil, contenu.id)?.runtimeSeconds ?? 0,
        segmentsFmp4: direct ? fmp4Live : !!options.qualiteSource && !fichier, nomFichier: fichier ? nom : undefined,
        metadonnees: metadonneesPour(profil, contenu, origine),
        qualite: direct ? qualiteLive ?? "Conversion compatible · 720p maximum"
          : options.qualiteSource ? "Vidéo source conservée" : options.compatible ? "Conversion compatible · 720p maximum" : "Conversion · 1080p maximum",
        url: `${origine}/api/diffusion/flux/${cle}/${options.tsContinu && session && (direct ? !fmp4Live : !options.qualiteSource) ? "continu.ts" : nom}`,
        expire: Date.now() + 12 * 3600_000, vu: Date.now() };
      if (options.tsContinu && session && (direct ? !fmp4Live : !options.qualiteSource)) media.mime = "video/mp2t";
      this.medias.set(cle, media); return media;
    } catch (e) { if (session) { if (direct) await arreterConversionLive(profil, session); else await stopPlaybackSession(session); } throw e; }
    finally { this.reservations--; }
  }
  /**
   * Les secondes de vidéo déjà prêtes depuis le début de la conversion. Un déplacement qui tombe
   * dedans se fait sur le récepteur, sans relancer une conversion.
   */
  async dureePreparee(cle: string): Promise<number> {
    const m = this.medias.get(cle);
    if (!m || m.direct) return 0;
    if (m.fichier) return Number.POSITIVE_INFINITY;
    const manifeste = m.session ? getPlaybackFile(m.session, "manifest.m3u8") : null;
    if (!manifeste) return 0;
    try {
      const texte = await readFile(manifeste.path, "utf8");
      return [...texte.matchAll(/^#EXTINF:([0-9.]+),/gm)].reduce((total, r) => total + Number(r[1]), 0);
    } catch { return 0; }
  }
  /**
   * Les segments MPEG-TS de la conversion, mis bout à bout dans une seule réponse au fil de leur
   * production. La plupart des téléviseurs DLNA ne lisent pas le HLS, mais presque tous lisent un
   * MPEG-TS servi en continu.
   */
  private async servirContinu(m: MediaDiffuse, reply: FastifyReply) {
    const session = m.session!;
    reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "no-store").type("video/mp2t");
    const self = this;
    if (m.direct) {
      // Le direct d'un téléviseur DLNA : les segments de la liste composée, au fil de leur arrivée,
      // à partir des trois derniers — le téléviseur démarre près du direct, avec une petite réserve.
      async function* direct() {
        const servis = new Set<string>(); let attente = 0, premier = true;
        while (attente < 30) {
          if (!self.medias.has(m.cle)) return;
          const segments = segmentsConversionLive(m.profil, session);
          if (!segments) return;
          const nouveaux = (premier ? segments.slice(-3) : segments).filter((seg) => !servis.has(seg.nom));
          premier = false;
          if (!nouveaux.length) { attente++; await new Promise((r) => setTimeout(r, 500)); continue; }
          for (const seg of nouveaux) {
            servis.add(seg.nom); m.vu = Date.now(); attente = 0;
            try { yield await readFile(seg.chemin); } catch { /* segment déjà retiré : le suivant suit */ }
          }
          for (const nom of servis) if (!segments.some((seg) => seg.nom === nom)) servis.delete(nom);
        }
      }
      const { Readable } = await import("node:stream");
      return reply.send(Readable.from(direct()));
    }
    async function* morceaux() {
      let rang = 0, attente = 0;
      while (attente < 60) {
        if (!self.medias.has(m.cle)) return;
        const manifeste = getPlaybackFile(session, "manifest.m3u8");
        const texte = manifeste ? await readFile(manifeste.path, "utf8").catch(() => "") : "";
        const segments = texte.split(/\r?\n/).filter((ligne) => ligne && !ligne.startsWith("#"));
        if (rang < segments.length) {
          const fichier = getPlaybackFile(session, segments[rang]!);
          if (fichier) { m.vu = Date.now(); yield await readFile(fichier.path); }
          rang++; attente = 0; continue;
        }
        if (texte.includes("#EXT-X-ENDLIST")) return;
        attente++; await new Promise((r) => setTimeout(r, 1000));
      }
    }
    const { Readable } = await import("node:stream");
    return reply.send(Readable.from(morceaux()));
  }
  async servir(cle: string, nom: string, request: FastifyRequest, reply: FastifyReply) {
    const m = this.medias.get(cle);
    if (!m || m.expire < Date.now() || !contenuAutorise(m.profil, m.contenu) || !/^[\w.-]{1,160}$/.test(nom) || nom.includes("..")) {
      return reply.code(404).send({ message: "Diffusion expirée" });
    }
    m.vu = Date.now();
    m.requetes = (m.requetes ?? 0) + 1;
    if (nom === "continu.ts" && m.session && !m.fichier) return this.servirContinu(m, reply);
    // Le direct d'un téléviseur : la liste composée des passes, qui survit aux relances de la conversion.
    if (m.direct && m.session && nom === "live.m3u8") {
      const liste = listeConversionLive(m.profil, m.session);
      if (liste) return reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "no-store")
        .type("application/vnd.apple.mpegurl").send(liste);
    }
    const file = m.fichier ? (nom === (m.nomFichier ?? "media.mp4") ? { path: m.fichier, contentType: m.mime } : null)
      : m.direct ? await fichierConversionLive(m.profil, m.session!, nom).then((f) => f && ({ path: f.chemin, contentType: f.type }))
      : getPlaybackFile(m.session!, nom);
    if (!file) return reply.code(404).send();
    // Un téléviseur DLNA demande les caractéristiques du flux avant de le lire ; sans réponse, certains
    // refusent de lancer la lecture ou de se déplacer dedans.
    if (request.headers["getcontentfeatures.dlna.org"]) {
      reply.header("contentFeatures.dlna.org", fonctionnalitesDlna(m.fichier != null)).header("transferMode.dlna.org", "Streaming");
    }
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
        return reply.send(m.direct ? texte : listeEvenement(texte));
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

/**
 * Déclare une conversion en cours comme un événement qui commence au début.
 *
 * Une liste HLS qui grandit sans `#EXT-X-ENDLIST` ressemble à un direct. Banc du 2 octobre 2026 sur la
 * Pixel Tablet : le lecteur Cast démarrait au deuxième segment, puis sautait de 8 à 18 s dès qu'une
 * mise à jour de la liste ajoutait plusieurs segments d'un coup. La personne perdait des passages du
 * film. Avec `EVENT` et `EXT-X-START` à zéro, la lecture part du début et suit le film au temps réel.
 */
export function listeEvenement(texte: string): string {
  if (/^#EXT-X-PLAYLIST-TYPE:/m.test(texte)) return texte;
  return texte.replace(/^#EXT-X-TARGETDURATION:/m, (debut) => `#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n${debut}`);
}

/** La position de départ d'une diffusion : dans les dix dernières secondes, le film repart du début. */
export function positionDeDepart(position: number, duree: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  return duree > 0 && position > duree - 10 ? 0 : position;
}

/** Le nom servi pour un fichier d'origine : `media` et son extension, rien d'autre du chemin. */
export function nomDuFichier(chemin: string): string {
  const extension = /\.([a-z0-9]{2,5})$/i.exec(chemin)?.[1]?.toLowerCase() ?? "mp4";
  return `media.${extension}`;
}
const TYPES_VIDEO: Record<string, string> = { mkv: "video/x-matroska", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
  ts: "video/mp2t", m2ts: "video/mp2t", webm: "video/webm", avi: "video/x-msvideo" };
export function mimeDuFichier(chemin: string): string {
  const extension = nomDuFichier(chemin).slice("media.".length);
  return TYPES_VIDEO[extension] ?? (mime.lookup(chemin) || "video/mp4");
}
/**
 * Les drapeaux DLNA d'un flux : un fichier se lit par plages (déplacement possible), une conversion
 * en continu se lit d'un trait.
 */
export function fonctionnalitesDlna(fichier: boolean): string {
  return `DLNA.ORG_OP=${fichier ? "01" : "00"};DLNA.ORG_CI=${fichier ? "0" : "1"};DLNA.ORG_FLAGS=${fichier ? "01700000" : "01300000"}000000000000000000000000`;
}
/** Ce que le téléviseur affiche : l'affiche servie par le NAS, le titre, l'épisode ou la chaîne. */
export function metadonneesPour(profil: string, contenu: ContenuDiffuse, origine: string): MetadonneesDiffusion {
  const image = (url: string | null | undefined) => !url ? undefined : url.startsWith("/") ? `${origine}${url}` : /^https?:\/\//.test(url) ? url : undefined;
  if (contenu.genre === "direct") {
    const chaine = chaineDetaillee(contenu.id);
    return { genre: "direct", titre: chaine?.nom ?? contenu.titre, sousTitre: "En direct", image: image(chaine?.logo) };
  }
  const m = getMediaItem(profil, contenu.id);
  if (!m) return { genre: "film", titre: contenu.titre };
  if (m.kind === "episode") return { genre: "episode", titre: m.title, serie: m.showTitle ?? undefined,
    saison: m.seasonNumber ?? undefined, episode: m.episodeNumber ?? undefined, image: image(m.posterUrl) };
  if (m.kind === "video") return { genre: "video", titre: m.title, sousTitre: m.showTitle ?? undefined, image: image(m.posterUrl) };
  return { genre: "film", titre: m.title, annee: m.year ?? undefined, image: image(m.posterUrl) };
}
