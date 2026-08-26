/**
 * Relevé géométrique — filet de sécurité pour toute retouche de style.
 *
 * Une refonte de feuille de style ne se relit pas : elle se mesure. Cet outil enregistre la taille et
 * la position des éléments qui structurent chaque écran, à plusieurs largeurs, puis compare deux
 * relevés. Un décalage supérieur à la tolérance est signalé avec son ampleur.
 *
 * L'intention n'est pas d'interdire tout changement — c'est de rendre visible **ce qui change**.
 * Une retouche censée être sans effet visuel qui déplace une jaquette de 40 px n'est pas ce qu'on
 * croyait faire.
 *
 * Usage :
 *   node scripts/geometrie.mjs relever  [url] [fichier.json]
 *   node scripts/geometrie.mjs comparer [url] [fichier.json]
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [action = "relever", base = "http://localhost:4000", fichier = "geometrie-baseline.json"] = process.argv.slice(2);
const PORT_DEBUG = 9335;

/** Écrans et largeurs relevés. Les extrêmes comptent autant que le cas courant. */
const CAS = [
  { route: "", nom: "accueil", largeurs: [360, 1280, 3840] },
  { route: "#films", nom: "films", largeurs: [360, 1280, 3840] },
];

/** Éléments dont la géométrie porte la mise en page. */
const SELECTEURS = [
  ".topbar", ".hero", ".hero-copy h1", ".hero-buttons button",
  ".catalog-page", ".catalog-header", ".catalog-controls", ".catalog-grid",
  ".catalog-grid .media-card", ".catalog-grid .poster", ".catalog-grid .card-title",
  ".rail-section", ".rail", ".rail .media-card", "footer", "main",
];

/** Tolérance, en pixels. En deçà, c'est du bruit d'arrondi. */
const TOLERANCE = 1.5;

const CHROMES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].filter(Boolean);
const chrome = CHROMES.find((chemin) => existsSync(chemin));
if (!chrome) { console.error("Aucun Chromium trouvé. Renseignez CHROME_PATH."); process.exit(1); }

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CODE_RELEVE = (selecteurs) => `(async () => {
  const jusqua = Date.now() + 15000;
  while (Date.now() < jusqua && !document.querySelector("h1, .app-error, .empty-state")) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 900));
  const arrondi = (v) => Math.round(v * 10) / 10;
  const releve = {};
  for (const selecteur of ${JSON.stringify(selecteurs)}) {
    const element = document.querySelector(selecteur);
    if (!element) { releve[selecteur] = null; continue; }
    const boite = element.getBoundingClientRect();
    releve[selecteur] = { l: arrondi(boite.width), h: arrondi(boite.height), x: arrondi(boite.left), y: arrondi(boite.top) };
  }
  return JSON.stringify(releve);
})()`;

async function relever(url, largeur) {
  const reponse = await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/new?about:blank`, { method: "PUT" });
  const onglet = await reponse.json();
  const socket = new WebSocket(onglet.webSocketDebuggerUrl);
  let identifiant = 0;
  const attentes = new Map();
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (evenement) => {
    const message = JSON.parse(evenement.data);
    const attente = attentes.get(message.id);
    if (attente) { attentes.delete(message.id); attente(message); }
  });
  const commande = (method, params = {}) => new Promise((resolve) => {
    const id = ++identifiant;
    attentes.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await commande("Emulation.setDeviceMetricsOverride",
      { width: largeur, height: 900, deviceScaleFactor: 1, mobile: largeur < 700 });
    await commande("Page.enable");
    await commande("Network.enable");
    await commande("Network.setBypassServiceWorker", { bypass: true });
    await commande("Page.navigate", { url });
    let resultat = null;
    for (let essai = 0; essai < 40; essai += 1) {
      resultat = await commande("Runtime.evaluate",
        { expression: CODE_RELEVE(SELECTEURS), awaitPromise: true, returnByValue: true });
      if (!/execution context/i.test(resultat?.error?.message ?? "")) break;
      await attendre(250);
    }
    const valeur = resultat?.result?.result?.value;
    if (!valeur) throw new Error(`Relevé vide : ${JSON.stringify(resultat?.error ?? resultat?.result)}`);
    return JSON.parse(valeur);
  } finally {
    socket.close();
    await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/close/${onglet.id}`).catch(() => {});
  }
}

const profil = await mkdtemp(path.join(tmpdir(), "flixtunes-geo-"));
const navigateur = spawn(chrome, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT_DEBUG}`,
  `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

let ecarts = 0;
try {
  for (let essai = 0; essai < 60; essai += 1) {
    try { await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/version`); break; } catch { await attendre(500); }
  }

  const courant = {};
  for (const { route, nom, largeurs } of CAS) {
    for (const largeur of largeurs) {
      courant[`${nom}@${largeur}`] = await relever(`${base}/${route}`, largeur);
    }
  }

  if (action === "relever") {
    await writeFile(fichier, JSON.stringify(courant, null, 2), "utf8");
    console.log(`Relevé enregistré dans ${fichier} — ${Object.keys(courant).length} combinaisons.`);
  } else {
    const reference = JSON.parse(await readFile(fichier, "utf8"));
    for (const cle of Object.keys(courant)) {
      const avant = reference[cle] ?? {};
      const apres = courant[cle];
      const differences = [];
      for (const selecteur of SELECTEURS) {
        const a = avant[selecteur];
        const b = apres[selecteur];
        if (!a && !b) continue;
        if (!a || !b) { differences.push(`${selecteur} : ${a ? "disparu" : "apparu"}`); continue; }
        for (const champ of ["l", "h", "x", "y"]) {
          const delta = Math.round((b[champ] - a[champ]) * 10) / 10;
          if (Math.abs(delta) > TOLERANCE) differences.push(`${selecteur} ${champ} ${a[champ]} → ${b[champ]} (${delta > 0 ? "+" : ""}${delta})`);
        }
      }
      ecarts += differences.length;
      console.log(`${cle} — ${differences.length ? `${differences.length} écart(s)` : "identique"}`);
      for (const difference of differences.slice(0, 8)) console.log(`  ✗ ${difference}`);
    }
  }
} finally {
  navigateur.kill();
  await attendre(1500);
  await rm(profil, { recursive: true, force: true }).catch(() => {});
}

if (action === "comparer" && ecarts > 0) {
  console.error(`\n${ecarts} écart(s) géométrique(s) au-delà de ${TOLERANCE} px.`);
  process.exit(1);
}
if (action === "comparer") console.log("\nAucun déplacement : la mise en page est inchangée.");
