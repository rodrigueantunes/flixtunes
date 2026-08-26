import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

/**
 * Le nettoyage hérité du prototype efface **toutes** les bibliothèques et **tout** le catalogue.
 *
 * Il était gardé par la seule absence du réglage `first_run_completed`. Une absence n'est pas une
 * preuve : une table de réglages réinitialisée, ou une sauvegarde restaurée d'avant la configuration,
 * et le démarrage suivant effaçait en silence la médiathèque entière d'un serveur en production.
 *
 * Tester cela demande d'exécuter le vrai module sur une vraie base : la migration s'exécute à
 * l'import, et la réécrire dans le test ne prouverait rien du code livré. Chaque cas ouvre donc sa
 * propre base dans un processus séparé, exactement comme un démarrage de serveur.
 */

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const repertoires: string[] = [];

afterEach(() => {
  for (const repertoire of repertoires.splice(0)) rmSync(repertoire, { recursive: true, force: true });
});

// `tsx` sert de lanceur parce que le module importe ses voisins en `./config.js` — la convention
// TypeScript. Le retrait de types intégré à Node ne réécrit pas ces spécificateurs et ne trouverait
// donc rien. C'est bien la source livrée qui s'exécute, pas une copie de sa logique.
const lanceur = path.resolve(sourceDir, "../../../node_modules/tsx/dist/cli.mjs");

// Le lancement est asynchrone : un `execFileSync` immobiliserait le fil d'exécution du test assez
// longtemps pour que vitest croie son worker perdu, et signale une erreur qui n'en est pas une.
const lancer = promisify(execFile);

/** Démarre le module de base de données dans son propre processus, sur `repertoire`. */
async function demarrerServeur(repertoire: string): Promise<void> {
  await lancer(process.execPath, [lanceur, path.join(sourceDir, "database.ts")], {
    env: { ...process.env, FLIXTUNES_DATA_DIR: repertoire },
  });
}

/** Prépare un répertoire de données neuf. */
function nouveauRepertoire(): string {
  const repertoire = mkdtempSync(path.join(tmpdir(), "flixtunes-migration-"));
  repertoires.push(repertoire);
  return repertoire;
}

/** Insère une bibliothèque et une fiche, comme une médiathèque déjà configurée. */
function garnir(repertoire: string, avecMarqueurConfiguration: boolean): void {
  const base = new DatabaseSync(path.join(repertoire, "flixtunes.db"));
  const libraryId = randomUUID();
  base.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, `D:/medias-${libraryId}`);
  base.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title) VALUES (?, ?, 'movie', 'Film', 'film')")
    .run(randomUUID(), libraryId);
  if (avecMarqueurConfiguration) {
    base.prepare("INSERT INTO server_settings (key, value) VALUES ('first_run_completed', 'true')").run();
  }
  base.close();
}

/** Compte les bibliothèques et les fiches restantes. */
function inventaire(repertoire: string): { bibliotheques: number; fiches: number; marqueur: string | null } {
  const base = new DatabaseSync(path.join(repertoire, "flixtunes.db"));
  const bibliotheques = Number((base.prepare("SELECT COUNT(*) AS n FROM library_folders").get() as { n: number }).n);
  const fiches = Number((base.prepare("SELECT COUNT(*) AS n FROM catalog_items").get() as { n: number }).n);
  const marqueur = (base.prepare("SELECT value FROM server_settings WHERE key = 'prototype_cleanup_done'")
    .get() as { value: string } | undefined)?.value ?? null;
  base.close();
  return { bibliotheques, fiches, marqueur };
}

describe("nettoyage hérité du prototype", () => {
  it("s'exécute une fois sur une base de prototype, puis pose son marqueur", async () => {
    const repertoire = nouveauRepertoire();
    await demarrerServeur(repertoire);            // crée le schéma et pose le marqueur sur une base vide
    const base = new DatabaseSync(path.join(repertoire, "flixtunes.db"));
    base.prepare("DELETE FROM server_settings WHERE key = 'prototype_cleanup_done'").run();
    base.close();
    garnir(repertoire, false);              // état du prototype : des données, aucun marqueur

    await demarrerServeur(repertoire);

    const apres = inventaire(repertoire);
    expect(apres.bibliotheques, "le nettoyage du prototype doit bien détacher les anciennes bibliothèques").toBe(0);
    expect(apres.fiches).toBe(0);
    expect(apres.marqueur, "le marqueur doit être posé pour que ce nettoyage ne se répète jamais").toBe("true");
  }, 180_000);

  it("ne touche à rien sur une base déjà configurée", async () => {
    const repertoire = nouveauRepertoire();
    await demarrerServeur(repertoire);
    garnir(repertoire, true);

    await demarrerServeur(repertoire);

    const apres = inventaire(repertoire);
    expect(apres.bibliotheques).toBe(1);
    expect(apres.fiches).toBe(1);
  }, 180_000);

  it("n'efface rien si le réglage de configuration disparaît après coup", async () => {
    // C'est le scénario dangereux : réglages réinitialisés, ou sauvegarde restaurée d'avant la
    // configuration. Avec l'ancien garde-fou, ce démarrage effaçait toute la médiathèque.
    const repertoire = nouveauRepertoire();
    await demarrerServeur(repertoire);
    garnir(repertoire, true);
    await demarrerServeur(repertoire);

    const base = new DatabaseSync(path.join(repertoire, "flixtunes.db"));
    base.prepare("DELETE FROM server_settings WHERE key = 'first_run_completed'").run();
    base.close();

    await demarrerServeur(repertoire);

    const apres = inventaire(repertoire);
    expect(apres.bibliotheques, "la perte d'un réglage ne doit jamais valoir ordre de suppression").toBe(1);
    expect(apres.fiches).toBe(1);
  }, 180_000);
});
