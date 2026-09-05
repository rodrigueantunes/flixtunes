#!/usr/bin/env node
/**
 * Réparer un `.deb` fabriqué sous Windows, que `dpkg` refuse d'installer.
 *
 * Le paquet de bureau est produit par le bundler Tauri, et sur Windows celui-ci laisse deux traces de
 * la plate-forme dans des fichiers qui n'en tolèrent aucune. Mesuré sur la livraison 0.5.7.r15 :
 *
 * | fichier | attendu | produit | conséquence |
 * | --- | --- | --- | --- |
 * | `debian-binary` | `2.0\n` | `2.0\r\n` | **`dpkg` refuse le paquet** |
 * | `control` | UTF-8 | cp1252 | description illisible, avertissements |
 *
 * Le premier suffit à tout bloquer. La politique Debian veut que le numéro de version du format soit
 * **suivi d'un saut de ligne**, et `dpkg-deb` vérifie l'octet : le retour chariot qui le précède fait
 * échouer la lecture avant même qu'on ait regardé le contenu du paquet. C'est pour cette raison
 * qu'aucun message ne parle jamais de FlixTunes — le refus a lieu au tout premier membre de l'archive.
 *
 * Le second ne bloque pas l'installation mais rend la description fausse : « Votre cinéma local »
 * s'affichait « Votre cin?ma local », parce que le fichier était écrit dans l'encodage de la console
 * Windows là où Debian impose UTF-8.
 *
 * ## Pourquoi réparer plutôt que corriger la source
 *
 * Les deux défauts viennent du bundler, pas de nous, et l'attendre reviendrait à ne pas livrer de
 * `.deb`. La réparation, elle, est vérifiable : ce script relit ce qu'il a écrit et refuse de rendre
 * la main si le résultat n'est pas conforme. Elle est aussi sans effet sur un paquet déjà sain — on
 * peut donc l'appliquer toujours, y compris le jour où le bundler sera réparé.
 *
 * Usage : `node tools/reparer-deb.mjs <chemin du .deb>`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

/** L'en-tête d'un membre `ar` : 60 octets de champs à largeur fixe, terminés par un magique. */
const TAILLE_ENTETE = 60;
const MAGIQUE = "`\n";

/** Un membre de l'archive, tel qu'on le relit puis le réécrit. */
function lireMembres(octets) {
  if (octets.subarray(0, 8).toString("latin1") !== "!<arch>\n") {
    throw new Error("ce fichier n'est pas une archive ar : il ne peut pas être un .deb");
  }
  const membres = [];
  let position = 8;
  while (position + TAILLE_ENTETE <= octets.length) {
    const entete = octets.subarray(position, position + TAILLE_ENTETE);
    if (entete.subarray(58, 60).toString("latin1") !== MAGIQUE) {
      throw new Error(`membre mal formé à l'octet ${position}`);
    }
    // GNU ar termine les noms par « / » ; BSD ne le fait pas. Les deux se rencontrent, et dpkg
    // accepte les deux : on retient le nom nu et on réécrit dans la forme d'origine.
    const nomBrut = entete.subarray(0, 16).toString("latin1").trimEnd();
    const taille = Number.parseInt(entete.subarray(48, 58).toString("latin1").trim(), 10);
    if (!Number.isFinite(taille)) throw new Error(`taille illisible pour « ${nomBrut} »`);
    const debut = position + TAILLE_ENTETE;
    membres.push({
      nomBrut,
      nom: nomBrut.replace(/\/$/, ""),
      entete: Buffer.from(entete),
      contenu: Buffer.from(octets.subarray(debut, debut + taille)),
    });
    // Les membres sont alignés sur un octet pair, comblés par un saut de ligne.
    position = debut + taille + (taille % 2);
  }
  return membres;
}

function ecrireArchive(membres) {
  const morceaux = [Buffer.from("!<arch>\n", "latin1")];
  for (const membre of membres) {
    const entete = Buffer.from(membre.entete);
    // Seule la taille change : tout le reste — date, propriétaire, mode — est celui du bundler, et
    // le réinventer ferait diverger le paquet de ce qui a été construit.
    entete.write(String(membre.contenu.length).padEnd(10, " "), 48, 10, "latin1");
    morceaux.push(entete, membre.contenu);
    if (membre.contenu.length % 2 === 1) morceaux.push(Buffer.from("\n", "latin1"));
  }
  return Buffer.concat(morceaux);
}

