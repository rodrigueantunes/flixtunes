import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import { scanLibraryById } from "./scanner.js";

/**
 * La vignette d'une vidéo web survit à une nouvelle analyse — sur un vrai dossier, par le vrai scanner.
 *
 * Relevé sur une installation réelle le 10 septembre 2026 : 95 vignettes téléchargées et posées sur
 * leur fiche, et **les 117 vidéos affichant l'avatar de leur chaîne**. Trois écritures remettaient
 * l'avatar sur le média, que le client lit :
 *
 * - l'enregistrement du média, qui suivait l'illustration et l'écrasait ;
 * - l'illustration, qui sautait une vidéo dont la fiche était déjà illustrée ;
 * - le rattrapage des fichiers inchangés, qui recopie l'affiche de la saison sur chaque épisode.
 *
 * Ces cas passent par `scanLibraryById`, parce que c'est l'**ordre** des écritures qui était en faute :
 * un test qui appellerait l'illustration seule le croirait correct.
 */
const racines: string[] = [];
const bibliotheques: string[] = [];

afterAll(async () => {
  for (const id of bibliotheques) {
    db.prepare("DELETE FROM web_recherches_vaines WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
});

beforeEach(() => {
  // Aucune clé : l'analyse ne doit rien pouvoir demander au réseau.
  saveProviderConfiguration({ youtubeApiKey: null });
});

/** Une bibliothèque web d'une vidéo, analysée une première fois. */
async function bibliothequeAnalysee(): Promise<{ id: string; fichier: string }> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-web-vignettes-"));
  racines.push(racine);
  const dossier = path.join(racine, "YouTube", "Greg Guillotin", "Pranks");
  await mkdir(dossier, { recursive: true });
  const fichier = path.join(dossier, "Une video.mp4");
  await writeFile(fichier, "fixture");

  const id = randomUUID();
  bibliotheques.push(id);
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Web', ?, 'web', 'fr-FR')")
    .run(id, racine);
  await scanLibraryById(id, { stabilityDelayMs: 1 });
  return { id, fichier };
}

/**
 * L'état constaté sur le NAS : la fiche de la vidéo porte sa vignette, la chaîne son avatar, et le
 * média — ce que le client affiche — l'avatar de la chaîne.
 */
function poserEtatConstate(fichier: string): string {
  const media = db.prepare("SELECT catalog_id FROM media_items WHERE file_path = ?").get(fichier) as
    { catalog_id: string } | undefined;
  if (!media) throw new Error("la première analyse n'a pas importé la vidéo");
  const palier = db.prepare("SELECT parent_id FROM catalog_items WHERE id = ?").get(media.catalog_id) as { parent_id: string };
  const chaine = db.prepare("SELECT parent_id FROM catalog_items WHERE id = ?").get(palier.parent_id) as { parent_id: string };
  db.prepare("UPDATE catalog_items SET poster_url = '/api/artwork/avatar-chaine' WHERE id IN (?, ?)")
    .run(chaine.parent_id, palier.parent_id);
  db.prepare("UPDATE catalog_items SET poster_url = '/api/artwork/vignette-propre' WHERE id = ?").run(media.catalog_id);
  db.prepare("UPDATE media_items SET poster_url = '/api/artwork/avatar-chaine' WHERE file_path = ?").run(fichier);
  return media.catalog_id;
}

const vignetteAffichee = (fichier: string) =>
  (db.prepare("SELECT poster_url FROM media_items WHERE file_path = ?").get(fichier) as { poster_url: string | null }).poster_url;

describe("la vignette d'une vidéo survit à une nouvelle analyse", () => {
  it("une analyse des fichiers ne remet pas l'avatar", async () => {
    // Fichier inchangé : c'est le rattrapage des images qui passe, pour chaque vidéo, à chaque analyse.
    const { id, fichier } = await bibliothequeAnalysee();
    poserEtatConstate(fichier);

    await scanLibraryById(id, { stabilityDelayMs: 1 });

    expect(vignetteAffichee(fichier)).toBe("/api/artwork/vignette-propre");
  });

  it("une actualisation des métadonnées ne remet pas l'avatar", async () => {
    // La passe que l'on relance quand « ça ne ramène pas les vignettes » : c'est elle qui écrasait.
    const { id, fichier } = await bibliothequeAnalysee();
    poserEtatConstate(fichier);

    await scanLibraryById(id, { mode: "metadata", stabilityDelayMs: 1 });

    expect(vignetteAffichee(fichier)).toBe("/api/artwork/vignette-propre");
  });
});
