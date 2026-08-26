/**
 * Mesure des signaux web perçus — livrable LCP/INP/CLS de l'étape 55.
 *
 * **Où mesurer.** Contre le serveur de développement, les chiffres seraient faux : modules servis un
 * par un, sans regroupement ni minification. Le serveur FlixTunes sert lui-même `apps/web/dist` à la
 * racine — le démarrer seul reproduit la topologie de production, la seule qui veuille dire quelque
 * chose.
 *
 * **Comment.** Chrome est piloté par son protocole de débogage, sur une connexion WebSocket ouverte
 * avec le client intégré à Node : aucune dépendance ajoutée à un dépôt dont les installations sont
 * déjà fragiles. Le code de mesure est évalué **dans la page elle-même**.
 *
 * Deux impasses écartées en chemin, qui expliquent ce choix :
 *   - une capture d'écran ne sert à rien ici, et trompe : Chrome sans interface impose une fenêtre
 *     d'au moins 504 px, si bien qu'une capture demandée à 320 px est rendue à 504 puis rognée ;
 *   - `--virtual-time-budget` ne convient pas davantage : l'application garde une connexion ouverte,
 *     et le temps virtuel, suspendu tant qu'une requête est en cours, ne s'écoule alors jamais. Un
 *     minuteur posé dans la page n'arrivait pas à échéance.
 *
 * **Ce qui n'est pas mesuré.** Le NAS. Ces chiffres viennent de la machine de développement, dont le
 * processeur n'a rien à voir avec un Celeron N5105. Ils servent de référence et de garde-fou contre
 * les régressions, pas de promesse sur l'appareil final.
 *
 * Usage : construire le client, démarrer le serveur, puis
 *   node scripts/vitals.mjs [http://localhost:4000]
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:4000";
const PORT_DEBUG = 9333;

const MESURES = [
  { route: "", nom: "accueil", largeur: 1280, hauteur: 900 },
  { route: "#films", nom: "films", largeur: 1280, hauteur: 900 },
  { route: "#films", nom: "films (téléphone)", largeur: 360, hauteur: 780 },
  { route: "#series", nom: "séries", largeur: 1280, hauteur: 900 },
];

/** Repères publics du Web. CLS est un ratio, les autres sont en millisecondes. */
const SEUILS = { LCP: 2500, FCP: 1800, CLS: 0.1 };

const CHROMES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const chrome = CHROMES.find((chemin) => existsSync(chemin));
if (!chrome) { console.error("Aucun Chromium trouvé. Renseignez CHROME_PATH."); process.exit(1); }

const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Code évalué dans la page.
 *
 * Il attend que le contenu principal soit là — un titre, un état vide ou une erreur — plutôt qu'un
 * délai fixe, puis relève les entrées de performance mises en tampon par le navigateur. Un
 * observateur installé après coup ne verrait rien ; le tampon, lui, conserve ce qui a déjà eu lieu.
 */
const CODE_MESURE = `(async () => {
  const jusqua = Date.now() + 15000;
  while (Date.now() < jusqua && !document.querySelector("h1, .app-error, .empty-state")) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1200));

  const nav = performance.getEntriesByType("navigation")[0] || null;
  const fcp = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
  const releve = window.__flix || { lcp: null, lcpElement: null, cls: 0, decalages: 0 };
  const ressources = performance.getEntriesByType("resource");

  // Coût d'un appui isolé. L'INP complet demande un usage réel prolongé ; ceci suffit à repérer un
  // gestionnaire trop lourd, et n'est pas présenté pour autre chose.
  let appui = null;
  const cible = document.querySelector("nav a[href], button");
  if (cible) {
    const debut = performance.now();
    cible.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    appui = performance.now() - debut;
  }

  return JSON.stringify({
    ttfb: nav ? nav.responseStart : null,
    fcp: fcp ? fcp.startTime : null,
    lcp: releve.lcp,
    lcpElement: releve.lcpElement,
    cls: releve.cls,
    decalages: releve.decalages,
    requetes: ressources.length,
    transfert: ressources.reduce((s, e) => s + (e.transferSize || 0), 0),
    appui,
  });
})()`;

/**
 * Observateur installé au tout début de chaque document.
 *
 * Il retient la dernière candidate LCP et cumule les décalages de mise en page. Ces deux mesures ne
 * peuvent pas être reconstituées après coup avec certitude : il faut être là quand elles surviennent.
 */
const SCRIPT_OBSERVATEUR = `
  window.__flix = { lcp: null, lcpElement: null, cls: 0, decalages: 0 };
  try {
    new PerformanceObserver((liste) => {
      for (const entree of liste.getEntries()) {
        window.__flix.lcp = entree.startTime;
        window.__flix.lcpElement = entree.element ? entree.element.tagName.toLowerCase() : null;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((liste) => {
      for (const entree of liste.getEntries()) {
        if (entree.hadRecentInput) continue;
        window.__flix.cls += entree.value;
        window.__flix.decalages += 1;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch { /* navigateur sans ces types d'entrée */ }
`;

