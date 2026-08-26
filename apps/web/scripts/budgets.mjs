/**
 * Budgets de charge du client Web — livrable bloquant de l'étape 55.
 *
 * Un budget qui se contente d'avertir ne sert à rien : personne ne lit l'avertissement, et le poids
 * dérive d'une version à l'autre jusqu'à ce que le premier affichage devienne pénible sur le réseau
 * local. Ce script **sort en erreur**, et il est appelé après la construction, dans la chaîne
 * d'empaquetage : un dépassement empêche la génération du paquet.
 *
 * Les seuils sont établis à partir de mesures réelles, avec une marge délibérément étroite. Une
 * marge large laisserait passer précisément ce qu'on cherche à attraper.
 *
 * Deux garanties **structurelles** accompagnent les chiffres, et elles comptent davantage :
 *   - hls.js doit rester dans un fichier séparé. C'est le plus gros morceau de code de
 *     l'application ; s'il retombait dans le fichier d'entrée, l'accueil paierait le coût du lecteur
 *     sans jamais s'en servir. Un simple seuil global ne verrait pas la différence.
 *   - les tailles déclarées dans le manifeste doivent correspondre aux fichiers réels. Une taille
 *     fausse fait choisir la mauvaise icône à l'installation, ou la fait rejeter.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const dist = join(racine, "dist");

const Kio = 1024;

/**
 * Seuils exprimés en octets compressés (gzip) pour le code : c'est ce qui circule réellement.
 * Les images et le son sont déjà compressés dans leur format, on les juge donc sur leur taille brute.
 */
const BUDGETS = {
  /**
   * Resserré de 100 à 95 Kio le 20 août 2026, et c'est un serrage, non un relâchement.
   *
   * Le lecteur était importé d'emblée par `App.tsx` : la page d'accueil payait le plus gros module de
   * l'application — sonde de décodage, mesure de débit, planches de vignettes — pour afficher une
   * grille de jaquettes. Le budget a fini par le dire, à 111,7 Kio. Le lecteur est passé en chargement
   * à la demande, et l'entrée est retombée à 81,3.
   *
   * Le seuil descend donc pour retenir le gain. Le laisser à 100 aurait rendu vingt kilooctets de
   * dérive à peine gagnés, ce que ce fichier existe précisément pour empêcher.
   */
  jsEntree: { limite: 95 * Kio, libelle: "JavaScript du premier affichage (gzip)" },
  css: { limite: 16 * Kio, libelle: "Feuille de style (gzip)" },
  /**
   * Relevé de 175 à 200 Kio le même jour, et pour la même raison vue de l'autre côté.
   *
   * Ce poste ne contenait que `hls.js`. Il contient désormais le lecteur lui-même, qui vient de
   * quitter le fichier d'entrée : trente kilooctets ont changé de poste, pas de nature. Le total
   * expédié est inchangé — 269,5 Kio avant, 270,1 après —, mais quelqu'un qui parcourt sans lire en
   * télécharge vingt-sept pour cent de moins.
   *
   * Refuser ce déplacement au nom du chiffre aurait conservé le poids là où il coûte le plus.
   */
  jsDiffere: { limite: 200 * Kio, libelle: "Lecteur chargé à la demande (gzip)" },
  imageUnitaire: { limite: 96 * Kio, libelle: "Image la plus lourde (brute)" },
  mediaDemarrage: { limite: 128 * Kio, libelle: "Son de démarrage (brut)" },
  totalDemarrage: { limite: 320 * Kio, libelle: "Tout ce qui part au premier affichage (gzip + images)" },
};

/** Parcourt `dist` et renvoie chaque fichier avec sa taille brute et compressée. */
function inventorier(repertoire) {
  const fichiers = [];
  for (const entree of readdirSync(repertoire)) {
    const chemin = join(repertoire, entree);
    if (statSync(chemin).isDirectory()) { fichiers.push(...inventorier(chemin)); continue; }
    const contenu = readFileSync(chemin);
    fichiers.push({
      chemin: relative(dist, chemin).replace(/\\/g, "/"),
      extension: extname(entree).toLowerCase(),
      brut: contenu.length,
      gzip: gzipSync(contenu, { level: 9 }).length,
    });
  }
  return fichiers;
}

/** Dimensions d'un PNG, lues dans son en-tête IHDR. */
function dimensionsPng(chemin) {
  const entete = readFileSync(chemin).subarray(16, 24);
  return { largeur: entete.readUInt32BE(0), hauteur: entete.readUInt32BE(4) };
}

