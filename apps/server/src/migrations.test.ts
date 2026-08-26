import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { appliquerLesMigrations, etatDuSchema, SOCLE, versionDuSchema, type Migration } from "./migrations.js";

/**
 * Le registre de migrations, éprouvé sur des bases jetables.
 *
 * Chaque cas travaille sur sa propre base, dans un répertoire temporaire : ce qui se vérifie ici est
 * le comportement du mécanisme, pas l'état de la médiathèque de développement. C'est aussi la seule
 * façon d'éprouver un échec de migration sans laisser la base commune à demi migrée.
 */
const racines: string[] = [];
const ouvertes: DatabaseSync[] = [];

function baseJetable(): DatabaseSync {
  const racine = mkdtempSync(path.join(os.tmpdir(), "flixtunes-migrations-"));
  racines.push(racine);
  const base = new DatabaseSync(path.join(racine, "essai.db"));
  ouvertes.push(base);
  base.exec("CREATE TABLE IF NOT EXISTS media_items (id TEXT PRIMARY KEY, titre TEXT)");
  return base;
}

afterEach(() => {
  for (const base of ouvertes.splice(0)) { try { base.close(); } catch { /* déjà fermée */ } }
  for (const racine of racines.splice(0)) rmSync(racine, { recursive: true, force: true });
});

const migration = (version: number, sql: string, nom = `essai ${version}`): Migration =>
  ({ version, nom, appliquer: (base) => base.exec(sql) });

describe("registre de migrations", () => {
  it("adopte le socle sans rien exécuter", () => {
    // Une base existante porte déjà le schéma : la consigner suffit, la réexécuter serait au mieux
    // inutile, au pire destructeur.
    const base = baseJetable();

    expect(appliquerLesMigrations(base, { registre: [] })).toEqual([]);

    expect(versionDuSchema(base)).toBe(SOCLE);
    expect(etatDuSchema(base, []).enAttente).toEqual([]);
  });

  it("applique ce qui manque, dans l'ordre, et une seule fois", () => {
    const base = baseJetable();
    const registre = [
      migration(3, "ALTER TABLE media_items ADD COLUMN troisieme TEXT"),
      migration(2, "ALTER TABLE media_items ADD COLUMN deuxieme TEXT"),
    ];

    expect(appliquerLesMigrations(base, { registre }), "l'ordre suit le numéro, pas la déclaration")
      .toEqual([2, 3]);
    expect(appliquerLesMigrations(base, { registre }), "un second démarrage ne refait rien").toEqual([]);

    const colonnes = (base.prepare("PRAGMA table_info(media_items)").all() as unknown as Array<{ name: string }>)
      .map((colonne) => colonne.name);
    expect(colonnes).toContain("deuxieme");
    expect(colonnes).toContain("troisieme");
    expect(versionDuSchema(base)).toBe(3);
  });

  it("ne consigne rien et ne laisse rien derrière quand une migration échoue", () => {
    /*
     * L'atomicité, qui est la raison d'être du registre. SQLite exécute le DDL dans une transaction :
     * une migration qui pose une colonne puis échoue ne doit laisser ni la colonne, ni son numéro.
     * Sans cela, le démarrage suivant reprendrait la migration sur un schéma déjà à demi modifié.
     */
    const base = baseJetable();
    const registre = [{
      version: 2,
      nom: "ajoute puis échoue",
      appliquer: (cible: DatabaseSync) => {
        cible.exec("ALTER TABLE media_items ADD COLUMN commencee TEXT");
        cible.exec("CETTE INSTRUCTION N'EST PAS DU SQL");
      },
    }];

    expect(() => appliquerLesMigrations(base, { registre }))
      .toThrowError(/Migration 2 \(ajoute puis échoue\)/);

    const colonnes = (base.prepare("PRAGMA table_info(media_items)").all() as unknown as Array<{ name: string }>)
      .map((colonne) => colonne.name);
    expect(colonnes, "la colonne posée avant l'échec a été annulée").not.toContain("commencee");
    expect(versionDuSchema(base), "et le numéro n'a pas été consigné").toBe(SOCLE);
  });

  it("sauvegarde avant de modifier, et seulement s'il y a quelque chose à modifier", () => {
    // Sauvegarder à chaque démarrage remplirait le disque de copies identiques ; ne jamais sauvegarder
    // laisserait une mise à jour sans retour possible. La sauvegarde suit donc le travail réel.
    const base = baseJetable();
    let sauvegardes = 0;
    const avantModification = () => { sauvegardes += 1; };

    appliquerLesMigrations(base, { registre: [], avantModification });
    expect(sauvegardes, "l'adoption du socle ne modifie rien").toBe(0);

    const registre = [migration(2, "ALTER TABLE media_items ADD COLUMN ajoutee TEXT")];
    appliquerLesMigrations(base, { registre, avantModification });
    expect(sauvegardes, "une migration réelle, une sauvegarde").toBe(1);

    appliquerLesMigrations(base, { registre, avantModification });
    expect(sauvegardes, "plus rien à faire, plus de sauvegarde").toBe(1);
  });

  it("refuse un registre qui se contredit", () => {
    const base = baseJetable();
    expect(() => appliquerLesMigrations(base, {
      registre: [migration(2, "SELECT 1"), migration(2, "SELECT 1", "homonyme")],
    }), "deux fois le même numéro").toThrowError(/numéro 2/);
    expect(() => appliquerLesMigrations(base, { registre: [migration(SOCLE, "SELECT 1")] }),
      "un numéro qui empiète sur le socle").toThrowError(/empiète sur le socle/);
  });

  it("annonce ce qui reste à faire avant de le faire", () => {
    // C'est ce que l'écran de diagnostic lit : savoir qu'une mise à jour attend vaut mieux que de
    // s'en apercevoir au redémarrage suivant.
    const base = baseJetable();
    const registre = [migration(2, "SELECT 1"), migration(4, "SELECT 1")];
    appliquerLesMigrations(base, { registre: [] });

    expect(etatDuSchema(base, registre)).toEqual({ version: SOCLE, enAttente: [2, 4] });
  });
});
