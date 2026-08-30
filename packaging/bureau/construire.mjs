#!/usr/bin/env node
/**
 * Construit l'installateur du client de bureau, VLC compris.
 *
 * Une commande, et rien à installer d'autre sur la machine qui reçoit le paquet : c'est la
 * contrainte, et elle explique chacune des étapes ci-dessous.
 *
 *   1. compiler la coque ;
 *   2. y déposer la copie taillée de VLC ;
 *   3. peupler le cache d'outils d'electron-builder — voir plus bas, c'est le passage délicat ;
 *   4. produire l'installateur du système sur lequel on tourne.
 *
 * ## Les paquets Linux demandent une machine Linux
 *
 * Le VLC qu'ils emportent, lui, s'assemble n'importe où : `preparer-vlc.mjs` le tire des paquets
 * Ubuntu, et le `tar` de Windows sait les ouvrir. C'était l'inconnue, et elle est levée — la machine
 * qui construit n'a même pas besoin d'avoir VLC installé.
 *
 * L'assemblage des paquets, non — et les deux raisons ont été mesurées, pas supposées.
 *
 * Le **`.deb`** passe par `fpm`. On peut l'installer sous Windows, Ruby compris, et il s'y lance :
 * ce n'est donc pas l'outil qui manque. Mais electron-builder construit sa description ainsi —
 * `` `${synopsis || ""}
 ${description}` ``, le saut de ligne est en dur — et un fichier de
 * commandes Windows ne peut pas porter un argument qui en contient. La ligne de commande se coupe
 * là, fpm ne reçoit jamais les chemins à empaqueter, et se plaint de n'avoir aucun paramètre.
 * Aucun réglage n'y échappe : retirer le synopsis laisse le saut de ligne en tête.
 *
 * L'**AppImage** pose un lien symbolique, que Windows refuse de créer sans un privilège qu'une
 * session ordinaire n'a pas. Celle-là sortirait peut-être d'un Windows en mode développeur — non
 * vérifié, c'est seulement l'erreur qu'elle rapporte.
 *
 * Les deux sortent donc d'une machine Linux, où rien de tout cela ne se pose. Le script le dit avant
 * de commencer, plutôt que d'échouer après avoir téléchargé cent mégaoctets.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparerVlc } from "./preparer-vlc.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");
const COQUE = path.join(RACINE, "apps", "desktop");

/**
 * Une commande, passée au shell d'un seul tenant.
 *
 * Node avertit — et il a raison — qu'un tableau d'arguments confié à un shell n'est pas échappé mais
 * concaténé. On concatène donc nous-mêmes, en connaissance de cause : tout ce qui passe ici vient de
 * ce fichier, aucune de ces chaînes ne dépend de ce qu'un tiers aurait écrit.
 */
function lancer(ligne, options = {}) {
  const bilan = spawnSync(ligne, { stdio: "inherit", shell: true, cwd: COQUE, ...options });
  if (bilan.status !== 0) throw new Error(`« ${ligne} » a échoué (${bilan.status})`);
}

/**
 * Le cache d'outils d'electron-builder, peuplé à la main sous Windows.
 *
 * electron-builder télécharge une archive d'outils de signature qui contient, à côté de ce dont on a
 * besoin, des **liens symboliques macOS**. Windows refuse de les créer sans un privilège que n'a pas
 * une session ordinaire, l'extraction échoue, et la construction s'arrête — alors que la partie
 * macOS ne nous sert à rien.
 *
 * On extrait donc l'archive nous-mêmes en écartant ce dossier. Le contenu utile est le même ;
 * `rcedit`, qui pose l'icône et le nom du produit sur l'exécutable, en fait partie.
 *
 * L'autre remède serait d'activer le mode développeur de Windows, qui accorde ce privilège. Il
 * demande un réglage du système : le script préfère ne rien exiger de la machine.
 */