const ko = (octets) => `${(octets / Kio).toFixed(1)} Kio`;

let fichiers;
try {
  fichiers = inventorier(dist);
} catch {
  console.error(`Budgets : aucune construction dans ${dist}.\nConstruisez d'abord le client Web, puis relancez.`);
  process.exit(1);
}

const manquements = [];
const releve = [];

/** Vérifie une mesure contre son budget et enregistre le relevé dans tous les cas. */
function verifier(cle, mesure, detail) {
  const { limite, libelle } = BUDGETS[cle];
  const part = Math.round((mesure / limite) * 100);
  releve.push(`  ${part >= 100 ? "✗" : "·"} ${libelle.padEnd(52)} ${ko(mesure).padStart(10)} / ${ko(limite).padStart(10)}  (${part} %)`);
  if (mesure > limite) manquements.push(`${libelle} : ${ko(mesure)} pour un budget de ${ko(limite)}${detail ? ` — ${detail}` : ""}`);
}

const js = fichiers.filter((f) => f.extension === ".js");
const entree = js.filter((f) => /(^|\/)index-/.test(f.chemin));
const differe = js.filter((f) => !/(^|\/)index-/.test(f.chemin) && f.chemin.startsWith("assets/"));
const css = fichiers.filter((f) => f.extension === ".css");
const images = fichiers.filter((f) => [".png", ".jpg", ".webp", ".svg"].includes(f.extension));
const sons = fichiers.filter((f) => [".wav", ".mp3", ".ogg", ".m4a", ".opus"].includes(f.extension));

const somme = (liste, champ) => liste.reduce((total, f) => total + f[champ], 0);

verifier("jsEntree", somme(entree, "gzip"), entree.map((f) => f.chemin).join(", "));
verifier("css", somme(css, "gzip"), css.map((f) => f.chemin).join(", "));
verifier("jsDiffere", somme(differe, "gzip"), differe.map((f) => f.chemin).join(", "));

const imagePlusLourde = images.sort((a, b) => b.brut - a.brut)[0];
if (imagePlusLourde) verifier("imageUnitaire", imagePlusLourde.brut, imagePlusLourde.chemin);
const sonPlusLourd = sons.sort((a, b) => b.brut - a.brut)[0];
if (sonPlusLourd) verifier("mediaDemarrage", sonPlusLourd.brut, sonPlusLourd.chemin);

// Le premier affichage paie le code d'entrée, la feuille de style, et tout ce que `public/` embarque.
const totalDemarrage = somme(entree, "gzip") + somme(css, "gzip") + somme(images, "brut") + somme(sons, "brut");
verifier("totalDemarrage", totalDemarrage,
  `dont ${ko(somme(images, "brut"))} d'images et ${ko(somme(sons, "brut"))} de son`);

// Garantie structurelle : le lecteur ne doit pas se retrouver dans le fichier d'entrée.
if (!differe.some((f) => /hls/i.test(f.chemin))) {
  manquements.push("hls.js n'est plus dans un fichier séparé : l'accueil paierait le coût du lecteur sans l'utiliser.");
}

// Garantie structurelle : le manifeste ne doit pas mentir sur ses icônes.
try {
  const manifeste = JSON.parse(readFileSync(join(dist, "manifest.webmanifest"), "utf8"));
  for (const icone of manifeste.icons ?? []) {
    if (!icone.src.endsWith(".png")) continue;
    const { largeur, hauteur } = dimensionsPng(join(dist, icone.src.replace(/^\//, "")));
    if (icone.sizes !== `${largeur}x${hauteur}`) {
      manquements.push(`Manifeste : ${icone.src} est annoncée ${icone.sizes} mais mesure ${largeur}x${hauteur}.`);
    }
  }
} catch (erreur) {
  manquements.push(`Manifeste illisible ou icône absente : ${erreur.message}`);
}

console.log("Budgets du client Web\n" + releve.join("\n"));

if (manquements.length > 0) {
  console.error("\nBudgets dépassés :\n" + manquements.map((m) => `  - ${m}`).join("\n"));
  console.error("\nAllégez la charge, ou révisez le seuil en expliquant pourquoi il n'est plus tenable.");
  process.exit(1);
}
console.log("\nTous les budgets sont tenus.");
