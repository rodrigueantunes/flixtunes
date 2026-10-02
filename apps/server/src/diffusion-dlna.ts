import type { CommandeDiffusion, EtatDiffusion } from "@flixtunes/contracts";
import { analyserXml, texteBorne, urlRecepteur, type Recepteur } from "./diffusion-reseau.js";
import type { MetadonneesDiffusion } from "./diffusion-cast.js";
import { fonctionnalitesDlna } from "./diffusion-medias.js";

export const echapperXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function tempsDlna(secondes: number) {
  const n = Math.floor(Math.max(0, secondes));
  return `${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function secondesDlna(s: unknown) {
  const m = /^(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(String(s));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
export class TransportDlna {
  private timer?: NodeJS.Timeout; private occupe = false; private ferme = false;
  private enLecture = false;
  constructor(private cible: Recepteur, private etat: (e: Partial<EtatDiffusion>) => void) {}
  private async soap(action: string, args: Record<string, string | number> = {}, rendu: boolean | "connexion" = false) {
    const service = rendu === "connexion" ? this.cible.connexion : rendu ? this.cible.rendu : this.cible.transport;
    if (!service) throw new Error(rendu ? "Le téléviseur ne propose pas le réglage du volume" : "Récepteur DLNA indisponible");
    const url = urlRecepteur(service.url, this.cible.adresse);
    // GetProtocolInfo ne prend aucun argument : certains téléviseurs refusent une instance en trop.
    const contenu = Object.entries(rendu === "connexion" ? args : { InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${echapperXml(String(v))}</${k}>`).join("");
    const xml = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service.type}">${contenu}</u:${action}></s:Body></s:Envelope>`;
    const r = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#${action}"` }, body: xml });
    const corps = analyserXml(await texteBorne(r.ok ? r : new Response(r.body, { status: 200 }))).Envelope?.Body;
    if (!r.ok || corps?.Fault) {
      const code = String(corps?.Fault?.detail?.UPnPError?.errorCode ?? r.status).replace(/[^0-9]/g, "").slice(0, 6);
      throw new Error(`Commande ${action} refusée par le téléviseur [DLNA_${code}]`);
    }
    return corps?.[`${action}Response`] ?? {};
  }
  /** Les formats que le téléviseur déclare savoir lire, ou `null` s'il ne le dit pas. */
  async protocolesAcceptes(): Promise<string[] | null> {
    if (!this.cible.connexion) return null;
    try {
      const r = await this.soap("GetProtocolInfo", {}, "connexion");
      return String(r.Sink ?? "").split(",").map((entree) => entree.trim()).filter(Boolean).slice(0, 512);
    } catch { return null; }
  }
  /** Arrête la lecture sur le téléviseur avant que le flux ne soit révoqué : il ne reste pas sur une adresse morte. */
  async liberer() {
    try { if (!this.ferme) await this.soap("Stop"); } catch { /* téléviseur déjà arrêté ou injoignable */ }
    finally { this.fermer(); }
  }
  async charger(url: string, mime: string, titre: string, direct: boolean, position: number, metadonnees?: MetadonneesDiffusion, fichier = false) {
    const metadata = didlDiffusion(url, mime, metadonnees ?? { genre: "film", titre }, fichier);
    await this.soap("SetAVTransportURI", { CurrentURI: url, CurrentURIMetaData: metadata });
    await this.soap("Play", { Speed: 1 });
    await this.actualiser();
    const limite = Date.now() + 15_000;
    while (!this.enLecture && !this.ferme && Date.now() < limite) { await new Promise((r) => setTimeout(r, 500)); await this.actualiser(); }
    if (!this.enLecture) throw new Error("Le téléviseur DLNA n’a pas confirmé le démarrage de la vidéo");
    if (!direct && position > 0) {
      try { await this.soap("Seek", { Unit: "REL_TIME", Target: tempsDlna(position) }); }
      catch (e) { if (!(e instanceof Error) || !e.message.includes("DLNA_701")) throw e;
        await new Promise((r) => setTimeout(r, 700)); await this.soap("Seek", { Unit: "REL_TIME", Target: tempsDlna(position) }); }
      await this.actualiser();
    }
    this.timer = setInterval(() => { void this.actualiser().catch(() => this.etat({ lecture: "erreur", erreur: "Téléviseur DLNA injoignable" })); }, 3000);
    this.timer.unref();
  }
  private async actualiser() {
    if (this.occupe || this.ferme) return; this.occupe = true;
    try {
      const transport = await this.soap("GetTransportInfo");
      this.enLecture = transport.CurrentTransportState === "PLAYING";
    // Certains téléviseurs lisent correctement mais ne proposent pas GetPositionInfo (notamment
    // sur le direct). L'absence de cette fonction ne doit pas annuler une lecture confirmée.
    const position = await this.soap("GetPositionInfo").catch(() => ({} as Record<string, unknown>));
      const volume = this.cible.rendu ? await this.soap("GetVolume", { Channel: "Master" }, true).catch(() => null) : null;
      if (!this.ferme) this.etat({ lecture: transport.CurrentTransportState === "PLAYING" ? "lecture" : transport.CurrentTransportState === "PAUSED_PLAYBACK" ? "pause" : transport.CurrentTransportState === "TRANSITIONING" ? "chargement" : "repos",
        position: secondesDlna(position.RelTime), duree: secondesDlna(position.TrackDuration),
        navigation: secondesDlna(position.TrackDuration) > 0, erreur: null,
        ...(volume && Number.isFinite(Number(volume.CurrentVolume)) ? { volume: Math.min(1, Math.max(0, Number(volume.CurrentVolume) / 100)) } : {}) });
    } finally { this.occupe = false; }
  }
  async commander(c: Exclude<CommandeDiffusion, { type: "charger" | "reinitialiser" }>) {
    if (c.type === "volume") await this.soap("SetVolume", { Channel: "Master", DesiredVolume: Math.round(c.valeur * 100) }, true);
    else if (c.type === "position") await this.soap("Seek", { Unit: "REL_TIME", Target: tempsDlna(c.valeur) });
    else await this.soap({ pause: "Pause", reprendre: "Play", arreter: "Stop" }[c.type], c.type === "reprendre" ? { Speed: 1 } : {});
    await this.actualiser();
  }
  fermer() { this.ferme = true; clearInterval(this.timer); }
}

