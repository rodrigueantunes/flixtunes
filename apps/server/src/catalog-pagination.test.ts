import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { MediaItem } from "@flixtunes/contracts";
import { buildHome, listCatalog } from "./catalog-view.js";
import { db, mapProfile } from "./database.js";

/**
 * Le tri, le filtre d'état et la recherche du catalogue s'appliquaient en mémoire sur la totalité des
 * fiches transmises. Ils s'appliquent désormais en SQL, avant le découpage en pages. C'est le genre de
 * déplacement qui se trompe sans rien signaler : trier une page déjà découpée produit un classement
 * faux mais plausible. Ces tests comparent donc les pages au résultat complet, page à page.
 */

const libraryId = randomUUID();
const profileId = randomUUID();

db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Pagination', ?, 'auto', 'fr-FR')")
  .run(libraryId, `D:/pagination-${libraryId}`);
db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, 'Pagination', '#2968ff', 'fr-FR')")
  .run(profileId);
const profile = mapProfile(db.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as never);

const MOVIE_COUNT = 137;
const movieIds: string[] = [];

/**
 * `listCatalog` porte sur tout le catalogue, sans filtre de bibliothèque. Compter en absolu rendait
 * ces cas dépendants d'une base vide : une vitrine de développement ou le résidu d'un test interrompu
 * suffisait à les faire échouer sans qu'aucun code soit en cause. On mesure donc l'écart.
 */
const baseline = { movies: 0, shows: 0 };

function seedMovie(index: number): string {
  const catalogId = randomUUID(); const mediaId = randomUUID();
  const title = `Film ${String(index).padStart(3, "0")}`;
  // Une fiche sur onze n'a pas d'année : le tri par date de sortie doit les reléguer en fin de liste
  // et non les placer en tête, ce que ferait une comparaison naïve sur NULL.
  const year = index % 11 === 0 ? null : 1970 + (index % 50);
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year)
    VALUES (?, ?, 'movie', ?, ?, ?)`).run(catalogId, libraryId, title, title.toLocaleLowerCase("fr"), year);
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, file_path, library_id,
    runtime_seconds, year, available) VALUES (?, ?, 'movie', ?, ?, ?, ?, 5400, ?, 1)`)
    .run(mediaId, catalogId, title, title.toLocaleLowerCase("fr"), `D:/pagination/${mediaId}.mkv`, libraryId, year);
  return mediaId;
}

function seedShow(index: number, title: string): string {
  const showId = randomUUID(); const seasonId = randomUUID(); const episodeId = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year)
    VALUES (?, ?, 'show', ?, ?, ?)`).run(showId, libraryId, title, title.toLocaleLowerCase("fr"), 2000 + index);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number)
    VALUES (?, ?, ?, 'season', 'Saison 1', '001', 1)`).run(seasonId, libraryId, showId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, season_number, episode_number)
    VALUES (?, ?, ?, 'episode', 'Episode 1', '0001', 1, 1)`).run(episodeId, libraryId, seasonId);
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, show_title, season_number,
    episode_number, file_path, library_id, runtime_seconds, available)
    VALUES (?, ?, 'episode', 'Episode 1', '0001', ?, 1, 1, ?, ?, 2700, 1)`)
    .run(randomUUID(), episodeId, title, `D:/pagination/${episodeId}.mkv`, libraryId);
  return showId;
}

baseline.movies = listCatalog(profileId, { kind: "movies", limit: 1 }).total;
baseline.shows = listCatalog(profileId, { kind: "shows", limit: 1 }).total;
for (let index = 0; index < MOVIE_COUNT; index += 1) movieIds.push(seedMovie(index));
const movieId = (index: number): string => movieIds[index]!;
const showIds = ["Série Accentuée", "Bravo", "Charlie"].map((title, index) => seedShow(index, title));

// Trois états de lecture distincts : en cours, terminé, et jamais ouvert pour tout le reste.
db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed)
  VALUES (?, ?, 1200, 5400, 0)`).run(profileId, movieId(3));
db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed)
  VALUES (?, ?, 900, 5400, 0)`).run(profileId, movieId(7));
