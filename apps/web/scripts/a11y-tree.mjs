/**
 * Contrôle de l'arbre d'accessibilité — volet « lecteur d'écran » de l'étape 55.
 *
 * **Ce que ça vaut, et ce que ça ne vaut pas.** Un lecteur d'écran ne lit pas le HTML : il lit
 * l'arbre d'accessibilité que le navigateur calcule à partir du HTML, du CSS et des attributs ARIA.
 * C'est cet arbre qui est inspecté ici, sur l'application réellement rendue. Ce n'est donc pas une
 * approximation du HTML comme le fait jsdom — mais ce n'est pas non plus un essai avec NVDA ou
 * VoiceOver, qui reste à faire par une personne. Ce contrôle attrape ce qui est mécanique : une
 * commande sans nom, un repère en double, une hiérarchie de titres rompue.
 *
 * jsdom ne pouvait pas rendre ce service : il ne calcule ni la visibilité, ni l'héritage de
 * `aria-hidden`, ni le nom accessible dans tous les cas.
 *
 * Usage : construire le client, démarrer le serveur, puis
 *   node scripts/a11y-tree.mjs [http://localhost:4000]
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:4000";
const PORT_DEBUG = 9334;

const ECRANS = [
  { route: "", nom: "accueil" },
  { route: "#films", nom: "films" },
  { route: "#series", nom: "séries" },
  { route: "#historique", nom: "historique" },
];

/** Rôles qui désignent une commande : sans nom, elles sont annoncées « bouton », « lien »… et rien d'autre. */
const ROLES_COMMANDES = new Set([
  "button", "link", "checkbox", "radio", "textbox", "combobox", "listbox", "slider",
  "menuitem", "tab", "switch", "searchbox", "spinbutton",
]);

/** Repères de structure. Deux repères de même rôle doivent se distinguer par leur nom. */
const ROLES_REPERES = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search", "form"]);

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

/** Ouvre un onglet, attend que la page ait du contenu, et rend son arbre d'accessibilité. */
async function arbreDe(url) {
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
    await commande("Page.enable");
    await commande("Page.navigate", { url });

    // Attendre le contenu, pas un délai : le temps de chargement varie avec la taille du catalogue.
    for (let essai = 0; essai < 60; essai += 1) {
      const pret = await commande("Runtime.evaluate", {
        expression: 'Boolean(document.querySelector("h1, .app-error, .empty-state"))',
        returnByValue: true,
      });
      if (pret?.result?.result?.value === true) break;
      await attendre(300);
    }
    await attendre(800);

    await commande("Accessibility.enable");
    const arbre = await commande("Accessibility.getFullAXTree");

    // Les titres sont relus depuis le document. L'ordre des nœuds rendus par `getFullAXTree` ne suit
    // pas celui du document — je l'ai cru, et la hiérarchie paraissait rompue là où elle ne l'était
    // pas. Seul le document fait foi sur l'ordre de lecture.
    const titresBruts = await commande("Runtime.evaluate", {
      expression: `JSON.stringify([...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .map((titre) => ({ niveau: Number(titre.tagName.slice(1)), nom: (titre.textContent || "").trim().slice(0, 60) })))`,
      returnByValue: true,
    });
    return {
      noeuds: arbre?.result?.nodes ?? [],
      titres: JSON.parse(titresBruts?.result?.result?.value ?? "[]"),
    };
  } finally {
    socket.close();
    await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/close/${onglet.id}`).catch(() => {});
  }
}

const valeur = (champ) => (champ && typeof champ.value === "string" ? champ.value : "");

/** Relève les manquements mécaniques d'un arbre. */
function examiner(noeuds, titres) {
  const manquements = [];
  const repères = new Map();

  for (const noeud of noeuds) {
    if (noeud.ignored) continue;
    const role = valeur(noeud.role);
    const nom = valeur(noeud.name).trim();

    if (ROLES_COMMANDES.has(role) && !nom) {
      const description = noeud.properties?.map((p) => `${p.name}=${valeur(p.value)}`).slice(0, 2).join(" ") ?? "";
      manquements.push(`commande « ${role} » sans nom accessible ${description}`.trim());
    }

    if (ROLES_REPERES.has(role)) {
      const cle = `${role}::${nom}`;
      repères.set(cle, (repères.get(cle) ?? 0) + 1);
    }

  }

  // Deux repères de même rôle sans nom distinct sont indiscernables : « aller à la navigation »
  // devient un choix entre deux entrées identiques.
  for (const [cle, compte] of repères) {
    const [role, nom] = cle.split("::");
    if (compte > 1) manquements.push(`${compte} repères « ${role} »${nom ? ` nommés « ${nom} »` : " sans nom"} — indiscernables`);
  }

  const premiers = titres.filter((titre) => titre.niveau === 1);
  if (premiers.length !== 1) manquements.push(`${premiers.length} titre(s) de premier niveau, il en faut exactement un`);
  for (let index = 1; index < titres.length; index += 1) {
    const saut = titres[index].niveau - titres[index - 1].niveau;
    if (saut > 1) {
      manquements.push(`saut de titre h${titres[index - 1].niveau} → h${titres[index].niveau} (« ${titres[index].nom} »)`);
    }
  }

  return { manquements, titres, commandes: noeuds.filter((n) => !n.ignored && ROLES_COMMANDES.has(valeur(n.role))).length };
}

const profil = await mkdtemp(path.join(tmpdir(), "flixtunes-a11y-"));
const navigateur = spawn(chrome, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT_DEBUG}`,
  `--user-data-dir=${profil}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });

let total = 0;
try {
  for (let essai = 0; essai < 60; essai += 1) {
    try { await fetch(`http://127.0.0.1:${PORT_DEBUG}/json/version`); break; } catch { await attendre(500); }
  }

  console.log(`Arbre d'accessibilité — ${base}\n`);
  for (const { route, nom } of ECRANS) {
    const { noeuds, titres: titresDocument } = await arbreDe(`${base}/${route}`);
    const { manquements, titres, commandes } = examiner(noeuds, titresDocument);
    total += manquements.length;
    console.log(`${nom} — ${noeuds.length} nœuds, ${commandes} commandes, ${titres.length} titres`);
    if (!manquements.length) console.log("  · rien à signaler");
    for (const manquement of manquements) console.log(`  ✗ ${manquement}`);
    console.log(`  titres : ${titres.map((t) => `h${t.niveau} ${t.nom}`).slice(0, 6).join(" · ") || "aucun"}`);
    console.log("");
  }
} finally {
  navigateur.kill();
  await attendre(1500);
  await rm(profil, { recursive: true, force: true }).catch(() => {});
}

if (total > 0) {
  console.error(`${total} manquement(s) dans l'arbre d'accessibilité.`);
  process.exit(1);
}
console.log("Aucun manquement mécanique dans l'arbre lu par les technologies d'assistance.");
console.log("Rappel : un essai avec un vrai lecteur d'écran reste à faire par une personne.");
