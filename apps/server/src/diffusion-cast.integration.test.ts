import { beforeAll, afterAll, expect, it } from "vitest";
import tls from "node:tls";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TransportCast } from "./diffusion-cast.js";
import type { EtatDiffusion } from "@flixtunes/contracts";

// Codec du récepteur de test indépendant du transport, avec les champs CASTV2 du protocole.
// Une erreur symétrique encodeur/décodeur de production ne doit pas rendre le test vert.
function decoderCast(corps: Buffer) {
  let p = 0;
  const entier = () => { let valeur = 0, bits = 0, octet: number;
    do { octet = corps[p++]!; valeur |= (octet & 127) << bits; bits += 7; } while (octet & 128);
    return valeur;
  };
  const champs: Record<number, string | number> = {};
  while (p < corps.length) {
    const tag = entier(), type = tag & 7;
    if (type === 0) champs[tag >>> 3] = entier();
    else if (type === 2) { const n = entier(); champs[tag >>> 3] = corps.subarray(p, p + n).toString("utf8"); p += n; }
    else throw new Error("Trame de test invalide");
  }
  expect(champs[1]).toBe(0); expect(champs[5]).toBe(0);
  return { source: String(champs[2]), destination: String(champs[3]), espace: String(champs[4]), donnees: JSON.parse(String(champs[6])) };
}
function encoderCast(m: { source: string; destination: string; espace: string; donnees: Record<string, unknown> }) {
  const octets: number[] = [8, 0];
  for (const [tag, valeur] of [[18, m.source], [26, m.destination], [34, m.espace], [50, JSON.stringify(m.donnees)]] as const) {
    if (tag === 50) octets.push(40, 0);
    const b = Buffer.from(valeur); octets.push(tag);
    let n = b.length; while (n >= 128) { octets.push((n & 127) | 128); n >>>= 7; } octets.push(n, ...b);
  }
  const trame = Buffer.alloc(4 + octets.length); trame.writeUInt32BE(octets.length); Buffer.from(octets).copy(trame, 4); return trame;
}

