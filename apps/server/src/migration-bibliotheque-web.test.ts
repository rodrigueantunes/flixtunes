import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  appliquerLesMigrations, elargirLaContrainte, MIGRATIONS, ouvrirLesTypesDeBibliotheque, ouvrirLesTypesDeMedia,
  reparerLesTitresEchappes,
} from "./migrations.js";

/**
 * Ouvrir `library_folders` à un cinquième type, sans emporter le catalogue.
 *
 * Cette table est la **mère** des fiches et des médias, qui la référencent en `ON DELETE CASCADE`.
 * Une reconstruction mal conduite ne se solde pas par une erreur mais par une médiathèque vide —
 * et l'essai qui a précédé ce fichier l'a effectivement vidée. D'où des cas qui vérifient moins la
 * réussite que l'**absence de dégâts** : les comptes des trois tables, les colonnes ajoutées après
 * coup, et la cascade elle-même, qu'une reconstruction peut rompre en silence.
 */
const racines: string[] = [];
const ouvertes: DatabaseSync[] = [];

/** La contrainte telle que `database.ts` l'écrit. La migration s'y accroche mot pour mot. */
const CONTRAINTE = "CHECK(kind IN ('auto', 'movie', 'tv', 'other'))";

/**
 * Une base qui reproduit la relation réelle : la bibliothèque, ses fiches, ses médias.
 *
 * Les colonnes ajoutées après coup par `database.ts` sont présentes, parce qu'elles sont l'enjeu :
 * une migration écrite en dur les perdrait, et le compte des lignes ne le dirait pas.
 */
function baseAvecMediatheque(contrainte = CONTRAINTE): DatabaseSync {
  const racine = mkdtempSync(path.join(os.tmpdir(), "flixtunes-web-"));
  racines.push(racine);
  const base = new DatabaseSync(path.join(racine, "essai.db"));
  ouvertes.push(base);
  base.exec("PRAGMA foreign_keys = ON");
  base.exec(`
    CREATE TABLE library_folders (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL ${contrainte},
      language TEXT NOT NULL DEFAULT 'fr-FR',
      enabled INTEGER NOT NULL DEFAULT 1
    , name TEXT NOT NULL DEFAULT 'Bibliothèque', last_scan_status TEXT NOT NULL DEFAULT 'idle', last_scan_error TEXT);
    CREATE TABLE catalog_items (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES library_folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    );
    CREATE TABLE media_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('movie', 'show', 'episode')),
      library_id TEXT REFERENCES library_folders(id) ON DELETE CASCADE,
      title TEXT NOT NULL
    , edition TEXT);
    CREATE TABLE artwork_assets (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('local', 'tvmaze', 'wikidata', 'tmdb')),
      local_path TEXT NOT NULL
    );
    CREATE TABLE playback_progress (
      profile_id TEXT NOT NULL,
      media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      position_seconds REAL NOT NULL DEFAULT 0,
      PRIMARY KEY(profile_id, media_id)
    );
    INSERT INTO library_folders (id, path, kind, name, last_scan_error)
      VALUES ('lib1', 'N:/Films', 'movie', 'Films du salon', 'incident precedent');
    INSERT INTO catalog_items (id, library_id, title) VALUES ('cat1', 'lib1', 'Arrival');
    INSERT INTO media_items (id, kind, library_id, title, edition) VALUES ('med1', 'movie', 'lib1', 'Arrival', 'longue');
    INSERT INTO playback_progress (profile_id, media_id, position_seconds) VALUES ('prof1', 'med1', 1234.5);
    INSERT INTO artwork_assets (id, catalog_id, role, source, local_path)
      VALUES ('art1', 'cat1', 'poster', 'tmdb', 'D:/artwork/art1.jpg');
  `);
  return base;
}

const compte = (base: DatabaseSync, table: string) =>
  (base.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }).n;

const schemaDe = (base: DatabaseSync, table: string) =>
  (base.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as unknown as { sql: string }).sql;

afterEach(() => {
  for (const base of ouvertes.splice(0)) { try { base.close(); } catch { /* déjà fermée */ } }
  for (const racine of racines.splice(0)) rmSync(racine, { recursive: true, force: true });
});

