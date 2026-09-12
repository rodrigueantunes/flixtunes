import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import { scanLibraryById } from "./scanner.js";

/**
 * Ajouter l'identifiant YouTube au nom d'un fichier déjà analysé.
 *
 * C'est la façon de faire retenue le 12 septembre 2026 : `Titre [qbmeKsooC5s].mp4`, pour que la vidéo
 * soit résolue par son identifiant plutôt que cherchée par son titre. Mais renommer change le chemin,
 * et le scanner reconnaissait un média **par son chemin**. Le fichier renommé était donc vu comme une
 * vidéo nouvelle : l'ancienne ligne tenait encore son rang pendant l'analyse, la nouvelle était décalée
 * au rang suivant, et une seconde fiche naissait — avec la reprise de lecture restée sur l'ancienne.
 * Les deux premiers cas échouaient avant correction : 2 fiches au lieu d'une, et un média neuf.
 *
 * Ces cas passent par le vrai scanner, sur un vrai dossier. L'annexe `.info.json` tient lieu de
 * réponse de YouTube : même identifiant, même date, sans réseau.
 */
const racines: string[] = [];
const bibliotheques: string[] = [];
const profils: string[] = [];

afterAll(async () => {
  for (const id of bibliotheques) {
    db.prepare("DELETE FROM web_recherches_vaines WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  for (const id of profils) db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
});

beforeEach(() => {
  saveProviderConfiguration({ youtubeApiKey: null });
});

const ANNEXE = {
  id: "qbmeKsooC5s",
  title: "MAKING OF - Le Pire Projet #12 (dernier épisode) : on fait l'bilan !",
  upload_date: "20230302",
  channel: "Greg Guillotin",
  webpage_url: "https://www.youtube.com/watch?v=qbmeKsooC5s",
  extractor_key: "Youtube",
};

const annexeDe = (video: string) => video.replace(/\.mp4$/, ".info.json");

/** Une chaîne d'une vidéo, analysée une première fois — identifiée ou non selon qu'elle a son annexe. */
async function chaineAnalysee(identifiee = true): Promise<{ id: string; avant: string }> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-web-renommage-"));
  racines.push(racine);
  const dossier = path.join(racine, "YouTube", "Greg Guillotin", "Le Pire Projet");
  await mkdir(dossier, { recursive: true });
  const avant = path.join(dossier, "MAKING OF - Le Pire Projet #12 (dernier épisode) ： on fait l'bilan !.mp4");
  await writeFile(avant, "fixture");
  if (identifiee) await writeFile(annexeDe(avant), JSON.stringify(ANNEXE));

  const id = randomUUID();
  bibliotheques.push(id);
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Web', ?, 'web', 'fr-FR')")
    .run(id, racine);
  await scanLibraryById(id, { stabilityDelayMs: 1 });
  return { id, avant };
}

/** Renommer comme on le fait à la main : le fichier et son annexe, sans toucher au contenu. */
async function ajouterIdentifiant(avant: string, repondre = false): Promise<string> {
  const apres = avant.replace(/\.mp4$/, " [qbmeKsooC5s].mp4");
  await rename(avant, apres);
  await rename(annexeDe(avant), annexeDe(apres)).catch(() => undefined);
  // Pour une vidéo jamais identifiée, l'annexe posée après le renommage tient lieu de la réponse que
  // YouTube donnerait au code : c'est ce qui prouve que la vidéo a bien été analysée de nouveau.
  if (repondre) await writeFile(annexeDe(apres), JSON.stringify(ANNEXE));
  return apres;
}

const mediasDisponibles = (bibliotheque: string) => db.prepare(
  "SELECT id, file_path, catalog_id, air_date FROM media_items WHERE library_id = ? AND available = 1",
).all(bibliotheque) as Array<{ id: string; file_path: string; catalog_id: string; air_date: string | null }>;

const episodes = (bibliotheque: string) => (db.prepare(
  "SELECT COUNT(*) AS n FROM catalog_items WHERE library_id = ? AND kind = 'episode'",
).get(bibliotheque) as { n: number }).n;

describe("renommer une vidéo pour y ajouter son identifiant", () => {
  it("ne crée pas de doublon", async () => {
    const { id, avant } = await chaineAnalysee();
    expect(mediasDisponibles(id)).toHaveLength(1);
    expect(episodes(id)).toBe(1);

    const apres = await ajouterIdentifiant(avant);
    await scanLibraryById(id, { stabilityDelayMs: 1 });

    expect(mediasDisponibles(id), "une seule vidéo disponible").toHaveLength(1);
    expect(mediasDisponibles(id)[0]?.file_path).toBe(apres);
    expect(episodes(id), "une seule fiche").toBe(1);
  });

  it("garde la reprise de lecture et la fiche", async () => {
    // La reprise est rattachée au média : un média recréé la perdait, et la vidéo repartait du début.
    const { id, avant } = await chaineAnalysee();
    const [media] = mediasDisponibles(id);
    const profil = randomUUID();
    profils.push(profil);
    db.prepare("INSERT INTO profiles (id, name, avatar_color) VALUES (?, 'Rodrigue', '#2968ff')").run(profil);
    db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed)
      VALUES (?, ?, 600, 1200, 0)`).run(profil, media!.id);

    await ajouterIdentifiant(avant);
    await scanLibraryById(id, { stabilityDelayMs: 1 });

    const [apres] = mediasDisponibles(id);
    expect(apres?.id, "le même média, pas un nouveau").toBe(media!.id);
    expect(apres?.catalog_id, "la même fiche").toBe(media!.catalog_id);
    const reprise = db.prepare("SELECT position_seconds FROM playback_progress WHERE profile_id = ? AND media_id = ?")
      .get(profil, media!.id) as { position_seconds: number } | undefined;
    expect(reprise?.position_seconds).toBe(600);
  });

  it("analyse de nouveau une vidéo jamais identifiée à laquelle on ajoute son code", async () => {
    /*
     * C'est le cas qui motive la convention : une vidéo restée sans correspondance, qu'on répare en
     * écrivant son code dans le nom. Reconnue comme renommée, elle serait sinon sautée comme
     * « inchangée » — même taille, même date — et son code ne serait jamais lu.
     */
    const { id, avant } = await chaineAnalysee(false);
    const [media] = mediasDisponibles(id);
    expect(media?.air_date, "aucune date avant").toBeNull();

    await ajouterIdentifiant(avant, true);
    await scanLibraryById(id, { stabilityDelayMs: 1 });

    const [apres] = mediasDisponibles(id);
    expect(apres?.id, "le même média").toBe(media!.id);
    expect(episodes(id), "une seule fiche").toBe(1);
    expect(apres?.air_date, "la date arrive avec le code").toBe("2023-03-02");
    const fiche = db.prepare("SELECT external_id FROM catalog_items WHERE id = ?").get(apres!.catalog_id) as
      { external_id: string | null };
    expect(fiche.external_id).toBe("qbmeKsooC5s");
  });

  it("ne prend pas le média d'une vidéo toujours présente sur le disque", async () => {
    /*
     * Le garde-fou qui rend la reconnaissance sûre.
     *
     * Deux fichiers de même taille et de même date ne sont pas le même fichier tant que le premier est
     * encore là : une copie, ou deux exports identiques. Reprendre le média du premier pour le second
     * attribuerait sa fiche et sa reprise de lecture à la mauvaise vidéo — sans aucune erreur.
     */
    const { id, avant } = await chaineAnalysee();
    const [premier] = mediasDisponibles(id);

    const second = avant.replace("#12 (dernier épisode)", "#11");
    await writeFile(second, "fixture");
    const date = (await stat(avant)).mtime;
    await utimes(second, date, date);
    await writeFile(annexeDe(second), JSON.stringify({ ...ANNEXE, id: "sBXCZRkvvPo", title: "Le Pire Projet #11", upload_date: "20230223" }));

    await scanLibraryById(id, { stabilityDelayMs: 1 });

    const medias = mediasDisponibles(id);
    expect(medias, "deux vidéos distinctes").toHaveLength(2);
    expect(medias.find((media) => media.file_path === avant)?.id, "le premier garde son média").toBe(premier!.id);
    expect(medias.find((media) => media.file_path === second)?.id, "le second a le sien").not.toBe(premier!.id);
  });
});
