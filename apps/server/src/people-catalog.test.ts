import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, setCatalogPeople } from "./database.js";
import { getDetails, getPersonDetails, searchCatalog } from "./catalog-view.js";
import { normaliseForSearch } from "./search-normalise.js";

const libraryId = randomUUID();
const profileId = randomUUID();
const catalogId = randomUUID();
const mediaId = randomUUID();
const actorExternalId = randomUUID();
const actorId = `tmdb:${actorExternalId}`;

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, `D:/people-${libraryId}`);
  db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, 'Casting test', '#2968ff')").run(profileId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, year)
    VALUES (?, ?, 'movie', 'Le Film sans le nom', 'film sans le nom', ?, 2025)`)
    .run(catalogId, libraryId, normaliseForSearch("Le Film sans le nom"));
  db.prepare(`INSERT INTO media_items
    (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, available)
    VALUES (?, ?, 'movie', 'Le Film sans le nom', 'film sans le nom', ?, ?, ?, 1)`)
    .run(mediaId, catalogId, normaliseForSearch("Le Film sans le nom"), `D:/people-${libraryId}/film.mkv`, libraryId);
  setCatalogPeople(catalogId, "tmdb", [{
    externalId: actorExternalId, name: "Élodie Exemple", profileUrl: "/api/metadata/image/w185/elodie.jpg",
    department: "Acting", role: "actor", character: "Capitaine Nova", job: null, order: 0,
  }, {
    externalId: randomUUID(), name: "Réalisateur Exemple", profileUrl: null,
    department: "Directing", role: "director", character: null, job: "Director", order: 1,
  }]);
});

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
  db.prepare("DELETE FROM catalog_people WHERE id = ?").run(actorId);
});

describe("navigation par personnes", () => {
  it("expose casting, personnage et équipe seulement dans la fiche détaillée", () => {
    expect(getDetails(profileId, mediaId)?.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: actorId, name: "Élodie Exemple", role: "actor", character: "Capitaine Nova" }),
      expect.objectContaining({ name: "Réalisateur Exemple", role: "director" }),
    ]));
  });

  it("retrouve les œuvres de la bibliothèque en cliquant sur une personne", () => {
    const details = getPersonDetails(profileId, actorId);
    expect(details?.person.name).toBe("Élodie Exemple");
    expect(details?.items.map((item) => item.title)).toContain("Le Film sans le nom");
  });

  it("la recherche globale retrouve un film par acteur sans charger le casting dans la grille", () => {
    expect(searchCatalog(profileId, "elodie exemple").map((item) => item.title)).toContain("Le Film sans le nom");
  });
});