describe("ouverture de library_folders au type web", () => {
  it("conserve les bibliothèques, leurs fiches et leurs médias", () => {
    // Le cas central. Une première tentative, qui croyait pouvoir se passer de désarmer les clés
    // étrangères, laissait `catalog_items` à zéro sans lever la moindre erreur.
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeBibliotheque(base);

    expect(compte(base, "library_folders")).toBe(1);
    expect(compte(base, "catalog_items")).toBe(1);
    expect(compte(base, "media_items")).toBe(1);
    expect(base.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });

  it("conserve les colonnes ajoutées après la création de la table", () => {
    // La nouvelle table est dérivée du schéma en place. Un `CREATE` recopié de `database.ts`
    // effacerait le nom de chaque bibliothèque et tout son historique d'analyse.
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeBibliotheque(base);

    const ligne = base.prepare("SELECT name, last_scan_error, kind FROM library_folders WHERE id = 'lib1'")
      .get() as unknown as { name: string; last_scan_error: string; kind: string };
    expect(ligne.name).toBe("Films du salon");
    expect(ligne.last_scan_error).toBe("incident precedent");
    expect(ligne.kind).toBe("movie");
  });

  it("accepte le type web et refuse toujours un type inconnu", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeBibliotheque(base);

    expect(() => base.exec("INSERT INTO library_folders (id, path, kind) VALUES ('lib2', 'N:/Web', 'web')"))
      .not.toThrow();
    expect(() => base.exec("INSERT INTO library_folders (id, path, kind) VALUES ('lib3', 'N:/X', 'nawak')"))
      .toThrow();
  });

  it("la cascade fonctionne encore après reconstruction", () => {
    // Une reconstruction peut rompre la cascade sans que rien ne le signale : les suppressions de
    // bibliothèques laisseraient alors des fiches orphelines, pour toujours.
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeBibliotheque(base);
    base.exec("DELETE FROM library_folders WHERE id = 'lib1'");

    expect(compte(base, "catalog_items")).toBe(0);
    expect(compte(base, "media_items")).toBe(0);
  });

  it("ne fait rien une seconde fois", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeBibliotheque(base);
    const apresUne = schemaDe(base, "library_folders");
    ouvrirLesTypesDeBibliotheque(base);

    expect(schemaDe(base, "library_folders")).toBe(apresUne);
    expect(compte(base, "catalog_items")).toBe(1);
  });

  it("refuse une contrainte qu'elle ne reconnaît pas, sans rien toucher", () => {
    // La migration s'accroche à un texte précis. Si quelqu'un modifie le schéma sans elle, mieux vaut
    // un démarrage qui échoue en le disant qu'une reconstruction menée sur une forme inconnue.
    const base = baseAvecMediatheque("CHECK(kind IN ('auto', 'movie'))");

    expect(() => ouvrirLesTypesDeBibliotheque(base)).toThrow(/forme attendue/);

    expect(compte(base, "catalog_items")).toBe(1);
    expect(schemaDe(base, "library_folders")).toContain("CHECK(kind IN ('auto', 'movie'))");
  });

  it("s'applique par le registre, et une seule fois", () => {
    const base = baseAvecMediatheque();

    expect(appliquerLesMigrations(base, { registre: MIGRATIONS })).toEqual([2, 3, 4, 5]);
    expect(appliquerLesMigrations(base, { registre: MIGRATIONS })).toEqual([]);
    expect(schemaDe(base, "library_folders")).toContain("'web'");
    expect(compte(base, "catalog_items")).toBe(1);
  });
});

describe("ouverture de media_items au type video", () => {
  it("conserve les progressions de lecture", () => {
    // `media_items` est la mère des progressions et des préférences de sous-titres, toutes deux en
    // cascade. Une reconstruction menée sans désarmer les clés effacerait l'historique de visionnage
    // de tous les profils — la donnée la moins remplaçable de l'installation.
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeMedia(base);

    expect(compte(base, "media_items")).toBe(1);
    expect(compte(base, "playback_progress")).toBe(1);
    expect((base.prepare("SELECT position_seconds AS p FROM playback_progress WHERE media_id = 'med1'")
      .get() as unknown as { p: number }).p).toBeCloseTo(1234.5);
    expect(base.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });

  it("conserve les colonnes ajoutées après coup", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeMedia(base);

    expect((base.prepare("SELECT edition FROM media_items WHERE id = 'med1'")
      .get() as unknown as { edition: string }).edition).toBe("longue");
  });

  it("accepte le type video et refuse toujours un type inconnu", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeMedia(base);

    expect(() => base.exec("INSERT INTO media_items (id, kind, title) VALUES ('med2', 'video', 'Une video')"))
      .not.toThrow();
    expect(() => base.exec("INSERT INTO media_items (id, kind, title) VALUES ('med3', 'nawak', 'X')"))
      .toThrow();
  });

  it("la cascade des progressions fonctionne encore", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeMedia(base);
    base.exec("DELETE FROM media_items WHERE id = 'med1'");

    expect(compte(base, "playback_progress")).toBe(0);
  });

  it("ne fait rien une seconde fois", () => {
    const base = baseAvecMediatheque();

    ouvrirLesTypesDeMedia(base);
    const apresUne = schemaDe(base, "media_items");
    ouvrirLesTypesDeMedia(base);

    expect(schemaDe(base, "media_items")).toBe(apresUne);
    expect(compte(base, "playback_progress")).toBe(1);
  });
});

