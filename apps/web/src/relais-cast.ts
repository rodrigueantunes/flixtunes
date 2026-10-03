import type { AccuseDiffusion, ActionRelais, EtatDiffusion, MetadonneesRelais, OrdreRelais } from "@flixtunes/contracts";
import { api } from "./api";

/**
 * L'émetteur Cast de Chrome, hors de chez soi (r10).
 *
 * Le NAS ne voit pas les téléviseurs du réseau où l'on se trouve : ce navigateur, si. Il ouvre la
 * session Cast par le sélecteur de Chrome, annonce le téléviseur au NAS comme relais, puis exécute les
 * ordres du NAS — sonder, charger, piloter, libérer — et lui rapporte l'état du téléviseur. Le NAS garde
 * toute la décision : qualité, préparation, replis. L'onglet doit rester ouvert pendant la diffusion.
 */

// Le SDK Cast n'a pas de types publiés dans ce dépôt : ses objets sont manipulés au plus près.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Fenetre = Window & { __onGCastApiAvailable?: (ok: boolean) => void; cast?: any; chrome?: any };
const fenetre = (): Fenetre => window as Fenetre;
const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sdk: Promise<boolean> | null = null;
function chargerSdk(): Promise<boolean> {
  return sdk ??= new Promise<boolean>((resolve) => {
    if (fenetre().cast?.framework) { resolve(true); return; }
    const delai = setTimeout(() => resolve(false), 15_000);
    fenetre().__onGCastApiAvailable = (ok) => { clearTimeout(delai); resolve(ok); };
    const script = document.createElement("script");
    script.src = SDK; script.async = true; script.onerror = () => { clearTimeout(delai); resolve(false); };
    document.head.appendChild(script);
  }).then((ok) => { if (!ok) sdk = null; return ok; });
}

class ErreurRelais extends Error { constructor(public code: string, message: string) { super(message); } }

type Relais = { profil: string; id: string; cle: string; arret: boolean };
let actif: Relais | null = null;

/** Le relais en cours, s'il y en a un : son téléviseur figure parmi les cibles du NAS. */
export const relaisActif = () => actif?.id ?? null;

export function arreterRelais() { if (actif) actif.arret = true; actif = null; }

/**
 * Ouvre le sélecteur Cast de Chrome, puis annonce au NAS le téléviseur choisi. Rend l'identifiant de
 * la cible, que le panneau sélectionne aussitôt.
 */
export async function choisirTeleviseurChrome(profil: string): Promise<string> {
  if (!await chargerSdk()) throw new Error("L’émetteur Cast de Chrome n’a pas pu se charger. Vérifiez la connexion, puis réessayez.");
  const { cast, chrome } = fenetre();
  const contexte = cast.framework.CastContext.getInstance();
  contexte.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
  try {
    const erreur = await contexte.requestSession();
    if (erreur) throw erreur;
  } catch (e) {
    throw new Error(e === "cancel" ? "Aucun téléviseur choisi." : `Chrome n’a pas ouvert la session Cast (${String(e)}).`);
  }
  const appareil = contexte.getCurrentSession()?.getCastDevice();
  if (!appareil) throw new Error("La session Cast s’est refermée aussitôt.");
  arreterRelais();
  const inscription = await api.diffusion<{ id: string; cle: string }>(profil, "relais", {
    nom: String(appareil.friendlyName || "Téléviseur").slice(0, 120), modele: appareil.modelName ? String(appareil.modelName).slice(0, 120) : undefined });
  const relais: Relais = { profil, ...inscription, arret: false };
  actif = relais;
  contexte.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e: any) => {
    // La session fermée depuis Chrome ou le téléviseur : le relais se tait, le NAS l'oublie en 30 s.
    if (e.sessionState === cast.framework.SessionState.SESSION_ENDED && actif === relais) {
      // Un dernier battement rapporte l'arrêt, pour que la diffusion se close tout de suite.
      void battre(relais, contexte, []).catch(() => undefined).finally(() => { relais.arret = true; if (actif === relais) actif = null; });
    }
  });
  void boucle(relais, contexte);
  return relais.id;
}

