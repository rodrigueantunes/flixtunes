import type { DatabaseSync } from "node:sqlite";

/**
 * Les évolutions de schéma, numérotées, atomiques, et consignées.
 *
 * Jusqu'ici le schéma évoluait par **détection** : `PRAGMA table_info`, et si la colonne manque on
 * l'ajoute. C'est robuste tant qu'on n'ajoute que des colonnes, et ça ne l'est plus dès qu'une
 * évolution demande de déplacer des données, de reconstruire une table ou de corriger une valeur —
 * trois choses qu'aucune détection de colonne ne sait décrire. Surtout, la base ne savait pas dire
 * **où elle en était** : impossible de refuser une mise à jour trop ancienne, de savoir ce qu'une
 * restauration a rendu, ni de reconnaître un schéma à demi migré.
 *
 * Le registre corrige cela sans réécrire ce qui marche :
 *
 * - la **version 1 est le socle** — tout ce que `database.ts` construit déjà, et qui est idempotent
 *   par nature (`CREATE TABLE IF NOT EXISTS`, colonnes ajoutées à la demande). Une base existante
 *   l'adopte donc sans rien exécuter, et une base neuve l'obtient en étant créée ;
 * - **toute évolution ultérieure porte un numéro**, s'applique dans une transaction, et n'est
 *   consignée que si elle a réussi entièrement.
 *
 * SQLite exécute le DDL dans une transaction, contrairement à d'autres moteurs : une migration qui
 * échoue à mi-chemin ne laisse donc pas un schéma bâtard. C'est cette propriété qui rend l'atomicité
 * réelle ici, et pas seulement annoncée.
 *
 * **Pourquoi pas de migration inverse.** Défaire un ajout de colonne en SQLite impose de reconstruire
 * la table entière — copier, supprimer, renommer, refaire les index et les clés étrangères. Cette
 * reconstruction est plus dangereuse que ce qu'elle répare, et elle s'exécuterait précisément dans le
 * moment le plus fragile : après une mise à jour qui vient d'échouer. Le chemin de retour est donc la
 * **sauvegarde**, prise juste avant d'appliquer quoi que ce soit, et restaurée par un mécanisme qui
 * remplace le fichier hors de tout accès concurrent — voir `restore-bootstrap`. Il est éprouvé par
 * ses propres cas de test, ce qu'une migration inverse écrite « au cas où » ne serait jamais.
 */

export interface Migration {
  /** Numéro strictement croissant. Deux migrations ne peuvent pas le partager. */
  version: number;
  /** Ce que la migration fait, en français, tel qu'il apparaîtra dans le journal. */
  nom: string;
  appliquer: (base: DatabaseSync) => void;
  /**
   * La migration ouvre et referme elle-même sa transaction.
   *
   * Le registre enveloppe normalement chaque migration dans un `BEGIN IMMEDIATE`, et c'est ce qu'il
   * faut dans la quasi-totalité des cas. Une reconstruction de table fait exception : SQLite ne sait
   * pas modifier une contrainte `CHECK`, il faut donc recréer la table, la remplir et supprimer
   * l'ancienne — et si cette table est la **mère** d'une autre, la suppression déclenche les
   * `ON DELETE CASCADE` des filles. Le seul moyen de l'empêcher est `PRAGMA foreign_keys = OFF`,
   * **sans effet une fois une transaction ouverte**. C'est mesuré, pas supposé : la tentative de
   * contourner le pragma avec `legacy_alter_table` a vidé la table des fiches sur une base d'essai.
   *
   * Une migration ainsi marquée reste donc atomique — elle se charge simplement de l'être elle-même,
   * et doit désarmer puis réarmer les clés étrangères autour de son propre `BEGIN`.
   */
  gereSaTransaction?: boolean;
}

/** Le socle : ce que `database.ts` construit et maintient déjà, adopté sans rien réexécuter. */
export const SOCLE = 1;

