import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyCorrection, undoCorrection } from "./corrections.js";
import { db } from "./database.js";
import { scanLibraryById } from "./scanner.js";

/**
 * Preuve du cycle scan → correction → rescan exigé par l'étape 53.
 *
 * Un test sur le seul SQL ne suffit pas : c'est le scanner réel qui doit respecter le verrou. Ce test
 * analyse un dossier, corrige une fiche, relance l'analyse et vérifie que la correction a survécu.
 */

const roots: string[] = [];
/**
 * Bibliothèques créées en base par ce fichier.
 *
 * Le nettoyage ne portait que sur les dossiers du disque : les lignes correspondantes restaient en
 * base, et trois bibliothèques s'y ajoutaient à **chaque exécution**. Elles y devenaient invisibles —
 * leur dossier n'existait plus — mais faussaient les comptages des autres fichiers de test, qui
 * interrogent la même base.
 */
const bibliothèques: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  for (const libraryId of bibliothèques) {
    // `media_items.library_id` est en `ON DELETE SET NULL` : supprimer la bibliothèque détache ses
    // médias au lieu de les supprimer. Il faut les retirer d'abord, sinon ils survivent en orphelins.
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  }
});

async function scannedLibrary(): Promise<{ libraryId: string; catalogId: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-corrections-")); roots.push(root);
  const movies = path.join(root, "Films");
  await mkdir(movies, { recursive: true });
  await writeFile(path.join(movies, "Voyage Azur (2026).mkv"), "fixture");
  const libraryId = randomUUID();
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Corrections', ?, 'movie', 'fr-FR')")
    .run(libraryId, movies);
  bibliothèques.push(libraryId);
  await scanLibraryById(libraryId, { mode: "files" });
  const row = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'movie'").get(libraryId) as { id: string };
  return { libraryId, catalogId: row.id };
}

describe("conservation des corrections lors d'un nouveau scan", () => {
  it("garde le titre, l'année et l'identifiant corrigés à la main", async () => {
    const { libraryId, catalogId } = await scannedLibrary();
    applyCorrection({ type: "rematch", catalogId, provider: "tmdb", externalId: "424242",
      title: "Titre corrigé à la main", year: 1999 });

    await scanLibraryById(libraryId, { mode: "files" });

    const after = db.prepare(`SELECT title, year, external_provider, external_id, match_status, metadata_locked
      FROM catalog_items WHERE id = ?`).get(catalogId) as {
        title: string; year: number | null; external_provider: string | null; external_id: string | null;
        match_status: string; metadata_locked: number;
      };
    expect(after).toMatchObject({
      title: "Titre corrigé à la main", year: 1999, external_provider: "tmdb", external_id: "424242",
      match_status: "manual", metadata_locked: 1,
    });
  });

  it("laisse de nouveau le scan décider après une annulation", async () => {
    const { libraryId, catalogId } = await scannedLibrary();
    const original = (db.prepare("SELECT title FROM catalog_items WHERE id = ?").get(catalogId) as { title: string }).title;
    const { auditId } = applyCorrection({ type: "rematch", catalogId, provider: "tmdb", externalId: "1", title: "Écrasé" });
    expect(undoCorrection(auditId)).toBe(true);

    await scanLibraryById(libraryId, { mode: "files" });

    const after = db.prepare("SELECT title, metadata_locked FROM catalog_items WHERE id = ?").get(catalogId) as
      { title: string; metadata_locked: number };
    expect(after.metadata_locked).toBe(0);
    expect(after.title).toBe(original);
  });

  it("ne touche jamais au fichier sur disque", async () => {
    const { libraryId, catalogId } = await scannedLibrary();
    const before = db.prepare("SELECT file_path FROM media_items WHERE library_id = ? LIMIT 1").get(libraryId) as { file_path: string };
    applyCorrection({ type: "rematch", catalogId, provider: "tmdb", externalId: "7", title: "Autre" });
    await scanLibraryById(libraryId, { mode: "files" });
    const after = db.prepare("SELECT file_path FROM media_items WHERE library_id = ? LIMIT 1").get(libraryId) as { file_path: string };
    expect(after.file_path).toBe(before.file_path);
    await expect(import("node:fs/promises").then(({ access }) => access(before.file_path))).resolves.toBeUndefined();
  });
});
