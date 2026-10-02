import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { unlink } from "node:fs/promises";
import { expect, it } from "vitest";
import { db } from "./database.js";
import { backupPath, createBackup, listBackups } from "./maintenance.js";

it("sauvegarde sans bloquer les tâches JS, mutualise les demandes et publie une base complète", async () => {
  const key = `backup-test-${randomUUID()}`;
  db.prepare("INSERT INTO server_settings(key,value) VALUES (?,?)").run(key, "Été à Paris");
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 0);
  let fichier: string | null = null;
  try {
    const avant = listBackups().map((b) => b.name);
    const premiere = createBackup();
    expect(createBackup()).toBe(premiere);
    expect(listBackups().map((b) => b.name)).toEqual(avant);
    const resultat = await premiere;
    fichier = backupPath(resultat.name)!;
    expect(ticks).toBeGreaterThan(0);
    const copie = new DatabaseSync(fichier, { readOnly: true });
    try {
      expect(copie.prepare("PRAGMA quick_check").get()).toMatchObject({ quick_check: "ok" });
      expect(copie.prepare("SELECT value FROM server_settings WHERE key = ?").get(key)).toMatchObject({ value: "Été à Paris" });
    } finally { copie.close(); }
  } finally {
    clearInterval(timer);
    db.prepare("DELETE FROM server_settings WHERE key = ?").run(key);
    if (fichier) await unlink(fichier);
  }
});