describe("ouverture des provenances de vignette", () => {
  it("conserve les images déjà en cache", () => {
    // Ranger une vignette YouTube sous « tmdb » aurait évité cette migration au prix d'une donnée
    // fausse — et la provenance sert justement à savoir quoi rafraîchir et à qui l'attribuer.
    const base = baseAvecMediatheque();

    appliquerLesMigrations(base, { registre: MIGRATIONS });

    expect(compte(base, "artwork_assets")).toBe(1);
    expect(schemaDe(base, "artwork_assets")).toContain("'youtube'");
    expect(() => base.exec(`INSERT INTO artwork_assets (id, catalog_id, role, source, local_path)
      VALUES ('art2', 'cat1', 'poster', 'youtube', 'D:/artwork/art2.jpg')`)).not.toThrow();
  });
});

describe("formes de schéma rencontrées en production", () => {
  /**
   * Une table déjà reconstruite par le passé porte son nom **entre guillemets**.
   *
   * SQLite réécrit la définition après un `ALTER TABLE ... RENAME TO`, et guillemette le nouveau nom.
   * C'est le cas d'`artwork_assets`, reconstruite lors de l'ouverture aux fournisseurs libres. La
   * migration cherchait `CREATE TABLE artwork_assets` : elle ne trouvait rien, la substitution ne se
   * faisait pas, et la recréation d'une table existante interrompait le démarrage du serveur.
   *
   * Relevé sur une installation réelle, migrations 2 et 3 appliquées et la 4 en échec.
   */
  it("reconstruit une table dont le nom est guillemeté", () => {
    const base = baseAvecMediatheque();
    base.exec(`
      CREATE TABLE illustrations_ancien (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK(source IN ('local', 'tmdb')),
        chemin TEXT NOT NULL
      );
      ALTER TABLE illustrations_ancien RENAME TO illustrations;
      CREATE INDEX idx_illustrations_source ON illustrations(source);
      INSERT INTO illustrations (id, source, chemin) VALUES ('a1', 'tmdb', 'D:/a1.jpg');
    `);
    expect(schemaDe(base, "illustrations"), "SQLite guillemette le nom après un renommage")
      .toContain('CREATE TABLE "illustrations"');

    elargirLaContrainte(base, "illustrations",
      "CHECK(source IN ('local', 'tmdb'))", "CHECK(source IN ('local', 'tmdb', 'youtube'))");

    expect(compte(base, "illustrations")).toBe(1);
    expect(schemaDe(base, "illustrations")).toContain("'youtube'");
  });

  /**
   * Les index ne survivent pas à `DROP TABLE`, et doivent être rejoués.
   *
   * `database.ts` les recrée au démarrage suivant en `IF NOT EXISTS`, mais s'y fier laisse le schéma
   * incomplet entre les deux — et sur une installation réelle, `media_items` s'est retrouvée sans un
   * seul de ses six index parce que le démarrage suivant n'a jamais eu lieu.
   */
  it("rejoue les index de la table reconstruite", () => {
    const base = baseAvecMediatheque();
    base.exec("CREATE INDEX idx_media_titre ON media_items(title)");

    ouvrirLesTypesDeMedia(base);

    const index = (base.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_items' AND sql IS NOT NULL",
    ).all() as unknown as Array<{ name: string }>).map((ligne) => ligne.name);
    expect(index).toContain("idx_media_titre");
  });
});

describe("accroche de la migration", () => {
  it("la contrainte visée existe encore dans le schéma du serveur", () => {
    // La migration reconnaît la table à un texte exact. Le jour où `database.ts` l'écrira autrement,
    // ce cas échouera ici — pas au démarrage d'une installation.
    const source = readFileSync(fileURLToPath(new URL("./database.ts", import.meta.url)), "utf8");
    expect(source).toContain(CONTRAINTE);
    expect(source).toContain("CHECK(kind IN ('movie', 'show', 'episode'))");
    expect(source).toContain("CHECK(source IN ('local', 'tvmaze', 'wikidata', 'tmdb'))");
  });
});

