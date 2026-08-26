import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseNfo, readSidecarNfo } from "./nfo.js";

describe("parseNfo", () => {
  it("lit les métadonnées et identifiants Kodi/Jellyfin", () => {
    const parsed = parseNfo(`<movie><title>Le Film &amp; Moi</title><year>2024</year><plot>Résumé local</plot>
      <uniqueid type="tmdb">123</uniqueid><uniqueid type="imdb">tt0099999</uniqueid><edition>Director's Cut</edition></movie>`);
    expect(parsed).toMatchObject({ title: "Le Film & Moi", year: 2024, overview: "Résumé local",
      edition: "Director's Cut", externalIds: { tmdb: "123", imdb: "tt0099999" } });
  });

  it("préserve la saison spéciale zéro", () => {
    expect(parseNfo("<episodedetails><showtitle>Série</showtitle><season>0</season><episode>2</episode></episodedetails>"))
      .toMatchObject({ showTitle: "Série", seasonNumber: 0, episodeNumber: 2, episodeNumbers: [2] });
  });

  it("distingue le titre d'une série du titre d'un épisode", () => {
    expect(parseNfo("<tvshow><title>Les Veilleurs</title><premiered>2025-01-10</premiered></tvshow>"))
      .toMatchObject({ showTitle: "Les Veilleurs", year: 2025 });
    expect(parseNfo("<tvshow><title>Les Veilleurs</title></tvshow>").title).toBeUndefined();
  });

  it("fusionne le tvshow racine et le NFO spécifique de l'épisode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-nfo-"));
    const show = path.join(root, "Les Veilleurs"); const season = path.join(show, "Saison 1");
    const media = path.join(season, "Les Veilleurs S01E02.mkv");
    await mkdir(season, { recursive: true });
    try {
      await Promise.all([
        writeFile(path.join(show, "tvshow.nfo"), "<tvshow><title>Les Veilleurs</title><uniqueid type=\"tvdb\">123</uniqueid></tvshow>"),
        writeFile(path.join(season, "Les Veilleurs S01E02.nfo"), "<episodedetails><title>Le Signal</title><season>1</season><episode>2</episode></episodedetails>"),
      ]);
      expect(await readSidecarNfo(media, "episode")).toMatchObject({
        showTitle: "Les Veilleurs", title: "Le Signal", seasonNumber: 1, episodeNumber: 2,
        externalIds: { tvdb: "123" },
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
