import tls from "node:tls";
import type { CommandeDiffusion, EtatDiffusion } from "@flixtunes/contracts";
import type { Recepteur } from "./diffusion-reseau.js";
import type { Verdict } from "./diffusion-sonde.js";

/** Ce que le téléviseur affiche pendant la lecture : affiche, titre, épisode ou chaîne. */
export interface MetadonneesDiffusion {
  genre: "film" | "episode" | "direct" | "video";
  titre: string;
  sousTitre?: string;
  image?: string;
  serie?: string;
  saison?: number;
  episode?: number;
  annee?: number;
}

/** Les métadonnées Cast : film (1), épisode (2) ou générique (0), avec l'affiche quand on l'a. */
export function metadonneesCast(m: MetadonneesDiffusion): Record<string, unknown> {
  const images = m.image ? [{ url: m.image }] : [];
  if (m.genre === "film") return { metadataType: 1, title: m.titre, ...(m.sousTitre ? { subtitle: m.sousTitre } : {}),
    ...(m.annee ? { releaseDate: `${m.annee}-01-01` } : {}), images };
  if (m.genre === "episode") return { metadataType: 2, title: m.titre, seriesTitle: m.serie ?? m.titre,
    ...(m.saison != null ? { season: m.saison } : {}), ...(m.episode != null ? { episode: m.episode } : {}), images };
  return { metadataType: 0, title: m.titre, ...(m.sousTitre ? { subtitle: m.sousTitre } : {}), images };
}

const NS = "urn:x-cast:com.google.cast.";
export class ErreurCast extends Error {
  constructor(public code: string, message: string) { super(`${message} [${code}]`); this.name = "ErreurCast"; }
}
type Message = { source: string; destination: string; espace: string; donnees: Record<string, any> };
const entier = (valeur: number) => { const b: number[] = []; do { b.push((valeur & 127) | (valeur > 127 ? 128 : 0)); valeur >>>= 7; } while (valeur); return Buffer.from(b); };
/** Enveloppe CastMessage protobuf (CASTV2). Les messages volumineux ou malformés ferment seulement
 * cette connexion : aucune donnée du téléviseur ne doit pouvoir arrêter le serveur. */
export function encoderCast(message: Message): Buffer {
  const chaine = (champ: number, texte: string) => { const b = Buffer.from(texte); return Buffer.concat([entier(champ * 8 + 2), entier(b.length), b]); };
  const corps = Buffer.concat([Buffer.from([8, 0]), chaine(2, message.source), chaine(3, message.destination),
    chaine(4, message.espace), Buffer.from([40, 0]), chaine(6, JSON.stringify(message.donnees))]);
  const taille = Buffer.alloc(4); taille.writeUInt32BE(corps.length); return Buffer.concat([taille, corps]);
}
export function decoderCast(corps: Buffer): Message {
  if (corps.length > 1024 * 1024) throw new Error("Message Cast trop grand");
  let offset = 0, payloadType = 0; const champs = new Map<number, string>();
  const lire = () => { let v = 0, facteur = 1;
    for (let i = 0; i < 5; i++) { const b = corps[offset++]; if (b == null) throw new Error("Message Cast incomplet"); v += (b & 127) * facteur; if (!(b & 128)) return v; facteur *= 128; }
    throw new Error("Entier Cast invalide");
  };
  while (offset < corps.length) {
    const tag = lire(), type = tag & 7;
    if (type === 0) { const valeur = lire(); if ((tag >>> 3) === 5) payloadType = valeur; }
    else if (type === 2) { const taille = lire(); if (offset + taille > corps.length) throw new Error("Message Cast tronqué");
      champs.set(tag >>> 3, corps.toString("utf8", offset, offset + taille)); offset += taille;
    } else throw new Error("Enveloppe Cast inconnue");
  }
  // Les messages de périphérique peuvent être binaires. Ils ne sont pas des réponses JSON
  // aux commandes média ; les ignorer sans casser une connexion par ailleurs valide.
  const donnees: unknown = payloadType === 1 && champs.has(7) ? { type: "BINARY" } : JSON.parse(champs.get(6) ?? "null");
  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) throw new Error("Message Cast invalide");
  return { source: champs.get(2) ?? "", destination: champs.get(3) ?? "", espace: champs.get(4) ?? "", donnees: donnees as Record<string, any> };
}

