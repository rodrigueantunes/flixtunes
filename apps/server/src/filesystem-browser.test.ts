import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { browseDirectories } from "./filesystem-browser.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("parcours sécurisé des dossiers serveur", () => {
  it("liste les dossiers et permet de remonter jusqu'à la racine autorisée", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-browser-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "Films", "Animation"), { recursive: true });
    await mkdir(path.join(root, ".system"));
    const canonicalRoot = await realpath(root);

    const roots = await browseDirectories(undefined, [root]);
    expect(roots.directories).toEqual([{ name: path.basename(canonicalRoot), path: canonicalRoot }]);
    const listing = await browseDirectories(root, [root]);
    expect(listing.directories).toEqual([{ name: "Films", path: path.join(canonicalRoot, "Films") }]);
    expect(listing.parentPath).toBeNull();
    expect((await browseDirectories(path.join(root, "Films"), [root])).parentPath).toBe(canonicalRoot);
  });

  it("ne montre les fichiers que si on les demande, et seulement l'extension nommée", async () => {
    // Le fichier de listes de la télévision en direct **est** un fichier : faire choisir son dossier
    // puis taper son nom à la main revenait à faire à moitié le travail de cette fenêtre. Mais sans
    // filtre d'extension, un dossier de médias y déverserait ses milliers de vidéos.
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-fichiers-"));
    temporaryDirectories.push(root);
    const canonicalRoot = await realpath(root);
    await writeFile(path.join(root, "m3u.json"), "{}");
    await writeFile(path.join(root, "notes.txt"), "");
    await writeFile(path.join(root, ".cache.json"), "{}");
    await mkdir(path.join(root, "Listes"));

    // Sans extension demandée : rien ne change pour les bibliothèques.
    expect((await browseDirectories(root, [root])).files).toBeUndefined();

    const avecFichiers = await browseDirectories(root, [root], ["json"]);
    expect(avecFichiers.files).toEqual([{ name: "m3u.json", path: path.join(canonicalRoot, "m3u.json") }]);
    // Les dossiers restent listés : on descend d'abord, on choisit ensuite.
    expect(avecFichiers.directories).toEqual([{ name: "Listes", path: path.join(canonicalRoot, "Listes") }]);
  });

  it("bloque les chemins et liens symboliques qui sortent des racines autorisées", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-browser-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "flixtunes-browser-outside-"));
    temporaryDirectories.push(root, outside);
    await expect(browseDirectories(outside, [root])).rejects.toThrow("hors des volumes autorisés");
    try {
      await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
      expect((await browseDirectories(root, [root])).directories).toEqual([]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });
});