/** Une conversation minimale avec Chrome, sur son protocole de débogage. */
async function evaluerDansPage(url, largeur, hauteur) {
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
    // La taille est imposée par émulation, non par la fenêtre : c'est ce qui permet de descendre sous
    // la largeur minimale qu'un navigateur sans interface s'impose à lui-même.
    await commande("Emulation.setDeviceMetricsOverride",
      { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: largeur < 700 });
    await commande("Page.enable");
    // Chaque mesure part d'un cache vide : sans cela, seule la première décrirait une première
    // visite et les suivantes flatteraient les chiffres sans qu'on s'en aperçoive.
    await commande("Network.enable");
    await commande("Network.clearBrowserCache");
    // Vider le cache HTTP ne vide pas celui du service worker : l'application continuait à servir son
    // shell précaché, et les mesures suivant la première paraissaient bien meilleures qu'une vraie
    // première visite. On le contourne pour que les quatre relevés soient comparables.
    await commande("Network.setBypassServiceWorker", { bypass: true });

    // L'observateur est posé AVANT la navigation. Se fier au tampon du navigateur suffit d'ordinaire,
    // mais pas ici : sans interface, aucune entrée LCP n'y apparaissait. Un observateur installé au
    // tout début du document, lui, reçoit chaque candidate à mesure qu'elle est retenue.
    await commande("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT_OBSERVATEUR });
    await commande("Page.navigate", { url });

    // Un onglet fraîchement ouvert n'a pas encore de contexte d'exécution : la navigation est en
    // cours. On réessaie brièvement plutôt que de dormir au jugé — la durée d'ouverture varie.
    let resultat = null;
    for (let essai = 0; essai < 40; essai += 1) {
      resultat = await commande("Runtime.evaluate",
        { expression: CODE_MESURE, awaitPromise: true, returnByValue: true });
      if (!/execution context/i.test(resultat?.error?.message ?? "")) break;
      await attendre(250);
    }
    const valeur = resultat?.result?.result?.value;
    if (!valeur) throw new Error(`Aucune mesure rendue : ${JSON.stringify(resultat?.error ?? resultat?.result ?? resultat)}`);
    return JSON.parse(valeur);
  } finally {
    socket.close();
    await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/close/${onglet.id}`).catch(() => {});
  }
}

const profil = await mkdtemp(path.join(tmpdir(), "flixtunes-vitals-"));
const navigateur = spawn(chrome, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT_DEBUG}`,
  `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

let depassements = 0;
try {
  // Attendre que le protocole réponde, plutôt que de dormir au hasard.
  for (let essai = 0; essai < 60; essai += 1) {
    try { await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/version`); break; } catch { await attendre(500); }
  }

  console.log(`Signaux web — ${base} (client construit, servi par le serveur)\n`);
  const arrondi = (valeur) => (valeur == null ? null : Math.round(valeur * 10) / 10);
  for (const { route, nom, largeur, hauteur } of MESURES) {
    const v = await evaluerDansPage(`${base}/${route}`, largeur, hauteur);
    const verdict = (etiquette, valeur, seuil, unite = " ms") => {
      if (valeur == null) { depassements += 1; return `✗ ${etiquette}=indisponible`; }
      const depasse = valeur > seuil;
      if (depasse) depassements += 1;
      return `${depasse ? "✗" : "·"} ${etiquette}=${valeur}${unite}`;
    };
    console.log(`${nom} (${largeur} px)`);
    console.log(`  ${verdict("LCP", arrondi(v.lcp), SEUILS.LCP)}   ${verdict("FCP", arrondi(v.fcp), SEUILS.FCP)}`
      + `   ${verdict("CLS", Math.round(v.cls * 1000) / 1000, SEUILS.CLS, "")}`);
    console.log(`  TTFB=${arrondi(v.ttfb)} ms · appui=${arrondi(v.appui)} ms · ${v.requetes} requêtes`
      + ` · ${Math.round(v.transfert / 1024)} Kio transférés`
      + (v.lcpElement ? ` · plus grand élément <${v.lcpElement}>` : "")
      + (v.decalages ? ` · ${v.decalages} décalage(s)` : ""));
    console.log("");
  }
} finally {
  navigateur.kill();
  // Windows garde les fichiers du profil verrouillés un instant après la fermeture. Un nettoyage qui
  // échoue ne doit pas masquer la mesure — c'est ce qui s'est produit : l'erreur de suppression avait
  // remplacé le résultat.
  await attendre(1500);
  await rm(profil, { recursive: true, force: true }).catch(() => {});
}

if (depassements > 0) {
  console.error(`${depassements} seuil(s) dépassé(s) ou non mesuré(s).`
    + ` Repères : LCP ${SEUILS.LCP} ms, FCP ${SEUILS.FCP} ms, CLS ${SEUILS.CLS}.`);
  process.exit(1);
}
console.log("Tous les signaux sont dans les repères du Web.");
console.log("Rappel : mesuré sur la machine de développement, pas sur le NAS.");
