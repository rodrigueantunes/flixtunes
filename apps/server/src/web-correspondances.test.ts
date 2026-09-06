import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { candidatsPourFicheWeb, listerCorrespondancesWeb } from "./web-correspondances.js";
import { noterCorrespondanceWeb } from "./web-analyse.js";
import { quotaDuJour } from "./web-fournisseurs.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import type { IdentiteWeb } from "./web-identite.js";

/**
 * Corriger une correspondance web sans toucher au catalogue.
 *
 * Ce fichier surveille une frontière plus qu'une fonction. Le centre de correspondances du catalogue
 * est plafonné à 250 lignes triées par confiance croissante ; une bibliothèque web y ferait entrer
 * des milliers de vidéos et en chasserait les films. Relevé sur une médiathèque réelle : 1 555
 * épisodes portent déjà le statut `unmatched`, et 6 589 sont résolus.
 *
 * Ces cas vérifient donc que rien ne traverse : aucun film ni aucune série dans la liste web, et une
 * vidéo dont la chaîne est inconnue n'a **aucun** candidat plutôt qu'un candidat pris au hasard.
 */
const bibliothequeWeb = randomUUID();
const bibliothequeFilms = randomUUID();
const chaineId = randomUUID();
const videoId = randomUUID();
const videoSansChaine = randomUUID();
const filmId = randomUUID();
const marque = bibliothequeWeb.slice(0, 8);

const identite = (extra: Partial<IdentiteWeb> = {}): IdentiteWeb => ({
  titre: null, chaine: null, plateforme: null, identifiant: null, url: null,
  publieeLe: null, annee: null, description: null, dureeSecondes: null, vignette: null, playlist: null,
  ...extra,
});

function poser(): void {
  // Une cle d'essai, pour que les cas eprouvent le vrai chemin : sans elle, l'empechement annonce est
  // « aucune cle », ce qui est juste mais masque tout ce qui vient apres.
  saveProviderConfiguration({ youtubeApiKey: "cle-d-essai-web" });
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeWeb, `D:/${bibliothequeWeb}`);
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(bibliothequeFilms, `D:/${bibliothequeFilms}`);

  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, external_id, external_provider)
    VALUES (?, ?, 'show', ?, 'chaine', 'chaine', 'UC-connue', 'youtube')`)
    .run(chaineId, bibliothequeWeb, `Chaine ${marque}`);
  const palierId = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, season_number)
    VALUES (?, ?, ?, 'season', 'Documentaires', '0001', 'documentaires', 1)`)
    .run(palierId, bibliothequeWeb, chaineId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title)
    VALUES (?, ?, ?, 'episode', ?, '0001', 'video')`)
    .run(videoId, bibliothequeWeb, palierId, `Video ${marque}`);

  // Une chaine sans identifiant, et sa video : c'est le cas ou l'on ne doit rien proposer.
  const orpheline = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title)
    VALUES (?, ?, 'show', 'Chaine inconnue', 'chaine inconnue', 'chaine inconnue')`)
    .run(orpheline, bibliothequeWeb);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title)
    VALUES (?, ?, ?, 'episode', 'Video orpheline', '0002', 'video orpheline')`)
    .run(videoSansChaine, bibliothequeWeb, orpheline);

  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title)
    VALUES (?, ?, 'movie', ?, 'film', 'film')`).run(filmId, bibliothequeFilms, `Film ${marque}`);
}

afterEach(() => {
  saveProviderConfiguration({ youtubeApiKey: null });
  db.prepare("DELETE FROM server_settings WHERE key = 'web_quota_youtube'").run();
  for (const id of [bibliothequeWeb, bibliothequeFilms]) {
    db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  }
});

describe("liste des correspondances web", () => {
  it("ne montre que des fiches web, jamais un film ni une série", () => {
    // La frontiere est le sujet de ce fichier : les deux mondes ne se croisent nulle part.
    poser();
    const titres = listerCorrespondancesWeb({ libraryId: bibliothequeWeb }).map((ligne) => ligne.titre);
    expect(titres).toContain(`Chaine ${marque}`);
    expect(titres.some((titre) => titre.startsWith("Film"))).toBe(false);
  });

  it("écarte ce qui est déjà résolu, et le retrouve sur demande", () => {
    // L'usage courant est de reparer ce qui manque ; retrouver une fiche deja appariee sert a la
    // corriger quand meme, ce que « modifier la correspondance manuellement » suppose.
    poser();
    noterCorrespondanceWeb(videoId, identite({ identifiant: "dQw4w9WgXcQ" }));

    const aTraiter = listerCorrespondancesWeb({ libraryId: bibliothequeWeb }).map((l) => l.id);
    expect(aTraiter).not.toContain(videoId);

    const toutes = listerCorrespondancesWeb({ libraryId: bibliothequeWeb, toutes: true }).map((l) => l.id);
    expect(toutes).toContain(videoId);
  });

  it("nomme les choses comme l'écran les nomme", () => {
    // « chaine » et « video », pas « show » et « episode » : le type interne du catalogue est un
    // detail de stockage, et l'ecran n'a pas a le reciter.
    poser();
    const lignes = listerCorrespondancesWeb({ libraryId: bibliothequeWeb, toutes: true });
    expect(lignes.find((l) => l.id === chaineId)?.genre).toBe("chaine");
    expect(lignes.find((l) => l.id === videoId)?.genre).toBe("video");
    expect(lignes.find((l) => l.id === videoId)?.chaine).toBe(`Chaine ${marque}`);
  });

  it("rattache chaque ligne à la fiche de sa chaîne", () => {
    /*
     * L'ecran ne montre que les videos de la chaine choisie, et c'est ce champ qui le lui permet.
     *
     * Rapprocher sur le **nom** aurait suffi tant que deux chaines ne portent pas le meme, ce que
     * rien ne garantit : deux plateformes peuvent heberger « Actualites », et les deux dossiers
     * coexistent sous la meme bibliotheque. La fiche, elle, est unique.
     */
    poser();
    const lignes = listerCorrespondancesWeb({ libraryId: bibliothequeWeb, toutes: true });
    expect(lignes.find((l) => l.id === chaineId)?.chaineId).toBe(chaineId);
    expect(lignes.find((l) => l.id === videoId)?.chaineId).toBe(chaineId);
    // Une video posee a la racine d'une chaine n'a pas de palier : elle doit quand meme se rattacher.
    expect(lignes.find((l) => l.id === videoSansChaine)?.chaineId).not.toBe(chaineId);
  });
});