async function battre(r: Relais, contexte: any, accuses: AccuseDiffusion[]) {
  const { etat, media } = etatSession(contexte);
  return await api.diffusion<{ ordres?: OrdreRelais[] }>(r.profil, `lecteurs/${encodeURIComponent(r.id)}`, { cle: r.cle, etat, accuses, media });
}

async function boucle(r: Relais, contexte: any) {
  const accuses: AccuseDiffusion[] = [];
  let echecs = 0;
  while (!r.arret) {
    try {
      const reponse = await battre(r, contexte, accuses.splice(0));
      echecs = 0;
      for (const ordre of reponse.ordres ?? []) {
        if (!("relais" in ordre)) continue;
        // Un chargement dure jusqu'à 35 s : les battements continuent pendant ce temps.
        void executer(contexte, ordre.relais).then(
          (resultat) => { accuses.push({ id: ordre.id, ok: true, ...resultat }); },
          (e) => { accuses.push({ id: ordre.id, ok: false, code: e instanceof ErreurRelais ? e.code : "CAST_RELAIS",
            erreur: String(e instanceof Error ? e.message : e).slice(0, 300) }); });
      }
    } catch {
      // Le NAS a oublié ce relais, ou ne répond plus : au bout de dix échecs, on arrête de battre.
      if (++echecs >= 10) { r.arret = true; if (actif === r) actif = null; return; }
    }
    await attendre(1000);
  }
}

function etatSession(contexte: any): { etat: Partial<EtatDiffusion>; media?: string } {
  const { chrome } = fenetre();
  const session = contexte.getCurrentSession();
  if (!session) return { etat: { lecture: "repos", motifRepos: "arret" } };
  const volume = Math.min(1, Math.max(0, Number(session.getVolume?.() ?? 1)));
  const m = session.getMediaSession?.();
  if (!m?.media) return { etat: { lecture: "repos", volume } };
  const P = chrome.cast.media.PlayerState, I = chrome.cast.media.IdleReason;
  const lecture = m.playerState === P.PLAYING ? "lecture" : m.playerState === P.PAUSED ? "pause" : m.playerState === P.BUFFERING ? "chargement"
    : m.idleReason === I.ERROR ? "erreur" : "repos";
  const motifRepos = lecture !== "repos" ? undefined : m.idleReason === I.FINISHED ? "fin" : m.idleReason === I.INTERRUPTED ? "tiers" : "arret";
  const borne = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(604800, Math.max(0, n)) : 0; };
  return { etat: { lecture, motifRepos, volume, position: borne(m.getEstimatedTime?.() ?? m.currentTime), duree: borne(m.media.duration),
    ...(lecture === "erreur" ? { erreur: "Le téléviseur a interrompu la lecture" } : {}) }, media: m.media.contentId };
}

function metadonnees(m: MetadonneesRelais): any {
  const { chrome } = fenetre(); const C = chrome.cast.media;
  let md: any;
  if (m.genre === "film") { md = new C.MovieMediaMetadata(); if (m.annee) md.releaseDate = `${m.annee}-01-01`; }
  else if (m.genre === "episode") { md = new C.TvShowMediaMetadata(); md.seriesTitle = m.serie ?? m.titre; md.season = m.saison; md.episode = m.episode; }
  else { md = new C.GenericMediaMetadata(); if (m.sousTitre) md.subtitle = m.sousTitre; }
  md.title = m.titre;
  if (m.image) md.images = [new chrome.cast.Image(m.image)];
  return md;
}

function requete(a: { url: string; mime: string; direct: boolean; position: number; fmp4: boolean; metadonnees: MetadonneesRelais }): any {
  const { chrome } = fenetre(); const C = chrome.cast.media;
  const info = new C.MediaInfo(a.url, a.mime);
  info.contentUrl = a.url;
  info.streamType = a.direct ? C.StreamType.LIVE : C.StreamType.BUFFERED;
  if (a.fmp4) { info.hlsSegmentFormat = C.HlsSegmentFormat.FMP4; info.hlsVideoSegmentFormat = C.HlsVideoSegmentFormat.FMP4; }
  info.metadata = metadonnees(a.metadonnees);
  const req = new C.LoadRequest(info);
  req.autoplay = true; req.currentTime = a.direct ? 0 : a.position;
  return req;
}

