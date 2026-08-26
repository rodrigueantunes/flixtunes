import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyMatchHints, parseMatchHints, readMatchHints } from "./match-hints.js";
import { parseMediaPath } from "./media-parser.js";

describe("indications de correspondance compatibles Plex", () => {
  it("lit titre, année et identifiants externes", () => {
    expect(parseMatchHints(`
      # Identité de la série
      Title: Le Bureau des légendes
      Year: 2015
      tmdbid: 62476
      tvdbid: 294071
    `)).toMatchObject({ title: "Le Bureau des légendes", year: 2015,
      externalIds: { tmdb: "62476", tvdb: "294071" } });
  });

  it("applique une numérotation d'épisode liée au nom exact du fichier", () => {
    const hints = parseMatchHints("Episode: S03E12-S03E13: Finale double.mkv", "Finale double.mkv");
    expect(hints).toMatchObject({ seasonNumber: 3, episodeNumbers: [12, 13] });
    expect(parseMatchHints("Episode: S03E12: Autre.mkv", "Finale double.mkv").episodeNumbers).toBeUndefined();
  });

  it("hérite de la série mais laisse la saison préciser son numéro", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-hints-"));
    const show = path.join(root, "Nom opaque"); const season = path.join(show, "Dossier B");
    const media = path.join(season, "episode-final.mkv");
    await mkdir(season, { recursive: true });
    try {
      await Promise.all([
        writeFile(path.join(show, ".plexmatch"), "Title: Severance\nYear: 2022\ntmdbid: 95396\n"),
        writeFile(path.join(season, ".flixtunesmatch"), "Season: 2\nEpisode: 3: episode-final.mkv\n"),
      ]);
      const hints = await readMatchHints(media, root);
      const parsed = applyMatchHints(parseMediaPath(media, "tv"), hints);
      expect(parsed).toMatchObject({ showTitle: "Severance", year: 2022, seasonNumber: 2,
        episodeNumber: 3, externalIds: { tmdb: "95396" }, detection: { decision: "auto", confidence: 1 } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
