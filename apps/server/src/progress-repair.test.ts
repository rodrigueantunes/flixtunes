import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db, repairTranscodedProgress } from "./database.js";

const libraryId = randomUUID();
const profileId = randomUUID();

function seed(runtimeSeconds: number | null, position: number, duration: number, completed = 0): string {
  const mediaId = randomUUID();
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, library_id, runtime_seconds, available)
    VALUES (?, 'movie', ?, ?, ?, ?, 1)`).run(mediaId, mediaId, mediaId, libraryId, runtimeSeconds);
  db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed)
    VALUES (?, ?, ?, ?, ?)`).run(profileId, mediaId, position, duration, completed);
  return mediaId;
}

function read(mediaId: string) {
  return db.prepare("SELECT position_seconds, duration_seconds, completed FROM playback_progress WHERE media_id = ?")
    .get(mediaId) as { position_seconds: number; duration_seconds: number; completed: number };
}

db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Réparation', 'D:/x', 'movie', 'fr-FR')")
  .run(libraryId);
db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, 'Réparation', '#2968ff', 'fr-FR')")
  .run(profileId);

describe("réparation des progressions faussées par la durée transcodée", () => {
  afterEach(() => {
    db.prepare("DELETE FROM playback_progress WHERE profile_id = ?").run(profileId);
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  });

  // Le profil et la bibliothèque étaient créés sans jamais être supprimés : un profil abandonné par
  // exécution, jusqu'à saturer le plafond de douze et faire échouer, ailleurs, un test qui crée les
  // siens. La base est partagée par toute la suite — ce qu'un fichier y laisse, un autre le paie.
  afterAll(() => {
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  });

  it("rétablit la durée réelle et recalcule l'état terminé", () => {
    // 300 s de lecture enregistrées avec 12 s de flux encodé : la fiche affichait 100 % et « vu ».
    const media = seed(3600, 300, 12, 1);
    expect(repairTranscodedProgress()).toBe(1);
    expect(read(media)).toMatchObject({ position_seconds: 300, duration_seconds: 3600, completed: 0 });
  });

  it("conserve le statut terminé d'un média réellement vu jusqu'au bout", () => {
    const media = seed(3600, 3500, 40, 1);
    repairTranscodedProgress();
    expect(read(media)).toMatchObject({ duration_seconds: 3600, completed: 1 });
  });

  it("ne touche pas une progression déjà cohérente", () => {
    const media = seed(3600, 900, 3600, 0);
    expect(repairTranscodedProgress()).toBe(0);
    expect(read(media)).toMatchObject({ duration_seconds: 3600, completed: 0 });
  });

  it("préserve un média marqué vu à la main", () => {
    // « Marquer vu » enregistre la sentinelle position 1 / durée 1 : la réparation doit l'ignorer.
    const media = seed(3600, 1, 1, 1);
    expect(repairTranscodedProgress()).toBe(0);
    expect(read(media)).toMatchObject({ position_seconds: 1, duration_seconds: 1, completed: 1 });
  });

  it("ignore un média dont la durée réelle est inconnue", () => {
    const media = seed(null, 300, 12, 1);
    expect(repairTranscodedProgress()).toBe(0);
    expect(read(media)).toMatchObject({ duration_seconds: 12 });
  });

  it("est idempotente", () => {
    seed(3600, 300, 12, 1);
    expect(repairTranscodedProgress()).toBe(1);
    expect(repairTranscodedProgress()).toBe(0);
  });
});
