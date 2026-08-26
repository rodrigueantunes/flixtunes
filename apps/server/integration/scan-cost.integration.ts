import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "../src/database.js";
import { scanLibraryById } from "../src/scanner.js";

/**
 * Coût d'une analyse répétée — étape 54, second volet.
 *
 * Sur une médiathèque déjà analysée, la quasi-totalité des fichiers n'a pas bougé : l'analyse se
 * contente de les remarquer disponibles. Ce banc mesure ce que coûte ce passage à vide.
 *
 * Il a d'abord été écrit pour comparer une transaction par fichier à des lots de deux cents. Deux
 * enseignements, tous deux conservés ici parce qu'ils coûtent cher à réapprendre :
 *
 * 1. La première version chronométrait ffmpeg, pas les transactions : sur des fichiers factices,
 *    aucune affiche ne peut être générée, et l'extraction était retentée à chaque analyse. Les fiches
 *    reçoivent donc une affiche avant la mesure, comme dans une médiathèque réelle.
 * 2. Les écarts observés entre configurations suivaient l'ordre des passages, pas la configuration :
 *    ils sont restés identiques une fois le paramètre rendu inerte. D'où cette forme — une seule
 *    configuration, répétée, avec sa dispersion — qui rend visible le bruit au lieu de le déguiser
 *    en résultat.
 *
 *   pnpm --filter @flixtunes/server test:scan-cost [nombre de fichiers] [passages]
 */

const fileCount = Number(process.argv[2] ?? 400);
const runCount = Number(process.argv[3] ?? 6);
const libraryId = randomUUID();

async function seed(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-scan-cost-"));
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Banc analyse', ?, 'movie', 'fr-FR')")
    .run(libraryId, root);
  await Promise.all(Array.from({ length: fileCount }, (_, index) =>
    writeFile(path.join(root, `Film synthétique ${String(index).padStart(4, "0")} (2020).mkv`), `contenu ${index}`)));
  return root;
}

let root = "";
try {
  root = await seed();
  console.log(`Bibliothèque synthétique : ${fileCount} fichiers, ${runCount} passages mesurés.\n`);
  await scanLibraryById(libraryId, { stabilityDelayMs: 1 });
  db.prepare(`UPDATE catalog_items SET poster_url = '/api/artwork/banc-poster',
    backdrop_url = '/api/artwork/banc-backdrop' WHERE library_id = ?`).run(libraryId);
  await scanLibraryById(libraryId, { stabilityDelayMs: 1 }); // chauffe, hors mesure

  const durations: number[] = [];
  for (let run = 0; run < runCount; run += 1) {
    const start = performance.now();
    await scanLibraryById(libraryId, { stabilityDelayMs: 1 });
    durations.push(performance.now() - start);
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(`passages   : ${durations.map((value) => value.toFixed(0)).join(", ")} ms`);
  console.log(`médiane    : ${median.toFixed(0)} ms  (${(median / fileCount).toFixed(2)} ms par fichier)`);
  console.log(`dispersion : ${sorted[0]!.toFixed(0)} à ${sorted.at(-1)!.toFixed(0)} ms `
    + `(±${(((sorted.at(-1)! - sorted[0]!) / median) * 100).toFixed(0)} % autour de la médiane)`);
  console.log("\nUn écart inférieur à cette dispersion ne prouve rien.");
} finally {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM scan_skips WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM media_items WHERE library_id IS NULL").run();
  db.prepare("DELETE FROM catalog_items WHERE library_id IS NULL").run();
  if (root) await rm(root, { recursive: true, force: true });
}