/** Attend que le téléviseur lise le média donné, ou le refuse. */
async function suivreChargement(contexte: any, url: string, delai: number): Promise<"lecture" | "refus" | "delai"> {
  const { chrome } = fenetre(); const P = chrome.cast.media.PlayerState, I = chrome.cast.media.IdleReason;
  const limite = Date.now() + delai;
  while (Date.now() < limite) {
    const m = contexte.getCurrentSession()?.getMediaSession?.();
    if (m?.media?.contentId === url) {
      if (m.playerState === P.PLAYING || (m.playerState === P.BUFFERING && Number(m.getEstimatedTime?.() ?? 0) > 0)) return "lecture";
      if (m.playerState === P.IDLE && m.idleReason === I.ERROR) return "refus";
    }
    await attendre(250);
  }
  return "delai";
}

/**
 * Libérer le téléviseur arrête d'abord le média, et ne ferme la session qu'après cinq secondes sans
 * nouveau chargement : un repli recharge le niveau suivant aussitôt, et Chrome ne rouvre pas une
 * session sans un geste de la personne.
 */
let finDeSession: ReturnType<typeof setTimeout> | undefined;
const promesse = (appel: (ok: () => void, ko: (e: unknown) => void) => void) => new Promise<void>((resolve, reject) => appel(resolve, reject));

async function executer(contexte: any, action: ActionRelais): Promise<Partial<AccuseDiffusion>> {
  const { chrome } = fenetre(); const C = chrome.cast.media;
  const session = contexte.getCurrentSession();
  if (!session) throw new ErreurRelais("CAST_CONNEXION", "La session Cast de ce navigateur est fermée : choisissez de nouveau le téléviseur.");
  if (action.type !== "liberer") { clearTimeout(finDeSession); finDeSession = undefined; }
  switch (action.type) {
    case "verifier": return {};
    case "sonder": {
      try { await session.loadMedia(requete({ ...action, direct: false, position: 0, metadonnees: { genre: "video", titre: "FlixTunes" } })); }
      catch { return { verdict: "refuse" }; }
      const r = await suivreChargement(contexte, action.url, 6_000);
      return { verdict: r === "lecture" ? "accepte" : r === "refus" ? "refuse" : "inconnu" };
    }
    case "charger": {
      try { await session.loadMedia(requete(action)); }
      catch (e) { throw new ErreurRelais("CAST_LOAD_FAILED", `Le téléviseur a refusé la vidéo (${String(e)}).`); }
      const r = await suivreChargement(contexte, action.url, 35_000);
      if (r === "refus") throw new ErreurRelais("CAST_MEDIA_ERREUR", "Le téléviseur n’a pas pu lire la vidéo.");
      if (r === "delai") throw new ErreurRelais("CAST_DEMARRAGE", "Le téléviseur n’a pas confirmé le démarrage de la vidéo.");
      return {};
    }
    case "commande": {
      const c = action.commande;
      if (c.type === "volume") { await session.setVolume(c.valeur); return {}; }
      const m = session.getMediaSession?.();
      if (!m) throw new ErreurRelais("CAST_RELAIS", "Aucune lecture en cours sur le téléviseur.");
      if (c.type === "pause") await promesse((ok, ko) => m.pause(new C.PauseRequest(), ok, ko));
      else if (c.type === "reprendre") await promesse((ok, ko) => m.play(new C.PlayRequest(), ok, ko));
      else if (c.type === "arreter") await promesse((ok, ko) => m.stop(new C.StopRequest(), ok, ko));
      else if (c.type === "position") { const req = new C.SeekRequest(); req.currentTime = c.valeur; await promesse((ok, ko) => m.seek(req, ok, ko)); }
      return {};
    }
    case "liberer": {
      const m = session.getMediaSession?.();
      if (m) await promesse((ok, ko) => m.stop(new C.StopRequest(), ok, ko)).catch(() => undefined);
      clearTimeout(finDeSession);
      finDeSession = setTimeout(() => { finDeSession = undefined; contexte.getCurrentSession()?.endSession(true); }, 5_000);
      return {};
    }
  }
}