let serveur: tls.Server, dossier: string, port = 0;
const charges: Record<string, unknown>[] = [];
const recus: string[] = [], sockets = new Set<tls.TLSSocket>();
let scenario = "normal", connexionsRefusees = 0, connexions = 0;
beforeAll(async () => {
  dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-cast-test-"));
  const opensslWindows = "C:/Program Files/Git/usr/bin/openssl.exe";
  execFileSync(existsSync(opensslWindows) ? opensslWindows : "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dossier, "key.pem"),
    "-out", path.join(dossier, "cert.pem"), "-days", "1", "-subj", "/CN=FlixTunes-Test"], { windowsHide: true, stdio: "ignore" });
  serveur = tls.createServer({ key: readFileSync(path.join(dossier, "key.pem")), cert: readFileSync(path.join(dossier, "cert.pem")) }, (socket) => {
    const numero = ++connexions; const canaux = new Set<string>();
    sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
    let buffer = Buffer.alloc(0), lecture = "PLAYING", position = 17, debutLecture = Date.now(), contenu = "", volume = .7, lance = scenario === "existant";
    socket.on("data", (b) => {
      buffer = Buffer.concat([buffer, b]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE() + 4) {
        const n = buffer.readUInt32BE(), m = decoderCast(buffer.subarray(4, n + 4)); buffer = buffer.subarray(n + 4);
        const d = m.donnees; recus.push(d.type);
        if (d.type === "CONNECT") {
          if (m.espace === "urn:x-cast:com.google.cast.tp.connection" && m.source === "sender-0"
            && d.connType === 0 && typeof d.userAgent === "string" && d.senderInfo?.connectionType === 1) canaux.add(m.destination);
          continue;
        }
        // Récepteur strict : aucune réponse sur un canal qui n'a pas été correctement ouvert.
        if (!canaux.has(m.destination)) continue;
        const repondre = (donnees: Record<string, unknown>, source = m.destination, espace = m.espace) => {
          const id = scenario === "id-texte" ? String(d.requestId) : d.requestId;
          const statutDiffuse = d.type === "GET_STATUS" && m.espace.endsWith(".receiver") && ["sans-id", "id-zero"].includes(scenario);
          const b = encoderCast({ source, destination: statutDiffuse ? "*" : m.source, espace,
            donnees: { requestId: statutDiffuse ? (scenario === "sans-id" ? undefined : 0) : id, ...donnees } });
          socket.write(b.subarray(0, 7)); socket.write(b.subarray(7));
        };
        const status = () => ({ type: "RECEIVER_STATUS", status: { volume: { level: volume }, applications: lance ? [{ appId: "CC1AD845", transportId: "test-transport", sessionId: "session-test" }] : [] } });
        if (d.type === "GET_STATUS" && m.espace === "urn:x-cast:com.google.cast.receiver") {
          if (scenario === "muet" || scenario === "premier-etat-perdu" && numero === 1) continue;
          if (scenario === "canal-etranger") {
            repondre({ type: "INVALID_REQUEST" }, "autre-application");
            repondre({ type: "INVALID_REQUEST" }, m.destination, "urn:x-cast:com.google.cast.media");
          }
          repondre(status());
        }
        else if (d.type === "LAUNCH") {
          if (scenario === "lent") { repondre(status()); setTimeout(() => { lance = true; repondre(status()); }, 50); }
          else { lance = true; repondre(status()); }
        }
        else if (d.type === "PING") repondre({ type: "PONG" });
        else if (d.type === "SET_VOLUME") { volume = d.volume.level; repondre({ type: "RECEIVER_STATUS", status: { volume: { level: volume } } }); }
        else if (["LOAD", "GET_STATUS", "PLAY", "PAUSE", "STOP", "SEEK"].includes(d.type)) {
          if (d.type === "LOAD" && d.media.contentId.includes("refuse")) { repondre({ type: "LOAD_FAILED" }); continue; }
          if (d.type === "LOAD") { charges.push(d.media); position = d.currentTime; debutLecture = Date.now(); contenu = d.media.contentId;
            if (scenario === "erreur-media") lecture = "IDLE";
          }
          if (d.type === "PAUSE") lecture = "PAUSED";
          if (d.type === "PLAY") lecture = "PLAYING";
          if (d.type === "STOP") lecture = "IDLE";
          if (d.type === "SEEK") position = d.currentTime;
          repondre({ type: "MEDIA_STATUS", status: [{ mediaSessionId: 42, playerState: lecture, currentTime: position + (d.type === "GET_STATUS" && lecture === "PLAYING" ? (Date.now() - debutLecture) / 1000 : 0),
            ...(scenario === "erreur-media" ? { idleReason: "ERROR" } : {}),
            media: { contentId: contenu, streamType: "BUFFERED", duration: 600 } }] });
        }
      }
    });
  });
  serveur.prependListener("connection", (socket) => { if (connexionsRefusees > 0) { connexionsRefusees--; socket.destroy(); } });
  serveur.listen(0, "127.0.0.1"); await once(serveur, "listening");
  port = (serveur.address() as { port: number }).port;
});
afterAll(async () => {
  for (const s of sockets) s.destroy();
  if (serveur) await new Promise<void>((r) => serveur.close(() => r()));
  if (dossier && path.dirname(dossier) === tmpdir() && path.basename(dossier).startsWith("flixtunes-cast-test-")) rmSync(dossier, { recursive: true, force: true });
});
it("pilote un récepteur Cast simulé sur une vraie connexion TLS", async () => {
  const etats: Partial<EtatDiffusion>[] = [];
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, (e) => etats.push(e));
  try {
    await transport.charger("http://10.0.0.1/media.m3u8", "application/vnd.apple.mpegurl", "Épisode testé", false, 120, true);
    expect(charges.at(-1)).toMatchObject({hlsSegmentFormat:"FMP4",hlsVideoSegmentFormat:"FMP4"});
    expect(etats.at(-1)?.lecture).toBe("lecture"); expect(etats.at(-1)?.position).toBeGreaterThan(120);
    await transport.commander({ type: "pause" }); expect(etats.at(-1)?.lecture).toBe("pause");
    await transport.commander({ type: "reprendre" }); expect(etats.at(-1)?.lecture).toBe("lecture");
    await transport.commander({ type: "position", valeur: 240 }); expect(etats.at(-1)?.position).toBe(240);
    await transport.commander({ type: "volume", valeur: .3 }); expect(etats.at(-1)?.volume).toBe(.3);
    await transport.commander({ type: "arreter" }); expect(etats.at(-1)?.lecture).toBe("repos");
    expect(recus).toEqual(expect.arrayContaining(["CONNECT", "LAUNCH", "LOAD", "PAUSE", "PLAY", "SEEK", "SET_VOLUME", "STOP"]));
  } finally { transport.fermer(); }
});
it("rend un refus du récepteur sans prétendre que le transfert a réussi", async () => {
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, () => {});
  try { await expect(transport.charger("http://10.0.0.1/refuse.mp4", "video/mp4", "Test", false, 0)).rejects.toThrow("refusée"); }
  finally { transport.fermer(); }
});
it.each(["lent", "existant", "reconnexion", "sans-id", "id-zero", "id-texte", "canal-etranger", "premier-etat-perdu"])("gère le récepteur %s sans abandonner le transfert", async (mode) => {
  scenario = mode; recus.length = 0; connexions = 0;
  if (mode === "reconnexion") connexionsRefusees = 1;
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, () => {});
  try {
    await transport.charger("http://10.0.0.1/test.mp4", "video/mp4", "Test", false, 0);
    expect(recus).toContain("LOAD");
    if (mode === "premier-etat-perdu") expect(connexions).toBe(2);
    if (mode === "existant") expect(recus).not.toContain("LAUNCH");
    if (mode === "reconnexion") expect(connexionsRefusees).toBe(0);
  } finally { transport.fermer(); scenario = "normal"; }
});
it("remonte immédiatement l’erreur de décodage au lieu d’attendre un démarrage impossible", async () => {
  scenario = "erreur-media";
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, () => {});
  try { await expect(transport.charger("http://10.0.0.1/test.mp4", "video/mp4", "Test", false, 0)).rejects.toThrow("CAST_MEDIA"); }
  finally { transport.fermer(); scenario = "normal"; }
});

it("échoue après deux liaisons sans état, même si le récepteur répond au heartbeat", async () => {
  scenario = "muet"; connexions = 0; recus.length = 0;
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, () => {});
  try {
    await expect(transport.verifier()).rejects.toThrow("CAST_DELAI_GET_STATUS");
    expect(connexions).toBe(2); expect(recus).not.toContain("LAUNCH"); expect(recus).not.toContain("LOAD");
    expect(recus).toContain("PING");
  } finally { transport.fermer(); scenario = "normal"; }
});

it("rend une erreur d’observateur sans exception non gérée ni délai GET_STATUS", async () => {
  scenario = "normal";
  const transport = new TransportCast({ id: "test", adresse: "127.0.0.1", port, nom: "Fixture", protocole: "googlecast", vu: Date.now() }, () => { throw new Error("Observateur de test défaillant"); });
  try { await expect(transport.verifier()).rejects.toThrow("Observateur de test défaillant"); }
  finally { transport.fermer(); }
});
