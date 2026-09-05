#!/usr/bin/env node
/**
 * Réparer un `.deb` fabriqué sous Windows, que `dpkg` refuse d'installer.
 *
 * Le paquet de bureau est produit par electron-builder, et sous Windows celui-ci laisse la fin de
 * ligne de la plate-forme dans des fichiers qui n'en tolèrent aucune. Relevé sur la livraison
 * 0.5.7.r18, **tout le répertoire de contrôle est en CRLF** :
 *
 * | fichier | attendu | produit | conséquence |
 * | --- | --- | --- | --- |
 * | `debian-binary` | `2.0\n` | `2.0\r\n` | `dpkg` refuse le paquet avant tout examen |
 * | `postinst`, `postrm` | `#!/bin/bash\n` | `#!/bin/bash\r\n` | **l'installation échoue** |
 * | `control`, `md5sums` | lignes en LF | lignes en CRLF | champs douteux, affichages abîmés |
 *
 * Le plus destructeur est le deuxième, et son message ne désigne jamais sa cause :
 *
 * ```
 * impossible d'exécuter (/var/lib/dpkg/tmp.ci/postrm) : Aucun fichier ou dossier de ce nom
 * ```
 *
 * Le fichier existe pourtant. Ce qui manque, c'est son **interpréteur** : le noyau lit la ligne
 * `#!`, y trouve `/bin/bash\r` — retour chariot compris — et cherche un programme de ce nom, qui
 * n'existe pas. D'où un `ENOENT` qui accuse le script alors que le coupable est le caractère
 * invisible qui le suit.
 *
 * ## Pourquoi réparer plutôt que corriger la source
 *
 * Le défaut vient du bundler, pas de nous, et l'attendre reviendrait à ne pas livrer de `.deb`. La
 * réparation, elle, est vérifiable : ce script relit ce qu'il a écrit et refuse de rendre la main si
 * le résultat n'est pas conforme. Elle est sans effet sur un paquet déjà sain — on peut donc
 * l'appliquer toujours, y compris le jour où le bundler sera réparé.
 *
 * **Seul le répertoire de contrôle est touché.** `data.tar` porte les fichiers installés, dont des
 * binaires et des médias où une conversion de fin de ligne serait une corruption pure et simple.
 *
 * Usage : `node tools/reparer-deb.mjs <chemin du .deb>`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const TAILLE_ENTETE_AR = 60;
const MAGIQUE_AR = "`\n";
const BLOC_TAR = 512;

/** Les membres d'une archive `ar`, dans l'ordre, tels qu'on les relit puis les réécrit. */
function lireMembres(octets) {
  if (octets.subarray(0, 8).toString("latin1") !== "!<arch>\n") {
    throw new Error("ce fichier n'est pas une archive ar : il ne peut pas être un .deb");
  }
  const membres = [];
  let position = 8;
  while (position + TAILLE_ENTETE_AR <= octets.length) {
    const entete = octets.subarray(position, position + TAILLE_ENTETE_AR);
    if (entete.subarray(58, 60).toString("latin1") !== MAGIQUE_AR) {
      throw new Error(`membre mal formé à l'octet ${position}`);
    }
    // GNU ar termine les noms par « / », BSD non ; dpkg accepte les deux, et l'on réécrit la forme
    // d'origine pour ne pas transformer plus que nécessaire.
    const nomBrut = entete.subarray(0, 16).toString("latin1").trimEnd();
    const taille = Number.parseInt(entete.subarray(48, 58).toString("latin1").trim(), 10);
    if (!Number.isFinite(taille)) throw new Error(`taille illisible pour « ${nomBrut} »`);
    const debut = position + TAILLE_ENTETE_AR;
    membres.push({
      nom: nomBrut.replace(/\/$/, ""),
      entete: Buffer.from(entete),
      contenu: Buffer.from(octets.subarray(debut, debut + taille)),
    });
    position = debut + taille + (taille % 2); // les membres sont alignés sur un octet pair
  }
  return membres;
}

function ecrireArchive(membres) {
  const morceaux = [Buffer.from("!<arch>\n", "latin1")];
  for (const membre of membres) {
    const entete = Buffer.from(membre.entete);
    // Seule la taille change : date, propriétaire et mode restent ceux du bundler, les réinventer
    // ferait diverger le paquet de ce qui a été construit.
    entete.write(String(membre.contenu.length).padEnd(10, " "), 48, 10, "latin1");
    morceaux.push(entete, membre.contenu);
    if (membre.contenu.length % 2 === 1) morceaux.push(Buffer.from("\n", "latin1"));
  }
  return Buffer.concat(morceaux);
}

/** Les entrées d'une archive tar, en-tête conservé tel quel pour tout ce qu'on ne change pas. */
function lireTar(octets) {
  const entrees = [];
  let position = 0;
  while (position + BLOC_TAR <= octets.length) {
    const entete = octets.subarray(position, position + BLOC_TAR);
    const nom = entete.subarray(0, 100).toString("latin1").replace(/\0.*$/, "");
    if (!nom) break; // deux blocs vides terminent l'archive
    const taille = Number.parseInt(
      entete.subarray(124, 136).toString("latin1").replace(/\0.*$/, "").trim() || "0", 8);
    const debut = position + BLOC_TAR;
    entrees.push({ nom, entete: Buffer.from(entete), contenu: Buffer.from(octets.subarray(debut, debut + taille)) });
    position = debut + Math.ceil(taille / BLOC_TAR) * BLOC_TAR;
  }
  return entrees;
}

