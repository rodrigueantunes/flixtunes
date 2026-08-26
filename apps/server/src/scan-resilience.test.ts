import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { listSkippedFiles } from "./scan-safety.js";
import { scanLibraryById } from "./scanner.js";

/**
 * Résilience d'une analyse — étape 54, second volet.
 *
 * Ces cas se jouent sur de vrais dossiers : ils portent sur ce que le scanner conclut de l'état du
 * disque, et une simulation en mémoire prouverait seulement que les simulations se comportent bien.
 */

const roots: string[] = [];
const libraries: string[] = [];

async function library(name: string): Promise<{ id: string; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), `flixtunes-${name}-`));
  roots.push(root);
  const id = randomUUID();
  libraries.push(id);
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, ?, ?, 'movie', 'fr-FR')")
    .run(id, name, root);
  return { id, root };
}

function availableCount(libraryId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE library_id = ? AND available = 1")
    .get(libraryId) as { n: number }).n;
}

/** Sème directement en base : ces cas portent sur la conclusion de l'analyse, pas sur l'import. */
function seedAvailable(libraryId: string, root: string, count: number): void {
  const insert = db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, file_path, library_id,
    runtime_seconds, available) VALUES (?, 'movie', ?, ?, ?, ?, 5400, 1)`);
  for (let index = 0; index < count; index += 1) {
    const title = `Semé ${index}`;
    insert.run(randomUUID(), title, title.toLowerCase(), path.join(root, `sème-${index}.mkv`), libraryId);
  }
}

afterAll(async () => {
  for (const id of libraries) {
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM media_items WHERE library_id IS NULL").run();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("une analyse ne vide jamais le catalogue", () => {
  it("conserve la bibliothèque quand la racine ne rend plus aucun fichier", async () => {
    // Partage démonté, disque en veille, permissions perdues : le dossier existe mais paraît vide.
    // Sans garde-fou, l'analyse marquait indisponible l'intégralité des médias, sans erreur.
    const { id, root } = await library("racine-vide");
    seedAvailable(id, root, 40);
    expect(availableCount(id)).toBe(40);

    const result = await scanLibraryById(id);
    expect(result.discovered).toBe(0);
    expect(result.removed).toBe(0);
    expect(availableCount(id), "les 40 médias doivent survivre").toBe(40);
    expect(result.retainedMissing).toBe(40);
    expect(result.errors[0]?.message).toContain("40");
  });

  it("conserve la bibliothèque quand la majorité des fichiers disparaît d'un coup", async () => {
    const { id, root } = await library("disparition-massive");
    seedAvailable(id, root, 40);
    // Un seul fichier réel : l'analyse en trouve un et conclurait à la perte des trente-neuf autres.
    await writeFile(path.join(root, "Survivant (2026).mkv"), "fixture");

    const result = await scanLibraryById(id);
    expect(result.discovered).toBe(1);
    expect(result.removed).toBe(0);
    expect(availableCount(id)).toBeGreaterThanOrEqual(40);
    expect(result.errors.some((error) => error.message.includes("disparition"))
      || result.errors.some((error) => error.message.includes("analyse"))).toBe(true);
  });

  it("applique tout de même les disparitions sur confirmation explicite", async () => {
    const { id, root } = await library("confirmation");
    seedAvailable(id, root, 40);
    await writeFile(path.join(root, "Survivant (2026).mkv"), "fixture");

    const result = await scanLibraryById(id, { confirmRemovals: true });
    expect(result.removed).toBe(40);
    expect(result.retainedMissing).toBeUndefined();
  });

  it("laisse une petite bibliothèque se vider sans discuter", async () => {
    // Vider un dossier de trois films est un geste courant et sans ambiguïté.
    const { id, root } = await library("petite");
    seedAvailable(id, root, 3);
    await writeFile(path.join(root, "Reste (2026).mkv"), "fixture");

    const result = await scanLibraryById(id);
    expect(result.removed).toBe(3);
  });
});

describe("fichiers en cours de copie", () => {
  it("écarte un fichier qui grossit encore et ne crée aucune fiche", async () => {
    const { id, root } = await library("copie-en-cours");
    const target = path.join(root, "Copie en cours (2026).mkv");
    await writeFile(target, "début");

    // Le fichier grandit pendant l'observation du scanner, exactement comme une copie réseau.
    const grow = setTimeout(() => { void writeFile(target, "début et suite bien plus longue"); }, 120);
    try {
      const result = await scanLibraryById(id, { stabilityDelayMs: 400 });
      expect(result.unstable).toBe(1);
      expect(result.imported).toBe(0);
      expect(availableCount(id), "aucune fiche ne doit être créée pour une copie en cours").toBe(0);
    } finally {
      clearTimeout(grow);
    }
  });

  it("importe le fichier une fois la copie terminée", async () => {
    const { id, root } = await library("copie-finie");
    await writeFile(path.join(root, "Copie finie (2026).mkv"), "contenu complet");

    const result = await scanLibraryById(id, { stabilityDelayMs: 200 });
    expect(result.unstable).toBe(0);
    expect(result.discovered).toBe(1);
    expect(availableCount(id)).toBe(1);
  });

  it("journalise le fichier écarté, puis l'oublie une fois entré", async () => {
    const { id, root } = await library("journal");
    const target = path.join(root, "Journalisé (2026).mkv");
    await writeFile(target, "début");

    const grow = setTimeout(() => { void writeFile(target, "début et suite bien plus longue"); }, 120);
    try {
      await scanLibraryById(id, { stabilityDelayMs: 400 });
    } finally { clearTimeout(grow); }

    const journal = listSkippedFiles(id);
    expect(journal).toHaveLength(1);
    expect(journal[0]?.reason).toBe("unstable");
    expect(journal[0]?.attempts).toBe(1);
    expect(journal[0]?.detail).toContain("cours d'écriture");

    // Deuxième passage, copie toujours en cours : c'est le même problème, pas un nouveau.
    const grow2 = setTimeout(() => { void writeFile(target, "encore plus long, la copie continue de grossir"); }, 120);
    try {
      await scanLibraryById(id, { stabilityDelayMs: 400 });
    } finally { clearTimeout(grow2); }
    expect(listSkippedFiles(id)[0]?.attempts, "le compteur distingue l'incident isolé du problème installé").toBe(2);

    // La copie est terminée : le fichier entre, et sort du journal.
    const result = await scanLibraryById(id, { stabilityDelayMs: 200 });
    expect(result.imported).toBe(1);
    expect(listSkippedFiles(id), "un fichier entré n'a plus à figurer parmi les problèmes").toHaveLength(0);
  });

  it("oublie un fichier journalisé qui a quitté le disque", async () => {
    const { id, root } = await library("journal-purge");
    const target = path.join(root, "Disparu (2026).mkv");
    await writeFile(target, "début");
    const grow = setTimeout(() => { void writeFile(target, "début et suite bien plus longue"); }, 120);
    try {
      await scanLibraryById(id, { stabilityDelayMs: 400 });
    } finally { clearTimeout(grow); }
    expect(listSkippedFiles(id)).toHaveLength(1);

    await rm(target);
    await scanLibraryById(id, { stabilityDelayMs: 200 });
    expect(listSkippedFiles(id), "un fichier supprimé n'est plus un problème à traiter").toHaveLength(0);
  });

  it("ne marque pas indisponible un fichier écarté pour instabilité", async () => {
    // Le fichier existe bel et bien : le compter comme disparu serait pire que de l'ignorer.
    const { id, root } = await library("instable-conserve");
    const target = path.join(root, "Remplacé (2026).mkv");
    await writeFile(target, "version initiale");
    await scanLibraryById(id, { stabilityDelayMs: 200 });
    expect(availableCount(id)).toBe(1);

    const grow = setTimeout(() => { void writeFile(target, "version bien plus longue en cours d'écriture"); }, 120);
    try {
      const result = await scanLibraryById(id, { stabilityDelayMs: 400 });
      expect(result.unstable).toBe(1);
      expect(result.removed).toBe(0);
      expect(availableCount(id), "la fiche existante doit rester disponible").toBe(1);
    } finally {
      clearTimeout(grow);
    }
  });
});
