import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { listCatalog, searchCatalog } from "./catalog-view.js";
import { db } from "./database.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * r15 : la recherche lit aussi le titre original. « A Star Is Born (1976) » avait reçu de TMDB son
 * titre français, « Une étoile est née » : chercher « star is born » ne rendait que le film de 2018.
 */
const libraryId = randomUUID();
const profileId = randomUUID();
const marque = randomUUID().slice(0, 6);
db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Titres', ?, 'auto', 'fr-FR')").run(libraryId, `D:/titres-${libraryId}`);
db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, 'Titres', '#2968ff', 'fr-FR')").run(profileId);

function film(titre: string, original: string, annee: number) {
  const catalogId = randomUUID(); const mediaId = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, original_title, sort_title, search_title, year)
    VALUES (?, ?, 'movie', ?, ?, ?, ?, ?)`).run(catalogId, libraryId, titre, original, titre.toLowerCase(), normaliseForSearch(titre), annee);
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, runtime_seconds, year, available)
    VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, 5400, ?, 1)`).run(mediaId, catalogId, titre, titre.toLowerCase(), normaliseForSearch(titre), `D:/titres/${mediaId}.mkv`, libraryId, annee);
}
film(`Une étoile est née ${marque}`, `A Star Is Born ${marque}`, 1976);
film(`A Star is Born ${marque}`, `A Star Is Born ${marque}`, 2018);
film(`Les Évadés ${marque}`, `The Shawshank Redemption ${marque}`, 1994);

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

describe("la recherche par titre original (r15)", () => {
  it("retrouve un film rangé sous son titre français, sans souci des accents ni de la casse", () => {
    const titres = (q: string) => listCatalog(profileId, { kind: "movies", query: q, limit: 50 }).items.map((i) => i.title).sort();
    expect(titres(`star is born ${marque}`)).toEqual([`A Star is Born ${marque}`, `Une étoile est née ${marque}`]);
    expect(titres(`SHÂWSHANK REDEMPTION ${marque}`)).toEqual([`Les Évadés ${marque}`]);
    // Le titre français reste trouvé comme avant.
    expect(titres(`etoile est nee ${marque}`)).toEqual([`Une étoile est née ${marque}`]);
  });
  it("vaut aussi pour la recherche générale", () => {
    expect(searchCatalog(profileId, `shawshank redemption ${marque}`).map((i) => i.title)).toEqual([`Les Évadés ${marque}`]);
  });
});
