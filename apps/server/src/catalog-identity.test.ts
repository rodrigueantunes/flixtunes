import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyCorrection } from "./corrections.js";
import { db } from "./database.js";
import { removeGhostCatalogEntries, scanLibraryById } from "./scanner.js";

/**
 * Identité durable d'une fiche de catalogue.
 *
 * Une fiche s'identifiait par son titre et son année — deux valeurs venues du fournisseur qui avait
 * répondu pour *ce* fichier-là. Quand le fournisseur se taisait, le titre retombait sur le nom de
 * fichier, la clé ne retrouvait plus rien, et une **seconde** fiche naissait pour le même contenu.
 *
 * Ces tests fixent ce qui doit rester vrai : un dossier de série ne donne qu'une fiche, deux dossiers
 * homonymes en donnent deux, un déverrouillage ne rend pas une fiche anonyme, et les fiches qui ne
 * désignent plus aucun fichier finissent par disparaître.
 */

const racines: string[] = [];
const bibliothèques: string[] = [];

afterAll(async () => {
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
  for (const libraryId of bibliothèques) {
    // `media_items.library_id` est en `ON DELETE SET NULL` : les médias doivent partir en premier,
    // sinon ils survivent en orphelins et faussent les comptages des autres fichiers de test.
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  }
});

/** Bibliothèque de séries contenant les fichiers demandés, chemins relatifs à sa racine. */
async function bibliothèqueSéries(fichiers: string[]): Promise<{ libraryId: string; racine: string }> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-identite-")); racines.push(racine);
  const séries = path.join(racine, "Series");
  for (const fichier of fichiers) {
    const complet = path.join(séries, fichier);
    await mkdir(path.dirname(complet), { recursive: true });
    await writeFile(complet, "fixture");
  }
  const libraryId = randomUUID();
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Identité', ?, 'tv', 'fr-FR')")
    .run(libraryId, séries);
  bibliothèques.push(libraryId);
  return { libraryId, racine: séries };
}

const fiches = (libraryId: string, kind: string) => db
  .prepare("SELECT id, title, source_folder, external_provider, external_id FROM catalog_items WHERE library_id = ? AND kind = ? ORDER BY title")
  .all(libraryId, kind) as Array<{ id: string; title: string; source_folder: string | null; external_provider: string | null; external_id: string | null }>;

describe("une série, un dossier", () => {
  it("réunit sous une seule fiche les épisodes d'un même dossier", async () => {
    const { libraryId } = await bibliothèqueSéries([
      "Ma Serie/Saison 1/S01E01.mkv", "Ma Serie/Saison 1/S01E02.mkv", "Ma Serie/Saison 2/S02E01.mkv",
    ]);
    await scanLibraryById(libraryId, { mode: "files" });

    const séries = fiches(libraryId, "show");
    expect(séries).toHaveLength(1);
    expect(séries[0]!.source_folder).toMatch(/Ma Serie$/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE library_id = ? AND kind = 'episode'")
      .get(libraryId)).toMatchObject({ n: 3 });
  });

  it("ne fusionne pas deux dossiers homonymes", async () => {
    // `Dr Who` et `Dr Who (2023)` lisent le même titre de série mais désignent deux œuvres. Une clé
    // fondée sur le titre les aurait réunies à tort ; le dossier les sépare.
    const { libraryId } = await bibliothèqueSéries([
      "Dr Who/Saison 1/S01E01.mkv", "Dr Who (2023)/Saison 1/S01E01.mkv",
    ]);
    await scanLibraryById(libraryId, { mode: "files" });

    const séries = fiches(libraryId, "show");
    expect(séries).toHaveLength(2);
    expect(new Set(séries.map((série) => série.source_folder))).toHaveProperty("size", 2);
  });

  it("recolle un dossier déjà éclaté sur deux fiches concurrentes", async () => {
    // Reproduction du défaut mesuré : pendant l'analyse, un fournisseur cède la main à un autre et
    // les épisodes suivants reçoivent un autre titre de série, donc une autre fiche.
    const { libraryId } = await bibliothèqueSéries([
      "Dr House/Saison 1/S01E01.mkv", "Dr House/Saison 1/S01E02.mkv",
    ]);
    await scanLibraryById(libraryId, { mode: "files" });
    const origine = fiches(libraryId, "show")[0]!;

    // On fabrique la seconde fiche à la main, comme l'aurait fait un second fournisseur, et on lui
    // rattache le deuxième épisode.
    const concurrente = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, match_status)
      VALUES (?, ?, 'show', 'House', 'house', 'automatic')`).run(concurrente, libraryId);
    const saison = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number)
      VALUES (?, ?, ?, 'season', 'Saison 1', '0001', 1)`).run(saison, libraryId, concurrente);
    const épisode = db.prepare(`SELECT c.id FROM catalog_items c JOIN media_items m ON m.catalog_id = c.id
      WHERE c.library_id = ? AND c.kind = 'episode' AND m.file_path LIKE '%S01E02%'`).get(libraryId) as { id: string };
    db.prepare("UPDATE catalog_items SET parent_id = ? WHERE id = ?").run(saison, épisode.id);

    expect(fiches(libraryId, "show")).toHaveLength(2);
    await scanLibraryById(libraryId, { mode: "metadata" });

    const après = fiches(libraryId, "show");
    expect(après).toHaveLength(1);
    expect(après[0]!.id).toBe(origine.id);
  });
});