/**
 * Le fichier `control` d'une archive tar, réencodé en UTF-8 quand il ne l'est pas.
 *
 * On ne réécrit que si c'est nécessaire : un paquet déjà sain doit ressortir identique, sans quoi la
 * réparation deviendrait elle-même une source de différences.
 */
function reparerControle(tarOctets) {
  const TAILLE_BLOC = 512;
  let position = 0;
  let modifie = false;
  const sortie = Buffer.from(tarOctets);
  while (position + TAILLE_BLOC <= sortie.length) {
    const entete = sortie.subarray(position, position + TAILLE_BLOC);
    const nom = entete.subarray(0, 100).toString("latin1").replace(/\0.*$/, "");
    if (!nom) break; // deux blocs vides terminent une archive tar
    const taille = Number.parseInt(entete.subarray(124, 136).toString("latin1").replace(/\0.*$/, "").trim() || "0", 8);
    const debut = position + TAILLE_BLOC;
    if (/(^|\/)control$/.test(nom)) {
      const brut = sortie.subarray(debut, debut + taille);
      const enUtf8 = Buffer.from(brut.toString("utf8"), "utf8");
      // Un aller-retour UTF-8 qui ne rend pas les mêmes octets dénonce un contenu qui n'est pas
      // de l'UTF-8 : c'est le cas d'un fichier écrit dans l'encodage de la console Windows.
      if (!enUtf8.equals(brut)) {
        const converti = Buffer.from(brut.toString("latin1"), "utf8");
        if (converti.length !== taille) {
          // Réécrire une taille de bloc tar changerait toute l'archive : on préfère le dire et ne
          // rien casser. Le défaut bloquant reste corrigé par ailleurs.
          console.warn("[reparer-deb] control non-UTF-8 mais de longueur différente une fois converti : laissé tel quel");
        } else {
          converti.copy(sortie, debut);
          modifie = true;
        }
      }
    }
    position = debut + Math.ceil(taille / TAILLE_BLOC) * TAILLE_BLOC;
  }
  return { octets: sortie, modifie };
}

const chemin = process.argv[2];
if (!chemin) {
  console.error("usage : node tools/reparer-deb.mjs <chemin du .deb>");
  process.exit(2);
}

const original = readFileSync(chemin);
const membres = lireMembres(original);
const corrections = [];

const binaire = membres.find((m) => m.nom === "debian-binary");
if (!binaire) throw new Error("le paquet ne porte pas de membre debian-binary");
const versionFormat = binaire.contenu.toString("latin1");
if (versionFormat !== "2.0\n") {
  binaire.contenu = Buffer.from("2.0\n", "latin1");
  corrections.push(`debian-binary : ${JSON.stringify(versionFormat)} → "2.0\\n"`);
}

const controle = membres.find((m) => m.nom.startsWith("control.tar"));
if (controle && controle.nom.endsWith(".gz")) {
  const { octets, modifie } = reparerControle(gunzipSync(controle.contenu));
  if (modifie) {
    controle.contenu = gzipSync(octets, { level: 9 });
    corrections.push("control : réencodé en UTF-8");
  }
}

if (!corrections.length) {
  console.log(`[reparer-deb] ${chemin} : déjà conforme, rien à faire`);
  process.exit(0);
}

const repare = ecrireArchive(membres);
writeFileSync(chemin, repare);

/*
 * On relit ce qu'on vient d'écrire.
 *
 * Une réparation qui ne se vérifie pas vaut une supposition de plus, et c'est précisément ce qu'on
 * cherche à éviter : le paquet n'a jamais été testé sur une machine Debian depuis cette chaîne de
 * construction, et le seul contrôle possible ici est celui de la forme.
 */
const relu = lireMembres(readFileSync(chemin));
const relubinaire = relu.find((m) => m.nom === "debian-binary");
if (relubinaire?.contenu.toString("latin1") !== "2.0\n") {
  throw new Error("la réparation n'a pas pris : debian-binary reste non conforme");
}
if (relu.length !== membres.length) throw new Error("des membres ont disparu à la réécriture");

for (const correction of corrections) console.log(`[reparer-deb] ${correction}`);
console.log(`[reparer-deb] ${chemin} : ${relu.length} membres, forme vérifiée`);
