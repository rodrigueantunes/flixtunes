import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
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
