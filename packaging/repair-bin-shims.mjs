/**
 * Reconstruit `node_modules/.bin` à partir des paquets déjà installés.
 *
 * Sur un partage réseau, `pnpm install` échoue régulièrement en `ERR_PNPM_EPERM` ou
 * `ERR_PNPM_ENOTEMPTY` : il copie un paquet vers « <nom>_tmp_<pid>_<n> » puis ne parvient pas à
 * remplacer le répertoire d'origine. Quand cela arrive pendant l'écriture des raccourcis, `.bin`
 * reste vide — ou disparaît. Les paquets, eux, sont bien là.
 *
 * L'effet est déroutant : `pnpm --filter … build` échoue sur « 'tsc' n'est pas reconnu », ce qui
 * ressemble à une dépendance manquante alors que TypeScript est installé. Seul le raccourci manque.
 *
 * Ce script relit le champ `bin` de chaque paquet et réécrit les raccourcis. Il n'installe rien, ne
 * télécharge rien et ne supprime rien : relancer `pnpm install` plus tard reste possible et
 * prioritaire. C'est un dépannage, pas un remplacement.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const racine = path.resolve(process.argv[2] ?? ".");
const modules = path.join(racine, "node_modules");
const bin = path.join(modules, ".bin");
if (!existsSync(modules)) throw new Error(`node_modules introuvable sous ${racine}`);
mkdirSync(bin, { recursive: true });

/** Les paquets installés, portées comprises (`@scope/nom`). */
function paquets() {
  const trouves = [];
  for (const entree of readdirSync(modules, { withFileTypes: true })) {
    if (entree.name.startsWith(".")) continue;
    if (entree.name.startsWith("@")) {
      const portee = path.join(modules, entree.name);
      for (const sous of readdirSync(portee, { withFileTypes: true })) {
        if (sous.isDirectory() || sous.isSymbolicLink()) trouves.push(`${entree.name}/${sous.name}`);
      }
    } else if (entree.isDirectory() || entree.isSymbolicLink()) trouves.push(entree.name);
  }
  return trouves;
}

/** Le champ `bin` normalisé en { commande: chemin relatif au paquet }. */
function commandes(nom) {
  const manifeste = path.join(modules, nom, "package.json");
  if (!existsSync(manifeste)) return {};
  let json;
  // Un manifeste à demi écrit par une installation interrompue ne doit pas arrêter la réparation.
  try { json = JSON.parse(readFileSync(manifeste, "utf8")); } catch { return {}; }
  if (!json.bin) return {};
  if (typeof json.bin === "string") return { [json.name?.split("/").pop() ?? nom]: json.bin };
  return typeof json.bin === "object" ? json.bin : {};
}

let ecrits = 0;
for (const nom of paquets()) {
  for (const [commande, cible] of Object.entries(commandes(nom))) {
    if (!commande || !cible) continue;
    const relatif = path.posix.join("..", ...nom.split("/"), String(cible).replace(/\\/g, "/"));
    if (!existsSync(path.join(bin, relatif))) continue;

    // Trois formes, parce que trois interpréteurs peuvent lancer un script de paquet : CMD (celui
    // que pnpm emploie par défaut sous Windows), PowerShell, et les shells POSIX.
    writeFileSync(path.join(bin, `${commande}.cmd`),
      `@echo off\r\nnode "%~dp0\\${relatif.replace(/\//g, "\\")}" %*\r\n`);
    writeFileSync(path.join(bin, `${commande}.ps1`),
      `#!/usr/bin/env pwsh\nnode "$PSScriptRoot/${relatif}" @args\nexit $LASTEXITCODE\n`);
    writeFileSync(path.join(bin, commande),
      `#!/bin/sh\nexec node "$(dirname "$0")/${relatif}" "$@"\n`);
    ecrits += 1;
  }
}
console.log(`${ecrits} raccourci(s) reconstruit(s) dans ${bin}`);
