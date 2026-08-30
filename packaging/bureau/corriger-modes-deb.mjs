#!/usr/bin/env node
/**
 * Rend au paquet Debian les droits que Windows ne sait pas exprimer.
 *
 * Un système de fichiers Windows n'a pas de bit d'exécution. `bsdtar`, qui empaquette, écrit donc
 * `0666` sur chaque fichier et `0777` sur chaque dossier — mesuré sur le premier paquet produit.
 * Installé tel quel, rien ne se lance : ni le programme, ni le VLC embarqué, ni même les scripts que
 * `dpkg` doit exécuter pendant l'installation.
 *
 * On les repose donc après coup, dans l'archive elle-même. Un `.deb` est une archive `ar` de trois
 * membres ; le mode d'une entrée `tar` tient sur huit octets à l'offset 100, suivi d'une somme de
 * contrôle à recalculer. C'est tout ce qu'il y a à faire, et cela se vérifie en relisant le paquet.
 *
 * La compression est `gzip` et non `xz` pour cette raison précise : Node sait ouvrir et refermer du
 * gzip sans rien installer. Le paquet est un peu plus gros ; il est surtout réparable.
 *
 * ## Ce qui devient exécutable, et rien d'autre
 *
 * Les dossiers, sans quoi on ne peut pas les traverser. Le programme et le VLC qu'il lance. Le bac à
 * sable de Chromium, qui veut en plus le bit `setuid` — c'est Chromium qui l'exige, et le script
 * d'installation d'electron-builder le repose lui aussi. Les scripts de mainteneur, que `dpkg`
 * exécute. Tout le reste garde `0644` : une bibliothèque partagée se charge très bien sans être
 * exécutable, et donner ce droit à ce qui n'en a pas besoin est une mauvaise habitude.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const MODES = {
  dossier: 0o755,
  programme: 0o755,
  bacASable: 0o4755,
  ordinaire: 0o644,
};

/** Ce qui doit pouvoir s'exécuter, désigné par la fin de son chemin dans l'archive. */
const EXECUTABLES = [
  "/opt/FlixTunes/flixtunes",
  "/opt/FlixTunes/chrome_crashpad_handler",
  "/opt/FlixTunes/resources/vlc/vlc",
];
const SCRIPTS_MAINTENEUR = ["./postinst", "./postrm", "./preinst", "./prerm"];

/** Le mode qui revient à une entrée, d'après son nom et son type. */
function modeVoulu(nom, typeflag) {
  if (typeflag === "5") return MODES.dossier;
  if (nom.endsWith("/opt/FlixTunes/chrome-sandbox")) return MODES.bacASable;
  if (EXECUTABLES.some((fin) => nom.endsWith(fin))) return MODES.programme;
  if (SCRIPTS_MAINTENEUR.includes(nom)) return MODES.programme;
  return MODES.ordinaire;
}

function lireChamp(entete, debut, longueur) {
  return entete.toString("ascii", debut, debut + longueur).replace(/\0.*$/, "").trim();
}

/** La somme de contrôle d'un en-tête tar : ses octets additionnés, son propre champ compté comme des espaces. */
function recalculerSomme(entete) {
  entete.fill(0x20, 148, 156);
  let total = 0;
  for (const octet of entete) total += octet;
  entete.write(total.toString(8).padStart(6, "0"), 148, 6, "ascii");
  entete[154] = 0;
  entete[155] = 0x20;
}

/** Repose les modes de chaque entrée d'une archive tar décompressée. */
export function corrigerTar(tar) {
  let position = 0;
  let corrigees = 0;
  while (position + 512 <= tar.length) {
    const entete = tar.subarray(position, position + 512);
    const nom = lireChamp(entete, 0, 100);
    if (nom.length === 0) break; // Deux blocs vides ferment l'archive.
    const taille = parseInt(lireChamp(entete, 124, 12) || "0", 8);
    const typeflag = String.fromCharCode(entete[156]);
    const mode = modeVoulu(nom, typeflag);
    entete.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "ascii");
    recalculerSomme(entete);
    corrigees += 1;
    position += 512 + Math.ceil(taille / 512) * 512;
  }
  return corrigees;
}

/**
 * Ouvre l'archive `ar` d'un paquet Debian.
 *
 * Le format est celui qu'écrit `Archiveur-Ar.ps1` : un en-tête de huit octets, puis par membre un
 * en-tête de soixante octets et ses données, complétées à une longueur paire.
 */
function lireAr(paquet) {
  const membres = [];
  let position = 8;
  while (position + 60 <= paquet.length) {
    const entete = paquet.subarray(position, position + 60);
    const nom = entete.toString("ascii", 0, 16).trim().replace(/\/$/, "");
    const taille = parseInt(entete.toString("ascii", 48, 58).trim(), 10);
    if (!nom || Number.isNaN(taille)) break;
    const debut = position + 60;
    membres.push({ nom, entete: Buffer.from(entete), donnees: Buffer.from(paquet.subarray(debut, debut + taille)) });
    position = debut + taille + (taille % 2);
  }
  return membres;
}

function ecrireAr(membres) {
  const morceaux = [Buffer.from("!<arch>\n", "ascii")];
  for (const membre of membres) {
    const entete = Buffer.from(membre.entete);
    entete.write(String(membre.donnees.length).padEnd(10), 48, 10, "ascii");
    morceaux.push(entete, membre.donnees);
    if (membre.donnees.length % 2 !== 0) morceaux.push(Buffer.from("\n", "ascii"));
  }
  return Buffer.concat(morceaux);
}

export function corrigerPaquet(chemin) {
  const membres = lireAr(readFileSync(chemin));
  const bilan = {};
  for (const membre of membres) {
    if (!membre.nom.endsWith(".tar.gz")) continue;
    const tar = gunzipSync(membre.donnees);
    bilan[membre.nom] = corrigerTar(tar);
    membre.donnees = gzipSync(tar, { level: 9 });
  }
  writeFileSync(chemin, ecrireAr(membres));
  return bilan;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const paquet = process.argv[2];
  if (!paquet) { console.error("usage : node corriger-modes-deb.mjs <paquet.deb>"); process.exit(2); }
  const bilan = corrigerPaquet(paquet);
  for (const [nom, combien] of Object.entries(bilan)) console.log(`  ${nom} : ${combien} entrées`);
}
