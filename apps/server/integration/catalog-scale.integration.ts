import { randomUUID } from "node:crypto";
import { buildHome, listCatalog, searchCatalog } from "../src/catalog-view.js";
import { db, getDefaultProfile } from "../src/database.js";

/**
 * Banc de montée en charge du catalogue — étape 54.
 *
 * Peuple une base synthétique à l'échelle demandée, puis mesure ce que coûte réellement l'accueil et la
 * recherche. Les volumes sont paramétrables afin de comparer une médiathèque réelle aux cibles du plan.
 *
 *   pnpm --filter @flixtunes/server test:scale            # 2000 films, 200 séries de 40 épisodes
 *   pnpm --filter @flixtunes/server test:scale 10000 2000 50
 */

const movieCount = Number(process.argv[2] ?? 2000);
const showCount = Number(process.argv[3] ?? 200);
const episodesPerShow = Number(process.argv[4] ?? 40);

const libraryId = randomUUID();
const profile = getDefaultProfile();

function seed(): number {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Banc échelle', ?, 'auto', 'fr-FR')")
      .run(libraryId, `D:/banc-${libraryId}`);
    const catalog = db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, year,
      season_number, episode_number, match_status, match_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'automatic', 0.95)`);
    const media = db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, show_title, season_number,
      episode_number, file_path, library_id, runtime_seconds, available) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    let rows = 0;
    for (let index = 0; index < movieCount; index += 1) {
      const id = randomUUID(); const title = `Film synthétique ${index}`;
      catalog.run(id, libraryId, null, "movie", title, title.toLowerCase(), 1980 + (index % 45), null, null);
      media.run(randomUUID(), id, "movie", title, title.toLowerCase(), null, null, null,
        `D:/banc/${id}.mkv`, libraryId, 5400);
      rows += 1;
    }
    // La hiérarchie série → saison → épisode reproduit ce que produit le scanner réel : l'accueil
    // n'affiche une série que si elle possède au moins une saison contenant un épisode disponible.
    for (let show = 0; show < showCount; show += 1) {
      const showId = randomUUID(); const showTitle = `Série synthétique ${show}`;
      catalog.run(showId, libraryId, null, "show", showTitle, showTitle.toLowerCase(), 2000 + (show % 26), null, null);
      const seasonCount = Math.max(1, Math.ceil(episodesPerShow / 20));
      const seasons: string[] = [];
      for (let season = 1; season <= seasonCount; season += 1) {
        const seasonId = randomUUID();
        catalog.run(seasonId, libraryId, showId, "season", `Saison ${season}`, String(season).padStart(3, "0"), null, season, null);
        seasons.push(seasonId);
      }
      for (let episode = 1; episode <= episodesPerShow; episode += 1) {
        const seasonIndex = Math.min(seasons.length - 1, Math.floor((episode - 1) / 20));
        const episodeId = randomUUID(); const title = `Épisode ${episode}`;
        catalog.run(episodeId, libraryId, seasons[seasonIndex]!, "episode", title, String(episode).padStart(4, "0"),
          null, seasonIndex + 1, episode);
        media.run(randomUUID(), episodeId, "episode", title, String(episode).padStart(4, "0"), showTitle,
          seasonIndex + 1, episode, `D:/banc/${episodeId}.mkv`, libraryId, 2700);
        rows += 1;
      }
    }
    // Une série sans le moindre épisode disponible : c'est le pire cas de la condition d'existence,
    // celui où elle doit conclure « non » sans parcourir la table des médias. Une version antérieure
    // y balayait toutes les lignes, ce qui coûtait une trentaine de secondes par recherche.
    catalog.run(randomUUID(), libraryId, null, "show", "Série sans fichier", "série sans fichier", 2020, null, null);
    db.exec("COMMIT");
    return rows;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function measure(label: string, work: () => unknown, runs = 20): { label: string; p50: number; p95: number; bytes: number } {
  const durations: number[] = [];
  let bytes = 0;
  // Un tir de chauffe hors mesure : sans lui, le premier appel — compilation des requêtes, pages du
  // fichier encore froides — devient à lui seul le p95 et masque le comportement en régime établi.
  work();
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    const result = work();
    durations.push(performance.now() - start);
    if (run === 0) bytes = Buffer.byteLength(JSON.stringify(result ?? null));
  }
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    label,
    p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]! * 10) / 10,
    p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! * 10) / 10,
    bytes,
  };
}

try {
  const rows = seed();
  console.log(`Base synthétique : ${movieCount} films, ${showCount} séries de ${episodesPerShow} épisodes `
    + `(${rows} médias, ${movieCount + showCount + showCount * episodesPerShow} fiches).`);
  // Contrôle de cohérence avant toute mesure. Ce banc a déjà rapporté deux fois des chiffres faux sans
  // rien signaler : une fois parce qu'il créait des séries sans saisons, une fois parce qu'un autre
  // processus tenait la base et que le catalogue mesuré était vide. Chronométrer une base qui ne
  // contient pas ce qu'on croit ne mesure rien du tout.
  const check = buildHome(profile);
  if (check.movieTotal < movieCount || check.showTotal < showCount) {
    throw new Error(`Base incohérente : ${check.movieTotal} films et ${check.showTotal} séries visibles pour `
      + `${movieCount} et ${showCount} attendus. Aucun autre processus ne doit utiliser la base pendant le banc.`);
  }

  const results = [
    measure("accueil complet", () => buildHome(profile)),
    measure("recherche « synthétique 42 »", () => searchCatalog(profile.id, "synthétique 42")),
    measure("recherche courte « Film »", () => searchCatalog(profile.id, "Film")),
    measure("page de films (tri titre)", () => listCatalog(profile.id, { kind: "movies", sort: "title", limit: 60 })),
    measure("page de films (tri sortie, en cours)", () =>
      listCatalog(profile.id, { kind: "movies", sort: "release", filter: "progress", limit: 60 })),
    measure("page de films no 20 (décalage 1140)", () =>
      listCatalog(profile.id, { kind: "movies", sort: "title", limit: 60, offset: 1140 })),
    measure("page de séries (tri titre)", () => listCatalog(profile.id, { kind: "shows", sort: "title", limit: 60 })),
  ];
  console.log("");
  console.log("| Mesure | p50 | p95 | Charge utile |");
  console.log("| --- | --- | --- | --- |");
  for (const result of results) {
    console.log(`| ${result.label} | ${result.p50} ms | ${result.p95} ms | ${(result.bytes / 1024).toFixed(0)} Kio |`);
  }
  const home = buildHome(profile);
  console.log("");
  console.log(`Accueil : ${home.movies.length}/${home.movieTotal} films et ${home.shows.length}/${home.showTotal} séries transmis.`);
} finally {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  // Filet de sécurité. La clé étrangère est en ON DELETE SET NULL : si la bibliothèque disparaît avant
  // ses médias — interruption, verrou, ordre inversé — les lignes survivent avec library_id à NULL.
  // Invisibles pour l'application, elles restaient dans la base et ont déjà ralenti toute la suite de
  // tests d'un facteur considérable après un banc interrompu.
  db.prepare("DELETE FROM media_items WHERE library_id IS NULL").run();
  db.prepare("DELETE FROM catalog_items WHERE library_id IS NULL").run();
}