/**
 * Les migrations postérieures au socle.
 *
 * Une nouvelle évolution s'ajoute ici avec le numéro suivant. Elle doit être **idempotente autant que
 * possible** — `IF NOT EXISTS`, `INSERT OR IGNORE` — parce qu'une base restaurée depuis une
 * sauvegarde d'âge inconnu peut la recroiser.
 */
/**
 * Elargir une contrainte `CHECK` sur une table, sans perdre ni ligne ni descendance.
 *
 * SQLite ne modifie pas une contrainte : il faut recreer la table. Trois precautions, chacune
 * verifiee sur une base peuplee :
 *
 * - **les cles etrangeres sont desarmees avant le `BEGIN`**, jamais dedans, ou le pragma serait sans
 *   effet. Sans cela, supprimer l'ancienne table declenche les `ON DELETE CASCADE` de ses filles.
 *   Ce n'est pas une precaution theorique : une premiere version, qui croyait pouvoir s'en passer
 *   grace a `legacy_alter_table`, a vide la table des fiches sur une base d'essai — sans erreur ;
 * - **la nouvelle table est derivee du schema en place**, jamais reecrite en dur. Des colonnes sont
 *   ajoutees a ces tables au fil des versions, et un `CREATE` recopie les effacerait toutes ;
 * - **`PRAGMA foreign_key_check` precede le `COMMIT`**, pour qu'un defaut se solde par un retour
 *   arriere plutot que par une base a demi cousue.
 */
export function elargirLaContrainte(base: DatabaseSync, table: string, ancienne: string, nouvelle: string): void {
  const schema = (base.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as unknown as { sql: string } | undefined)?.sql;
  if (!schema) throw new Error(`La table ${table} est absente.`);
  if (schema.includes(nouvelle)) return;
  if (schema.split(ancienne).length - 1 !== 1) {
    throw new Error(`La contrainte de ${table} n'a pas la forme attendue.`);
  }

  const provisoire = `${table}_elargie`;
  const nouvelleTable = schema
    .replace(`CREATE TABLE ${table}`, `CREATE TABLE ${provisoire}`)
    .replace(ancienne, nouvelle);

  base.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    base.exec(`
      ${nouvelleTable};
      INSERT INTO ${provisoire} SELECT * FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${provisoire} RENAME TO ${table};
    `);
    const orphelines = base.prepare("PRAGMA foreign_key_check").all();
    if (orphelines.length) throw new Error(`${orphelines.length} references orphelines apres reconstruction.`);
    base.exec("COMMIT;");
  } catch (cause) {
    base.exec("ROLLBACK;");
    throw cause;
  } finally {
    base.exec("PRAGMA foreign_keys = ON;");
  }
}

/** Ouvrir `library_folders` a un cinquieme type de bibliotheque. */
export function ouvrirLesTypesDeBibliotheque(base: DatabaseSync): void {
  elargirLaContrainte(base, "library_folders",
    "CHECK(kind IN ('auto', 'movie', 'tv', 'other'))",
    "CHECK(kind IN ('auto', 'movie', 'tv', 'other', 'web'))");
}

/**
 * Donner leur type aux videos web : `video`, et non `episode`.
 *
 * Elles etaient enregistrees en `episode` pour heriter sans code neuf de la reprise et de
 * l'enchainement. Le raccourci ne tenait pas : ce type voyage avec la fiche, et l'accueil annoncait
 * « S1 · E20024 » — le numero d'episode etant un nombre de jours. Une video n'est pas un episode, et
 * aucun ecran ne doit avoir a le deviner.
 *
 * `media_items` est la mere des progressions de lecture et des preferences de sous-titres, toutes
 * deux en `ON DELETE CASCADE`. Une reconstruction menee sans desarmer les cles effacerait donc
 * l'historique de visionnage de tous les profils.
 */
