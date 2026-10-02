import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { commandeDiffusionSchema, etatDiffusionVide } from "@flixtunes/contracts";
import { RegistreDiffusion } from "./diffusion-registre.js";
import { decoderCast, encoderCast } from "./diffusion-cast.js";
import { descriptionDlna, ipv4Privee, urlRecepteur } from "./diffusion-reseau.js";
import { echapperXml, secondesDlna, tempsDlna } from "./diffusion-dlna.js";
import { routesDiffusion } from "./diffusion-routes.js";
import { db, getDefaultProfile } from "./database.js";
import { ouvrirSession, revoquerSession } from "./sessions-profil.js";
import { origineDiffusion } from "./diffusion-medias.js";
import { verdictWan } from "./wan-exposition.js";

describe("télécommande isolée par profil", () => {
  it("ne divulgue ni clé ni lecture à un autre profil, et exige la clé du récepteur", () => {
    const r = new RegistreDiffusion(), tv = r.inscrire("parent", "TV Philips");
    expect(r.lister("enfant")).toEqual([]);
    expect(r.lister("parent")[0]).not.toHaveProperty("cle");
    expect(r.commander(tv.id, "enfant", { type: "pause" })).toBeNull();
    expect(r.battre(tv.id, "parent", "0".repeat(64), etatDiffusionVide(), [])).toBeNull();
    expect(r.battre(tv.id, "enfant", tv.cle, etatDiffusionVide(), [])).toBeNull();
  });
  it("distingue ordre envoyé et ordre effectivement appliqué, sans rejouer au battement suivant", () => {
    const r = new RegistreDiffusion(), tv = r.inscrire("p", "TV");
    const id = r.commander(tv.id, "p", { type: "pause" })!;
    expect(r.resultat(tv.id, "p", id)).toBeNull();
    expect(r.battre(tv.id, "p", tv.cle, etatDiffusionVide(), [])).toEqual([{ id, commande: { type: "pause" } }]);
    expect(r.battre(tv.id, "p", tv.cle, etatDiffusionVide(), [{ id, ok: true }])).toEqual([]);
    expect(r.resultat(tv.id, "p", id)).toEqual({ id, ok: true });
  });
  it("oublie les ordres périmés et les TV éteintes", () => {
    let now = 0; const r = new RegistreDiffusion(() => now), tv = r.inscrire("p", "TV");
    r.commander(tv.id, "p", { type: "reprendre" }); now = 11_000;
    expect(r.battre(tv.id, "p", tv.cle, etatDiffusionVide(), [])).toEqual([]);
    now = 42_000; expect(r.lister("p")).toEqual([]);
  });
  it("borne les files même si le récepteur ne répond plus", () => {
    const r = new RegistreDiffusion(), tv = r.inscrire("p", "TV");
    for (let i = 0; i < 16; i++) r.commander(tv.id, "p", { type: "pause" });
    expect(() => r.commander(tv.id, "p", { type: "pause" })).toThrow();
  });
  it.each([{ type: "volume", valeur: 2 }, { type: "position", valeur: -1 }, { type: "volume", valeur: NaN }, { type: "ouvrirUrl", url: "http://nas/admin" }])("refuse une commande invalide %j", (c) => {
    expect(commandeDiffusionSchema.safeParse(c).success).toBe(false);
  });
});

