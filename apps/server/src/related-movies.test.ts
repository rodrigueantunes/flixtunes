import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, setCatalogGenres } from "./database.js";
import { getDetails } from "./catalog-view.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Fiches proposées à côté d'un film.
 *
 * Cette liste tirait douze films **au hasard** : la section promettait un rapprochement et n'en
 * offrait aucun. Un lien arbitraire est pire qu'une section vide, parce qu'il laisse croire à une
 * parenté qui n'existe pas — et sur une médiathèque de deux mille films, le hasard ne tombe
 * pratiquement jamais juste.
 *
 * La saga vient de TMDB (`belongs_to_collection`), comme les genres : la donnée était déjà dans la
 * réponse et n'était pas lue.
 */

const libraryId = randomUUID();
const profileId = randomUUID();
const racine = `D:/liees-${libraryId}`;

interface Fiche { titre: string; annee: number; genres: string[]; saga?: string }
const corpus: Fiche[] = [
  { titre: "Saga Premier", annee: 2001, genres: ["Action"], saga: "42" },
  { titre: "Saga Second", annee: 2004, genres: ["Action"], saga: "42" },
  { titre: "Saga Troisième", annee: 2008, genres: ["Aventure"], saga: "42" },
  { titre: "Cousin Proche", annee: 2010, genres: ["Action", "Aventure"] },
  { titre: "Cousin Lointain", annee: 2012, genres: ["Action"] },
  { titre: "Étranger Complet", annee: 2014, genres: ["Documentaire"] },
];
const mediaParTitre = new Map<string, string>();
const catalogParTitre = new Map<string, string>();

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, racine);
  db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, ?, '#2968ff')")
    .run(profileId, `Liees ${libraryId.slice(0, 8)}`);

  for (const fiche of corpus) {
    const catalogId = randomUUID();
    const mediaId = randomUUID();
    mediaParTitre.set(fiche.titre, mediaId);
    catalogParTitre.set(fiche.titre, catalogId);
    db.prepare(`INSERT INTO catalog_items
      (id, library_id, kind, title, sort_title, search_title, year, collection_id, collection_name)
      VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?)`)
      .run(catalogId, libraryId, fiche.titre, fiche.titre.toLowerCase(), normaliseForSearch(fiche.titre),
        fiche.annee, fiche.saga ?? null, fiche.saga ? "Ma Saga" : null);
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

/** Les titres proposés à côté d'un film, dans l'ordre rendu. */
function liees(titre: string): string[] {
  const details = getDetails(profileId, mediaParTitre.get(titre)!);
  return (details?.related ?? []).map((item) => item.title);
}

describe("fiche détaillée d'un film", () => {
  it("porte sa bibliothèque, sans quoi la correction de correspondance est impossible", () => {
    // Le bouton « Corriger la correspondance » se conditionne à la présence de la bibliothèque. Le
    // chemin des séries l'attachait, celui des films non : la correction n'était offerte que pour les
    // séries, et rien ne le signalait — le bouton manquait, simplement.
    const details = getDetails(profileId, mediaParTitre.get("Saga Premier")!);
    expect(details?.item.libraryId, "la fiche doit dire de quelle bibliothèque elle vient").toBe(libraryId);
    expect(details?.item.catalogId).toBe(catalogParTitre.get("Saga Premier"));
  });
});

describe("fiches proposées à côté d'un film", () => {
  it("place la saga en tête, dans l'ordre chronologique", () => {
    const proposees = liees("Saga Premier");
    // Le lien le plus fort qui soit : les autres films de la même série, et dans leur ordre de sortie.
    expect(proposees.slice(0, 2)).toEqual(["Saga Second", "Saga Troisième"]);
  });

  it("retient un film de la saga même quand son genre diffère", () => {
    // « Saga Troisième » n'a aucun genre commun avec le premier : c'est la saga qui les relie.
    expect(liees("Saga Premier")).toContain("Saga Troisième");
  });

  it("complète par les genres partagés, les plus proches d'abord", () => {
    const proposees = liees("Cousin Proche");
    // Deux genres en commun avec « Cousin Proche », contre un seul pour « Cousin Lointain ».
    expect(proposees.indexOf("Saga Premier")).toBeGreaterThanOrEqual(0);
    expect(proposees).toContain("Cousin Lointain");
  });

  it("n'inclut jamais le film lui-même", () => {
    for (const fiche of corpus) {
      expect(liees(fiche.titre), fiche.titre).not.toContain(fiche.titre);
    }
  });

  it("ne répète pas un film déjà proposé au titre de la saga", () => {
    const proposees = liees("Saga Premier");
    expect(new Set(proposees).size, "aucun doublon").toBe(proposees.length);
  });

  it("ne propose rien plutôt que n'importe quoi", () => {
    // « Étranger Complet » ne partage ni saga ni genre. Compléter au hasard laisserait croire à une
    // parenté inexistante : une section vide dit la vérité sur l'état de la médiathèque.
    expect(liees("Étranger Complet")).toEqual([]);
  });
});
