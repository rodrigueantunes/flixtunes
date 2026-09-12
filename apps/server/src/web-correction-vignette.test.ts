import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { appliquerCorrespondanceWeb, type OutilsDeCorrection } from "./web-correspondances.js";
import type { IdentiteWeb } from "./web-identite.js";

/**
 * Corriger une vidéo à la main affiche **sa** vignette.
 *
 * Relevé sur une installation réelle le 12 septembre 2026 : une vidéo corrigée avec son lien YouTube
 * recevait bien sa date, et sa nouvelle vignette était téléchargée et posée sur la fiche — mais l'écran
 * gardait l'ancienne, celle de la vidéo qu'on venait de déclarer fausse. La correction écrivait la date
 * sur le média et la vignette sur la fiche seulement ; le client lit le média.
 *
 * Le réseau est remplacé par des outils de test : ce qui est surveillé ici, ce sont les écritures.
 */
const bibliothequeId = randomUUID();
const chaineId = randomUUID();
const palierId = randomUUID();
const videoId = randomUUID();

const identite: IdentiteWeb = {
  titre: "Prank (exclu membres) : Amour toujours", chaine: "Greg Guillotin", plateforme: "youtube",
  identifiant: "rxMNyQW_eWY", url: "https://www.youtube.com/watch?v=rxMNyQW_eWY", publieeLe: "2026-05-07",
  annee: 2026, description: null, dureeSecondes: null,
  vignette: "https://i.ytimg.com/vi/rxMNyQW_eWY/maxresdefault.jpg", playlist: null,
};

function poser(): void {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeId, `D:/${bibliothequeId}`);
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, poster_url)
    VALUES (?, ?, 'show', 'Greg Guillotin', 'greg', 'greg', '/api/artwork/avatar-chaine')`).run(chaineId, bibliothequeId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title)
    VALUES (?, ?, ?, 'season', 'Pranks', '0001', 'pranks')`).run(palierId, bibliothequeId, chaineId);
  // L'état constaté : la fiche et le média portent la vignette de la correspondance fausse.
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, poster_url)
    VALUES (?, ?, ?, 'episode', 'Amour toujours', '0001', 'amour', '/api/artwork/ancienne-vignette')`)
    .run(videoId, bibliothequeId, palierId);
  db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, poster_url, available)
    VALUES (?, ?, 'video', 'Amour toujours', 'amour', 'amour', ?, ?, '/api/artwork/ancienne-vignette', 1)`)
    .run(randomUUID(), videoId, `D:/${bibliothequeId}/YouTube/Greg Guillotin/Pranks/Amour toujours.mp4`, bibliothequeId);
}

afterEach(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(bibliothequeId);
});

const media = () => db.prepare("SELECT poster_url, air_date FROM media_items WHERE catalog_id = ?")
  .get(videoId) as { poster_url: string | null; air_date: string | null };
const fiche = () => db.prepare("SELECT poster_url, external_id, match_status FROM catalog_items WHERE id = ?")
  .get(videoId) as { poster_url: string | null; external_id: string | null; match_status: string };

describe("corriger une vidéo avec son lien YouTube", () => {
  it("affiche la vignette de la vidéo choisie, pas l'ancienne", async () => {
    poser();
    const outils: OutilsDeCorrection = {
      resoudre: async () => identite,
      telecharger: async () => "/api/artwork/nouvelle-vignette",
    };

    const resultat = await appliquerCorrespondanceWeb(videoId, "rxMNyQW_eWY", "fr-FR", outils);

    expect(resultat.applique).toBe(true);
    expect(media().poster_url, "l'écran lit le média").toBe("/api/artwork/nouvelle-vignette");
    expect(fiche().poster_url).toBe("/api/artwork/nouvelle-vignette");
    expect(media().air_date).toBe("2026-05-07");
    expect(fiche().external_id).toBe("rxMNyQW_eWY");
    expect(fiche().match_status).toBe("manual");
  });

  it("accepte l'adresse telle qu'on la copie depuis le navigateur", async () => {
    poser();
    const demandes: string[] = [];
    const outils: OutilsDeCorrection = {
      resoudre: async (identifiant) => { demandes.push(identifiant); return identite; },
      telecharger: async () => "/api/artwork/nouvelle-vignette",
    };

    await appliquerCorrespondanceWeb(videoId, "https://www.youtube.com/watch?v=rxMNyQW_eWY", "fr-FR", outils);

    expect(demandes).toEqual(["rxMNyQW_eWY"]);
    expect(media().poster_url).toBe("/api/artwork/nouvelle-vignette");
  });

  it("dit quand la vignette n'a pas pu être téléchargée, au lieu de l'avaler", async () => {
    // La correction a pris — date et identifiant sont retenus —, mais l'écran montrerait encore
    // l'ancienne image sans que rien n'explique pourquoi. Le message le dit, et l'image affichée
    // n'est pas remplacée par un vide.
    poser();
    const outils: OutilsDeCorrection = {
      resoudre: async () => identite,
      telecharger: async () => { throw new Error("Téléchargement de jaquette impossible (403)"); },
    };

    const resultat = await appliquerCorrespondanceWeb(videoId, "rxMNyQW_eWY", "fr-FR", outils);

    expect(resultat.applique).toBe(true);
    expect(resultat.message).toMatch(/vignette n'a pas pu être téléchargée/);
    expect(media().air_date).toBe("2026-05-07");
    expect(media().poster_url).toBe("/api/artwork/ancienne-vignette");
  });
});
