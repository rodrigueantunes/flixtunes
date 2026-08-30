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
 * ## Ce que Linux demande, et qu'on ne peut pas faire depuis Windows
 *
 * Le `.deb` et l'AppImage sont configurés, mais ils ne se construisent **que sur une machine
 * Linux** : leurs formats s'assemblent avec des outils qui n'existent pas ici, et surtout le VLC
 * qu'ils doivent emporter est fait de binaires Linux — ceux de cette machine ne leur serviraient à
 * rien. Le script le dit plutôt que d'échouer à mi-chemin.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

console.log("1. compilation de la coque");
lancer(`node "${path.join(RACINE, "node_modules", "typescript", "bin", "tsc")}" -p tsconfig.json`);
lancer("node scripts/copier-pages.mjs");

console.log("2. VLC embarqué");
const vlc = preparerVlc(path.join(COQUE, "vendor", "vlc"));
console.log(`  ${vlc.fichiers} fichiers, ${vlc.mio.toFixed(1)} Mio`);

console.log("3. outils d'empaquetage");
preparerOutilsWindows();

console.log("4. installateur");
if (process.platform === "win32") {
  lancer("npx electron-builder --win --publish never");
} else if (process.platform === "linux") {
  lancer("npx electron-builder --linux --publish never");
} else {
  throw new Error(`Aucune cible d'empaquetage pour ${process.platform}.`);
}

console.log(`\nInstallateur dans ${path.join(COQUE, "release")}`);
