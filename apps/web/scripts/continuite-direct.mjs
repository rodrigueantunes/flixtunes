/** Essai réel du lecteur, sur vidéo synthétique locale. Aucun flux tiers ni serveur utilisateur. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, createReadStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-continuite-"));
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const httpLocal = process.env.FLIXTUNES_TEST_HTTP_LOCAL === "1";
const hoteHttp = "flixtunes-http.test";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
console.log("Création d'une vidéo synthétique dans", dossier);
execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
  "testsrc2=size=320x180:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
  "-t", "360", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "30", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "64k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
  "-hls_segment_filename", path.join(dossier, "seg%d.ts"), path.join(dossier, "fixture.m3u8")], { windowsHide: true });

let coupureJusqua = 0, panneSource = null;
let demandesB = 0, resultats = [];
const depart = Date.now() - 90_000;
const serveur = await createServer({ root, configFile: false, plugins: [react(), {
  name: "continuite-fixture", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, "http://fixture");
      if (url.pathname === "/essai") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await vite.transformIndexHtml("/essai", `<div id="root"></div>
          <script type="module">import React from 'react';
          import '/src/styles.css';
          import {createRoot} from 'react-dom/client';
          import {LecteurDirect} from '/src/LecteurDirect.tsx';
          createRoot(document.getElementById('root')).render(React.createElement(LecteurDirect,
            {chaine:{id:'test',nom:'Vidéo synthétique'},precedente:null,onChaine:()=>{},onClose:()=>{}}));</script>`));
        return;
      }
      if (url.pathname === "/api/live/channels/test") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ sources: ["a", "b"].map((id) => ({
          url: `/stream/${id}/live.m3u8`, identifiant: id, empreinte: id, echecs: 0,
        })) })); return;
      }
      if (url.pathname.endsWith("/resultat")) {
        let body = ""; for await (const part of req) body += part;
        resultats.push(JSON.parse(body)); res.statusCode = 204; res.end(); return;
      }
      if (url.pathname.endsWith("/sondes")) { res.setHeader("Content-Type", "application/json"); res.end('{"muettes":[]}'); return; }
      if (!url.pathname.startsWith("/stream/")) return next();
      res.setHeader("Cache-Control", "no-store");
      const source = url.pathname.split("/")[2];
      if (source === "b") demandesB++;
      if (Date.now() < coupureJusqua || panneSource === source) { res.statusCode = 503; res.end(); return; }
      if (url.pathname.endsWith("m3u8")) {
        const dernier = Math.min(177, Math.floor((Date.now() - depart) / 2_000) - 1);
        const premier = Math.max(0, dernier - 39);
        let texte = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${premier + (source === "b" ? 10_000 : 0)}\n`;
        for (let i = premier; i <= dernier; i++) texte += `#EXT-X-PROGRAM-DATE-TIME:${new Date(depart + i * 2_000).toISOString()}\n#EXTINF:2,\nseg${i}.ts\n`;
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl"); res.end(texte); return;
      }
      const nom = path.basename(url.pathname);
      if (!/^seg\d+\.ts$/.test(nom) || !existsSync(path.join(dossier, nom))) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", "video/mp2t");
      createReadStream(path.join(dossier, nom)).pipe(res);
    });
  },
}], server: { host: "127.0.0.1", port: 0, hmr: false, allowedHosts: [hoteHttp] } });
await serveur.listen();
const base = `http://${httpLocal ? hoteHttp : "127.0.0.1"}:${serveur.httpServer.address().port}`;
const profil = path.join(dossier, "chrome");
const processus = spawn(chrome, ["--headless=new", "--disable-gpu", "--autoplay-policy=no-user-gesture-required",
  ...(httpLocal ? [`--host-resolver-rules=MAP ${hoteHttp} 127.0.0.1`, "--no-proxy-server"] : []),
  "--mute-audio", "--remote-debugging-port=0", `--user-data-dir=${profil}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let ws;
try {
  for (let i = 0; i < 100 && !existsSync(path.join(profil, "DevToolsActivePort")); i++) await attendre(100);
  const [port] = readFileSync(path.join(profil, "DevToolsActivePort"), "utf8").split("\n");
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = tabs.find((t) => t.type === "page") ?? await (await fetch(
    `http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let numero = 0; const attentes = new Map();
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data); if (m.id) { attentes.get(m.id)?.(m); attentes.delete(m.id); }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++numero;
    const timer = setTimeout(() => { attentes.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 10_000);
    attentes.set(id, (m) => { clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluer = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await cdp("Page.navigate", { url: `${base}/essai` });
  await attendre(20_000);
  const contexte = await evaluer(`({securise: window.isSecureContext, uuid: typeof crypto.randomUUID})`);
  if (httpLocal && (contexte.securise || contexte.uuid !== "undefined")) throw new Error("Le test doit reproduire un HTTP LAN non sécurisé");
  const etat = () => evaluer(`(() => {const v=document.querySelector('video:not(.lecteur-direct-releve)');
    if(!v) return {erreur:document.body.innerText};
    return {temps:v.currentTime,paused:v.paused,ready:v.readyState,frames:v.getVideoPlaybackQuality().totalVideoFrames,
      source:document.querySelector('.lecteur-direct-sources')?.textContent,
      tampon:v.buffered.length?v.buffered.end(v.buffered.length-1)-v.currentTime:0,
      retard:v.seekable.length?v.seekable.end(v.seekable.length-1)-v.currentTime:0};})()`);
  let avant = await etat();
  if (!Number.isFinite(avant.temps) || avant.temps < 1 || avant.frames < 1) throw new Error(`Lecture absente: ${JSON.stringify(avant)}`);
  console.log("Lecture établie", avant);
  // Souris immobile dans le lecteur et focus retenu : aucune incrustation permanente.
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 300, y: 150 });
  await evaluer(`document.querySelector('.lecteur-direct-barre button').focus();
    document.querySelector('details').open=true`);
  await attendre(5_000);
  const commandesCachees = await evaluer(`(() => ({
    barre: getComputedStyle(document.querySelector('.lecteur-direct-barre')).visibility,
    diagnostic: document.querySelector('.lecteur-direct-diagnostic').hidden,
    ouvert: document.querySelector('.lecteur-direct-diagnostic').open
  }))()`);
  if (commandesCachees.barre !== "hidden" || !commandesCachees.diagnostic || commandesCachees.ouvert) {
    throw new Error('Commandes persistantes : ' + JSON.stringify(commandesCachees));
  }
  const scenarios = [];
  let sourceAvantPanne = "";
  for (const duree of [5, 15, 30, "secours"]) {
    console.log("Scénario", duree);
    if (duree === "secours") {
      sourceAvantPanne = avant.source;
      panneSource = avant.source.includes("1/2") ? "a" : "b";
    } else coupureJusqua = Date.now() + duree * 1000;
    const jusqua = Date.now() + (duree === "secours" ? 35 : duree + 8) * 1000;
    let dernierProgres = Date.now(), gelMaxMs = 0, retardMaxS = 0;
    while (Date.now() < jusqua) {
      await attendre(250);
      const courant = await etat();
      if (courant.frames !== avant.frames || courant.source !== avant.source) dernierProgres = Date.now();
      gelMaxMs = Math.max(gelMaxMs, Date.now() - dernierProgres);
      retardMaxS = Math.max(retardMaxS, courant.retard ?? 0);
      avant = courant;
    }
    scenarios.push({ duree, gelMaxMs, retardMaxS, fin: avant });
    console.log(JSON.stringify(scenarios.at(-1)));
  }
  const rapport = { navigateur: chrome, contexte, commandesCachees, scenarios, demandesB, resultats };
  writeFileSync(path.join(dossier, "rapport.json"), JSON.stringify(rapport, null, 2));
  console.log("Rapport :", path.join(dossier, "rapport.json"));
  if (scenarios.some((s) => s.gelMaxMs > 1500 || s.retardMaxS > 61) || avant.source === sourceAvantPanne) process.exitCode = 1;
} finally {
  ws?.close(); processus.kill(); await serveur.close();
}
