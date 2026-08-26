import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { db, getDefaultProfile } from "./database.js";
import { getDetails } from "./catalog-view.js";
import { parseMediaPath } from "./media-parser.js";
import { scanLibraryById } from "./scanner.js";

/**
 * Ordre et titres des épisodes — étape 55.
 *
 * Deux défauts constatés sur une médiathèque réelle : une saison qui s'ouvre sur son neuvième épisode,
 * et des titres qui restent le nom de fichier brut, suffixes techniques compris.
 *
 * L'analyseur, lui, est correct : il extrait saison, numéro et titre y compris avec un tiret
 * demi-cadratin. Les fiches fautives ont donc été écrites par une version antérieure, et le chemin
 * « fichier inchangé » du scanner les préserve indéfiniment — une amélioration de l'analyseur
 * n'atteint jamais ce qui est déjà importé. D'où ces deux cas : le classement doit résister à une
 * numérotation manquante, et une ré-analyse des métadonnées doit réparer les titres.
 */

const roots: string[] = [];
const libraries: string[] = [];

afterAll(async () => {
  for (const id of libraries) {
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM media_items WHERE library_id IS NULL").run();
  db.prepare("DELETE FROM catalog_items WHERE library_id IS NULL").run();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("analyse des noms d'épisodes", () => {
  it("extrait numéro et titre malgré un tiret demi-cadratin et des suffixes techniques", () => {
    // Le séparateur des noms constatés n'est pas un trait d'union mais un tiret demi-cadratin.
    const parsed = parseMediaPath(
      "D:/Séries/Daredevil Born Again/Saison 1/Daredevil Born Again – S01E09 – Directement en enfer 2160p.DV.HDR.x265-Amen.mkv",
      "tv",
    );
    expect(parsed.kind).toBe("episode");
    expect(parsed.seasonNumber).toBe(1);
    expect(parsed.episodeNumber).toBe(9);
    expect(parsed.title).toBe("Directement en enfer");
  });

  it("reconnaît un épisode dans une bibliothèque de type indéterminé", () => {
    const parsed = parseMediaPath("D:/Media/Une série/S02E03 - Le creux de sa main.mkv", "other");
    expect(parsed.kind).toBe("episode");
    expect(parsed.episodeNumber).toBe(3);
  });
});

describe("ordre des épisodes d'une saison", () => {
  it("relègue en fin de liste un épisode dont la numérotation manque", async () => {
    // Un seul épisode mal analysé suffisait à ouvrir la saison sur lui : SQLite classe les NULL
    // en premier, et l'ordre affiché commençait donc par le neuvième.
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-ordre-")); roots.push(root);
    const libraryId = randomUUID(); libraries.push(libraryId);
    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Ordre', ?, 'tv', 'fr-FR')")
      .run(libraryId, root);

    const showId = randomUUID(); const seasonId = randomUUID();
    db.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year) VALUES (?, ?, 'show', 'Série ordre', 'série ordre', 2025)")
      .run(showId, libraryId);
    db.prepare("INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number) VALUES (?, ?, ?, 'season', 'Saison 1', '0001', 1)")
      .run(seasonId, libraryId, showId);

    const ajouter = (numero: number | null, titre: string) => {
      const episodeId = randomUUID();
      db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number, episode_number)
        VALUES (?, ?, ?, 'episode', ?, ?, 1, ?)`).run(episodeId, libraryId, seasonId, titre, String(numero ?? 0).padStart(4, "0"), numero);
      db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, show_title, season_number, episode_number,
        file_path, library_id, runtime_seconds, available) VALUES (?, ?, 'episode', ?, ?, 'Série ordre', 1, ?, ?, ?, 2700, 1)`)
        .run(randomUUID(), episodeId, titre, String(numero ?? 0).padStart(4, "0"), numero, path.join(root, `${titre}.mkv`), libraryId);
    };
    ajouter(2, "Deuxième"); ajouter(null, "Sans numéro"); ajouter(1, "Premier"); ajouter(3, "Troisième");

    const details = getDetails(getDefaultProfile().id, showId);
    const ordre = details?.seasons[0]?.episodes.map((episode) => episode.title);
    expect(ordre).toEqual(["Premier", "Deuxième", "Troisième", "Sans numéro"]);
  });
});

describe("réparation des fiches écrites par une version antérieure", () => {
  it("réécrit un titre d'épisode resté au nom de fichier lors d'une ré-analyse des métadonnées", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-reparation-")); roots.push(root);
    const libraryId = randomUUID(); libraries.push(libraryId);
    const saison = path.join(root, "Ma Série", "Saison 1");
    await writeFile(path.join(root, "placeholder"), "");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(saison, { recursive: true });
    const fichier = path.join(saison, "Ma Série – S01E04 – Le vrai titre 2160p.DV.HDR.x265-Groupe.mkv");
    await writeFile(fichier, "fixture");

    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Réparation', ?, 'tv', 'fr-FR')")
      .run(libraryId, root);
    await scanLibraryById(libraryId, { stabilityDelayMs: 1 });

    // On simule l'héritage : une fiche dont le titre est resté le nom de fichier complet.
    const media = db.prepare("SELECT id, catalog_id FROM media_items WHERE library_id = ?").get(libraryId) as
      { id: string; catalog_id: string } | undefined;
    expect(media, "l'épisode doit avoir été importé").toBeDefined();
    const nomBrut = "Ma Série – S01E04 – Le vrai titre 2160p.DV.HDR.x265-Groupe";
    db.prepare("UPDATE media_items SET title = ? WHERE id = ?").run(nomBrut, media!.id);
    db.prepare("UPDATE catalog_items SET title = ? WHERE id = ?").run(nomBrut, media!.catalog_id);

    // Une analyse ordinaire ne corrige rien : le fichier n'a pas bougé, elle passe par le chemin rapide.
    await scanLibraryById(libraryId, { stabilityDelayMs: 1 });
    expect((db.prepare("SELECT title FROM media_items WHERE id = ?").get(media!.id) as { title: string }).title).toBe(nomBrut);

    // La ré-analyse des métadonnées, elle, ré-analyse le nom et réécrit le titre.
    await scanLibraryById(libraryId, { mode: "metadata", stabilityDelayMs: 1 });
    const repare = (db.prepare("SELECT title FROM media_items WHERE id = ?").get(media!.id) as { title: string }).title;
    expect(repare, "le titre doit être réanalysé").not.toBe(nomBrut);
    expect(repare).not.toContain("2160p");
  });
});
