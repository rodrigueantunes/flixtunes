import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./database.js";
import { config } from "./config.js";
import { restoreMarkerPath } from "./restore-bootstrap.js";

const backupsDir = path.join(config.dataDir, "backups");
mkdirSync(backupsDir, { recursive: true });

export interface BackupInfo { name: string; size: number; createdAt: string }

export function listBackups(): BackupInfo[] {
  return readdirSync(backupsDir).filter((name) => /^flixtunes-\d{8}-\d{9}\.db$/.test(name)).map((name) => {
    const info = statSync(path.join(backupsDir, name));
    return { name, size: info.size, createdAt: info.mtime.toISOString() };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function backupPath(name: string): string | null {
  return /^flixtunes-\d{8}-\d{9}\.db$/.test(name) ? path.join(backupsDir, name) : null;
}

export function createBackup(): BackupInfo {
  const compact = new Date().toISOString().replace(/\D/g, "").slice(0, 17);
  const stamp = `${compact.slice(0, 8)}-${compact.slice(8)}`;
  const name = `flixtunes-${stamp}.db`; const target = path.join(backupsDir, name);
  db.exec("PRAGMA wal_checkpoint(FULL)");
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const backups = listBackups();
  for (const expired of backups.slice(config.backupRetention)) {
    try { unlinkSync(path.join(backupsDir, expired.name)); } catch { /* best effort */ }
  }
  return listBackups().find((entry) => entry.name === name)!;
}

export async function requestRestore(name: string): Promise<void> {
  const source = backupPath(name);
  if (!source) throw new Error("Nom de sauvegarde invalide");
  statSync(source);
  await writeFile(restoreMarkerPath, JSON.stringify({ backup: name, requestedAt: new Date().toISOString() }), "utf8");
}

export function databaseHealth() {
  const integrity = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
  const database = statSync(path.join(config.dataDir, "flixtunes.db"));
  return { integrity: integrity.quick_check, databaseBytes: database.size, backups: listBackups().length };
}
