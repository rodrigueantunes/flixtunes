/**
 * Contrôle de mise en page multi-viewports — livrable « E2E visuels » de l'étape 55.
 *
 * jsdom n'a pas de moteur de rendu : aucun test de la suite ne peut dire qu'une page déborde à
 * 320 px. C'est la limite que je répétais depuis le début de l'étape, et voici ce qui la lève.
 *
 * **Comment, et pourquoi ainsi.** Une capture d'écran ne suffit pas, et pire : elle trompe. Chrome
 * sans interface impose une largeur de fenêtre minimale — mesurée à 504 px sur cette machine. Une
 * capture demandée à 320 px est donc rendue à 504 px puis **rognée** à 320 : la page paraît coupée
 * alors qu'elle va très bien. J'ai signalé un faux défaut avant de m'en apercevoir.
 *
 * La sonde contourne cela en chargeant l'application dans un cadre à la largeur voulue. Un cadre a
 * son propre viewport : les requêtes de média y répondent pour de bon, et les mesures sont vraies
 * quelle que soit la fenêtre du navigateur.
 *
 * Les éléments contenus dans un conteneur défilant sont ignorés : un carrousel dépasse par
 * construction, c'est ce qu'on lui demande. Seul un dépassement que personne ne rattrape est un
 * défaut.
 *
 * Usage : démarrer le serveur et le client, puis
 *   node scripts/viewports.mjs [http://localhost:5173]
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lancer = promisify(execFile);
const ici = path.dirname(fileURLToPath(import.meta.url));
const racineWeb = path.resolve(ici, "..");

const base = process.argv[2] ?? "http://localhost:5173";

/** Largeurs éprouvées, et ce que chacune représente. */
const VIEWPORTS = [
  { largeur: 320, quoi: "petit téléphone" },
  { largeur: 360, quoi: "téléphone courant" },
  { largeur: 640, quoi: "zoom 200 % sur un écran 1280" },
  { largeur: 768, quoi: "tablette" },
  { largeur: 1280, quoi: "ordinateur" },
  { largeur: 1920, quoi: "grand écran" },
  { largeur: 3840, quoi: "téléviseur 4K" },
];

const ECRANS = [
  { route: "", nom: "accueil" },
  { route: "#films", nom: "films" },
  { route: "#series", nom: "séries" },
  { route: "#historique", nom: "historique" },
];

/** Emplacements habituels d'un Chromium, du plus probable au moins. */
const CHROMES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chrome = CHROMES.find((chemin) => existsSync(chemin));
if (!chrome) {
  console.error("Aucun Chromium trouvé. Renseignez CHROME_PATH.");
  process.exit(1);
}

// La sonde doit être servie par le même serveur que l'application : un cadre d'une autre origine
// serait illisible. Elle est déposée le temps de la mesure, puis retirée — elle n'a rien à faire
// dans un paquet livré.
const sondeSource = path.join(ici, "viewport-probe.html");
const sondeServie = path.join(racineWeb, "public", "__viewport-probe.html");

/** Interroge la sonde et rend son rapport brut. */
async function sonder(largeur, route) {
  const url = `${base}/__viewport-probe.html?w=${largeur}&h=900&route=${encodeURIComponent(route)}`;
  const { stdout } = await lancer(chrome, [
    "--headless=new", "--disable-gpu", "--virtual-time-budget=14000",
    // La fenêtre est large à dessein : c'est le cadre qui porte la largeur mesurée, et une fenêtre
    // étroite ne ferait qu'ajouter la contrainte minimale du navigateur par-dessus.
    "--window-size=1100,900", "--dump-dom",
    `--user-data-dir=${path.join(racineWeb, "node_modules", ".viewport-chrome")}`,
    url,
  ], { maxBuffer: 40 * 1024 * 1024 });
  const trouve = /<div id="resultat">([\s\S]*?)<\/div>/.exec(stdout);
  return (trouve?.[1] ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

await copyFile(sondeSource, sondeServie);
let manquements = 0;
try {
  for (const ecran of ECRANS) {
    console.log(`\n${ecran.nom}`);
    for (const { largeur, quoi } of VIEWPORTS) {
      const rapport = await sonder(largeur, ecran.route);
      const deborde = /DEBORDE=OUI/.test(rapport);
      const fautifs = rapport.split("\n").filter((ligne) => /^ {2}\d+px/.test(ligne));
      if (deborde || fautifs.length) {
        manquements += 1;
        console.log(`  ✗ ${String(largeur).padStart(4)} px (${quoi})`);
        for (const ligne of fautifs.slice(0, 5)) console.log(`     ${ligne.trim()}`);
        if (deborde) console.log("     le document entier défile horizontalement");
      } else {
        console.log(`  · ${String(largeur).padStart(4)} px (${quoi}) — rien ne dépasse`);
      }
    }
  }
} finally {
  await rm(sondeServie, { force: true });
}

if (manquements > 0) {
  console.error(`\n${manquements} combinaison(s) écran/largeur débordent.`);
  process.exit(1);
}
console.log("\nAucun débordement, sur aucun écran, à aucune largeur.");
