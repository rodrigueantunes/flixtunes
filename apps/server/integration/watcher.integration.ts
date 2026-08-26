import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.env.FLIXTUNES_MDNS = "0"; process.env.FLIXTUNES_WATCH = "1"; process.env.FLIXTUNES_WATCH_POLLING = "1";
const [{ db, listLibraries }, { startRuntimeServices }] = await Promise.all([import("../src/database.js"), import("../src/runtime-services.js")]);
const directory = await mkdtemp(path.join(os.tmpdir(), "flixtunes-watch-")); const id = randomUUID();
db.prepare("INSERT INTO library_folders (id, name, path, kind, language, enabled) VALUES (?, 'Watcher QA', ?, 'movie', 'fr-FR', 1)").run(id, directory);
const logger = { info() {}, warn() {}, error() {}, fatal() {}, debug() {}, trace() {}, child() { return this; }, level: "silent", silent() {} } as never;
const runtime = startRuntimeServices(logger);
try {
  await new Promise((resolve) => setTimeout(resolve, 800));
  await writeFile(path.join(directory, "Watcher Film (2026).mkv"), "fixture");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const library = listLibraries().find((entry) => entry.id === id);
    if (library?.scan.status === "completed") { console.log(`Watcher OK: scan ${library.scan.status}`); process.exitCode = 0; break; }
  }
  if (listLibraries().find((entry) => entry.id === id)?.scan.status !== "completed") throw new Error("Le changement de dossier n'a pas déclenché de scan");
} finally {
  await runtime.close(); db.prepare("DELETE FROM library_folders WHERE id = ?").run(id); await rm(directory, { recursive: true, force: true });
}
