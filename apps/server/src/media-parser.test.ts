import { describe, expect, it } from "vitest";
import { parseMediaPath } from "./media-parser.js";

describe("parseMediaPath", () => {
  it("reconnaît un film et son année", () => {
    expect(parseMediaPath("D:/Movies/Arrival.2016.1080p.mkv")).toMatchObject({
      kind: "movie",
      title: "Arrival",
      year: 2016,
    });
  });

  it("détecte le titre et l'année entre parenthèses", () => {
    expect(parseMediaPath("D:/Films/Le Comte de Monte-Cristo (2024).mkv", "movie")).toMatchObject({
      kind: "movie",
      title: "Le Comte de Monte-Cristo",
      year: 2024,
    });
  });

  it("respecte le type Films même si le titre ressemble à un épisode", () => {
    expect(parseMediaPath("D:/Films/Projet S01E02 (2022).mkv", "movie").kind).toBe("movie");
  });

  it("classe un épisode selon son dossier Saison", () => {
    expect(parseMediaPath("D:/TV/Engrenages/Saison 3/04 - Episode.mkv", "tv")).toMatchObject({
      kind: "episode", showTitle: "Engrenages", seasonNumber: 3, episodeNumber: 4,
    });
  });

  it("reconnaît une série au format SxxExx", () => {
    expect(parseMediaPath("D:/TV/Severance/Season 01/Severance.S01E02.1080p.mkv")).toMatchObject({
      kind: "episode",
      showTitle: "Severance",
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });

  it("reconnaît le format 1x02", () => {
    expect(parseMediaPath("D:/TV/Dark/Dark.2x03.mkv")).toMatchObject({
      kind: "episode",
      showTitle: "Dark",
      seasonNumber: 2,
      episodeNumber: 3,
    });
  });

  it("reconnaît les épisodes doubles et les spéciaux", () => {
    expect(parseMediaPath("D:/TV/Arcane/Season 01/Arcane.S01E02-E04.mkv", "tv")).toMatchObject({
      seasonNumber: 1, episodeNumber: 2, episodeNumbers: [2, 3, 4],
    });
    expect(parseMediaPath("D:/TV/Doctor Who/Specials/Doctor.Who.S00E03.mkv", "tv")).toMatchObject({
      seasonNumber: 0, episodeNumber: 3,
    });
  });

  it("détecte les identifiants, éditions et types de films", () => {
    expect(parseMediaPath("D:/Documentaires/Apollo 11 (2019) {tmdb-549559} IMAX.mkv", "movie")).toMatchObject({
      title: "Apollo 11", year: 2019, contentType: "documentary", edition: "IMAX", externalIds: { tmdb: "549559" },
    });
    expect(parseMediaPath("D:/Concerts/Daft Punk Alive 2007 [imdb-tt1234567].mkv", "movie")).toMatchObject({
      contentType: "concert", externalIds: { imdb: "tt1234567" },
    });
  });

  it("reconnaît un épisode daté et une numérotation absolue", () => {
    expect(parseMediaPath("D:/TV/Daily Show/Daily.Show.2025.03.14.Guest.mkv", "tv")).toMatchObject({
      airDate: "2025-03-14", seasonNumber: 2025, episodeNumber: 314,
    });
    expect(parseMediaPath("D:/TV/Anime/001 - Départ.mkv", "tv")).toMatchObject({ episodeNumber: 1, title: "Départ" });
  });

  it("retire les groupes techniques Anime et expose une détection explicable", () => {
    const anime = parseMediaPath("D:/TV/Frieren/Season 01/12 - Le véritable héros [1080p HEVC MULTI].mkv", "tv");
    expect(anime).toMatchObject({
      kind: "episode", showTitle: "Frieren", episodeNumber: 12, title: "Le véritable héros",
      detection: { pattern: "absolute", rule: "numerotation-absolue" },
    });
    expect(anime.detection?.evidence?.length).toBeGreaterThan(0);
    // Un nom sans aucun indice ne doit jamais être appliqué seul.
    const bare = parseMediaPath("D:/Films/Film sans annee.mkv", "movie");
    expect(bare.detection).toMatchObject({ pattern: "movie-name", rule: "film-nom", decision: "rejet" });
    expect(bare.detection?.warnings.length).toBeGreaterThan(0);
  });

  it("reconnaît les épisodes empilés sans confondre leurs codecs", () => {
    expect(parseMediaPath("D:/TV/The Bear/Season 02/The.Bear.S02E01E02.2160p.DV.mkv", "tv")).toMatchObject({
      showTitle: "The Bear", seasonNumber: 2, episodeNumber: 1, episodeNumbers: [1, 2],
      detection: { confidence: 0.98, pattern: "sxe" },
    });
  });

  it("normalise l'année du dossier de série pour fiabiliser la correspondance", () => {
    expect(parseMediaPath("D:/TV/Andor (2022)/Saison 1/01 - Kassa.mkv", "tv")).toMatchObject({
      showTitle: "Andor", year: 2022, seasonNumber: 1, episodeNumber: 1,
    });
    expect(parseMediaPath("D:/TV/1923 (2022)/1923 (2022).S01E01.mkv", "tv")).toMatchObject({
      showTitle: "1923", year: 2022, seasonNumber: 1, episodeNumber: 1,
    });
  });
});
