import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Une correspondance corrigée à la main doit produire un effet **visible**.
 *
 * Les tests de `correction-persistence.test.ts` prouvent qu'une correction survit à un nouveau scan.
 * Ils ne prouvent pas qu'elle s'applique : ils passent un titre à `applyCorrection`, qui l'écrit
 * lui-même. Le bouton « Corriger la correspondance » de l'interface, lui, n'envoie pas de titre — il
 * épingle un identifiant TMDB et compte sur l'analyse pour aller chercher la fiche.
 *
 * D'où ce fichier : il rejoue le geste réel de l'utilisateur, celui qui ne donnait rien.
 */

/**
 * Fournisseur de métadonnées simulé.
 *
 * Il rend la fiche de l'identifiant épinglé, comme le ferait TMDB. Sans cette simulation, le test
 * dépendrait du réseau et d'une clé d'API : il ne prouverait plus rien de fiable.
 */
vi.mock("./metadata-providers.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./metadata-providers.js")>();
  return {
    ...original,
    fetchMetadataWithProviders: vi.fn(async (parsed: { kind: string }, _langue: string,
      forced?: { provider: string; id: string }) => {
      if (!forced) return null;
      const fiche = {
        provider: forced.provider as "tmdb", externalId: forced.id, imdbId: null,
        title: "C'est arrivé près de chez vous", originalTitle: null,
        overview: "La fiche réellement choisie par l'utilisateur.", year: 1992, originalLanguage: "fr",
        runtimeSeconds: 5_400, posterSourceUrl: "https://exemple.invalid/jaquette.jpg",
        backdropSourceUrl: null, language: "fr-FR", confidence: 1,
      };
      return parsed.kind === "movie" ? { movie: fiche } : { show: fiche };
    }),
  };
});

const { db } = await import("./database.js");
const { scanLibraryById } = await import("./scanner.js");

const racines: string[] = [];
const bibliothèques: string[] = [];

afterAll(async () => {
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
  for (const libraryId of bibliothèques) {
    // `media_items.library_id` est en `ON DELETE SET NULL` : sans cette suppression, les médias
    // survivraient en orphelins et fausseraient les comptages des autres fichiers de test.
    db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  }
});

/** Une bibliothèque d'un film, analysée une première fois. */
async function bibliothèqueAnalysée(): Promise<{ libraryId: string; catalogId: string }> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-correction-")); racines.push(racine);
  const films = path.join(racine, "Films");
  await mkdir(films, { recursive: true });
  await writeFile(path.join(films, "C.est.arrive.pres.de.chez.vous.1992.mkv"), "fixture");
  const libraryId = randomUUID();
  db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Correction', ?, 'movie', 'fr-FR')")
    .run(libraryId, films);
  bibliothèques.push(libraryId);
  await scanLibraryById(libraryId, { mode: "files" });
  const ligne = db.prepare("SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'movie'")
    .get(libraryId) as { id: string };
  return { libraryId, catalogId: ligne.id };
}

/**
 * Le geste exact de la route `/api/catalog/:id/match` : épingler un identifiant, rien de plus.
 *
 * Aucun titre n'est fourni — c'est tout l'intérêt de la correction : l'utilisateur désigne la bonne
 * fiche, et l'application va chercher son contenu.
 */
