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
 * ## Le paquet Debian se construit sous Windows
 *
 * Il a fallu lever quatre obstacles, chacun mesuré, aucun insurmontable :
 *
 * 1. **Le VLC embarqué.** `preparer-vlc.mjs` le tire des paquets Ubuntu ; le `tar` de Windows sait
 *    ouvrir un `.deb` et sa charge zstd. La machine qui construit n'a même pas besoin de VLC.
 * 2. **fpm ne recevait pas ses arguments.** electron-builder met un saut de ligne dans la description
 *    d'un paquet — un `\n` en dur dans son gabarit —, et RubyGems installe `fpm` comme
 *    un fichier de commandes, qui ne peut pas en porter. Un exécutable, lui, le peut : `Relais-Fpm.ps1`
 *    en compile un de trente lignes.
 * 3. **fpm ne trouvait pas ses outils.** Il découpe le `PATH` sur `:` — le séparateur d'Unix, pas
 *    celui de Windows — et cherche `tar` sans extension. `rustine-fpm.rb` corrige les deux en mémoire,
 *    sans toucher à la gemme installée.
 * 4. **`ar` n'existe pas sous Windows.** Plutôt que d'exiger MSYS2 ou LLVM, `Archiveur-Ar.ps1` en
 *    écrit un de création seule : le conteneur d'un `.deb` tient en un en-tête par membre.
 *
 * Reste une chose que Windows ne sait pas dire : le **bit d'exécution**. Le paquet sort avec `0666`
 * partout, et rien ne se lancerait. `corriger-modes-deb.mjs` repose les droits dans l'archive
 * elle-même, après coup.
 *
 * L'**AppImage**, elle, ne sort pas d'ici : son agencement pose un lien symbolique, que Windows
 * refuse de créer sans un privilège qu'une session ordinaire n'a pas. Elle se construit sur une
 * machine Linux — ou peut-être sur un Windows en mode développeur, non vérifié.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparerVlc } from "./preparer-vlc.mjs";
import { corrigerPaquet } from "./corriger-modes-deb.mjs";

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

/**
 * L'outillage Debian sous Windows : un relais vers fpm, un `ar`, et la rustine qui corrige sa
 * recherche d'outils. Rend les variables d'environnement à passer à electron-builder.
 *
 * `System32` est mis en tête du chemin pour une raison précise : c'est le `tar` de Windows qu'on veut,
 * et non celui de Git — ce dernier lit « C:\… » comme une machine distante et échoue.
 */
function preparerOutilsDebian() {
  const outils = path.join(COQUE, "outils-paquet");
  const dire = (ligne) => spawnSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ligne}"`, { shell: true, encoding: "utf8" });

  const relais = dire(`${path.join(ICI, "Relais-Fpm.ps1")}" -Destination "${outils}`);
  if (relais.status !== 0) {
    console.error(relais.stderr?.trim() || "Le relais vers fpm n'a pas pu être construit.");
    console.error("Installez Ruby puis « gem install fpm » : le paquet Debian en dépend.");
    process.exit(2);
  }
  // Le script rend une ligne de JSON, précédée le cas échéant d'avertissements : on garde la dernière.
  const { ruby, script } = JSON.parse(relais.stdout.trim().split(/\r?\n/).pop().trim());
  const archiveur = dire(`${path.join(ICI, "Archiveur-Ar.ps1")}" -Destination "${outils}`);
  if (archiveur.status !== 0) { console.error(archiveur.stderr?.trim()); process.exit(2); }

  const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  console.log("  fpm et ar prêts");
  return {
    PATH: [system32, outils, process.env.PATH].join(path.delimiter),
    FLIXTUNES_RUBY: ruby,
    FLIXTUNES_FPM: script,
    FLIXTUNES_RUSTINE_FPM: path.join(ICI, "rustine-fpm.rb"),
  };
}

console.log("1. compilation de la coque");
lancer(`node "${path.join(RACINE, "node_modules", "typescript", "bin", "tsc")}" -p tsconfig.json`);
lancer("node scripts/copier-pages.mjs");

const cible = process.argv.includes("--linux") ? "linux" : process.platform;
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
const outillageDebian = cible === "linux" && process.platform === "win32" ? preparerOutilsDebian() : {};

const marque = estampille();
console.log(`4. installateur ${marque}`);
// L'estampille passe par l'environnement plutôt que par la ligne de commande : `${arch}` et `${ext}`
// sont des motifs d'electron-builder, et un shell les remplacerait par du vide avant qu'il ne les voie.
const avecEstampille = { env: { ...process.env, FLIXTUNES_ESTAMPILLE: marque, ...outillageDebian } };

/*
 * **La révision entre aussi dans la version du paquet, et pas seulement dans son nom de fichier.**
 *
 * L'estampille ne servait qu'à nommer les fichiers ; le champ `Version` du `.deb`, lui, venait de
 * `package.json` et valait « 0.5.7 » pour toutes les révisions. Conséquence relevée sous Ubuntu : le
 * Centre d'applications affiche « installé » devant une révision plus récente et ne propose aucune
 * mise à jour — `dpkg` compare 0.5.7 à 0.5.7 et conclut à l'égalité, ce qui est exact et inutile.
 *
 * `0.5.7.r22` est une version Debian valide, et l'ordre de comparaison est celui qu'on attend :
 * elle est supérieure à `0.5.7.r21` comme à `0.5.7` tout court.
 */
const versionPaquet = `--config.extraMetadata.version=${marque}`;
if (cible === "linux") {
  // L'AppImage n'est demandée que sur une machine Linux : voir l'en-tête.
  const formats = process.platform === "linux" ? "deb AppImage" : "deb";
  lancer(`npx electron-builder --linux ${formats} ${versionPaquet} --publish never`, avecEstampille);
  if (process.platform === "win32") {
    console.log("5. droits du paquet Debian");
    for (const nom of readdirSync(path.join(COQUE, "release")).filter((entree) => entree.endsWith(".deb"))) {
      const bilan = corrigerPaquet(path.join(COQUE, "release", nom));
      for (const [archive, combien] of Object.entries(bilan)) console.log(`  ${nom} — ${archive} : ${combien} entrées`);
    }
    console.log("  AppImage non produite : elle demande une machine Linux.");
  }
} else if (process.platform === "win32") {
  lancer(`npx electron-builder --win ${versionPaquet} --publish never`, avecEstampille);
} else {
  throw new Error(`Aucune cible d'empaquetage pour ${process.platform}.`);
}

console.log(`\nInstallateur dans ${path.join(COQUE, "release")}`);
