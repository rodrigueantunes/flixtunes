import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import dgram from "node:dgram";

vi.mock("node:os", () => ({ networkInterfaces: () => ({
  lan: [{ address: "10.0.0.1", internal: false }],
  virtuel: [{ address: "192.168.7.1", internal: false }],
}) }));
import { DecouverteDiffusion } from "./diffusion-reseau.js";

// Vrais Bonjour, multicast-dns et codec DNS. Seule la livraison UDP est simulée :
// sous Linux, un socket lié à l'IP unicast ne reçoit pas les paquets adressés au groupe.
const require = createRequire(import.meta.url);
const requireBonjour = createRequire(require.resolve("bonjour-service"));
const requireMdns = createRequire(requireBonjour.resolve("multicast-dns"));
const dns = requireMdns("dns-packet");
const groupe = "224.0.0.251", service = "Salon._googlecast._tcp.local";
function annonce(ttl = 120, adresse = "10.0.0.2") {
  return dns.encode({ type: "response", flags: 0x400, answers: [
    { type: "PTR", name: "_googlecast._tcp.local", ttl, data: service },
  ], additionals: [
    { type: "SRV", name: service, ttl, data: { port: 8009, target: "salon.local", priority: 0, weight: 0 } },
    { type: "TXT", name: service, ttl, data: [Buffer.from("id=salon"), Buffer.from("fn=Téléviseur du salon")] },
    { type: "A", name: "salon.local", ttl, data: adresse },
  ] });
}
class SocketSimule extends EventEmitter {
  port = 0; liaison = ""; interfaceSortie = ""; ferme = false;
  membres = new Set<string>(); requetes = 0;
  bind(port: number, adresse: string, cb: () => void) {
    this.port = port; this.liaison = adresse || "0.0.0.0";
    queueMicrotask(() => { if (!this.ferme) { this.emit("listening"); cb(); } });
    return this;
  }
  address() { return { port: this.port, address: this.liaison, family: "IPv4" }; }
  addMembership(ip: string, iface: string) { this.membres.add(`${ip}|${iface}`); }
  dropMembership(ip: string, iface: string) { this.membres.delete(`${ip}|${iface}`); }
  setMulticastInterface(iface: string) { this.interfaceSortie = iface; }
  setMulticastTTL() {}
  setMulticastLoopback() {}
  send(message: Buffer, ...args: any[]) {
    const cb = args.at(-1); if (typeof cb === "function") cb(null);
    if (this.port !== 5353) return; // SSDP conserve son socket unicast indépendant.
    const paquet = dns.decode(message);
    if (paquet.questions?.some((q: any) => q.name === "_googlecast._tcp.local")) this.requetes++;
  }
  recevoir(message: Buffer) {
    if (this.ferme || this.port !== 5353 || !this.membres.size) return;
    if (this.liaison !== "0.0.0.0" && this.liaison !== groupe) return;
    this.emit("message", message, { address: "10.0.0.2", port: 5353, family: "IPv4", size: message.length });
  }
  close(cb?: () => void) { this.ferme = true; this.emit("close"); cb?.(); }
}
const sockets: SocketSimule[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); sockets.length = 0; });
function preparer() {
  vi.stubEnv("NODE_ENV", "development");
  vi.spyOn(dgram, "createSocket").mockImplementation((() => {
    const s = new SocketSimule(); sockets.push(s); return s;
  }) as any);
  return new DecouverteDiffusion();
}
const attendreReseau = () => new Promise<void>((resolve) => setImmediate(resolve));

it("reçoit les réponses multicast Linux avec la pile Bonjour réelle sur plusieurs cartes", async () => {
  const d = preparer();
  try {
    d.demarrer(); await attendreReseau();
    const mdns = sockets.filter(s => s.port === 5353);
    expect(mdns).toHaveLength(2);
    expect(mdns.map(s => s.interfaceSortie)).toEqual(["10.0.0.1", "192.168.7.1"]);
    expect(mdns.every(s => s.requetes > 0)).toBe(true);
    for (const s of mdns) s.recevoir(annonce());
    expect(d.lister()).toEqual([expect.objectContaining({ nom: "Téléviseur du salon", adresse: "10.0.0.2", protocole: "googlecast", port: 8009 })]);
    mdns[0]!.recevoir(annonce(0)); expect(d.lister()).toHaveLength(1);
    mdns[1]!.recevoir(annonce(0)); expect(d.lister()).toHaveLength(0);
  } finally { d.fermer(); }
  expect(sockets.every(s => s.ferme && s.membres.size === 0)).toBe(true);
});

it("refuse une adresse publique annoncée en multicast et ignore les annonces après arrêt", async () => {
  const d = preparer();
  try {
    d.demarrer(); await attendreReseau();
    const s = sockets.find(s => s.port === 5353)!;
    s.recevoir(annonce(120, "8.8.8.8")); expect(d.lister()).toHaveLength(0);
    s.recevoir(annonce(0)); s.recevoir(annonce()); expect(d.lister()).toHaveLength(1);
    d.fermer(); s.recevoir(annonce()); expect(d.lister()).toHaveLength(0);
  } finally { d.fermer(); }
});