/**
 * Le téléviseur lit-il le HLS ? `null` quand il ne déclare rien : on essaie alors comme avant.
 *
 * Seules les listes vidéo comptent. Le Philips 58PUS7304 déclare `audio/x-mpegurl`, une liste de
 * lecture audio : la r7 y voyait du HLS et lui envoyait un flux qu'il ne lit pas.
 */
export function dlnaLitLeHls(protocoles: string[] | null): boolean | null {
  if (!protocoles?.length) return null;
  return protocoles.some((entree) => /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|video\/(x-)?mpegurl)$/i.test(entree.split(":")[2] ?? ""));
}

/** Les types sous lesquels un téléviseur peut déclarer chaque conteneur. */
const ALIAS_DLNA: Record<string, string[]> = {
  "video/x-matroska": ["video/x-matroska", "video/x-mkv", "video/mkv"],
  "video/mp4": ["video/mp4", "video/mpeg4", "video/x-m4v"],
  "video/mp2t": ["video/mp2t", "video/vnd.dlna.mpeg-tts", "video/mpeg"],
  "video/webm": ["video/webm"], "video/quicktime": ["video/quicktime"], "video/x-msvideo": ["video/x-msvideo", "video/avi", "video/msvideo"],
};
/** Le téléviseur déclare-t-il savoir lire ce conteneur ? Il recevra alors le fichier tel quel. */
export function dlnaLitLeConteneur(protocoles: string[] | null, mime: string): boolean {
  if (!protocoles?.length) return false;
  const acceptes = new Set(protocoles.map((entree) => (entree.split(":")[2] ?? "").toLowerCase()));
  return (ALIAS_DLNA[mime.toLowerCase()] ?? [mime.toLowerCase()]).some((alias) => acceptes.has(alias));
}

/** Le DIDL-Lite d'une diffusion : titre, épisode, affiche, et les drapeaux DLNA du flux. */
export function didlDiffusion(url: string, mime: string, m: MetadonneesDiffusion, fichier: boolean): string {
  const titre = m.genre === "episode" && m.serie ? `${m.serie} — ${m.titre}` : m.titre;
  const description = m.genre === "episode" && m.saison != null && m.episode != null ? `Saison ${m.saison}, épisode ${m.episode}` : m.sousTitre;
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">`
    + `<item id="0" parentID="-1" restricted="1"><dc:title>${echapperXml(titre)}</dc:title>`
    + (description ? `<dc:description>${echapperXml(description)}</dc:description>` : "")
    + (m.image ? `<upnp:albumArtURI>${echapperXml(m.image)}</upnp:albumArtURI>` : "")
    + `<upnp:class>${m.genre === "direct" ? "object.item.videoItem.videoBroadcast" : m.genre === "film" ? "object.item.videoItem.movie" : "object.item.videoItem"}</upnp:class>`
    + `<res protocolInfo="http-get:*:${mime}:${fonctionnalitesDlna(fichier)}">${echapperXml(url)}</res></item></DIDL-Lite>`;
}
