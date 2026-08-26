import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { searchCatalog, listCatalog } from "./catalog-view.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Recherche tolérante — exigence de l'étape 55.
 *
 * `sort_title` ne faisait qu'abaisser la casse : les accents restaient, donc « amelie » ne trouvait
 * pas « Amélie ». Sur une médiathèque française de plusieurs milliers de titres, c'est la gêne la
 * plus fréquente qui soit, parce qu'elle frappe les titres qu'on tape le plus vite.
 *
 * Ces tests s'exécutent sur la vraie base, avec la vraie colonne et le vrai index : une normalisation
 * vérifiée en isolation ne prouverait pas que la requête s'en sert.
 */

const libraryId = randomUUID();
const profileId = randomUUID();
const racine = `D:/tolerant-search-${libraryId}`;

const titres = ["Amélie", "Cœur de Dragon", "Spider-Man", "Les Misérables", "Straße der Nacht"];
const identifiants = new Map<string, string>();

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, racine);
  db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, ?, '#2968ff')")
    .run(profileId, `Recherche ${libraryId.slice(0, 8)}`);

  for (const titre of titres) {
    const catalogId = randomUUID();
    const mediaId = randomUUID();
    identifiants.set(titre, mediaId);
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, year)
      VALUES (?, ?, 'movie', ?, ?, ?, 2020)`)
      .run(catalogId, libraryId, titre, titre.toLowerCase(), normaliseForSearch(titre));
    db.prepare(`INSERT INTO media_items
      (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, available)
      VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, 1)`)
      .run(mediaId, catalogId, titre, titre.toLowerCase(), normaliseForSearch(titre),
        `${racine}/${mediaId}.mkv`, libraryId);
  }
});

afterAll(() => {
  // Sans ce nettoyage, ces films s'ajouteraient aux comptages des autres fichiers de test.
  // `media_items.library_id` est en `ON DELETE SET NULL` : supprimer la bibliothèque ne supprime pas
  // ses médias, elle les détache. Ils deviennent invisibles — les requêtes exigent une bibliothèque —
  // mais restent en base et s'accumulent à chaque exécution. Il faut les retirer explicitement.
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

/** Les titres trouvés par la recherche globale, pour une saisie donnée. */
function trouver(saisie: string): string[] {
  return searchCatalog(profileId, saisie)
    .filter((item) => identifiants.has(item.title))
    .map((item) => item.title);
}

describe("recherche insensible aux accents", () => {
  it("trouve un titre accentué saisi sans accent", () => {
    expect(trouver("amelie")).toContain("Amélie");
  });

  it("trouve un titre saisi avec accent", () => {
    // La tolérance ne doit pas se payer d'une régression : la saisie exacte marche toujours.
    expect(trouver("Amélie")).toContain("Amélie");
  });

  it("défait les ligatures que la décomposition Unicode laisse intactes", () => {
    // œ et æ sont des lettres à part entière : aucune décomposition ne les sépare.
    expect(trouver("coeur")).toContain("Cœur de Dragon");
    expect(trouver("cœur")).toContain("Cœur de Dragon");
  });

  it("ignore la ponctuation dans les deux sens", () => {
    expect(trouver("spider man")).toContain("Spider-Man");
    expect(trouver("spider-man")).toContain("Spider-Man");
  });

  it("traite l'eszett allemand comme un double s", () => {
    expect(trouver("strasse")).toContain("Straße der Nacht");
  });

  it("trouve un mot au milieu du titre", () => {
    expect(trouver("miserables")).toContain("Les Misérables");
  });

  it("ne ramène pas tout le catalogue sur une saisie sans correspondance", () => {
    expect(trouver("zzzintrouvable")).toHaveLength(0);
  });
});

describe("recherche depuis la page catalogue", () => {
  it("applique la même tolérance à la liste paginée des films", () => {
    // La page catalogue passe par une autre requête que la recherche globale : les deux doivent se
    // comporter pareil, sans quoi un même mot donnerait deux résultats différents selon l'écran.
    const page = listCatalog(profileId, { kind: "movies", query: "misérables", sort: "title", filter: "all", offset: 0, limit: 60 });
    expect(page.items.map((item) => item.title)).toContain("Les Misérables");

    const sansAccent = listCatalog(profileId, { kind: "movies", query: "miserables", sort: "title", filter: "all", offset: 0, limit: 60 });
    expect(sansAccent.items.map((item) => item.title)).toContain("Les Misérables");
    expect(sansAccent.total).toBe(page.total);
  });
});
