import { createHash } from "node:crypto";
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import { Bonjour, type Browser, type Service } from "bonjour-service";
import { XMLParser } from "fast-xml-parser";

export interface Recepteur {
  id: string; nom: string; protocole: "googlecast" | "dlna"; adresse: string; port: number; vu: number;
  adresses?: string[];
  transport?: { url: string; type: string }; rendu?: { url: string; type: string };
}
export function ipv4Privee(ip: string): boolean {
  const octets = ip.split(".");
  if (octets.length !== 4 || octets.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255 || String(Number(x)) !== x)) return false;
  const [a, b] = octets.map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b! >= 16 && b! <= 31;
}
export function urlRecepteur(valeur: string, adresse: string, base?: string): string {
  const u = new URL(valeur, base);
  if (!ipv4Privee(adresse) || u.hostname !== adresse || u.protocol !== "http:" || u.username || u.password || u.hash) {
    throw new Error("Adresse de récepteur refusée");
  }
  return u.href;
}
const parser = new XMLParser({ removeNSPrefix: true, processEntities: true, ignoreAttributes: true });
export function analyserXml(xml: string): Record<string, any> {
  if (xml.length > 256 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Réponse du récepteur invalide");
  return parser.parse(xml) as Record<string, any>;
}
export async function texteBorne(reponse: Response): Promise<string> {
  if (!reponse.ok || !reponse.body) throw new Error("Le récepteur ne répond pas");
  const lecteur = reponse.body.getReader(), morceaux: Uint8Array[] = []; let taille = 0;
  try { while (true) { const r = await lecteur.read(); if (r.done) break;
    taille += r.value.length; if (taille > 256 * 1024) throw new Error("Réponse du récepteur trop grande"); morceaux.push(r.value);
  } } finally { await lecteur.cancel().catch(() => {}); }
  return Buffer.concat(morceaux).toString("utf8");
}
export function descriptionDlna(xml: string, location: string, adresse: string): Recepteur | null {
  const root = analyserXml(xml).root;
  const chercher = (d: any, profondeur = 0): any => {
    if (!d || profondeur > 5) return null;
    if (String(d.deviceType).includes(":MediaRenderer:")) return d;
    for (const enfant of [d.deviceList?.device ?? []].flat().slice(0, 64)) { const trouve = chercher(enfant, profondeur + 1); if (trouve) return trouve; }
    return null;
  };
  const device = chercher(root?.device); if (!device) return null;
  const base = root.URLBase ? urlRecepteur(String(root.URLBase), adresse, location) : location;
  const services = [device.serviceList?.service ?? []].flat();
  const service = (nom: string) => {
    const s = services.find((v: any) => new RegExp(`^urn:schemas-upnp-org:service:${nom}:[1-3]$`).test(String(v.serviceType)));
    return s ? { type: String(s.serviceType), url: urlRecepteur(String(s.controlURL), adresse, base) } : undefined;
  };
  const transport = service("AVTransport"); if (!transport) return null;
  return { id: `dlna-${createHash("sha256").update(`${adresse}|${device.UDN}`).digest("hex").slice(0, 24)}`,
    nom: String(device.friendlyName ?? "Téléviseur DLNA").slice(0, 120), adresse,
    port: Number(new URL(location).port || 80), protocole: "dlna", vu: Date.now(), transport, rendu: service("RenderingControl") };
}

/** Découverte à la demande, bornée, sur les interfaces privées. Aucun scan de ports ni URL fournie
 * par le contrôleur. L'adresse SSDP doit désigner exactement la machine qui a répondu. */
export class DecouverteDiffusion {
  private cibles = new Map<string, Recepteur>();
  private bonjours: Bonjour[] = []; private browsers: Browser[] = []; private sockets: dgram.Socket[] = [];
  private timer?: NodeJS.Timeout; private enCours = new Set<string>(); private ferme = false;
  private garder(cible: Recepteur) { if (!this.ferme && (this.cibles.size < 128 || this.cibles.has(cible.id))) this.cibles.set(cible.id, cible); }
  demarrer() {
    if (this.timer || this.ferme || process.env.NODE_ENV === "test") return;
    const interfaces = [...new Set(Object.values(networkInterfaces()).flat()
      .filter((r) => r && !r.internal && ipv4Privee(r.address)).map((r) => r!.address))].slice(0, 8);
    // Sur les hôtes avec cartes virtuelles, la route multicast par défaut peut manquer le LAN.
    // Chaque interface privée émet sa propre recherche ; l'identité mDNS évite les doublons.
    const observations: Map<string, Recepteur>[] = [];
    const reconcilier = (id: string) => {
      const reste = observations.map((o) => o.get(id)).filter((c): c is Recepteur => !!c)
        .sort((a, b) => b.vu - a.vu)[0];
      if (reste) this.garder(reste); else this.cibles.delete(id);
    };
    for (const adresseLocale of interfaces.length ? interfaces : [undefined]) {
      try {
        // bonjour-service transmet ces options à multicast-dns, mais les type comme ServiceConfig.
        // Ne pas confondre interface d'émission et adresse d'écoute : multicast-dns
        // utilise sinon interface pour bind(), ce qui perd les réponses multicast sous Linux.
        const options = { bind: "0.0.0.0", interface: adresseLocale, reuseAddr: true };
        const bonjour = new Bonjour(options as ConstructorParameters<typeof Bonjour>[0], () => {});
        this.bonjours.push(bonjour);
        const observees = new Map<string, Recepteur>(); observations.push(observees);
        const identifier = (s: Service) => `cast-${createHash("sha256").update(String(s.txt?.id || s.fqdn || s.name)).digest("hex").slice(0, 24)}`;
        const actualiser = (s: Service) => {
          const adresses = [...new Set(s.addresses?.filter(ipv4Privee))].slice(0, 4);
          const adresse = adresses[0], id = identifier(s);
          if (this.ferme || !adresse || s.port < 1 || s.port > 65535 || observees.size >= 128 && !observees.has(id)) return;
          observees.set(id, { id, nom: String(s.txt?.fn || s.name).slice(0, 120), adresse, adresses,
            port: s.port, protocole: "googlecast", vu: Date.now() });
          reconcilier(id);
        };
        const browser = bonjour.find({ type: "googlecast" }, actualiser); this.browsers.push(browser);
        browser.on("srv-update", actualiser); browser.on("txt-update", actualiser);
        browser.on("down", (s) => { const id = identifier(s); observees.delete(id); reconcilier(id); });
      } catch { /* Les autres interfaces, SSDP et les lecteurs FlixTunes restent disponibles. */ }
    }
    for (const adresseLocale of interfaces) {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true }); this.sockets.push(socket);
      socket.on("error", () => {});
      socket.on("message", (message, rinfo) => { void this.reponseSsdp(message, rinfo.address); });
      socket.bind(0, adresseLocale, () => { try { socket.setMulticastTTL(2); this.chercher(socket); } catch { /* Interface disparue pendant la découverte. */ } });
    }
    this.timer = setInterval(() => { for (const b of this.browsers) b.update(); for (const s of this.sockets) this.chercher(s); }, 30_000);
    this.timer.unref();
  }
  private chercher(socket: dgram.Socket) {
    const message = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n');
    try { socket.send(message, 1900, "239.255.255.250", () => {}); } catch { /* Interface déconnectée. */ }
  }
  private async reponseSsdp(message: Buffer, adresse: string) {
    if (this.ferme || !ipv4Privee(adresse) || message.length > 8192 || this.enCours.size >= 8) return;
    const location = /^location:\s*(.+)$/im.exec(message.toString())?.[1]?.trim(); if (!location) return;
    try {
      const url = urlRecepteur(location, adresse);
      const connue = [...this.cibles.values()].find((c) => c.adresse === adresse && c.protocole === "dlna");
      if (connue) { connue.vu = Date.now(); return; }
      if (this.enCours.has(url)) return; this.enCours.add(url);
      try {
        const xml = await texteBorne(await fetch(url, { redirect: "error", signal: AbortSignal.timeout(4000) }));
        const cible = descriptionDlna(xml, url, adresse); if (cible) this.garder(cible);
      } finally { this.enCours.delete(url); }
    } catch { /* Annonce invalide ou appareil parti. */ }
  }
  lister() {
    this.demarrer(); const now = Date.now();
    for (const [id, cible] of this.cibles) if (cible.protocole === "dlna" && now - cible.vu > 95_000) this.cibles.delete(id);
    return [...this.cibles.values()];
  }
  trouver(id: string) { return this.lister().find((c) => c.id === id); }
  fermer() {
    this.ferme = true; clearInterval(this.timer); for (const b of this.browsers) b.stop(); for (const b of this.bonjours) b.destroy();
    for (const socket of this.sockets) { try { socket.close(); } catch {} } this.cibles.clear();
  }
}
