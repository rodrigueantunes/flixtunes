import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, setCatalogGenres } from "./database.js";
import { listCatalog } from "./catalog-view.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Filtres combinables — exigence de l'étape 55.
 *
 * L'enjeu n'est pas qu'un filtre fonctionne isolément, mais que **plusieurs s'appliquent ensemble**,
 * en SQL, avant le découpage en pages. Appliqués sur les seules fiches déjà chargées, ils donneraient
 * un décompte faux dès la deuxième page — et un décompte faux est pire qu'un filtre absent, parce
 * qu'il inspire confiance.
 *
 * Les genres viennent de TMDB. La réponse les contenait déjà ; ils n'étaient simplement jamais lus.
 */

const libraryId = randomUUID();
const profileId = randomUUID();
const racine = `D:/filtres-${libraryId}`;

interface Fiche { titre: string; annee: number; genres: string[] }
const corpus: Fiche[] = [
  { titre: "Course Nocturne", annee: 1998, genres: ["Action"] },
  { titre: "Rire Jaune", annee: 1998, genres: ["Comédie"] },
  { titre: "Poursuite Comique", annee: 2015, genres: ["Action", "Comédie"] },
  { titre: "Duel Silencieux", annee: 2015, genres: ["Action"] },
  { titre: "Course Contre la Montre", annee: 2022, genres: ["Action", "Thriller"] },
  { titre: "Sans Genre Connu", annee: 2022, genres: [] },
];
const connus = new Set(corpus.map((fiche) => fiche.titre));

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, racine);
  db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, ?, '#2968ff')")
    .run(profileId, `Filtres ${libraryId.slice(0, 8)}`);

  for (const fiche of corpus) {
    const catalogId = randomUUID();
    const mediaId = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, year)
      VALUES (?, ?, 'movie', ?, ?, ?, ?)`)
      .run(catalogId, libraryId, fiche.titre, fiche.titre.toLowerCase(), normaliseForSearch(fiche.titre), fiche.annee);
    db.prepare(`INSERT INTO media_items
      (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, year, available)
      VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, 1)`)
      .run(mediaId, catalogId, fiche.titre, fiche.titre.toLowerCase(), normaliseForSearch(fiche.titre),
        `${racine}/${mediaId}.mkv`, libraryId, fiche.annee);
    setCatalogGenres(catalogId, fiche.genres);
  }
});

afterAll(() => {
  // `media_items.library_id` est en `ON DELETE SET NULL` : supprimer la bibliothèque ne supprime pas
  // ses médias, elle les détache. Ils deviennent invisibles — les requêtes exigent une bibliothèque —
  // mais restent en base et s'accumulent à chaque exécution. Il faut les retirer explicitement.
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

/** Les titres de ce corpus retenus par une interrogation, et le décompte annoncé. */
function interroger(query: Parameters<typeof listCatalog>[1]): { titres: string[]; total: number } {
  const page = listCatalog(profileId, { limit: 60, offset: 0, ...query });
  const miens = page.items.filter((item) => connus.has(item.title));
  return { titres: miens.map((item) => item.title).sort(), total: page.total };
}

describe("bornes d'année", () => {
  it("retient un intervalle inclusif", () => {
    const { titres } = interroger({ kind: "movies", minYear: 1998, maxYear: 2015 });
    expect(titres).toEqual(["Course Nocturne", "Duel Silencieux", "Poursuite Comique", "Rire Jaune"]);
  });

  it("accepte une borne seule", () => {
    expect(interroger({ kind: "movies", minYear: 2022 }).titres)
      .toEqual(["Course Contre la Montre", "Sans Genre Connu"]);
    expect(interroger({ kind: "movies", maxYear: 1998 }).titres)
      .toEqual(["Course Nocturne", "Rire Jaune"]);
  });
});

describe("filtre par genre", () => {
  it("exige tous les genres demandés, et non l'un d'entre eux", () => {
    // Deux cases cochées ensemble cherchent une comédie d'action, pas la réunion des deux rayons.
    expect(interroger({ kind: "movies", genres: ["Action", "Comédie"] }).titres).toEqual(["Poursuite Comique"]);
  });

  it("retient toutes les fiches d'un genre demandé seul", () => {
    expect(interroger({ kind: "movies", genres: ["Action"] }).titres)
      .toEqual(["Course Contre la Montre", "Course Nocturne", "Duel Silencieux", "Poursuite Comique"]);
  });

  it("écarte les fiches sans genre connu", () => {
    const { titres } = interroger({ kind: "movies", genres: ["Action"] });
    expect(titres, "une fiche sans genre ne peut satisfaire aucune exigence").not.toContain("Sans Genre Connu");
  });

  it("annonce les genres du catalogue entier", () => {
    const page = listCatalog(profileId, { kind: "movies", limit: 1, offset: 0 });
    // Une seule fiche demandée, mais l'inventaire couvre tout : proposer les seuls genres visibles
    // ferait disparaître un choix dès qu'on tourne la page.
    for (const genre of ["Action", "Comédie", "Thriller"]) {
      expect(page.availableGenres, `« ${genre} » doit être proposé`).toContain(genre);
    }
  });
});

describe("critères appliqués ensemble", () => {
  it("croise l'année et le genre", () => {
    expect(interroger({ kind: "movies", genres: ["Action"], minYear: 2015, maxYear: 2015 }).titres)
      .toEqual(["Duel Silencieux", "Poursuite Comique"]);
  });

  it("croise l'année, le genre et la recherche", () => {
    // Trois critères d'un coup : c'est là que se joue « combinables ».
    expect(interroger({ kind: "movies", genres: ["Action"], minYear: 1990, maxYear: 2015, query: "course" }).titres)
      .toEqual(["Course Nocturne"]);
  });

  it("compte ce qui correspond, pas ce qui est affiché", () => {
    // Le décompte doit tenir compte de tous les critères. Un total juste sur la première page mais
    // faux ensuite tromperait davantage qu'un filtre absent, parce qu'il inspire confiance.
    const restreint = listCatalog(profileId, { kind: "movies", genres: ["Action"], minYear: 2015, limit: 1, offset: 0 });
    expect(restreint.items).toHaveLength(1);
    expect(restreint.total, "trois films d'action à partir de 2015").toBe(3);
  });

  it("ne retient rien quand les critères s'excluent", () => {
    expect(interroger({ kind: "movies", genres: ["Comédie"], minYear: 2022 }).titres).toEqual([]);
  });
});
