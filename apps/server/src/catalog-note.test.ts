import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listCatalog } from "./catalog-view.js";
import { db } from "./database.js";

/**
 * La note sur cinq (r14) : montrée seulement à partir de dix votes, et tri « Note » qui place les
 * mieux notés d'abord et ceux sans note à la fin. Les fiches d'essai portent un préfixe unique : la
 * base de test peut contenir d'autres fiches, on ne regarde que les nôtres.
 */

const libraryId = randomUUID();
const profileId = randomUUID();
const prefixe = `Note ${libraryId.slice(0, 6)}`;
const prefixeDate = `Date ${libraryId.slice(0, 6)}`;
db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Notes', ?, 'auto', 'fr-FR')")
  .run(libraryId, `D:/notes-${libraryId}`);
db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, 'Notes', '#2968ff', 'fr-FR')").run(profileId);

function film(nom: string, note: number | null, votes: number | null) {
  const catalogId = randomUUID(); const mediaId = randomUUID(); const titre = `${prefixe} ${nom}`;
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year, note_sur_5, note_votes, note_source)
    VALUES (?, ?, 'movie', ?, ?, 2001, ?, ?, ?)`).run(catalogId, libraryId, titre, titre.toLowerCase(), note, votes, note == null ? null : "tmdb");
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, file_path, library_id, runtime_seconds, year, available)
    VALUES (?, ?, 'movie', ?, ?, ?, ?, 5400, 2001, 1)`).run(mediaId, catalogId, titre, titre.toLowerCase(), `D:/notes/${mediaId}.mkv`, libraryId);
}
function serie(nom: string, note: number | null, votes: number | null) {
  const showId = randomUUID(); const seasonId = randomUUID(); const episodeId = randomUUID(); const titre = `${prefixe} ${nom}`;
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year, note_sur_5, note_votes, note_source)
    VALUES (?, ?, 'show', ?, ?, 2001, ?, ?, ?)`).run(showId, libraryId, titre, titre.toLowerCase(), note, votes, note == null ? null : "tmdb");
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number)
    VALUES (?, ?, ?, 'season', 'Saison 1', '001', 1)`).run(seasonId, libraryId, showId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number, episode_number)
    VALUES (?, ?, ?, 'episode', 'Episode 1', '0001', 1, 1)`).run(episodeId, libraryId, seasonId);
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, show_title, season_number, episode_number, file_path, library_id, runtime_seconds, available)
    VALUES (?, ?, 'episode', 'Episode 1', '0001', ?, 1, 1, ?, ?, 2700, 1)`).run(randomUUID(), episodeId, titre, `D:/notes/${episodeId}.mkv`, libraryId);
}

film("A moyen", 3.1, 400); film("B excellent", 4.6, 2000); film("C sans note", null, null); film("D un seul vote", 5, 1);
serie("A bonne", 4.2, 900); serie("B confidentielle", 4.9, 3); serie("C passable", 2.8, 60);

const nos = <T extends { title: string }>(items: T[]) => items.filter((item) => item.title.startsWith(prefixe));

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

describe("les tris par date, au jour près (r14)", () => {
  const dateFilm = (nom: string, sortie: string | null, annee: number | null, fichier: string) => {
    const catalogId = randomUUID(); const mediaId = randomUUID(); const titre = `${prefixeDate} ${nom}`;
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year, date_sortie, created_at)
      VALUES (?, ?, 'movie', ?, ?, ?, ?, '2026-08-13 10:00:00')`).run(catalogId, libraryId, titre, titre.toLowerCase(), annee, sortie);
    db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, file_path, library_id, runtime_seconds, year, available,
      file_modified_at, created_at) VALUES (?, ?, 'movie', ?, ?, ?, ?, 5400, ?, 1, ?, '2026-08-13 10:00:00')`)
      .run(mediaId, catalogId, titre, titre.toLowerCase(), `D:/notes/${mediaId}.mkv`, libraryId, annee, Date.parse(fichier));
  };
  dateFilm("mars", "2010-03-01", 2010, "2026-02-01T08:00:00Z");
  dateFilm("novembre", "2010-11-20", 2010, "2025-11-03T21:00:00Z");
  dateFilm("annee seule", null, 2010, "2026-05-10T12:00:00Z");
  dateFilm("2011", "2011-01-05", 2011, "2026-05-10T11:00:00Z");
  const ordre = (sort: "release" | "added") => listCatalog(profileId, { kind: "movies", sort, limit: 500 }).items
    .filter((f) => f.title.startsWith(prefixeDate)).map((f) => f.title.slice(prefixeDate.length + 1));

  it("trie la sortie au jour près, une année sans date venant après les dates connues de la même année", () => {
    expect(ordre("release")).toEqual(["2011", "novembre", "mars", "annee seule"]);
  });
  it("trie l'ajout sur la date du fichier, à l'heure près, et non sur le jour de l'analyse", () => {
    expect(ordre("added")).toEqual(["annee seule", "2011", "mars", "novembre"]);
  });
});

describe("la note sur cinq dans le catalogue (r14)", () => {
  it("trie les films par note, sans note ou trop peu votés à la fin, et ne montre que les notes assez votées", () => {
    const films = nos(listCatalog(profileId, { kind: "movies", sort: "note", limit: 500 }).items);
    expect(films.map((f) => f.title.slice(prefixe.length + 1))).toEqual(["B excellent", "A moyen", "C sans note", "D un seul vote"]);
    expect(films[0]!.note).toEqual({ surCinq: 4.6, votes: 2000, source: "tmdb" });
    expect(films.find((f) => f.title.endsWith("D un seul vote"))!.note).toBeNull();
  });
  it("fait de même pour les séries", () => {
    const series = nos(listCatalog(profileId, { kind: "shows", sort: "note", limit: 500 }).items);
    expect(series.map((s) => s.title.slice(prefixe.length + 1))).toEqual(["A bonne", "C passable", "B confidentielle"]);
    expect(series[0]!.note?.surCinq).toBe(4.2);
    expect(series[2]!.note).toBeNull();
  });
});