export function ouvrirLesTypesDeMedia(base: DatabaseSync): void {
  elargirLaContrainte(base, "media_items",
    "CHECK(kind IN ('movie', 'show', 'episode'))",
    "CHECK(kind IN ('movie', 'show', 'episode', 'video'))");
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    nom: "library_folders accepte le type web",
    gereSaTransaction: true,
    appliquer: ouvrirLesTypesDeBibliotheque,
  },
  {
    version: 3,
    nom: "media_items accepte le type video",
    gereSaTransaction: true,
    appliquer: ouvrirLesTypesDeMedia,
  },
];

export interface EtatSchema {
  /** Version atteinte, `0` si la base n'a jamais été consignée. */
  version: number;
  /** Ce qui reste à appliquer. */
  enAttente: number[];
}

function preparerRegistre(base: DatabaseSync): void {
  base.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    applique_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
}

export function versionDuSchema(base: DatabaseSync): number {
  preparerRegistre(base);
  const ligne = base.prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as unknown as { version: number | null } | undefined;
  return ligne?.version ?? 0;
}

export function etatDuSchema(base: DatabaseSync, registre: Migration[] = MIGRATIONS): EtatSchema {
  const version = versionDuSchema(base);
  return { version, enAttente: registre.filter((m) => m.version > version).map((m) => m.version) };
}

/**
 * Applique ce qui manque, dans l'ordre, et rend la liste de ce qui a été fait.
 *
 * `avantModification` est appelé **une seule fois**, juste avant la première migration réelle — jamais
 * pour la simple adoption du socle, qui ne touche à rien. C'est là que le service prend sa sauvegarde :
 * la prendre à chaque démarrage serait du bruit, ne pas la prendre du tout laisserait une mise à jour
 * sans retour possible.
 */
export function appliquerLesMigrations(base: DatabaseSync, options: {
  registre?: Migration[];
  avantModification?: () => void;
  journaliser?: (message: string) => void;
} = {}): number[] {
  const registre = [...(options.registre ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  for (const [index, migration] of registre.entries()) {
    if (index > 0 && migration.version === registre[index - 1]!.version) {
      throw new Error(`Deux migrations portent le numéro ${migration.version}.`);
    }
    if (migration.version <= SOCLE) {
      throw new Error(`La migration ${migration.version} empiète sur le socle (${SOCLE}).`);
    }
  }

  preparerRegistre(base);
  const consigner = base.prepare("INSERT OR IGNORE INTO schema_migrations (version, nom) VALUES (?, ?)");

  // Adoption du socle : la base porte déjà ce schéma, puisque `database.ts` vient de le construire ou
  // de le compléter. On ne l'exécute pas, on l'enregistre.
  if (versionDuSchema(base) < SOCLE) consigner.run(SOCLE, "Socle 0.5.6 — schéma construit par database.ts");

  const aFaire = registre.filter((migration) => migration.version > versionDuSchema(base));
  if (!aFaire.length) return [];

  options.avantModification?.();

  const appliquees: number[] = [];
  for (const migration of aFaire) {
    // Le numéro figure dans le message d'échec : sans lui, on cherche la migration fautive à la main
    // dans un service qui refuse de démarrer.
    const echec = (cause: unknown) => new Error(
      `Migration ${migration.version} (${migration.nom}) impossible : `
      + (cause instanceof Error ? cause.message : String(cause)), { cause });

    if (migration.gereSaTransaction) {
      try {
        migration.appliquer(base);
        consigner.run(migration.version, migration.nom);
      } catch (cause) {
        throw echec(cause);
      }
    } else {
      base.exec("BEGIN IMMEDIATE");
      try {
        migration.appliquer(base);
        consigner.run(migration.version, migration.nom);
        base.exec("COMMIT");
      } catch (cause) {
        base.exec("ROLLBACK");
        throw echec(cause);
      }
    }
    appliquees.push(migration.version);
    options.journaliser?.(`Migration ${migration.version} appliquée — ${migration.nom}`);
  }
  return appliquees;
}
