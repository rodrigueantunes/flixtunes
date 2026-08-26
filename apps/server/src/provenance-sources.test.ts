import { describe, expect, it } from "vitest";
import { db, SOURCES_METADONNEES } from "./database.js";

/**
 * La contrainte de la table et le type des contrats doivent décrire la même chose.
 *
 * Ils ne le décrivaient pas : `anilist` figurait parmi les fournisseurs de métadonnées mais pas dans
 * la contrainte `CHECK` de `metadata_field_values`. Chaque série animée appariée par AniList faisait
 * donc échouer l'écriture de sa provenance, et la bibliothèque affichait « 16 erreur(s). CHECK
 * constraint failed » — sans nommer le fournisseur, ni le champ, ni le média.
 *
 * Le coût d'une divergence est élevé et le signal est faible : ces tests la rendent impossible à
 * livrer.
 */
describe("provenances de métadonnées", () => {
  function definitionTable(): string {
    return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'metadata_field_values'")
      .get() as { sql?: string } | undefined)?.sql ?? "";
  }

  it("la table accepte exactement les provenances déclarées", () => {
    const definition = definitionTable();
    expect(definition, "table introuvable").not.toBe("");
    for (const source of SOURCES_METADONNEES) {
      expect(definition, `provenance absente de la contrainte : ${source}`).toContain(`'${source}'`);
    }
  });

  it("accepte anilist, le fournisseur qui manquait", () => {
    expect(SOURCES_METADONNEES).toContain("anilist");
    expect(definitionTable()).toContain("'anilist'");
  });

  it("couvre les neuf fournisseurs plus les quatre origines locales", () => {
    // Miroir de `MetadataFieldProvenance["source"]` dans les contrats. Toute divergence se voit ici,
    // à la compilation du test plutôt qu'à l'exécution d'une analyse de bibliothèque.
    const attendues: Array<(typeof SOURCES_METADONNEES)[number]> = [
      "filename", "embedded", "nfo", "manual",
      "local", "tvmaze", "wikidata", "anilist", "tmdb", "tvdb", "imdb", "fanart", "allocine",
    ];
    expect([...SOURCES_METADONNEES].sort()).toEqual([...attendues].sort());
  });

  it("écrit réellement une provenance anilist sans lever", () => {
    const bibliotheque = `test-lib-${Date.now()}`;
    const catalogue = `test-cat-${Date.now()}`;
    db.prepare("INSERT INTO library_folders (id, path, kind) VALUES (?, ?, 'tv')")
      .run(bibliotheque, `/tmp/${bibliotheque}`);
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title)
      VALUES (?, ?, 'show', 'Série animée', 'serie animee')`).run(catalogue, bibliotheque);
    try {
      expect(() => db.prepare(`INSERT INTO metadata_field_values
        (catalog_id, field, value_json, source, confidence) VALUES (?, 'title', ?, 'anilist', 0.8)`)
        .run(catalogue, JSON.stringify("Série animée"))).not.toThrow();
    } finally {
      db.prepare("DELETE FROM library_folders WHERE id = ?").run(bibliotheque);
    }
  });
});
