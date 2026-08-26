import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SOURCES_METADONNEES } from "./database.js";

/**
 * La migration est éprouvée sur l'**ancien** schéma, pas sur une base neuve.
 *
 * La suite crée une base vierge, qui naît déjà correcte : le chemin de migration n'y est jamais
 * exercé. Or c'est précisément lui qui s'exécutera sur une installation existante, sur des dizaines
 * de milliers de lignes de provenance, et une erreur y détruirait l'historique de métadonnées de
 * toute la médiathèque.
 *
 * Ce fichier reconstitue donc une base au schéma d'avant — contrainte `CHECK` sans `anilist` —, la
 * remplit, applique la migration, et vérifie que rien n'a été perdu.
 */
describe("migration des provenances de métadonnées", () => {
  let dossier = "";

  afterEach(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true });
    dossier = "";
  });

  function baseAncienne(): DatabaseSync {
    dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-migration-"));
    const db = new DatabaseSync(path.join(dossier, "ancienne.db"));
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
      CREATE TABLE catalog_items (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE metadata_field_values (
        catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        field TEXT NOT NULL CHECK(field IN ('title', 'originalTitle', 'overview', 'year', 'runtimeSeconds', 'poster', 'backdrop')),
        value_json TEXT,
        source TEXT NOT NULL CHECK(source IN ('filename', 'embedded', 'nfo', 'local', 'tvmaze', 'wikidata', 'tmdb', 'tvdb', 'imdb', 'fanart', 'allocine', 'manual')),
        source_id TEXT, language TEXT, confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        locked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(catalog_id, field)
      );
      CREATE INDEX idx_metadata_fields_source ON metadata_field_values(source, field);
    `);
    return db;
  }

  /** La migration telle qu'elle figure dans `database.ts`, appliquée ici sur la base d'essai. */
  function migrer(db: DatabaseSync): void {
    const check = SOURCES_METADONNEES.map((nom) => `'${nom}'`).join(", ");
    db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      db.exec(`
        CREATE TABLE metadata_field_values_open (
          catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
          field TEXT NOT NULL CHECK(field IN ('title', 'originalTitle', 'overview', 'year', 'runtimeSeconds', 'poster', 'backdrop')),
          value_json TEXT,
          source TEXT NOT NULL CHECK(source IN (${check})),
          source_id TEXT, language TEXT, confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          locked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(catalog_id, field)
        );
        INSERT INTO metadata_field_values_open SELECT * FROM metadata_field_values;
        DROP TABLE metadata_field_values;
        ALTER TABLE metadata_field_values_open RENAME TO metadata_field_values;
        CREATE INDEX idx_metadata_fields_source ON metadata_field_values(source, field);
      `);
      db.exec("COMMIT;");
    } catch (erreur) {
      db.exec("ROLLBACK;");
      throw erreur;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  it("conserve chaque ligne, sa valeur et son verrou", () => {
    const db = baseAncienne();
    const sources = ["filename", "nfo", "tmdb", "tvmaze", "manual", "wikidata"];
    // `entries()` plutôt qu'un index : sous `noUncheckedIndexedAccess`, `sources[index]` vaut
    // `string | undefined` et n'est pas acceptable comme paramètre lié.
    for (const [index, source] of sources.entries()) {
      db.prepare("INSERT INTO catalog_items (id, title) VALUES (?, ?)").run(`c${index}`, `Titre ${index}`);
      db.prepare(`INSERT INTO metadata_field_values (catalog_id, field, value_json, source, source_id, language, confidence, locked)
        VALUES (?, 'title', ?, ?, ?, 'fr-FR', ?, ?)`)
        .run(`c${index}`, JSON.stringify(`Titre ${index}`), source, `ext-${index}`, 0.5 + index / 100, index % 2);
    }
    const avant = db.prepare("SELECT * FROM metadata_field_values ORDER BY catalog_id").all();

    migrer(db);

    const apres = db.prepare("SELECT * FROM metadata_field_values ORDER BY catalog_id").all();
    expect(apres).toEqual(avant);
    db.close();
  });

  it("accepte anilist après migration, et le refusait avant", () => {
    const db = baseAncienne();
    db.prepare("INSERT INTO catalog_items (id, title) VALUES ('anime', 'Série animée')").run();
    const ecrire = () => db.prepare(`INSERT INTO metadata_field_values (catalog_id, field, value_json, source, confidence)
      VALUES ('anime', 'title', ?, 'anilist', 0.8)`).run(JSON.stringify("Série animée"));

    expect(ecrire, "c'est exactement l'erreur vue sur la bibliothèque Séries TV").toThrow(/CHECK constraint failed/);
    migrer(db);
    expect(ecrire).not.toThrow();
    db.close();
  });

  it("laisse la contrainte refuser une provenance inventée", () => {
    const db = baseAncienne();
    db.prepare("INSERT INTO catalog_items (id, title) VALUES ('x', 'X')").run();
    migrer(db);
    expect(() => db.prepare(`INSERT INTO metadata_field_values (catalog_id, field, value_json, source, confidence)
      VALUES ('x', 'title', ?, 'fournisseur-imaginaire', 0.8)`).run(JSON.stringify("X")))
      .toThrow(/CHECK constraint failed/);
    db.close();
  });

  it("rétablit l'index de recherche par provenance", () => {
    const db = baseAncienne();
    migrer(db);
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'metadata_field_values'")
      .all() as Array<{ name: string }>;
    expect(index.map((ligne) => ligne.name)).toContain("idx_metadata_fields_source");
    db.close();
  });

  it("préserve la clé étrangère : supprimer un élément emporte ses provenances", () => {
    const db = baseAncienne();
    db.prepare("INSERT INTO catalog_items (id, title) VALUES ('c', 'C')").run();
    db.prepare(`INSERT INTO metadata_field_values (catalog_id, field, value_json, source, confidence)
      VALUES ('c', 'title', ?, 'tmdb', 0.9)`).run(JSON.stringify("C"));
    migrer(db);
    db.prepare("DELETE FROM catalog_items WHERE id = 'c'").run();
    const reste = db.prepare("SELECT COUNT(*) AS n FROM metadata_field_values").get() as { n: number };
    expect(reste.n, "la cascade doit survivre à la reconstruction").toBe(0);
    db.close();
  });
});
