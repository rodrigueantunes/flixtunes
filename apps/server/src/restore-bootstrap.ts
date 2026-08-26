import { copyFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const restoreMarkerPath = path.join(config.dataDir, "restore-pending.json");

export async function applyPendingRestore(): Promise<void> {
  let marker: { backup: string };
  try { marker = JSON.parse(await readFile(restoreMarkerPath, "utf8")) as { backup: string }; }
  catch { return; }
  if (!/^flixtunes-\d{8}-\d{9}\.db$/.test(marker.backup)) throw new Error("Marqueur de restauration invalide");
  const source = path.join(config.dataDir, "backups", marker.backup);
  const database = path.join(config.dataDir, "flixtunes.db");
  const safety = path.join(config.dataDir, `flixtunes-before-restore-${Date.now()}.db`);
  try { await rename(database, safety); } catch { /* Première restauration ou base absente. */ }
  await copyFile(source, database);
  await Promise.all([rm(`${database}-wal`, { force: true }), rm(`${database}-shm`, { force: true }), rm(restoreMarkerPath, { force: true })]);
}