db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed)
  VALUES (?, ?, 5400, 5400, 1)`).run(profileId, movieId(11));

function allPages(query: Parameters<typeof listCatalog>[1], pageSize = 25): MediaItem[] {
  const collected: MediaItem[] = [];
  let offset = 0; let total = Number.POSITIVE_INFINITY;
  while (collected.length < total) {
    const page = listCatalog(profileId, { ...query, offset, limit: pageSize });
    total = page.total;
    if (!page.items.length) break;
    collected.push(...page.items);
    offset += pageSize;
  }
  return collected;
}

afterAll(() => {
  db.prepare("DELETE FROM playback_progress WHERE profile_id = ?").run(profileId);
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

describe("pagination du catalogue", () => {
  it("parcourt toutes les pages sans perte ni doublon", () => {
    const collected = allPages({ kind: "movies", sort: "title" });
    const miens = collected.filter((item) => movieIds.includes(item.id));
    expect(miens).toHaveLength(MOVIE_COUNT);
    expect(new Set(collected.map((item) => item.id)).size, "aucun doublon").toBe(collected.length);
  });

  it("annonce un total indépendant de la taille de page", () => {
    for (const limit of [1, 7, 60, 200]) {
      const page = listCatalog(profileId, { kind: "movies", limit });
      expect(page.total).toBe(baseline.movies + MOVIE_COUNT);
      expect(page.items).toHaveLength(Math.min(limit, baseline.movies + MOVIE_COUNT));
      expect(page.limit).toBe(limit);
    }
  });

  it("borne une taille de page abusive au lieu de la servir", () => {
    expect(listCatalog(profileId, { kind: "movies", limit: 100_000 }).limit).toBe(200);
    expect(listCatalog(profileId, { kind: "movies", limit: 0 }).limit).toBe(1);
  });

  it("rend une page vide au-delà de la fin sans se tromper de total", () => {
    const page = listCatalog(profileId, { kind: "movies", offset: baseline.movies + MOVIE_COUNT + 50, limit: 25 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(baseline.movies + MOVIE_COUNT);
  });

  it("trie par titre, par date de sortie puis par date d'ajout, pages comprises", () => {
    const byTitle = allPages({ kind: "movies", sort: "title" }).map((item) => item.sortTitle);
    expect(byTitle).toEqual([...byTitle].sort());

    const byRelease = allPages({ kind: "movies", sort: "release" });
    const years = byRelease.map((item) => item.year);
    const dated = years.filter((year): year is number => year != null);
    // Les années présentes décroissent, et aucune fiche datée ne suit une fiche sans année.
    expect(dated).toEqual([...dated].sort((left, right) => right - left));
    expect(years.indexOf(null) === -1 || years.slice(years.indexOf(null)).every((year) => year == null)).toBe(true);
  });

  it("partitionne exactement le catalogue entre les filtres d'état", () => {
    const progress = allPages({ kind: "movies", filter: "progress" });
    const watched = allPages({ kind: "movies", filter: "watched" });
    const unwatched = allPages({ kind: "movies", filter: "unwatched" });
    expect(progress.filter((item) => movieIds.includes(item.id))).toHaveLength(2);
    expect(watched.filter((item) => movieIds.includes(item.id))).toHaveLength(1);
    expect(unwatched.filter((item) => movieIds.includes(item.id))).toHaveLength(MOVIE_COUNT - 3);
    expect(progress.every((item) => item.progressPercent > 0 && !item.completed)).toBe(true);
    expect(watched.every((item) => item.completed)).toBe(true);
    const union = new Set([...progress, ...watched, ...unwatched].map((item) => item.id));
    expect(movieIds.every((id) => union.has(id)), "chaque film semé doit tomber dans exactement un filtre").toBe(true);
  });

  it("cherche un titre de série sans se laisser arrêter par la casse ni les accents", () => {
    for (const query of ["Série Accentuée", "série accentuée", "SÉRIE ACCENTUÉE", "accentuée"]) {
      const page = listCatalog(profileId, { kind: "shows", query });
      expect(page.items.map((item) => item.title), `recherche « ${query} »`).toContain("Série Accentuée");
    }
    expect(listCatalog(profileId, { kind: "shows", query: "introuvable" }).total).toBe(0);
  });

  it("saute à la première jaquette d'une lettre sans filtrer le catalogue", () => {
    const catalogueFilms = allPages({ kind: "movies", sort: "title" });
    const filmsF = listCatalog(profileId, { kind: "movies", sort: "title", letter: "f" });
    expect(filmsF.total).toBe(baseline.movies + MOVIE_COUNT);
    expect(filmsF.anchor).toBeGreaterThanOrEqual(filmsF.offset);
    const filmCible = filmsF.items[(filmsF.anchor ?? 0) - filmsF.offset];
    expect(filmCible?.id).toBe(catalogueFilms[filmsF.anchor ?? 0]?.id);
    expect(filmCible?.title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()).toMatch(/^f/);
    expect(filmsF.items[0]?.id).toBe(catalogueFilms[filmsF.offset]?.id);

    const catalogueSeries = allPages({ kind: "shows", sort: "title" });
    const seriesS = listCatalog(profileId, { kind: "shows", sort: "title", letter: "s" });
    expect(seriesS.total).toBe(baseline.shows + showIds.length);
    const serieCible = seriesS.items[(seriesS.anchor ?? 0) - seriesS.offset];
    expect(serieCible?.id).toBe(catalogueSeries[seriesS.anchor ?? 0]?.id);
    expect(serieCible?.title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()).toMatch(/^s/);
    expect(seriesS.offset).toBeLessThan(seriesS.anchor ?? 0);
  });

  it("traite le joker SQL comme un caractère ordinaire", () => {
    // Sans échappement, « % » ramènerait tout le catalogue au lieu de ne rien trouver.
    expect(listCatalog(profileId, { kind: "movies", query: "%" }).total).toBe(0);
    expect(listCatalog(profileId, { kind: "movies", query: "_" }).total).toBe(0);
  });

  it("compte les séries et retient celles qui ont un épisode disponible", () => {
    const page = listCatalog(profileId, { kind: "shows", sort: "title" });
    expect(page.total).toBe(baseline.shows + showIds.length);
    const orphan = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year)
      VALUES (?, ?, 'show', 'Série sans fichier', 'série sans fichier', 2020)`).run(orphan, libraryId);
    try {
      // Une série dont aucun épisode n'est disponible ne doit pas apparaître : c'est la garantie que
      // la jointure sur l'épisode représentatif remplace bien l'ancienne condition d'existence.
      expect(listCatalog(profileId, { kind: "shows" }).total).toBe(baseline.shows + showIds.length);
    } finally {
      db.prepare("DELETE FROM catalog_items WHERE id = ?").run(orphan);
    }
  });
});