export class TransportCast {
  private socket?: tls.TLSSocket; private tampon = Buffer.alloc(0); private prochain = 1;
  // Identifiant de plateforme CASTV2, isolé par la connexion TLS.
  private source = "sender-0"; private destination = ""; private session?: number;
  private volume = 1; private dernierMessage = Date.now(); private timer?: NodeJS.Timeout;
  private enLecture = false;
  private contenuAttendu?: string;
  private positionConfirmee?: number;
  private progressionConfirmee = false;
  private dernierProgres = Date.now();
  private etatPrecedent = "";
  private messagesRecus = 0; private battementsRecus = 0;
  private application?: { transportId: string; sessionId?: string };
  private erreurLecture?: Error;
  /** Le code détaillé du dernier refus du récepteur (`detailedErrorCode` du lecteur Cast). */
  private codeDetaille?: string;
  private observateurSonde?: (statut: any) => void;
  /** Le lecteur trouvé ouvert a été examiné une fois : sain, il est repris ; douteux, il est relancé. */
  private santeVerifiee = false;
  private attentes = new Map<number, { espace: string; destination: string; type: string; resolve: (r: Record<string, any>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private cible: Recepteur, private etat: (etat: Partial<EtatDiffusion>) => void) {}
  private envoyer(espace: string, donnees: Record<string, unknown>, destination = "receiver-0") {
    if (!this.socket || this.socket.destroyed) throw new Error("Connexion Cast interrompue");
    this.socket.write(encoderCast({ source: this.source, destination, espace: NS + espace, donnees }));
  }
  private requete(espace: string, donnees: Record<string, unknown>, destination = "receiver-0", delai = 12_000): Promise<Record<string, any>> {
    const requestId = this.prochain++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.attentes.delete(requestId); reject(new ErreurCast(`CAST_DELAI_${String(donnees.type)}`, `Le récepteur Cast ne répond pas à ${String(donnees.type)}`)); }, delai);
      this.attentes.set(requestId, { espace: NS + espace, destination, type: String(donnees.type), resolve, reject, timer });
      try { this.envoyer(espace, { ...donnees, requestId }, destination); }
      catch (e) { clearTimeout(timer); this.attentes.delete(requestId); reject(e); }
    });
  }
  private recevoir(chunk: Buffer) {
    try {
      this.tampon = Buffer.concat([this.tampon, chunk]);
      while (this.tampon.length >= 4) {
        const taille = this.tampon.readUInt32BE(0);
        if (!taille || taille > 1024 * 1024) throw new Error("Message Cast trop grand");
        if (this.tampon.length < taille + 4) break;
        const m = decoderCast(this.tampon.subarray(4, taille + 4)); this.tampon = this.tampon.subarray(taille + 4);
        // Une connexion peut recevoir des notifications destinées à un autre émetteur.
        if (m.destination !== this.source && m.destination !== "*") continue;
        this.dernierMessage = Date.now(); this.messagesRecus++;
        if (m.espace === NS + "tp.heartbeat") this.battementsRecus++;
        if (m.espace === NS + "tp.connection" && m.donnees.type === "CLOSE"
          && (m.source === "receiver-0" || m.source === this.destination)) {
          throw new ErreurCast("CAST_CANAL_FERME", "Le récepteur a fermé le canal Cast");
        }
        if (m.espace === NS + "tp.heartbeat" && m.donnees.type === "PING") this.envoyer("tp.heartbeat", { type: "PONG" }, m.source);
        if (m.espace === NS + "media" && m.source === this.destination && ["ERROR", "LOAD_FAILED"].includes(m.donnees.type)) {
          const brut = String(m.donnees.detailedErrorCode ?? m.donnees.reason ?? "");
          if (/^(?:[A-Z][A-Z0-9_]{0,39}|\d{1,9})$/.test(brut)) this.codeDetaille = brut;
        }
        if (m.espace === NS + "media" && m.source === this.destination && m.donnees.type === "MEDIA_STATUS") {
          const statut = m.donnees.status?.find((s: any) => s.mediaSessionId === this.session) ?? m.donnees.status?.[0];
          if (this.observateurSonde) this.observateurSonde(statut);
          else this.actualiser(statut);
        }
        if (m.espace === NS + "receiver" && m.source === "receiver-0" && m.donnees.type === "RECEIVER_STATUS") {
          const a = m.donnees.status?.applications?.find((a: any) => a.appId === "CC1AD845");
          this.application = typeof a?.transportId === "string" ? a : undefined;
          // Le lecteur que nous pilotions a été fermé ou remplacé : une autre application a pris le
          // récepteur, ou quelqu'un l'a quittée avec la télécommande. Ce n'est pas une panne.
          const toujoursLa = (m.donnees.status?.applications ?? []).some((app: any) => app.transportId === this.destination);
          if (this.destination && !toujoursLa && Array.isArray(m.donnees.status?.applications)) this.reprisParUnTiers();
        }
        if (m.espace === NS + "receiver" && m.source === "receiver-0" && typeof m.donnees.status?.volume?.level === "number") {
          this.volume = Math.max(0, Math.min(1, m.donnees.status.volume.level)); this.etat({ volume: this.volume });
        }
        const brutId = m.donnees.requestId;
        let requestId = typeof brutId === "number" ? brutId
          : typeof brutId === "string" && /^\d{1,9}$/.test(brutId) ? Number(brutId) : undefined;
        // Un statut de plateforme diffusé sans identifiant (ou avec 0) suffit pour une
        // demande de lecture d'état, jamais pour confirmer LOAD, PLAY, SEEK ou LAUNCH.
        if ((requestId == null || requestId === 0) && m.espace === NS + "receiver"
          && m.source === "receiver-0" && m.donnees.type === "RECEIVER_STATUS"
          && m.donnees.status && typeof m.donnees.status === "object" && !Array.isArray(m.donnees.status)) {
          requestId = [...this.attentes].find(([, a]) => a.type === "GET_STATUS"
            && a.espace === m.espace && a.destination === m.source)?.[0];
        }
        const attente = requestId == null ? undefined : this.attentes.get(requestId);
        const refus = ["INVALID_REQUEST", "LOAD_FAILED", "LOAD_CANCELLED", "LAUNCH_ERROR"].includes(m.donnees.type);
        const statut = m.espace === NS + "receiver" ? "RECEIVER_STATUS" : "MEDIA_STATUS";
        if (attente && attente.espace === m.espace && attente.destination === m.source
          && (refus || m.donnees.type === statut)) {
          this.attentes.delete(requestId!); clearTimeout(attente.timer);
          if (refus) {
            const brut = String(m.donnees.reason ?? m.donnees.detailedErrorCode ?? m.donnees.customData?.errorCode ?? "");
            const detail = /^(?:[A-Z][A-Z0-9_]{0,39}|\d{1,9})$/.test(brut) ? brut : "";
            attente.reject(new ErreurCast(`CAST_${m.donnees.type}${detail ? `_${detail}` : ""}`, "Lecture refusée par le récepteur Cast"));
          }
          else attente.resolve(m.donnees);
        }
      }
    } catch (e) {
      this.erreurLecture = e instanceof Error ? e : new Error("Connexion Cast interrompue");
      // Un observateur défaillant ne doit ni lever une seconde exception ni laisser la requête
      // sans réponse jusqu'à son délai : rendre l'erreur et libérer la liaison dans tous les cas.
      try { this.etat({ lecture: "erreur", erreur: this.erreurLecture.message }); } catch { /* Erreur déjà conservée. */ }
      this.fermer(this.erreurLecture);
    }
  }
  /** La diffusion s'arrête sans erreur : le récepteur a été pris par un autre, ou rendu à son menu. */
  private reprisParUnTiers() {
    const actif = this.session != null || this.progressionConfirmee;
    this.destination = ""; this.session = undefined; this.enLecture = false; this.progressionConfirmee = false;
    this.positionConfirmee = undefined; this.contenuAttendu = undefined;
    if (actif) this.etat({ lecture: "repos", erreur: null, motifRepos: "tiers" });
  }
  private actualiser(s: any) {
    if (!s) {
      if (this.session != null) {
        this.session = undefined; this.enLecture = false; this.progressionConfirmee = false; this.positionConfirmee = undefined;
        this.etat({ lecture: "repos", erreur: null, motifRepos: "arret" });
      }
      return;
    }
    if (typeof s.mediaSessionId !== "number") return;
    const contenu = s.media?.contentId ?? s.media?.contentUrl;
    // Un autre émetteur a chargé un autre média sur le même lecteur après que le nôtre a démarré.
    if (this.progressionConfirmee && contenu && this.contenuAttendu && contenu !== this.contenuAttendu) { this.reprisParUnTiers(); return; }
    // Les anciens MEDIA_STATUS peuvent arriver après LOAD. Ils ne confirment pas le nouveau média.
    if (this.contenuAttendu && ((contenu && contenu !== this.contenuAttendu)
      || (this.session == null && contenu !== this.contenuAttendu))) return;
    if (this.session != null && s.mediaSessionId !== this.session) return;
    this.session = s.mediaSessionId;
    if (s.playerState !== "PLAYING" || this.etatPrecedent !== "PLAYING") this.dernierProgres = Date.now();
    this.etatPrecedent = s.playerState;
    const position = Number.isFinite(s.currentTime) ? Math.max(0, s.currentTime) : undefined;
    if (s.playerState === "PLAYING" && position != null) {
      if (this.positionConfirmee == null) { this.positionConfirmee = position; this.dernierProgres = Date.now(); }
      else if (position > this.positionConfirmee + .5) {
        this.progressionConfirmee = true; this.positionConfirmee = position; this.dernierProgres = Date.now();
      }
    } else if (!this.progressionConfirmee) this.positionConfirmee = undefined;
    this.enLecture = s.playerState === "PLAYING" && this.progressionConfirmee;
    const bloquee = this.enLecture && Date.now() - this.dernierProgres > 20_000;
    if (s.playerState === "IDLE" && s.idleReason === "ERROR") this.erreurLecture = new ErreurCast(`CAST_MEDIA${this.codeDetaille ? `_${this.codeDetaille}` : ""}`, "Le récepteur n’a pas pu décoder ou récupérer ce flux");
    else if (bloquee) this.erreurLecture = new ErreurCast("CAST_LECTURE_BLOQUEE", "La position de lecture du récepteur n’avance plus");
    else if (this.enLecture) this.erreurLecture = undefined;
    const motifRepos = s.playerState !== "IDLE" ? undefined : s.idleReason === "FINISHED" ? "fin" as const
      : s.idleReason === "INTERRUPTED" ? "tiers" as const : s.idleReason === "CANCELLED" ? "arret" as const : undefined;
    this.etat({ lecture: this.erreurLecture ? "erreur" : s.playerState === "PLAYING" ? (this.enLecture ? "lecture" : "chargement")
      : s.playerState === "PAUSED" ? "pause" : s.playerState === "BUFFERING" ? "chargement" : "repos",
      position: position ?? 0, duree: Number.isFinite(s.media?.duration) ? s.media.duration : 0,
      navigation: s.media?.streamType === "BUFFERED", erreur: this.erreurLecture?.message ?? null,
      ...(motifRepos && !this.erreurLecture ? { motifRepos } : {}) });
  }
  private ouvrirCanal(destination = "receiver-0") {
    this.envoyer("tp.connection", { type: "CONNECT", origin: {}, connType: 0,
      userAgent: "FlixTunes/0.6.0", senderInfo: { sdkType: 2, version: "0.6.0", connectionType: 1 } }, destination);
  }
  private async connecter(adresse: string) {
    this.application = undefined; this.destination = ""; this.session = undefined; this.enLecture = false;
    this.tampon = Buffer.alloc(0); this.dernierMessage = Date.now();
    this.messagesRecus = 0; this.battementsRecus = 0;
    await new Promise<void>((resolve, reject) => {
      // Certificat de périphérique Cast ; aucun jeton de compte/profil n'est envoyé.
      const socket = tls.connect({ host: adresse, port: this.cible.port, rejectUnauthorized: false, minVersion: "TLSv1.2" });
      this.socket = socket; let connectee = false;
      const timer = setTimeout(() => { reject(new ErreurCast("CAST_CONNEXION_DELAI", "Le NAS ne parvient pas à joindre le récepteur Cast")); socket.destroy(); }, 10_000);
      socket.once("secureConnect", () => { connectee = true; clearTimeout(timer); socket.setKeepAlive(true, 10_000); resolve(); });
      socket.on("data", (b: Buffer) => { if (this.socket === socket) this.recevoir(b); });
      socket.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer);
        const erreur = new ErreurCast(`CAST_CONNEXION_${(e.code ?? "INCONNUE").replace(/[^A-Z0-9_]/g, "")}`, "Connexion Cast impossible depuis le NAS");
        reject(erreur); if (this.socket === socket) { this.erreurLecture = erreur; this.fermer(); }
      });
      socket.on("close", () => { clearTimeout(timer);
        if (!connectee) reject(new ErreurCast("CAST_CONNEXION_FERMEE", "Le récepteur ferme la connexion avant de répondre"));
        if (this.socket === socket) { this.etat({ lecture: "erreur", erreur: "Récepteur Cast déconnecté" }); this.fermer(); }
      });
    });
    this.erreurLecture = undefined;
    this.ouvrirCanal();
    this.envoyer("tp.heartbeat", { type: "PING" });
    this.timer = setInterval(() => {
      if (Date.now() - this.dernierMessage > 20_000) { this.fermer(); this.etat({ lecture: "erreur", erreur: "Récepteur Cast hors ligne" }); return; }
      try { this.envoyer("tp.heartbeat", { type: "PING" });
        if (this.destination) this.envoyer("media", { type: "GET_STATUS", requestId: this.prochain++ }, this.destination);
      } catch { this.fermer(); }
    }, 5000); this.timer.unref();
  }
  /** Vérifie la liaison sans lancer d'application ni interrompre la lecture du téléviseur. */
  async verifier() {
    const adresses = [...new Set([this.cible.adresse, ...(this.cible.adresses ?? [])])].slice(0, 2);
    const essais = adresses.length > 1 ? adresses : [this.cible.adresse, this.cible.adresse];
    for (let i = 0; i < essais.length; i++) {
      this.fermer(); this.contenuAttendu = undefined;
      try {
        await this.connecter(essais[i]!);
        await this.requete("receiver", { type: "GET_STATUS" });
        return;
      } catch (e) {
        this.fermer();
        if (i === essais.length - 1) {
          if (e instanceof ErreurCast && e.code === "CAST_DELAI_GET_STATUS") {
            throw new ErreurCast(e.code, `Connexion chiffrée établie, mais aucun état Cast confirmé après deux essais (${this.messagesRecus} messages reçus, dont ${this.battementsRecus} battements). Aucun média n’a été envoyé.`);
          }
          throw e;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  /** Le lecteur multimédia par défaut du récepteur, lancé s'il ne l'est pas, et notre canal vers lui. */
  /**
   * Un lecteur Cast déjà ouvert dans un état douteux est fermé, puis relancé : la diffusion prend le
   * dessus au lieu de se glisser dans un lecteur bloqué. Relevé le 2 octobre 2026 sur un Philips
   * 58PUS7304 : son lecteur restait en chargement à 0 s sur un flux révoqué, et chaque envoi suivant y
   * échouait jusqu'au redémarrage du téléviseur. Un lecteur qui lit ou attend en pause est repris tel
   * quel : relancer coûterait deux à trois secondes pour rien.
   */
  private async prendreLeDessus() {
    if (this.santeVerifiee || !this.application) { this.santeVerifiee = true; return; }
    this.santeVerifiee = true;
    let douteux = false;
    try {
      this.destination = this.application.transportId; this.ouvrirCanal(this.destination);
      const r = await this.requete("media", { type: "GET_STATUS" }, this.destination, 4000);
      const s = r.status?.[0];
      douteux = !!s && (s.playerState === "BUFFERING" || (s.playerState === "IDLE" && s.idleReason === "ERROR"));
    } catch { douteux = true; }
    if (!douteux) return;
    await this.fermerApplication();
  }
  /** Ferme l'application Cast du récepteur : le téléviseur revient à son écran. */
  private async fermerApplication() {
    const session = this.application?.sessionId;
    if (!session || !this.socket || this.socket.destroyed) return;
    try { await this.requete("receiver", { type: "STOP", sessionId: session }, "receiver-0", 5000); } catch { /* état relu ci-dessous */ }
    this.application = undefined; this.destination = ""; this.session = undefined;
    const limite = Date.now() + 4000;
    while (this.socket && !this.socket.destroyed && Date.now() < limite) {
      try { await this.requete("receiver", { type: "GET_STATUS" }, "receiver-0", 2000); } catch { break; }
      if (!this.application) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  /**
   * Rend le téléviseur libre : arrêt du média, puis fermeture de l'application Cast. Appelé sur tout
   * échec, abandon ou arrêt, avant que le flux ne soit révoqué — sans cela le lecteur restait en boucle
   * sur une adresse morte.
   */
  async liberer() {
    try {
      if (!this.socket || this.socket.destroyed) await this.verifier();
      if (this.session != null && this.destination) {
        try { await this.requete("media", { type: "STOP", mediaSessionId: this.session }, this.destination, 3000); } catch { /* la fermeture suit */ }
      }
      if (this.application) await this.fermerApplication();
    } catch { /* récepteur injoignable : rien à libérer */ }
    finally { this.fermer(); }
  }
  /** Ferme l'application Cast du récepteur même sans diffusion connue : le bouton « Réinitialiser ». */
  async reinitialiser() {
    await this.verifier();
    await this.fermerApplication();
    this.fermer();
  }
  private async assurerLecteur() {
    if (!this.socket || this.socket.destroyed) await this.verifier();
    await this.prendreLeDessus();
    if (!this.application) {
      try { await this.requete("receiver", { type: "LAUNCH", appId: "CC1AD845" }, "receiver-0", 30_000); }
      catch (e) { if (!this.application) throw e; }
      const limite = Date.now() + 15_000;
      while (!this.application && this.socket && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 500)); await this.requete("receiver", { type: "GET_STATUS" });
      }
    }
    if (!this.application) throw new ErreurCast("CAST_LANCEUR", "Le lecteur du récepteur Cast n’est pas prêt");
    if (this.destination !== this.application.transportId) {
      this.destination = this.application.transportId;
      this.ouvrirCanal(this.destination);
    }
  }
  /**
   * Fait lire un clip de sonde et rend le verdict du récepteur : il refuse en moins d'une seconde ce
   * qu'il ne sait pas lire, et commence à lire ce qu'il accepte. Rien n'est attendu au-delà.
   */
  async sonder(url: string, mime: string, fmp4: boolean, delai = 6000): Promise<Verdict> {
    await this.assurerLecteur();
    this.contenuAttendu = undefined; this.session = undefined; this.enLecture = false; this.erreurLecture = undefined;
    this.progressionConfirmee = false; this.positionConfirmee = undefined; this.codeDetaille = undefined;
    let fini: (v: Verdict) => void = () => {};
    const resultat = new Promise<Verdict>((resolve) => { fini = resolve; });
    const timer = setTimeout(() => fini("inconnu"), delai);
    this.observateurSonde = (st: any) => {
      const contenu = st?.media?.contentId ?? st?.media?.contentUrl;
      if (contenu && contenu !== url) return;
      if (st?.playerState === "PLAYING" || (st?.playerState === "BUFFERING" && Number(st.currentTime) > 0)) fini("accepte");
      else if (st?.playerState === "IDLE" && st.idleReason === "ERROR") fini("refuse");
    };
    try {
      this.requete("media", { type: "LOAD", autoplay: true, currentTime: 0,
        ...(this.application?.sessionId ? { sessionId: this.application.sessionId } : {}),
        media: { ...(fmp4 ? { hlsSegmentFormat: "FMP4", hlsVideoSegmentFormat: "FMP4" } : {}), contentId: url, contentUrl: url,
          contentType: mime, streamType: "BUFFERED", metadata: { metadataType: 0, title: "FlixTunes" } } }, this.destination, delai)
        .catch((e) => { if (e instanceof ErreurCast && /^CAST_(LOAD_FAILED|LOAD_CANCELLED|INVALID_REQUEST)/.test(e.code)) fini("refuse"); else fini("inconnu"); });
      const v = await resultat;
      // Un dernier état de la sonde ne doit pas passer pour celui du vrai média.
      const limite = Date.now() + 1500;
      while (this.socket && Date.now() < limite && this.attentes.size) await new Promise((r) => setTimeout(r, 100));
      return v;
    } finally {
      clearTimeout(timer); this.observateurSonde = undefined;
      this.session = undefined; this.erreurLecture = undefined; this.codeDetaille = undefined;
    }
  }
  async charger(url: string, mime: string, titre: string, direct: boolean, position: number, segmentsFmp4 = false, metadonnees?: MetadonneesDiffusion) {
    await this.assurerLecteur();
    this.enLecture = false; this.erreurLecture = undefined; this.session = undefined; this.codeDetaille = undefined;
    this.contenuAttendu = url; this.positionConfirmee = undefined; this.progressionConfirmee = false; this.dernierProgres = Date.now();
    await this.requete("media", { type: "LOAD", autoplay: true, currentTime: direct ? 0 : position,
      ...(this.application?.sessionId ? { sessionId: this.application.sessionId } : {}),
      media: { ...(segmentsFmp4 ? { hlsSegmentFormat: "FMP4", hlsVideoSegmentFormat: "FMP4" } : {}), contentId: url, contentUrl: url, contentType: mime, streamType: direct ? "LIVE" : "BUFFERED", metadata: metadonnees ? metadonneesCast(metadonnees) : { metadataType: 0, title: titre } } }, this.destination, 35_000);
    const limite = Date.now() + 35_000;
    while (!this.enLecture && !this.erreurLecture && this.socket && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 750));
      if (!this.enLecture && !this.erreurLecture && this.socket) await this.requete("media", { type: "GET_STATUS" }, this.destination, 5000);
    }
    if (this.erreurLecture) throw this.erreurLecture;
    if (!this.enLecture || !this.socket) throw new ErreurCast("CAST_DEMARRAGE", "Le récepteur Cast n’a pas confirmé le démarrage de la vidéo");
  }
  async commander(c: Exclude<CommandeDiffusion, { type: "charger" | "reinitialiser" }>) {
    if (c.type === "volume") { await this.requete("receiver", { type: "SET_VOLUME", volume: { level: c.valeur, muted: false } }); return; }
    if (this.session == null) throw new Error("Aucune lecture Cast active");
    if (c.type === "position") { this.positionConfirmee = c.valeur; this.dernierProgres = Date.now(); }
    await this.requete("media", { type: { pause: "PAUSE", reprendre: "PLAY", arreter: "STOP", position: "SEEK" }[c.type],
      mediaSessionId: this.session, ...(c.type === "position" ? { currentTime: c.valeur } : {}) }, this.destination);
  }
  fermer(erreur = new Error("Connexion Cast fermée")) {
    clearInterval(this.timer); const s = this.socket; this.socket = undefined; s?.destroy();
    for (const a of this.attentes.values()) { clearTimeout(a.timer); a.reject(erreur); } this.attentes.clear();
  }
}