describe("déverrouiller n'efface pas l'identité", () => {
  it("retire le verrou en conservant le fournisseur et son identifiant", async () => {
    const { libraryId } = await bibliothèqueSéries(["Ma Serie/Saison 1/S01E01.mkv"]);
    await scanLibraryById(libraryId, { mode: "files" });
    const série = fiches(libraryId, "show")[0]!;
    applyCorrection({ type: "rematch", catalogId: série.id, provider: "tmdb", externalId: "57243" });

    applyCorrection({ type: "unlock", catalogId: série.id });

    const après = db.prepare(`SELECT external_provider, external_id, metadata_locked, match_status
      FROM catalog_items WHERE id = ?`).get(série.id) as {
        external_provider: string | null; external_id: string | null; metadata_locked: number; match_status: string;
      };
    // Le verrou tombe — c'est le but — mais la fiche sait toujours qui elle est, donc l'analyse
    // suivante la retrouve au lieu d'en fabriquer une autre à partir du nom de fichier.
    expect(après).toMatchObject({ external_provider: "tmdb", external_id: "57243", metadata_locked: 0 });
    expect(après.match_status).not.toBe("unmatched");
  });
});

describe("fiches sans fichier", () => {
  it("retire une fiche qui ne désigne plus aucun média, et garde celles qui comptent", async () => {
    const { libraryId } = await bibliothèqueSéries(["Ma Serie/Saison 1/S01E01.mkv"]);
    await scanLibraryById(libraryId, { mode: "files" });
    const vivante = fiches(libraryId, "show")[0]!;

    const fantôme = randomUUID();
    db.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title) VALUES (?, ?, 'movie', 'Fantôme', 'fantôme')")
      .run(fantôme, libraryId);
    const verrouillée = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, metadata_locked)
      VALUES (?, ?, 'movie', 'Choisie à la main', 'choisie à la main', 1)`).run(verrouillée, libraryId);

    const retirées = removeGhostCatalogEntries(libraryId);

    expect(retirées).toBe(1);
    expect(db.prepare("SELECT id FROM catalog_items WHERE id = ?").get(fantôme)).toBeUndefined();
    // Une décision prise à la main n'est pas une trace, même sans fichier.
    expect(db.prepare("SELECT id FROM catalog_items WHERE id = ?").get(verrouillée)).toBeTruthy();
    expect(db.prepare("SELECT id FROM catalog_items WHERE id = ?").get(vivante.id)).toBeTruthy();
  });

  it("ne supprime rien lorsque la moitié du catalogue paraît vide", async () => {
    // Une telle proportion ne décrit pas des traces mais un incident : effacer serait le pire choix.
    const { libraryId } = await bibliothèqueSéries(["Ma Serie/Saison 1/S01E01.mkv"]);
    await scanLibraryById(libraryId, { mode: "files" });
    const avant = (db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE library_id = ?").get(libraryId) as { n: number }).n;
    for (let index = 0; index < avant + 2; index += 1) {
      db.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title) VALUES (?, ?, 'movie', ?, ?)")
        .run(randomUUID(), libraryId, `Vide ${index}`, `vide ${index}`);
    }

    expect(removeGhostCatalogEntries(libraryId)).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM catalog_items WHERE library_id = ?").get(libraryId))
      .toMatchObject({ n: avant * 2 + 2 });
  });
});