describe("statut d'une fiche web", () => {
  it("déclare résolue une vidéo dont on connaît l'identifiant", () => {
    /*
     * Sans cette ecriture, `match_status` reste a `unmatched` par defaut et **toutes** les videos se
     * declarent douteuses — 6 589 correctement identifiees comprises sur une mediatheque reelle.
     * Un ecran de correction qui liste tout n'apprend plus rien.
     */
    poser();
    noterCorrespondanceWeb(videoId, identite({ identifiant: "dQw4w9WgXcQ" }));
    const statut = (db.prepare("SELECT match_status FROM catalog_items WHERE id = ?").get(videoId) as
      unknown as { match_status: string }).match_status;
    expect(statut).toBe("automatic");
  });

  it("laisse à traiter une vidéo qu'on n'a pas su identifier", () => {
    poser();
    noterCorrespondanceWeb(videoId, identite({ titre: "Un titre lu dans le nom de fichier" }));
    expect(listerCorrespondancesWeb({ libraryId: bibliothequeWeb }).map((l) => l.id)).toContain(videoId);
  });

  it("ne défait jamais une correction manuelle", () => {
    // Un verrou est une intention exprimee : une analyse ne le retourne pas.
    poser();
    db.prepare("UPDATE catalog_items SET match_status = 'manual', metadata_locked = 1 WHERE id = ?").run(videoId);
    noterCorrespondanceWeb(videoId, identite());
    const statut = (db.prepare("SELECT match_status FROM catalog_items WHERE id = ?").get(videoId) as
      unknown as { match_status: string }).match_status;
    expect(statut).toBe("manual");
  });
});

describe("candidats proposés", () => {
  it("dit qu'aucune clé n'est enregistrée plutôt que « rien trouvé »", async () => {
    // Sans cle, aucune recherche ne peut partir : le dire evite de chercher un defaut ailleurs.
    poser();
    saveProviderConfiguration({ youtubeApiKey: null });
    const { motif } = await candidatsPourFicheWeb(chaineId);
    expect(motif).toMatch(/Aucune clé YouTube/);
  });

  it("ne propose rien pour une vidéo dont la chaîne est inconnue", async () => {
    // Chercher sans chaine identifiee rendrait la video d'un autre au titre voisin — et couterait
    // cent unites de quota pour ce faux resultat. L'ecran doit le dire, pas deviner.
    poser();
    const { candidats, motif } = await candidatsPourFicheWeb(videoSansChaine);
    expect(candidats).toHaveLength(0);
    expect(motif).toMatch(/chaîne n'est pas encore identifiée/);
  });

  it("dit que le budget est épuisé plutôt que « rien trouvé »", async () => {
    /*
     * Le pire message est celui qui envoie chercher le défaut ailleurs.
     *
     * Constaté a l'ecran : « Aucune chaîne trouvée pour ce nom » devant une chaîne de quatre millions
     * d'abonnés, alors qu'il restait 99 unités de quota et qu'une recherche en coûte 100. La chaîne
     * existait, la clé fonctionnait, la requête était juste — seul le budget manquait.
     */
    poser();
    const etat = quotaDuJour();
    db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run("web_quota_youtube", JSON.stringify({ date: etat.date, depense: etat.plafond - 1 }));

    const { candidats, motif } = await candidatsPourFicheWeb(chaineId);

    expect(candidats).toHaveLength(0);
    expect(motif).toMatch(/Budget YouTube épuisé/);
    expect(motif).not.toMatch(/Aucune chaîne trouvée/);
  });

  it("refuse une fiche qui n'existe pas", async () => {
    const { candidats, motif } = await candidatsPourFicheWeb(randomUUID());
    expect(candidats).toHaveLength(0);
    expect(motif).toBe("Fiche introuvable.");
  });
});