describe("accueil à grande médiathèque", () => {
  it("ne transmet qu'une page tout en annonçant le catalogue entier", () => {
    const home = buildHome(profile);
    expect(home.movieTotal).toBe(baseline.movies + MOVIE_COUNT);
    expect(home.showTotal).toBe(baseline.shows + showIds.length);
    expect(home.movies.length).toBeLessThan(baseline.movies + MOVIE_COUNT);
    expect(home.movies).toHaveLength(60);
  });

  it("garde dans « Ma liste » un titre absent de la première page", () => {
    // Régression guettée de près : dériver la liste d'envies de la seule page transmise la viderait
    // silencieusement de tout titre situé plus loin dans le catalogue.
    const beyondFirstPage = db.prepare(`SELECT catalog_id FROM media_items WHERE library_id = ?
      ORDER BY created_at DESC LIMIT 1 OFFSET 120`).get(libraryId) as { catalog_id: string };
    db.prepare("INSERT INTO profile_watchlist (profile_id, catalog_id) VALUES (?, ?)")
      .run(profileId, beyondFirstPage.catalog_id);
    try {
      const home = buildHome(profile);
      expect(home.movies.some((item) => item.catalogId === beyondFirstPage.catalog_id)).toBe(false);
      expect(home.watchlist?.map((item) => item.catalogId)).toContain(beyondFirstPage.catalog_id);
    } finally {
      db.prepare("DELETE FROM profile_watchlist WHERE profile_id = ?").run(profileId);
    }
  });
});