describe("protocoles réseau bornés", () => {
  it("encode et décode une enveloppe Cast UTF-8", () => {
    const m = { source: "sender-1", destination: "receiver-0", espace: "urn:x-cast:com.google.cast.media", donnees: { type: "LOAD", titre: "Été à la télé – Séries", requestId: 3 } };
    const b = encoderCast(m); expect(b.readUInt32BE()).toBe(b.length - 4); expect(decoderCast(b.subarray(4))).toEqual(m);
  });
  it("ignore un message binaire de périphérique sans fermer la connexion média", () => {
    expect(decoderCast(Buffer.from([8, 0, 40, 1, 58, 2, 0, 255])).donnees.type).toBe("BINARY");
  });
  it.each([Buffer.from([0x12, 255]), Buffer.from([0x12, 0x80, 0x80, 0x80, 0x80, 0x80]), Buffer.from([0x0f]), Buffer.alloc(1048577)])("refuse les messages Cast malformés", (b) => {
    expect(() => decoderCast(b)).toThrow();
  });
  it.each(["127.0.0.1", "169.254.169.254", "8.8.8.8", "::1", "10.999.0.1", "010.0.0.1"]) ("refuse une découverte hors LAN : %s", (ip) => expect(ipv4Privee(ip)).toBe(false));
  it.each(["http://127.0.0.1/admin", "http://10.0.0.3/admin", "http://user:pass@10.0.0.2/control", "https://10.0.0.2/control", "file:///etc/passwd"]) ("refuse une redirection de la découverte : %s", (url) => {
    expect(() => urlRecepteur(url, "10.0.0.2")).toThrow();
  });
  it("accepte un récepteur DLNA et uniquement ses services à la même adresse", () => {
    const xml = '<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Téléviseur</friendlyName><UDN>uuid:test</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/transport</controlURL></service></serviceList></device></root>';
    expect(descriptionDlna(xml, "http://10.0.0.2/description", "10.0.0.2")?.transport?.url).toBe("http://10.0.0.2/transport");
    expect(() => descriptionDlna(xml.replace("/transport", "http://10.0.0.3/admin"), "http://10.0.0.2/description", "10.0.0.2")).toThrow();
    expect(() => descriptionDlna('<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml, "http://10.0.0.2/description", "10.0.0.2")).toThrow();
  });
  it("échappe les métadonnées SOAP et conserve les positions longues", () => {
    expect(echapperXml('A&B<"é">')).toBe("A&amp;B&lt;&quot;é&quot;&gt;");
    expect(tempsDlna(3723.9)).toBe("01:02:03"); expect(secondesDlna("01:02:03")).toBe(3723);
  });
  it("refuse une origine de cast publique ou locale à la machine", () => {
    expect(() => origineDiffusion("localhost:4000")).toThrow();
    expect(() => origineDiffusion("example.com")).toThrow();
    expect(origineDiffusion("10.20.30.254:4000")).toBe("http://10.20.30.254:4000");
    expect(origineDiffusion("10.20.30.254:4000", "https")).toBe("https://10.20.30.254:4000");
    expect(origineDiffusion("nas.local:4000", "http", "::ffff:10.20.30.254", 4000)).toBe("http://10.20.30.254:4000");
    expect(() => origineDiffusion("nas.local:4000", "http", "127.0.0.1", 4000)).toThrow();
    expect(() => origineDiffusion("nas.local:4000", "https", "10.20.30.254", 4000)).toThrow();
  });
});

describe("API cast", async () => {
  const app = Fastify(); await routesDiffusion(app); await app.ready();
  const profil = getDefaultProfile();
  const { token } = ouvrirSession({ profileId: profil.id, origine: "lan", dureeHeures: 1 });
  const headers = { "x-flixtunes-profile-token": token };
  const autre = randomUUID();
  db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, ?, ?, ?)").run(autre, "Cast test", "#112233", "fr-FR");
  const tokenAutre = ouvrirSession({ profileId: autre, origine: "lan", dureeHeures: 1 }).token;
  afterAll(async () => { await app.close(); revoquerSession(token); revoquerSession(tokenAutre); db.prepare("DELETE FROM profiles WHERE id = ?").run(autre); });
  it("exige une session même sur le LAN, et ignore un profileId usurpé", async () => {
    expect((await app.inject({ url: `/api/diffusion/cibles?profileId=${profil.id}` })).statusCode).toBe(401);
    const inscription = await app.inject({ method: "POST", url: "/api/diffusion/lecteurs", headers, payload: { nom: "Téléviseur" } });
    const i = inscription.json(); expect(inscription.statusCode).toBe(200);
    const liste = await app.inject({ url: `/api/diffusion/cibles?profileId=${profil.id}`, headers: { "x-flixtunes-profile-token": tokenAutre } });
    expect(liste.json().cibles).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/api/diffusion/cibles/${i.id}/commande`, headers: { "x-flixtunes-profile-token": tokenAutre }, payload: { type: "pause" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/diffusion/lecteurs/${i.id}`, headers, payload: { cle: "0".repeat(64), etat: etatDiffusionVide() } })).statusCode).toBe(404);
  });
  it("refuse les contenus inexistants avant de commander la TV", async () => {
    const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/inconnue/commande", headers,
      payload: { type: "charger", contenu: { genre: "media", id: "absent" } } }); expect(r.statusCode).toBe(404);
  });
  it("refuse les jetons de flux inconnus et n'expose aucune route Cast sur le WAN", async () => {
    expect((await app.inject({ url: `/api/diffusion/flux/${"a".repeat(64)}/media.mp4` })).statusCode).toBe(404);
    for (const route of ["/api/diffusion/cibles", "/api/diffusion/lecteurs", "/api/diffusion/airplay", "/api/diffusion/flux/:cle/:nom"]) {
      expect(verdictWan("GET", route).autorise).toBe(false); expect(verdictWan("POST", route).autorise).toBe(false);
    }
  });
});
