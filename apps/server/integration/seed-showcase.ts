import { randomUUID } from "node:crypto";
import { db } from "../src/database.js";

/**
 * Jeu de données d'observation de l'interface — étape 55.
 *
 * Reproduit les cas limites que le dossier impose de tenir : titres interminables, titre d'une seule
 * lettre, écriture non latine, absence totale d'affiche, résumés très longs. Ces cas ne se rencontrent
 * pas par hasard dans une médiathèque de test, et ce sont eux qui cassent une mise en page.
 *
 *   pnpm --filter @flixtunes/server seed:showcase
 *   pnpm --filter @flixtunes/server seed:showcase --clean
 */

const MARQUEUR = "Vitrine interface";

/**
 * Volume de remplissage, paramétrable : les cas limites de mise en page se voient sur quelques
 * dizaines de fiches, mais le coût d'une longue grille demande de monter à l'échelle réelle.
 *
 *   pnpm --filter @flixtunes/server seed:showcase 2000
 */
const remplissage = Number(process.argv.find((argument) => /^\d+$/.test(argument)) ?? 55);

function nettoyer(): number {
  const libraries = db.prepare("SELECT id FROM library_folders WHERE name = ?").all(MARQUEUR) as Array<{ id: string }>;
  for (const { id } of libraries) {
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  // La clé étrangère est en ON DELETE SET NULL : sans cette purge, les médias survivraient orphelins.
  db.prepare("DELETE FROM media_items WHERE library_id IS NULL").run();
  db.prepare("DELETE FROM catalog_items WHERE library_id IS NULL").run();
  return libraries.length;
}

if (process.argv.includes("--clean")) {
  console.log(`Retiré ${nettoyer()} bibliothèque(s) de vitrine.`);
} else {
  nettoyer();
  const libraryId = randomUUID();
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, ?, ?, 'movie', 'fr-FR')")
    .run(libraryId, MARQUEUR, `D:/vitrine-${libraryId}`);
  const catalog = db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year, overview,
    match_status, match_confidence) VALUES (?, ?, 'movie', ?, ?, ?, ?, 'automatic', 0.95)`);
  const media = db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, year, overview,
    file_path, library_id, runtime_seconds, available) VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, 5400, 1)`);

  const titres = [
    "Le Seigneur des anneaux : La Communauté de l'anneau — édition longue restaurée en quatre parties",
    "A",
    "Мосфильм : история одного города",
    "American Pie présente : Les Sœurs de la confrérie du campus en folie",
    "映画『君の名は。』特別版",
    ...Array.from({ length: Math.max(0, remplissage) }, (_, index) => `Film de vitrine ${String(index).padStart(4, "0")}`),
  ];

  db.exec("BEGIN IMMEDIATE");
  titres.forEach((titre, index) => {
    const catalogId = randomUUID(); const mediaId = randomUUID();
    const resume = index % 3 === 0
      ? "Un résumé délibérément très long, destiné à vérifier que le texte ne déborde d'aucune carte, "
        + "ne chevauche aucun titre et reste lisible même à fort agrandissement, y compris sur un écran étroit."
      : null;
    catalog.run(catalogId, libraryId, titre, titre.toLocaleLowerCase("fr"), 1980 + (index % 45), resume);
    media.run(mediaId, catalogId, titre, titre.toLocaleLowerCase("fr"), 1980 + (index % 45), resume,
      `D:/vitrine/${mediaId}.mkv`, libraryId);
  });
  db.exec("COMMIT");
  console.log(`Vitrine peuplée : ${titres.length} films, aucune affiche, résumés longs un sur trois.`);
}
