import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildHome, getDetails } from "./catalog-view.js";
import { db, getDefaultProfile, inferKindFromPath, listLibraries } from "./database.js";
import { getPlaybackInfo } from "./playback.js";
import { scanLibraryById } from "./scanner.js";

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

describe("audit des étapes de bibliothèque", () => {
  it("déduit le type d'un dossier sans chemin préconfiguré", () => {
    expect(inferKindFromPath("D:\\Médias\\Films")).toBe("movie");
    expect(inferKindFromPath("D:\\Médias\\Série TV")).toBe("tv");
    expect(inferKindFromPath("D:\\Médias\\Vidéos personnelles")).toBe("other");
  });

  it("analyse films et séries, conserve les fichiers et construit saisons/épisodes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-step-audit-")); roots.push(root);
    const movieRoot = path.join(root, "Films");
    const showRoot = path.join(root, "Série TV");
    const seasonOne = path.join(showRoot, "Les Veilleurs", "Saison 1");
    const seasonTwo = path.join(showRoot, "Les Veilleurs", "Saison 2");
    await Promise.all([import("node:fs/promises").then(({ mkdir }) => mkdir(movieRoot, { recursive: true })),
      import("node:fs/promises").then(({ mkdir }) => mkdir(seasonOne, { recursive: true })),
      import("node:fs/promises").then(({ mkdir }) => mkdir(seasonTwo, { recursive: true }))]);
    const movie = path.join(movieRoot, "Voyage Azur (2026).mkv");
    const episodeOne = path.join(seasonOne, "Les Veilleurs S01E01 - Le Signal.mkv");
    const episodeTwo = path.join(seasonTwo, "Les Veilleurs S02E01 - La Relève.mkv");
    await Promise.all([
      writeFile(movie, "fixture"), writeFile(episodeOne, "fixture"), writeFile(episodeTwo, "fixture"),
      writeFile(path.join(movieRoot, "Voyage Azur (2026).nfo"), "<movie><title>Voyage Azur</title><year>2026</year><plot>Documentaire local.</plot></movie>"),
      writeFile(path.join(showRoot, "Les Veilleurs", "poster.jpg"), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
    ]);
    const movieLibrary = randomUUID(); const tvLibrary = randomUUID();
    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Films audit', ?, 'auto', 'fr-FR')").run(movieLibrary, movieRoot);
    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Séries audit', ?, 'auto', 'fr-FR')").run(tvLibrary, showRoot);
    try {
      expect(listLibraries().find((item) => item.id === movieLibrary)?.resolvedKind).toBe("movie");
      expect(listLibraries().find((item) => item.id === tvLibrary)?.resolvedKind).toBe("tv");
      const movieScan = await scanLibraryById(movieLibrary);
      const tvScan = await scanLibraryById(tvLibrary);
      expect(movieScan.errors).toEqual([]);
      expect(tvScan.errors).toEqual([]);
      expect(movieScan).toMatchObject({ discovered: 1, imported: 1, removed: 0 });
      expect(tvScan).toMatchObject({ discovered: 2, imported: 2, removed: 0 });
      await Promise.all([access(movie), access(episodeOne), access(episodeTwo)]);
      const show = db.prepare("SELECT id, poster_url FROM catalog_items WHERE library_id = ? AND kind = 'show'").get(tvLibrary) as { id: string; poster_url: string | null };
      expect(show.poster_url).toMatch(/^\/api\/artwork\//);
      const details = getDetails(getDefaultProfile().id, show.id);
      expect(details?.seasons.map((season) => [season.number, season.episodes.length])).toEqual([[1, 1], [2, 1]]);
      expect(details?.seasons.every((season) => season.episodes[0]?.posterUrl === show.poster_url)).toBe(true);
      expect(details?.source).toEqual({ kind: "folder", name: "Les Veilleurs" });
      const movieCatalog = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'movie'")
        .get(movieLibrary) as { id: string };
      expect(getDetails(getDefaultProfile().id, movieCatalog.id)?.source)
        .toEqual({ kind: "file", name: "Voyage Azur (2026).mkv" });
      const home = buildHome(getDefaultProfile());
      expect(home.movies.some((item) => item.title === "Voyage Azur" && item.year === 2026)).toBe(true);
      expect(home.shows.some((item) => item.title === "Les Veilleurs" && item.seasonCount === 2)).toBe(true);
      await rm(movie);
      expect(await scanLibraryById(movieLibrary)).toMatchObject({ discovered: 0, removed: 1 });
      const available = db.prepare("SELECT available FROM media_items WHERE library_id = ?").get(movieLibrary) as { available: number };
      expect(available.available).toBe(0);
    } finally {
      db.prepare("DELETE FROM library_folders WHERE id IN (?, ?)").run(movieLibrary, tvLibrary);
    }
  });

  it("inventorie les sous-titres externes texte et image", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-subtitle-audit-")); roots.push(root);
    const mediaPath = path.join(root, "Film (2026).mkv");
    await Promise.all([
      writeFile(mediaPath, "fixture"),
      writeFile(path.join(root, "Film (2026).fr.forced.srt"), "1\n00:00:00,000 --> 00:00:01,000\nBonjour\n"),
      writeFile(path.join(root, "Film (2026).eng.sdh.ass"), "[Script Info]\nTitle: Audit\n"),
      writeFile(path.join(root, "Film (2026).fra.sup"), "fixture"),
    ]);
    const libraryId = randomUUID(); const mediaId = randomUUID();
    db.prepare("INSERT INTO library_folders (id, name, path, kind) VALUES (?, 'Sous-titres audit', ?, 'movie')").run(libraryId, root);
    db.prepare("INSERT INTO media_items (id, kind, title, sort_title, file_path, library_id, available) VALUES (?, 'movie', 'Film', 'film', ?, ?, 1)")
      .run(mediaId, mediaPath, libraryId);
    try {
      const info = await getPlaybackInfo(mediaId);
      expect(info?.externalSubtitles).toEqual(expect.arrayContaining([
        expect.objectContaining({ format: "srt", language: "fr", forced: true, canConvertToWebVtt: true }),
        expect.objectContaining({ format: "ass", kind: "text", language: "en", hearingImpaired: true, canConvertToWebVtt: true }),
        expect.objectContaining({ format: "pgs", kind: "image", language: "fr", canConvertToWebVtt: false }),
      ]));
    } finally {
      db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
    }
  });
});