function preparerOutilsWindows() {
  if (process.platform !== "win32") return;
  const cache = path.join(process.env.LOCALAPPDATA ?? "", "electron-builder", "Cache", "winCodeSign");
  const attendu = path.join(cache, "winCodeSign-2.6.0");
  if (existsSync(path.join(attendu, "rcedit-x64.exe"))) return;

  const archive = existsSync(cache)
    ? readdirSync(cache).filter((nom) => nom.endsWith(".7z")).map((nom) => path.join(cache, nom))[0]
    : undefined;
  if (!archive) {
    console.log("  outils de signature : archive absente du cache, electron-builder la téléchargera");
    return;
  }
  const sept = path.join(RACINE, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
  if (!existsSync(sept)) return;
  mkdirSync(attendu, { recursive: true });
  lancer(`"${sept}" x "${archive}" "-o${attendu}" -x!darwin -bd -y`, { stdio: "ignore" });
  console.log("  outils de signature extraits sans la partie macOS");
}

/**
 * L'estampille du paquet : la version du produit **et** la révision d'empaquetage.
 *
 * `${version}` d'electron-builder ne connaît que la première, et les paquets sortaient donc en
 * « 0.5.6 » tout court — deux révisions différentes portaient le même nom de fichier, ce qui rend
 * impossible de dire lequel on a installé.
 *
 * La révision vient de la livraison quand c'est elle qui appelle, du journal des versions sinon :
 * son premier titre porte celle de l'entrée en cours.
 */
function estampille() {
  const version = JSON.parse(readFileSync(path.join(COQUE, "package.json"), "utf8")).version;
  const imposee = process.env.FLIXTUNES_PACKAGE_REVISION;
  if (imposee) return `${version}.${imposee}`;
  const journal = readFileSync(path.join(RACINE, "CHANGELOG.md"), "utf8");
  const trouve = /^##\s+\d+\.\d+\.\d+\.(r\d+)/m.exec(journal);
  if (!trouve) throw new Error("Aucune révision lisible dans le premier titre de CHANGELOG.md.");
  return `${version}.${trouve[1]}`;
}

console.log("1. compilation de la coque");
lancer(`node "${path.join(RACINE, "node_modules", "typescript", "bin", "tsc")}" -p tsconfig.json`);
lancer("node scripts/copier-pages.mjs");

const cible = process.argv.includes("--linux") ? "linux" : process.platform;
if (cible === "linux" && process.platform !== "linux") {
  console.error("Les paquets Linux s'assemblent sur une machine Linux. Le .deb echoue ici meme avec fpm");
  console.error("installe : electron-builder met un saut de ligne dans sa description, et un fichier de");
  console.error("commandes Windows ne peut pas porter un argument qui en contient. L'AppImage, elle, pose");
  console.error("un lien symbolique que Windows refuse de creer.");
  console.error("Le VLC Linux, lui, s'assemble d'ici : « node packaging/bureau/preparer-vlc.mjs --linux ».");
  process.exit(2);
}
console.log(`2. VLC embarqué (${cible})`);
const vlc = preparerVlc(path.join(COQUE, "vendor", "vlc"), cible);
console.log(`  ${vlc.fichiers} fichiers, ${vlc.mio.toFixed(1)} Mio`);
if (vlc.dependances.length > 0) {
  // La liste declaree par notre .deb est figee dans package.json : elle ne change qu'avec la version
  // de VLC. On la compare a celle qu'Ubuntu annonce, et on le dit plutot que de la reecrire en
  // silence — un paquet dont les dependances bougent sans qu'on l'ait voulu est un paquet qu'on ne
  // sait plus expliquer.
  const declarees = JSON.parse(readFileSync(path.join(COQUE, "package.json"), "utf8")).build?.deb?.depends ?? [];
  const ecart = vlc.dependances.filter((nom) => !declarees.includes(nom));
  if (ecart.length > 0) console.log(`  ATTENTION : ${ecart.length} dependances non declarees — ${ecart.join(", ")}`);
}

console.log("3. outils d'empaquetage");
preparerOutilsWindows();

const marque = estampille();
console.log(`4. installateur ${marque}`);
// L'estampille passe par l'environnement plutôt que par la ligne de commande : `${arch}` et `${ext}`
// sont des motifs d'electron-builder, et un shell les remplacerait par du vide avant qu'il ne les voie.
const avecEstampille = { env: { ...process.env, FLIXTUNES_ESTAMPILLE: marque } };
if (cible === "linux") {
  lancer("npx electron-builder --linux deb AppImage --publish never", avecEstampille);
} else if (process.platform === "win32") {
  lancer("npx electron-builder --win --publish never", avecEstampille);
} else {
  throw new Error(`Aucune cible d'empaquetage pour ${process.platform}.`);
}

console.log(`\nInstallateur dans ${path.join(COQUE, "release")}`);
