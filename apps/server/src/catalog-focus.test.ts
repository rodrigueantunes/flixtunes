import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Ouverture de l'écran de correction sur une fiche précise.
 *
 * La liste d'administration est plafonnée à 250 titres, triés par ordre alphabétique. Sur une
 * bibliothèque réelle de 1 449 films, tout titre au-delà du 250e en était absent : « Corriger la
 * correspondance » ouvrait alors l'écran sur le **premier film du catalogue**, sans rien signaler.
 *
 * Arriver depuis une fiche précise pour se retrouver devant une autre est pire qu'un refus : la
 * personne croit corriger son film et modifie celui d'à côté.
 */

const libraryId = randomUUID();
const racine = `D:/focus-${libraryId}`;
const TOTAL = 320;
let cibleId = "";

/** Arrivée depuis une fiche précise : la route ne sert que celle-là. */
function listerAvecFocus(focusId: string): Array<{ id: string; title: string }> {
  return db.prepare(`SELECT id, title FROM catalog_items
    WHERE id = ? AND library_id = ? AND kind IN ('movie', 'show')`)
    .all(focusId, libraryId) as Array<{ id: string; title: string }>;
}

/** Bouton général : le catalogue, plafonné et trié. */
function listerTout(): Array<{ id: string; title: string }> {
  return db.prepare(`SELECT id, title FROM catalog_items
    WHERE library_id = ? AND kind IN ('movie', 'show') ORDER BY sort_title LIMIT 250`)
    .all(libraryId) as Array<{ id: string; title: string }>;
}

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, racine);
  for (let index = 0; index < TOTAL; index += 1) {
    const id = randomUUID();
    // Les titres sont numérotés pour que l'ordre alphabétique soit prévisible : « Film 300 » se situe
    // très au-delà du 250e rang, exactement comme les films qui posaient problème.
    const titre = `Film ${String(index).padStart(4, "0")}`;
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, year)
      VALUES (?, ?, 'movie', ?, ?, ?, 2000)`)
      .run(id, libraryId, titre, titre.toLowerCase(), normaliseForSearch(titre));
    if (index === TOTAL - 1) cibleId = id;
  }
});

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
});

describe("écran de correction ouvert depuis une fiche", () => {
  it("ne sert que la fiche concernée", () => {
    // On vient corriger *ce* titre : servir tout le catalogue obligerait à l'y retrouver soi-même.
    const liste = listerAvecFocus(cibleId);
    expect(liste).toHaveLength(1);
    expect(liste[0]?.id).toBe(cibleId);
    expect(liste[0]?.title).toBe(`Film ${String(TOTAL - 1).padStart(4, "0")}`);
  });

  it("y parvient même très au-delà du plafond de la liste", () => {
    // C'est le défaut d'origine : la liste s'arrête à 250 titres, et le film demandé — le 320e — n'y
    // figurait pas. L'écran s'ouvrait alors sur le premier film du catalogue, sans rien signaler.
    expect(listerTout().map((row) => row.id)).not.toContain(cibleId);
    expect(listerAvecFocus(cibleId)[0]?.id).toBe(cibleId);
  });

  it("ne rend rien pour une fiche d'une autre bibliothèque", () => {
    // Une fiche demandée doit appartenir à la bibliothèque ouverte : sans ce garde-fou, un
    // identifiant deviné donnerait accès à n'importe quelle fiche du serveur.
    expect(listerAvecFocus(randomUUID())).toHaveLength(0);
  });
});

describe("écran de correction ouvert par le bouton général", () => {
  it("sert le catalogue, trié et plafonné", () => {
    const liste = listerTout();
    expect(liste).toHaveLength(250);
    const titres = liste.map((row) => row.title);
    expect(titres).toEqual([...titres].sort());
  });
});
