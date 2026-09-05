import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { listCatalog } from "./catalog-view.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * L'étanchéité entre le rayon Web, les Séries et les Films.
 *
 * Une chaîne web est stockée **comme une série** : c'est ce qui lui donne la fiche, la reprise et
 * l'enchaînement sans une ligne de plus. Rien dans la forme des fiches ne la distingue donc d'une
 * vraie série, et la séparation repose entièrement sur le type de la bibliothèque.
 *
 * C'est exactement pourquoi ces cas existent. Si la clause d'appartenance venait à sauter, aucune
 * erreur ne serait levée : des chaînes YouTube apparaîtraient simplement au milieu des séries, et des
 * séries au milieu des chaînes. Une régression silencieuse dans un rayon qu'on regarde tous les jours.
 */
const bibliothequeWeb = randomUUID();
const bibliothequeSeries = randomUUID();
const bibliothequeFilms = randomUUID();
const profileId = randomUUID();
const marque = bibliothequeWeb.slice(0, 8);

const CHAINE = `Chaine ${marque}`;
const SERIE = `Serie ${marque}`;
const FILM = `Film ${marque}`;

/** Une fiche de série — ou de chaîne, la forme est la même — avec un épisode jouable. */
function poserSerie(libraryId: string, titre: string, palier: string): void {
  const showId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const mediaId = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, source_folder)
    VALUES (?, ?, 'show', ?, ?, ?, ?)`)
    .run(showId, libraryId, titre, titre.toLowerCase(), normaliseForSearch(titre), `D:/${libraryId}/${titre}`);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, season_number)
    VALUES (?, ?, ?, 'season', ?, '0001', ?, 1)`)
    .run(seasonId, libraryId, showId, palier, normaliseForSearch(palier));
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, season_number, episode_number)
    VALUES (?, ?, ?, 'episode', ?, '0001', ?, 1, 1)`)
    .run(episodeId, libraryId, seasonId, `${titre} — video`, normaliseForSearch(titre));
  db.prepare(`INSERT INTO media_items
    (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, show_title, season_number, episode_number, available)
    VALUES (?, ?, 'episode', ?, ?, ?, ?, ?, ?, 1, 1, 1)`)
    .run(mediaId, episodeId, `${titre} — video`, titre.toLowerCase(), normaliseForSearch(titre),
      `D:/${libraryId}/${mediaId}.mp4`, libraryId, titre);
}

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeWeb, `D:/${bibliothequeWeb}`);
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'tv', 'fr-FR')")
    .run(bibliothequeSeries, `D:/${bibliothequeSeries}`);
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(bibliothequeFilms, `D:/${bibliothequeFilms}`);
  db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, ?, '#2968ff')")
    .run(profileId, `Rayon ${marque}`);

  poserSerie(bibliothequeWeb, CHAINE, "Documentaires");
  poserSerie(bibliothequeSeries, SERIE, "Saison 1");

  const catalogId = randomUUID();
  const mediaId = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, year)
    VALUES (?, ?, 'movie', ?, ?, ?, 2024)`)
    .run(catalogId, bibliothequeFilms, FILM, FILM.toLowerCase(), normaliseForSearch(FILM));
  db.prepare(`INSERT INTO media_items
    (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, year, available)
    VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, 2024, 1)`)
    .run(mediaId, catalogId, FILM, FILM.toLowerCase(), normaliseForSearch(FILM),
      `D:/${bibliothequeFilms}/${mediaId}.mkv`, bibliothequeFilms);
});

afterAll(() => {
  for (const id of [bibliothequeWeb, bibliothequeSeries, bibliothequeFilms]) {
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

const titres = (kind: "movies" | "shows" | "web") =>
  listCatalog(profileId, { kind, limit: 200 }).items.map((item) => item.showTitle ?? item.title);

describe("étanchéité des rayons", () => {
  it("le rayon Web ne montre que les chaînes", () => {
    const rendus = titres("web");
    expect(rendus).toContain(CHAINE);
    expect(rendus).not.toContain(SERIE);
    expect(rendus).not.toContain(FILM);
  });

  it("une chaîne n'apparaît pas dans Séries TV", () => {
    // La régression que ce cas surveille ne leverait aucune erreur : les chaînes se glisseraient
    // simplement parmi les séries, sous la même forme de fiche.
    const rendus = titres("shows");
    expect(rendus).toContain(SERIE);
    expect(rendus).not.toContain(CHAINE);
  });

  it("une chaîne n'apparaît pas dans Films", () => {
    const rendus = titres("movies");
    expect(rendus).toContain(FILM);
    expect(rendus).not.toContain(CHAINE);
  });

  it("le rayon Web ne propose pas de facette de genres", () => {
    // Les genres viennent de TMDB, qu'aucune bibliothèque web n'interroge. Proposer un filtre
    // toujours vide serait proposer un filtre qui ne filtre rien.
    expect(listCatalog(profileId, { kind: "web", limit: 200 }).availableGenres).toEqual([]);
  });

  it("compte le rayon Web sans y mêler les séries", () => {
    // Le décompte suit la même clause que la liste : un total qui ne correspond pas à ce qu'on voit
    // est pire qu'un total absent, parce qu'il inspire confiance.
    const page = listCatalog(profileId, { kind: "web", limit: 200 });
    expect(page.total).toBe(page.items.length);
    expect(page.items.every((item) => (item.showTitle ?? item.title) !== SERIE)).toBe(true);
  });
});