/**
 * La somme de contrôle d'un en-tête tar.
 *
 * Elle se calcule sur l'en-tête entier, **son propre champ compté comme huit espaces**. L'oublier
 * produirait une archive que `tar` refuse d'ouvrir — et l'on aurait remplacé un paquet qui ne
 * s'installe pas par un paquet qu'on ne peut même plus lire.
 */
function sceller(entete) {
  entete.fill(0x20, 148, 156);
  let somme = 0;
  for (const octet of entete) somme += octet;
  entete.write(somme.toString(8).padStart(6, "0"), 148, 6, "latin1");
  entete[154] = 0;
  entete[155] = 0x20;
  return entete;
}

function ecrireTar(entrees) {
  const morceaux = [];
  for (const entree of entrees) {
    const entete = Buffer.from(entree.entete);
    entete.write(entree.contenu.length.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
    morceaux.push(sceller(entete), entree.contenu);
    const reste = entree.contenu.length % BLOC_TAR;
    if (reste) morceaux.push(Buffer.alloc(BLOC_TAR - reste));
  }
  // Deux blocs nuls ferment l'archive, puis l'on complète jusqu'au multiple usuel de dix blocs.
  morceaux.push(Buffer.alloc(BLOC_TAR * 2));
  const total = morceaux.reduce((somme, morceau) => somme + morceau.length, 0);
  const comblement = (BLOC_TAR * 20) - (total % (BLOC_TAR * 20));
  if (comblement !== BLOC_TAR * 20) morceaux.push(Buffer.alloc(comblement));
  return Buffer.concat(morceaux);
}

/** Le CRLF n'a rien à faire dans un fichier de contrôle : ni dans un script, ni dans un champ. */
function enFinsDeLigneUnix(octets) {
  const sortie = Buffer.alloc(octets.length);
  let ecrit = 0;
  for (let index = 0; index < octets.length; index += 1) {
    if (octets[index] === 0x0d && octets[index + 1] === 0x0a) continue; // on saute le CR d'un CRLF
    sortie[ecrit] = octets[index];
    ecrit += 1;
  }
  return sortie.subarray(0, ecrit);
}

const chemin = process.argv[2];
if (!chemin) {
  console.error("usage : node tools/reparer-deb.mjs <chemin du .deb>");
  process.exit(2);
}

const membres = lireMembres(readFileSync(chemin));
const corrections = [];

const binaire = membres.find((membre) => membre.nom === "debian-binary");
if (!binaire) throw new Error("le paquet ne porte pas de membre debian-binary");
const versionFormat = binaire.contenu.toString("latin1");
if (versionFormat !== "2.0\n") {
  binaire.contenu = Buffer.from("2.0\n", "latin1");
  corrections.push(`debian-binary : ${JSON.stringify(versionFormat)} → "2.0\\n"`);
}

const controle = membres.find((membre) => membre.nom.startsWith("control.tar"));
if (controle && controle.nom.endsWith(".gz")) {
  const entrees = lireTar(gunzipSync(controle.contenu));
  const changees = [];
  for (const entree of entrees) {
    const propre = enFinsDeLigneUnix(entree.contenu);
    if (propre.length !== entree.contenu.length) {
      entree.contenu = propre;
      changees.push(entree.nom.replace(/^\.\//, ""));
    }
  }
  if (changees.length) {
    controle.contenu = gzipSync(ecrireTar(entrees), { level: 9 });
    corrections.push(`répertoire de contrôle remis en fins de ligne Unix : ${changees.join(", ")}`);
  }
}

if (!corrections.length) {
  console.log(`[reparer-deb] ${chemin} : déjà conforme, rien à faire`);
  process.exit(0);
}

writeFileSync(chemin, ecrireArchive(membres));

/*
 * On relit ce qu'on vient d'écrire.
 *
 * Une réparation qui ne se vérifie pas vaut une supposition de plus, et c'est ce qu'on cherche à
 * éviter : le paquet ne peut pas être installé depuis cette machine, et le seul contrôle possible ici
 * est celui de la forme. On vérifie donc les trois choses qui ont réellement cassé — la version du
 * format, la lisibilité de l'archive de contrôle, et la ligne `#!` de chaque script.
 */
const relus = lireMembres(readFileSync(chemin));
if (relus.find((membre) => membre.nom === "debian-binary")?.contenu.toString("latin1") !== "2.0\n") {
  throw new Error("la réparation n'a pas pris : debian-binary reste non conforme");
}
if (relus.length !== membres.length) throw new Error("des membres ont disparu à la réécriture");
const relu = relus.find((membre) => membre.nom.startsWith("control.tar"));
const entreesRelues = lireTar(gunzipSync(relu.contenu));
if (!entreesRelues.length) throw new Error("l'archive de contrôle réécrite est illisible");
for (const entree of entreesRelues) {
  if (entree.contenu.includes(Buffer.from("\r\n"))) {
    throw new Error(`${entree.nom} contient encore des fins de ligne Windows`);
  }
  if (entree.contenu.subarray(0, 2).toString("latin1") === "#!") {
    const premiere = entree.contenu.subarray(0, entree.contenu.indexOf(0x0a)).toString("latin1");
    if (/\r$/.test(premiere)) throw new Error(`${entree.nom} garde un retour chariot sur sa ligne #!`);
  }
}

for (const correction of corrections) console.log(`[reparer-deb] ${correction}`);
console.log(`[reparer-deb] ${chemin} : ${relus.length} membres, ${entreesRelues.length} fichiers de contrôle, forme vérifiée`);