/**
 * Rendre aux titres déjà enregistrés les caractères que l'échappement HTML masquait.
 *
 * Le défaut est corrigé à la lecture, mais ce qui est en base y resterait jusqu'à une réanalyse
 * complète — c'est-à-dire, en pratique, indéfiniment. Deux garde-fous comptent autant que la
 * réparation elle-même : elle ne doit toucher **que** les bibliothèques web, et elle ne doit pas
 * échouer sur une base assez ancienne pour ne pas avoir toutes les colonnes.
 */
describe("réparation des titres échappés", () => {
  /** Une base dotée des colonnes que `database.ts` ajoute après coup, et de deux bibliothèques. */
  function baseAvecTitres(): DatabaseSync {
    const racine = mkdtempSync(path.join(os.tmpdir(), "flixtunes-entites-"));
    racines.push(racine);
    const base = new DatabaseSync(path.join(racine, "essai.db"));
    ouvertes.push(base);
    base.exec(`
      CREATE TABLE library_folders (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, kind TEXT NOT NULL);
      CREATE TABLE catalog_items (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, title TEXT NOT NULL,
        overview TEXT, search_title TEXT);
      CREATE TABLE media_items (id TEXT PRIMARY KEY, library_id TEXT, title TEXT NOT NULL,
        search_title TEXT, show_title TEXT);
      INSERT INTO library_folders VALUES ('web-1', 'D:/Web', 'web'), ('films-1', 'D:/Films', 'movie');
      INSERT INTO catalog_items VALUES
        ('v1', 'web-1', 'Greg &amp; Greg : L&#39;amour propre', 'Une &quot;parodie&quot;.', 'greg &amp; greg'),
        ('f1', 'films-1', 'Fisher &amp; Sons', NULL, 'fisher &amp; sons');
      INSERT INTO media_items VALUES
        ('m1', 'web-1', 'Greg &amp; Greg : L&#39;amour propre', 'greg &amp; greg', 'Greg &amp; Guillotin');
    `);
    return base;
  }

  it("décode les titres web, et seulement eux", () => {
    const base = baseAvecTitres();
    reparerLesTitresEchappes(base);

    const video = base.prepare("SELECT title, overview, search_title FROM catalog_items WHERE id = 'v1'")
      .get() as unknown as { title: string; overview: string; search_title: string };
    expect(video.title).toBe("Greg & Greg : L'amour propre");
    expect(video.overview).toBe('Une "parodie".');
    expect(video.search_title).toBe("greg & greg");

    const media = base.prepare("SELECT title, show_title FROM media_items WHERE id = 'm1'")
      .get() as unknown as { title: string; show_title: string };
    expect(media.title).toBe("Greg & Greg : L'amour propre");
    expect(media.show_title).toBe("Greg & Guillotin");

    // Un film n'est pas touche : les autres fournisseurs rendent du texte brut, ou une esperluette
    // est une esperluette. Y passer aurait ete un risque sans contrepartie.
    const film = base.prepare("SELECT title FROM catalog_items WHERE id = 'f1'")
      .get() as unknown as { title: string };
    expect(film.title).toBe("Fisher &amp; Sons");
  });

  it("ne s'arrête pas sur une base à qui manquent des colonnes", () => {
    // `search_title` et `show_title` sont ajoutees apres coup par `database.ts`. Le registre etant
    // atomique, une migration qui les nommerait sans verifier bloquerait toute la mise a jour.
    const racine = mkdtempSync(path.join(os.tmpdir(), "flixtunes-entites-vieille-"));
    racines.push(racine);
    const base = new DatabaseSync(path.join(racine, "essai.db"));
    ouvertes.push(base);
    base.exec(`
      CREATE TABLE library_folders (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, kind TEXT NOT NULL);
      CREATE TABLE catalog_items (id TEXT PRIMARY KEY, library_id TEXT NOT NULL, title TEXT NOT NULL);
      CREATE TABLE media_items (id TEXT PRIMARY KEY, library_id TEXT, title TEXT NOT NULL);
      INSERT INTO library_folders VALUES ('web-1', 'D:/Web', 'web');
      INSERT INTO catalog_items VALUES ('v1', 'web-1', 'Greg &amp; Greg');
    `);

    expect(() => reparerLesTitresEchappes(base)).not.toThrow();
    expect((base.prepare("SELECT title FROM catalog_items WHERE id = 'v1'")
      .get() as unknown as { title: string }).title).toBe("Greg & Greg");
  });
});
