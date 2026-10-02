/** Banc réel Electron + VLC, isolé du NAS et des réglages de l'utilisateur. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, createReadStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const depot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-vlc-r6-"));
const duree = Number(process.env.FLIXTUNES_TEST_DUREE_S ?? 3600);
const commandes = process.env.FLIXTUNES_TEST_COMMANDES === "1";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(JSON.stringify({ dossier, duree }));
execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
  "testsrc2=size=320x180:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
  "-t", String(duree + 180), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "30", "-sc_threshold", "0",
  "-c:a", "aac", "-b:a", "64k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
  "-hls_segment_filename", path.join(dossier, "seg%d.ts"), path.join(dossier, "fixture.m3u8")], { windowsHide: true });
let coupure = 0, autorise = 0, refuse = 0, relais = 0;
const depart = Date.now() - 90_000;
const resultats = [];
const serveur = await createServer({ root: path.join(depot, "apps/web"), configFile: false, plugins: [react(), {
  name: "banc-vlc", configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const u = new URL(req.url, "http://fixture");
      if (u.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Set-Cookie", "flixtunes-test=r5; HttpOnly; SameSite=Strict; Path=/");
        res.end(await vite.transformIndexHtml("/", `<div id="root"></div><script type="module">
          import React from 'react'; import '/src/styles.css'; import {createRoot} from 'react-dom/client';
          import {LecteurDirect} from '/src/LecteurDirect.tsx';
          window.__ouvrir=()=>{window.__root=createRoot(document.getElementById('root'));
          window.__root.render(React.createElement(LecteurDirect,{chaine:{id:'test',nom:'Banc VLC'},precedente:null,onChaine:()=>{},onClose:()=>window.__root.unmount()}));
          };window.__ouvrir();
          </script>`)); return;
      }
      if (u.pathname === "/api/live/channels/test") {
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ sources: ["live", "liveb"].map((t) => ({
          url: `/api/live/relais?t=${t}`, relais: `/api/live/relais?t=${t}`, identifiant: t, empreinte: t, echecs: 0,
        })) })); return;
      }
      if (u.pathname.endsWith("/resultat")) {
        let texte = ""; for await (const p of req) texte += p;
        resultats.push(JSON.parse(texte)); res.writeHead(204).end(); return;
      }
      if (u.pathname === "/api/media/test/stream") {
        const film = Buffer.concat(Array.from({ length: 10 }, (_, i) => readFileSync(path.join(dossier, `seg${i}.ts`))));
        res.writeHead(200, { "Content-Type": "video/mp2t", "Content-Length": film.length }); res.end(film); return;
      }
      if (u.pathname !== "/api/live/relais") return next();
      relais++;
      if (!req.headers.cookie?.includes("flixtunes-test=r5")) { refuse++; res.writeHead(401).end(); return; }
      autorise++; res.setHeader("Cache-Control", "no-store");
      if (Date.now() < coupure) { res.writeHead(503).end(); return; }
      if (["live", "liveb"].includes(u.searchParams.get("t"))) {
        const dernier = Math.floor((Date.now() - depart) / 2000) - 1, premier = Math.max(0, dernier - 39);
        let texte = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${premier}\n`;
        for (let i = premier; i <= dernier; i++) texte += `#EXT-X-PROGRAM-DATE-TIME:${new Date(depart + i * 2000).toISOString()}\n#EXTINF:2,\n/api/live/relais?t=seg${i}\n`;
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl"); res.end(texte); return;
      }
      const nom = u.searchParams.get("t");
      if (!/^seg\d+$/.test(nom ?? "") || !existsSync(path.join(dossier, `${nom}.ts`))) { res.writeHead(404).end(); return; }
      res.setHeader("Content-Type", "video/mp2t"); createReadStream(path.join(dossier, `${nom}.ts`)).pipe(res);
    });
  },
}], server: { host: "127.0.0.1", port: 0, hmr: false } });
await serveur.listen();
const base = `http://127.0.0.1:${serveur.httpServer.address().port}`;
const profil = path.join(dossier, "profil");
const bootstrap = path.join(dossier, "bootstrap.cjs");
// Les fenêtres restent cachées pendant ce banc automatisé. Le code de production est chargé tel quel.
writeFileSync(bootstrap, `const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'); fs.mkdirSync(${JSON.stringify(profil)},{recursive:true});
fs.writeFileSync(${JSON.stringify(path.join(profil, "reglages.json"))},JSON.stringify({serveur:${JSON.stringify(base)}}));
app.setPath('userData',${JSON.stringify(profil)}); BrowserWindow.prototype.show=function(){};
app.commandLine.appendSwitch('remote-debugging-port','0');
require(${JSON.stringify(path.join(depot, "apps/desktop/dist/main.js"))});`, "utf8");
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(path.join(depot, "node_modules/electron/dist/electron.exe"), [bootstrap], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let journal = "";
electron.stderr.on("data", (b) => { journal += b.toString(); });
electron.stdout.on("data", (b) => { journal += b.toString(); });
electron.on("exit", (code, signal) => {
  journal += `\nFin Electron : ${code} / ${signal}\n`;
  writeFileSync(path.join(dossier, "electron.log"), journal);
});
let ws, echec;
try {
  for (let i = 0; i < 200 && !existsSync(path.join(profil, "DevToolsActivePort")); i++) await attendre(100);
  const port = readFileSync(path.join(profil, "DevToolsActivePort"), "utf8").split("\n")[0];
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.url.startsWith(base));
    if (!page) await attendre(100);
  }
  if (!page) throw new Error("Page Electron absente");
  ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let numero = 0; const attentes = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id) { attentes.get(m.id)?.(m); attentes.delete(m.id); } });
  const cdp = (method, params) => new Promise((resolve, reject) => {
    const id = ++numero;
    const timer = setTimeout(() => { attentes.delete(id); reject(new Error(`CDP sans réponse : ${method}`)); }, 10_000);
    attentes.set(id, (m) => { clearTimeout(timer); resolve(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluer = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails || r.error) throw new Error(JSON.stringify(r));
    return r.result.result.value;
  };
  const lectures = [];
  const gestes = [];
  if (commandes) {
    const exiger = (ok, raison) => { if (!ok) throw new Error(raison); };
    const attendreImage = async () => {
      let etat;
      for (let i = 0; i < 35; i++) {
        etat = await evaluer("window.flixtunesBureau.lecteur.etat()");
        if (etat.imagesAffichees > 20 && etat.enLecture) return etat;
        await attendre(1000);
      }
      throw new Error(`Pas d'image après commande : ${JSON.stringify(etat)}`);
    };
    await attendreImage();
    const transparent = await evaluer(`({page:getComputedStyle(document.querySelector('.lecteur-direct-bureau')).backgroundColor,
      corps:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor})`);
    exiger(Object.values(transparent).every((v) => v === "rgba(0, 0, 0, 0)"), "Fond opaque devant VLC");
    gestes.push({ transparence: transparent });
    await evaluer("document.querySelector('.lecteur-direct').dispatchEvent(new PointerEvent('pointermove',{bubbles:true}))");
    await attendre(150);
    const boutons = await evaluer(`Array.from(document.querySelectorAll('.lecteur-direct-barre > button,.lecteur-direct-progression > button')).map(b=>{
      const s=getComputedStyle(b);return {nom:b.getAttribute('aria-label')||b.textContent,fond:s.backgroundColor,couleur:s.color,rayon:s.borderRadius,hauteur:b.getBoundingClientRect().height};})`);
    exiger(boutons.length >= 4 && boutons.every((b) => b.fond === 'rgba(16, 23, 34, 0.8)' && b.couleur === 'rgb(232, 238, 252)' && b.hauteur >= 38), 'Commandes hors du thème du lecteur');
    gestes.push({ boutons });
    await evaluer("document.querySelector('button[aria-label=\"Pause\"]').click()"); await attendre(1500);
    exiger(!(await evaluer("window.flixtunesBureau.lecteur.etat()")).enLecture, "Pause ignorée");
    await evaluer("document.querySelector('button[aria-label=\"Reprendre\"]').click()"); await attendreImage(); gestes.push({ pauseReprise: true });
    await evaluer("document.querySelector('button[aria-label=\"Plein écran\"]').click()"); await attendre(500);
    exiger(await evaluer("!!document.querySelector('button[aria-label=\"Quitter le plein écran\"]')"), 'État plein écran absent');
    await evaluer("document.querySelector('button[aria-label=\"Quitter le plein écran\"]').click()"); gestes.push({ pleinEcran: true });
    await evaluer("document.querySelector('.lecteur-direct-sources').click()"); await attendre(200);
    await evaluer("document.querySelectorAll('.lecteur-direct-choix button')[1].click()"); await attendre(1200);
    await attendreImage();
    exiger((await evaluer("document.querySelector('.lecteur-direct-sources').textContent")).includes("2/2"), "Source choisie ignorée");
    gestes.push({ sourceManuelle: 2 });
    await evaluer("window.__root.unmount()"); await attendre(500);
    const ouvert = await evaluer(`window.flixtunesBureau.lecteur.ouvrir(${JSON.stringify(base + "/api/media/test/stream")})`);
    exiger(ouvert.ok, "Retour au lecteur de films impossible"); await attendreImage();
    exiger(await evaluer("window.flixtunesBureau.direct.diagnostic()") === null, "Cache direct survivant au film");
    gestes.push({ lectureFilmApresDirect: true });
    await evaluer("window.flixtunesBureau.lecteur.fermer()"); await evaluer("window.__ouvrir()"); await attendre(1500);
    await attendreImage(); gestes.push({ retourAuDirect: true });
    console.log(JSON.stringify({ gestes }));
  }
  const debut = Date.now(); let dernieresImages = 0, dernierProgres = debut, maximumGel = 0;
  while (Date.now() - debut < duree * 1000) {
    const seconde = Math.floor((Date.now() - debut) / 1000);
    if (seconde === 60 || seconde === 180) coupure = Date.now() + (seconde === 60 ? 15_000 : 30_000);
    const e = await evaluer(`(async()=>({etat:await window.flixtunesBureau.lecteur.etat(),cache:await window.flixtunesBureau.direct.diagnostic(),natif:!!document.querySelector('.lecteur-direct-bureau'),texte:document.body.innerText}))()`);
    lectures.push({ seconde, ...e });
    if (e.etat.imagesAffichees > dernieresImages) { dernieresImages = e.etat.imagesAffichees; dernierProgres = Date.now(); }
    if (seconde > 30) {
      maximumGel = Math.max(maximumGel, Date.now() - dernierProgres);
      if (!e.natif || !e.etat.imagesAffichees) throw new Error(`VLC ne joue pas : ${JSON.stringify(e)}`);
      if (Date.now() - dernierProgres > 45_000) throw new Error("VLC figé plus de 45 secondes");
    }
    if (seconde % 30 === 0) console.log(JSON.stringify({ seconde, frames: e.etat.imagesAffichees, cache: e.cache }));
    await attendre(1000);
  }
  await evaluer("window.__root.unmount()"); await attendre(1500);
  const apres = await evaluer("(async()=>({etat:await window.flixtunesBureau.lecteur.etat(),cache:await window.flixtunesBureau.direct.diagnostic()}))()");
  if (apres.etat.ouvert || apres.cache !== null) throw new Error("Le lecteur ne se ferme pas");
  writeFileSync(path.join(dossier, "rapport.json"), JSON.stringify({ duree, autorise, refuse, relais, maximumGel, gestes, resultats, lectures, apres }, null, 2));
  console.log(JSON.stringify({ termine: true, duree, autorise, refuse, maximumGel, rapport: path.join(dossier, "rapport.json") }));
} catch (e) { echec = e; console.error(e); }
finally {
  writeFileSync(path.join(dossier, "electron.log"), journal);
  ws?.close();
  // La fermeture par CDP ci-dessus a libéré VLC. En cas d'échec, fermer l'arbre de test uniquement.
  if (electron.exitCode === null && electron.signalCode === null) {
    execFileSync("taskkill", ["/PID", String(electron.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  await serveur.close();
}
if (echec) process.exitCode = 1;
