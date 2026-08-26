import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { retenirIntroduction } from "./marqueurs-memoire.js";
import { getPlaybackInfo } from "./playback.js";

/**
 * Ce que le lecteur accepte de servir comme repère d'introduction.
 *
 * La passe de repérage recopie en base l'introduction que les chapitres d'un fichier désignent — non
 * pour le lecteur, qui relit ces chapitres lui-même, mais pour que la file d'attente sache que
 * l'épisode est réglé. Cette copie ne doit donc jamais ressortir : si le fichier a ses chapitres, ils
 * ont déjà répondu ; s'il ne les a plus, la copie est périmée par définition.
 */
const racines: string[] = [];
const poses: string[] = [];
afterAll(async () => {
  for (const id of poses) {
    db.prepare("DELETE FROM marqueurs_generique WHERE media_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  }
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
});

async function poserEpisode(): Promise<string> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-marqueurs-"));
  racines.push(racine);
  const fichier = path.join(racine, "S01E01.mkv");
  await writeFile(fichier, "");
  const id = randomUUID();
  poses.push(id);
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, show_title, season_number,
      episode_number, file_path, runtime_seconds, available)
    VALUES (?, 'episode', 'E1', 'e1', 'Série lecteur', 1, 1, ?, 1500, 1)`).run(id, fichier);
  return id;
}

describe("repères servis au lecteur", () => {
  it("ne sert pas une copie de provenance « chapitre »", async () => {
    // Le fichier n'a aucun chapitre lisible : la copie en base est donc périmée, et proposerait un
    // saut vers un endroit qui n'existe plus.
    const id = await poserEpisode();
    retenirIntroduction(id, 30, 110, "chapitre");

    const info = await getPlaybackInfo(id);

    expect(info?.intro, "la copie reste dans la file, pas dans le lecteur").toBeNull();
  });

  it("sert en revanche ce que l'empreinte sonore a trouvé", async () => {
    const id = await poserEpisode();
    retenirIntroduction(id, 12.5, 102.5, "empreinte");

    const info = await getPlaybackInfo(id);

    expect(info?.intro).toEqual({ startSeconds: 12.5, endSeconds: 102.5 });
  });
});
