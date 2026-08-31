import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DirectoryBrowserEntry, DirectoryBrowserListing } from "@flixtunes/contracts";
import { config } from "./config.js";
import { listLibraries } from "./database.js";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function existingDirectory(candidate: string): Promise<string | null> {
  try {
    const resolved = await realpath(candidate);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

async function uniqueExistingDirectories(candidates: string[]): Promise<string[]> {
  const resolved = await Promise.all(candidates.map(existingDirectory));
  const seen = new Set<string>();
  return resolved.filter((item): item is string => {
    if (!item) return false;
    const comparable = process.platform === "win32" ? item.toLowerCase() : item;
    if (seen.has(comparable)) return false;
    seen.add(comparable);
    return true;
  });
}

export async function discoverBrowseRoots(): Promise<string[]> {
  const configured = process.env.FLIXTUNES_BROWSE_ROOTS?.split(path.delimiter).map((item) => item.trim()).filter(Boolean) ?? [];
  if (configured.length) return uniqueExistingDirectories(configured);

  const candidates: string[] = [];
  if (process.platform === "win32") {
    // Un serveur Windows peut stocker les médias sur un autre disque que celui
    // de FlixTunes. Les lettres C à Z sont sondées sans dépendre de PowerShell.
    candidates.push(...Array.from({ length: 24 }, (_, index) => `${String.fromCharCode(67 + index)}:\\`));
    candidates.push(path.parse(process.cwd()).root, path.parse(config.dataDir).root);
    for (const library of listLibraries()) candidates.push(path.parse(library.path).root);
  } else {
    try {
      const rootEntries = await readdir("/", { withFileTypes: true });
      candidates.push(...rootEntries.filter((entry) => entry.isDirectory() && /^volume\d+$/.test(entry.name)).map((entry) => `/${entry.name}`));
    } catch {
      // Les racines standards ci-dessous restent disponibles si / ne peut pas être lu.
    }
    candidates.push("/mnt", "/media", "/srv");
    for (const library of listLibraries()) {
      const match = /^\/(volume\d+)(?:\/|$)/.exec(library.path);
      if (match) candidates.push(`/${match[1]}`);
    }
  }
  const roots = await uniqueExistingDirectories(candidates);
  if (roots.length) return roots;

  // Repli limité au dossier de données de FlixTunes, jamais à la racine complète du système.
  return uniqueExistingDirectories([config.dataDir]);
}

/**
 * Les fichiers d'un dossier, filtrés par extension.
 *
 * Le parcours ne montrait que des dossiers, parce qu'une bibliothèque **est** un dossier. Le fichier
 * de listes, lui, est un fichier : demander de le taper à la main après avoir choisi son dossier
 * revenait à faire à moitié le travail que ce composant existe pour faire.
 *
 * L'extension est **exigée** plutôt qu'optionnelle : sans elle, un dossier de médias afficherait ses
 * milliers de fichiers vidéo dans une fenêtre qui sert à en choisir un seul.
 */
async function fileEntries(directory: string, extensions: string[]): Promise<DirectoryBrowserEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const voulues = extensions.map((extension) => `.${extension.replace(/^\./, "").toLowerCase()}`);
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".")
      && voulues.includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true, sensitivity: "base" }));
}

async function directoryEntries(directory: string, allowedRoot: string): Promise<DirectoryBrowserEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = await Promise.all(entries
    .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("@") && (entry.isDirectory() || entry.isSymbolicLink()))
    .map(async (entry): Promise<DirectoryBrowserEntry | null> => {
      const child = path.join(directory, entry.name);
      try {
        const resolved = await realpath(child);
        if (!isInside(allowedRoot, resolved) || !(await stat(resolved)).isDirectory()) return null;
        return { name: entry.name, path: resolved };
      } catch {
        return null;
      }
    }));
  return directories.filter((entry): entry is DirectoryBrowserEntry => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true, sensitivity: "base" }));
}

export async function browseDirectories(requestedPath?: string, explicitRoots?: string[],
  extensions: string[] = []): Promise<DirectoryBrowserListing> {
  const roots = await uniqueExistingDirectories(explicitRoots ?? await discoverBrowseRoots());
  const rootEntries = roots.map((root) => ({ name: path.basename(root) || root, path: root }));
  if (!requestedPath?.trim()) return { path: null, parentPath: null, roots: rootEntries, directories: rootEntries };

  let current: string;
  try {
    current = await realpath(requestedPath);
  } catch {
    throw new Error("Dossier introuvable ou inaccessible");
  }
  const allowedRoot = roots.find((root) => isInside(root, current));
  if (!allowedRoot) throw new Error("Ce dossier se trouve hors des volumes autorisés");
  if (!(await stat(current)).isDirectory()) throw new Error("Le chemin ne désigne pas un dossier");

  const parentCandidate = path.dirname(current);
  const parentPath = current === allowedRoot ? null : (isInside(allowedRoot, parentCandidate) ? parentCandidate : null);
  return {
    path: current,
    parentPath,
    roots: rootEntries,
    directories: await directoryEntries(current, allowedRoot),
    files: extensions.length ? await fileEntries(current, extensions) : undefined,
  };
}
