import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyPendingRestore } from "./restore-bootstrap.js";

/**
 * La restauration, éprouvée de bout en bout sur de vraies bases SQLite.
 *
 * C'est le chemin de retour du projet : il n'y a pas de migration inverse, et la sauvegarde prise
 * avant toute évolution de schéma ne vaut que si l'on sait la rendre. Une restauration qu'on
 * n'éprouve jamais est une promesse, pas une garantie — et elle ne se découvre fausse qu'au moment
 * où l'on en a besoin.
 *
 * Chaque cas monte son propre répertoire de données : la base commune aux suites n'est jamais
 * touchée, ce qui est la moindre des choses pour des cas qui écrasent des fichiers de base.
 */
const racines: string[] = [];

function poserRepertoire(): string {
  const racine = mkdtempSync(path.join(os.tmpdir(), "flixtunes-restauration-"));
  racines.push(racine);
  mkdirSync(path.join(racine, "backups"), { recursive: true });
  return racine;
}

/** Une base SQLite véritable, avec une ligne dedans, refermée pour être copiable. */
function poserBase(chemin: string, marque: string): void {
  const base = new DatabaseSync(chemin);
  base.exec("CREATE TABLE IF NOT EXISTS temoin (marque TEXT PRIMARY KEY)");
  // Une seule ligne, toujours : `INSERT OR REPLACE` avec une marque différente en ajoutait une
  // seconde, et la lecture rendait la première — le banc affirmait alors un défaut inexistant.
  base.exec("DELETE FROM temoin");
  base.prepare("INSERT INTO temoin (marque) VALUES (?)").run(marque);
  base.close();
}

function lireMarque(chemin: string): string | null {
  const base = new DatabaseSync(chemin);
  try {
    const integrite = base.prepare("PRAGMA integrity_check").get() as unknown as { integrity_check: string };
    expect(integrite.integrity_check, "la base restaurée doit être intègre").toBe("ok");
    const ligne = base.prepare("SELECT marque FROM temoin").get() as unknown as { marque: string } | undefined;
    return ligne?.marque ?? null;
  } finally { base.close(); }
}

afterEach(() => { for (const racine of racines.splice(0)) rmSync(racine, { recursive: true, force: true }); });

describe("restauration d'une sauvegarde", () => {
  it("rend le contenu de la sauvegarde, et garde l'état d'avant", async () => {
    const racine = poserRepertoire();
    const base = path.join(racine, "flixtunes.db");
    poserBase(path.join(racine, "backups", "flixtunes-20260824-120000000.db"), "sauvegarde");
    poserBase(base, "état courant");
    // Le WAL et l'index partagé décrivent la base qu'on va écarter : s'ils survivaient, ils
    // corrompraient la lecture de celle qu'on pose.
    writeFileSync(`${base}-wal`, "résidu");
    writeFileSync(`${base}-shm`, "résidu");
    writeFileSync(path.join(racine, "restore-pending.json"),
      JSON.stringify({ backup: "flixtunes-20260824-120000000.db", requestedAt: new Date().toISOString() }));

    await applyPendingRestore(racine);

    expect(lireMarque(base), "la base porte le contenu de la sauvegarde").toBe("sauvegarde");
    expect(existsSync(`${base}-wal`), "le journal de l'ancienne base est écarté").toBe(false);
    expect(existsSync(`${base}-shm`)).toBe(false);
    expect(existsSync(path.join(racine, "restore-pending.json")),
      "le marqueur est consommé : un redémarrage ne restaure pas deux fois").toBe(false);

    const ecartee = readdirSync(racine).find((nom) => nom.startsWith("flixtunes-before-restore-"));
    expect(ecartee, "l'état d'avant reste sur le disque").toBeDefined();
    expect(lireMarque(path.join(racine, ecartee!)), "et il est intact").toBe("état courant");
  });

  it("reprend une restauration interrompue au démarrage suivant", async () => {
    /*
     * Le cas qui justifie le marqueur : la demande est notée, puis le service est coupé — mise à
     * jour du paquet, coupure de courant — avant d'avoir redémarré. Le marqueur survit, et c'est le
     * démarrage suivant qui exécute la restauration.
     */
    const racine = poserRepertoire();
    const base = path.join(racine, "flixtunes.db");
    poserBase(path.join(racine, "backups", "flixtunes-20260825-093000000.db"), "avant l'incident");
    poserBase(base, "état courant");
    writeFileSync(path.join(racine, "restore-pending.json"),
      JSON.stringify({ backup: "flixtunes-20260825-093000000.db" }));

    await applyPendingRestore(racine);
    // Deuxième démarrage : le marqueur a été consommé, plus rien ne doit bouger.
    poserBase(base, "travail repris après restauration");
    await applyPendingRestore(racine);

    expect(lireMarque(base)).toBe("travail repris après restauration");
  });

  it("ne fait rien sans marqueur", async () => {
    const racine = poserRepertoire();
    const base = path.join(racine, "flixtunes.db");
    poserBase(base, "intacte");

    await applyPendingRestore(racine);

    expect(lireMarque(base)).toBe("intacte");
    expect(readdirSync(racine).some((nom) => nom.startsWith("flixtunes-before-restore-")),
      "aucune copie de sécurité inutile").toBe(false);
  });

  it("refuse un marqueur qui ne désigne pas une sauvegarde", async () => {
    // Le marqueur est un fichier du disque : rien ne garantit que le service l'a écrit. Un nom libre
    // ferait copier n'importe quel fichier par-dessus la base.
    const racine = poserRepertoire();
    const base = path.join(racine, "flixtunes.db");
    poserBase(base, "intacte");
    writeFileSync(path.join(racine, "restore-pending.json"),
      JSON.stringify({ backup: "../../../etc/passwd" }));

    await expect(applyPendingRestore(racine)).rejects.toThrowError(/Marqueur de restauration invalide/);

    expect(lireMarque(base), "la base n'a pas été touchée").toBe("intacte");
  });
});