function corrigerDepuisInterface(catalogId: string, externalId: string): void {
  db.prepare(`UPDATE catalog_items SET external_provider = 'tmdb', external_id = ?, match_status = 'manual',
    metadata_locked = 1, match_confidence = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(externalId, catalogId);
}

describe("une correction manuelle s'applique", () => {
  it("va chercher le titre et le résumé de la fiche choisie", async () => {
    const { libraryId, catalogId } = await bibliothèqueAnalysée();
    db.prepare("UPDATE catalog_items SET title = 'Julien Courbet', year = 2007 WHERE id = ?").run(catalogId);

    corrigerDepuisInterface(catalogId, "82384");
    await scanLibraryById(libraryId, { mode: "metadata" });

    const après = db.prepare("SELECT title, year, overview FROM catalog_items WHERE id = ?")
      .get(catalogId) as { title: string; year: number | null; overview: string | null };
    expect(après.title).toBe("C'est arrivé près de chez vous");
    expect(après.year).toBe(1992);
    expect(après.overview).toContain("réellement choisie");
  });

  it("garde la correction et son statut après l'avoir appliquée", async () => {
    // Appliquer ne doit pas déverrouiller : la fiche reste celle qu'on a choisie, et un scan
    // ultérieur ne doit pas pouvoir la reprendre pour une autre.
    const { libraryId, catalogId } = await bibliothèqueAnalysée();
    corrigerDepuisInterface(catalogId, "82384");
    await scanLibraryById(libraryId, { mode: "metadata" });

    const après = db.prepare(`SELECT external_id, match_status, metadata_locked, match_confidence
      FROM catalog_items WHERE id = ?`).get(catalogId) as {
        external_id: string; match_status: string; metadata_locked: number; match_confidence: number | null;
      };
    expect(après).toMatchObject({
      external_id: "82384", match_status: "manual", metadata_locked: 1, match_confidence: 1,
    });
  });

  it("ne reprend qu'une fiche, sans faire passer les autres pour disparues", async () => {
    // Danger propre à l'analyse ciblée : elle ne relève qu'un fichier. Si la suite du scan en tirait
    // les conclusions habituelles, tous les autres seraient absents de la liste des fichiers vus et
    // donc déclarés supprimés — une bibliothèque entière effacée par une simple correction, sans
    // qu'aucune erreur ne soit levée.
    const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-ciblee-")); racines.push(racine);
    const films = path.join(racine, "Films");
    await mkdir(films, { recursive: true });
    for (const nom of ["Premier.Film.2001.mkv", "Deuxieme.Film.2002.mkv", "Troisieme.Film.2003.mkv"]) {
      await writeFile(path.join(films, nom), "fixture");
    }
    const libraryId = randomUUID();
    db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Ciblée', ?, 'movie', 'fr-FR')")
      .run(libraryId, films);
    bibliothèques.push(libraryId);
    await scanLibraryById(libraryId, { mode: "files" });

    const cible = db.prepare(`SELECT id FROM catalog_items WHERE library_id = ? AND title LIKE 'Deuxieme%'`)
      .get(libraryId) as { id: string };
    corrigerDepuisInterface(cible.id, "555");
    await scanLibraryById(libraryId, { mode: "metadata", onlyCatalogId: cible.id });

    const disponibles = db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE library_id = ? AND available = 1")
      .get(libraryId) as { n: number };
    expect(disponibles.n, "les trois fichiers restent disponibles").toBe(3);

    // Et la fiche visée, elle, a bien été reprise.
    const corrigée = db.prepare("SELECT title FROM catalog_items WHERE id = ?").get(cible.id) as { title: string };
    expect(corrigée.title).toBe("C'est arrivé près de chez vous");

    // Les voisines n'ont pas été retouchées : c'est tout l'intérêt d'une reprise ciblée.
    const voisine = db.prepare(`SELECT title FROM catalog_items WHERE library_id = ? AND title LIKE 'Premier%'`)
      .get(libraryId) as { title: string } | undefined;
    expect(voisine?.title).toBeDefined();
  });

  it("refuse toujours une fiche qui ne vient pas de la correspondance choisie", async () => {
    // La garde d'origine avait une raison d'être : un rescan ne doit pas réécrire par-dessus le
    // travail de l'utilisateur. Ce qui change, c'est qu'elle ne s'applique plus à la fiche épinglée
    // elle-même — seulement à ce qui vient d'ailleurs.
    const { libraryId, catalogId } = await bibliothèqueAnalysée();
    corrigerDepuisInterface(catalogId, "82384");
    db.prepare("UPDATE catalog_items SET title = 'Titre choisi à la main' WHERE id = ?").run(catalogId);

    // Un scan de fichiers sans fournisseur : les métadonnées viennent du nom de fichier, donc
    // d'aucune correspondance TMDB. Le verrou doit tenir.
    await scanLibraryById(libraryId, { mode: "files" });

    const après = db.prepare("SELECT title, external_id FROM catalog_items WHERE id = ?")
      .get(catalogId) as { title: string; external_id: string };
    expect(après.title).toBe("Titre choisi à la main");
    expect(après.external_id).toBe("82384");
  });
});

describe("langue de tournage", () => {
  it("conserve la langue d'origine rendue par le fournisseur", async () => {
    // Elle est la seule façon d'honorer la préférence audio « langue originale » : sur un fichier
    // multilingue, rien ne distingue la piste japonaise d'origine d'un doublage japonais. TMDB la
    // donnait déjà — elle servait à choisir les affiches, puis était jetée.
    const { libraryId, catalogId } = await bibliothèqueAnalysée();
    corrigerDepuisInterface(catalogId, "82384");
    await scanLibraryById(libraryId, { mode: "metadata", onlyCatalogId: catalogId });

    const ligne = db.prepare("SELECT original_language FROM catalog_items WHERE id = ?")
      .get(catalogId) as { original_language: string | null };
    expect(ligne.original_language).toBe("fr");
  });
});
