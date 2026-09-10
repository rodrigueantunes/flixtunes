import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LibraryFolder } from "@flixtunes/contracts";
import { db } from "./database.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import { analyserVideoWeb, chercherSansRepayer, DELAI_RECHERCHE_VAINE_JOURS, illustrerVideoWeb } from "./web-analyse.js";
import { lireCheminWeb, retablirCaracteresDeTelechargement } from "./web-chemins.js";
import type { IdentiteWeb } from "./web-identite.js";

/**
 * Fiabiliser le rayon Web avant de relancer une actualisation.
 *
 * Chaque cas de ce fichier reproduit un relevé fait sur une installation réelle, le 10 septembre 2026 :
 *
 * - **117 vidéos affichaient l'avatar de leur chaîne**, alors que 95 vraies vignettes étaient
 *   téléchargées et posées sur leur fiche ;
 * - **22 vidéos n'avaient ni date ni identifiant**, dont 14 portaient dans leur nom le `⧸` que yt-dlp
 *   écrit à la place de `/`. Le même titre rétabli trouvait la vidéo — vérifié sur l'API, trois
 *   recherches, 300 unités ;
 * - **chaque actualisation repayait 2 200 unités** pour chercher de nouveau ces mêmes 22 vidéos.
 */
const bibliothequeId = randomUUID();
const racine = `D:/${bibliothequeId}`;
const bibliotheque: LibraryFolder = {
  id: bibliothequeId, name: "Web", path: racine, kind: "web", resolvedKind: "web",
  language: "fr-FR", organizeSeasons: false, enabled: true, itemCount: 0,
  scan: { mode: "files", status: "idle", discovered: 0, imported: 0, enriched: 0, removed: 0,
    startedAt: null, finishedAt: null, error: null },
};

const trouvee = (identifiant: string): IdentiteWeb => ({
  titre: "Pranque : The Door / Hologram ghost prank", chaine: "Greg Guillotin", plateforme: "youtube",
  identifiant, url: null, publieeLe: "2016-05-30", annee: 2016, description: null, dureeSecondes: null,
  vignette: null, playlist: null,
});

beforeEach(() => {
  // Aucune clé : aucun cas de ce fichier ne doit pouvoir partir sur le réseau.
  saveProviderConfiguration({ youtubeApiKey: null });
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeId, racine);
});

afterEach(() => {
  db.prepare("DELETE FROM web_recherches_vaines WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(bibliothequeId);
});

describe("les caractères que le téléchargeur a remplacés", () => {
  it("rétablit la barre oblique et les deux-points", () => {
    expect(retablirCaracteresDeTelechargement("Pranque ： The Door ⧸ Hologram ghost prank"))
      .toBe("Pranque : The Door / Hologram ghost prank");
  });

  it("rétablit toute la table de yt-dlp", () => {
    expect(retablirCaracteresDeTelechargement("a⧸b⧹c：d＊e？f＂g＜h＞i｜j")).toBe("a/b\\c:d*e?f\"g<h>i|j");
  });

  it("ne touche à rien d'autre", () => {
    // Une apostrophe courbe, un tiret long, une esperluette et un emoji sont le titre, pas une
    // substitution : les changer inventerait un titre que personne n'a publié.
    const titre = "L’amour propre – Greg & Jack 😅 (canular) #3…";
    expect(retablirCaracteresDeTelechargement(titre)).toBe(titre);
  });

  it("donne à la vidéo le titre rétabli", () => {
    const lecture = lireCheminWeb(racine, `${racine}/YouTube/Greg Guillotin/Pranks/Pranque ： The Door ⧸ Hologram ghost prank.mp4`);
    expect(lecture.valide && lecture.chemin.titre).toBe("Pranque : The Door / Hologram ghost prank");
  });

  it("lit toujours l'identifiant entre crochets", () => {
    const lecture = lireCheminWeb(racine, `${racine}/YouTube/Greg Guillotin/Pranque ： The Door ⧸ Hologram [wnMwVGL8PvA].mp4`);
    expect(lecture.valide && lecture.chemin.identifiant).toBe("wnMwVGL8PvA");
    expect(lecture.valide && lecture.chemin.titre).toBe("Pranque : The Door / Hologram");
  });
});

describe("une recherche vaine ne se repaie pas", () => {
  const fichier = `${racine}/YouTube/Greg Guillotin/Clips/Rim'K - Air Max ft. Ninho (Clip Officiel).mp4`;
  const maintenant = Date.parse("2026-09-10T12:00:00Z");

  it("ne refait pas, pendant une semaine, la même recherche restée sans réponse", async () => {
    // Un clip d'un autre artiste rangé sous la chaîne : une recherche limitée à la chaîne ne le
    // trouvera jamais, et coûtait cent unités à chaque actualisation.
    let appels = 0;
    const chercher = async () => { appels += 1; return null; };

    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max", chercher, maintenant });
    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max", chercher,
      maintenant: maintenant + 86_400_000 });

    expect(appels).toBe(1);
  });

  it("la retente une fois le délai passé", async () => {
    let appels = 0;
    const chercher = async () => { appels += 1; return null; };

    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max", chercher, maintenant });
    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max", chercher,
      maintenant: maintenant + (DELAI_RECHERCHE_VAINE_JOURS + 1) * 86_400_000 });

    expect(appels).toBe(2);
  });

  it("la retente tout de suite si le terme a changé", async () => {
    // C'est le cas des 14 titres rétablis : leur terme n'est plus le même, ils méritent leur chance.
    let appels = 0;
    const chercher = async () => { appels += 1; return null; };

    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Pranque ： The Door ⧸ Hologram", chercher, maintenant });
    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Pranque : The Door / Hologram", chercher, maintenant });

    expect(appels).toBe(2);
  });

  it("oublie l'échec dès que la vidéo est trouvée", async () => {
    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max",
      chercher: async () => null, maintenant });
    await chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max 2",
      chercher: async () => trouvee("wnMwVGL8PvA"), maintenant });

    const reste = db.prepare("SELECT COUNT(*) AS n FROM web_recherches_vaines WHERE library_id = ?")
      .get(bibliothequeId) as { n: number };
    expect(reste.n).toBe(0);
  });

  it("ne retient pas une panne comme une réponse", async () => {
    // Une exception n'est pas un « introuvable » : la retenir condamnerait la vidéo pour une semaine
    // à cause d'un réseau coupé.
    await expect(chercherSansRepayer({ libraryId: bibliothequeId, cheminFichier: fichier, terme: "Air Max",
      chercher: async () => { throw new Error("réseau coupé"); }, maintenant })).rejects.toThrow("réseau coupé");

    const reste = db.prepare("SELECT COUNT(*) AS n FROM web_recherches_vaines WHERE library_id = ?")
      .get(bibliothequeId) as { n: number };
    expect(reste.n).toBe(0);
  });
});

describe("une actualisation n'efface pas ce qu'on savait", () => {
  it("garde la date et l'identifiant d'une vidéo que la plateforme ne rend plus", async () => {
    /*
     * Une vidéo retirée de YouTube — un retrait pour droits d'auteur suffit — ne répond plus. Sa date
     * repassait à vide à chaque actualisation, et son identifiant aussi : elle était alors cherchée par
     * son titre, à cent unités. Ici, aucune clé n'est enregistrée : la plateforme se tait, exactement
     * comme pour une vidéo retirée.
     */
    const fichier = `${racine}/YouTube/TPZ/Guillaume Pley ： clap de fin d’une LEGEND.mp4`;
    const chaineDossier = (lireCheminWeb(racine, fichier) as { valide: true; chemin: { chaineDossier: string } }).chemin.chaineDossier;
    const chaineId = randomUUID();
    const videoId = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, source_folder)
      VALUES (?, ?, 'show', 'TPZ', 'tpz', 'tpz', ?)`).run(chaineId, bibliothequeId, chaineDossier);
    db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, external_provider, external_id)
      VALUES (?, ?, ?, 'episode', 'Guillaume Pley : clap de fin d''une LEGEND', '0001', 'guillaume', 'youtube', 'M0k64yoLzdA')`)
      .run(videoId, bibliothequeId, chaineId);
    db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, air_date, available)
      VALUES (?, ?, 'video', 'Guillaume Pley', 'guillaume', 'guillaume', ?, ?, '2026-08-01', 1)`)
      .run(randomUUID(), videoId, fichier, bibliothequeId);

    const lecture = await analyserVideoWeb(bibliotheque, fichier, null, videoId);

    expect(lecture.valide).toBe(true);
    if (!lecture.valide) return;
    expect(lecture.identite.publieeLe).toBe("2026-08-01");
    expect(lecture.identite.identifiant).toBe("M0k64yoLzdA");
    expect(lecture.parsed.airDate).toBe("2026-08-01");
    expect(lecture.parsed.title).toBe("Guillaume Pley : clap de fin d'une LEGEND");
  });

  it("ne reprend pas le vieux titre d'une vidéo jamais identifiée", async () => {
    // Le titre d'une fiche non identifiée n'est que l'ancien nom de fichier, `⧸` compris. S'il était
    // repris, il l'emporterait sur le titre qu'on vient de rétablir.
    const fichier = `${racine}/YouTube/Greg Guillotin/Pranks/Pranque ： The Door ⧸ Hologram ghost prank.mp4`;
    const videoId = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title)
      VALUES (?, ?, 'episode', 'Pranque ： The Door ⧸ Hologram ghost prank', '0001', 'pranque')`)
      .run(videoId, bibliothequeId);

    const lecture = await analyserVideoWeb(bibliotheque, fichier, null, videoId);

    expect(lecture.valide).toBe(true);
    if (!lecture.valide) return;
    expect(lecture.parsed.title).toBe("Pranque : The Door / Hologram ghost prank");
    expect(lecture.identite.identifiant).toBeNull();
    expect(lecture.identite.publieeLe).toBeNull();
  });
});

describe("la vignette d'une vidéo se voit", () => {
  it("remet sur le média la vignette que la fiche possède déjà", async () => {
    /*
     * Le client lit la vignette sur le média, et l'enregistrement du média y remet l'affiche de la
     * saison — l'avatar de la chaîne. Sauter la vidéo parce que sa fiche était illustrée laissait
     * l'avatar pour toujours : 95 vignettes sur leur fiche, aucune à l'écran.
     */
    const fichier = `${racine}/YouTube/Greg Guillotin/Pranks/Une video.mp4`;
    const lecture = lireCheminWeb(racine, fichier);
    if (!lecture.valide) throw new Error("chemin attendu valide");
    const chaineId = randomUUID();
    const videoId = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, source_folder, poster_url)
      VALUES (?, ?, 'show', 'Greg Guillotin', 'greg', 'greg', ?, '/api/artwork/avatar-de-la-chaine')`)
      .run(chaineId, bibliothequeId, lecture.chemin.chaineDossier);
    db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title, poster_url)
      VALUES (?, ?, ?, 'episode', 'Une video', '0001', 'une video', '/api/artwork/vignette-propre')`)
      .run(videoId, bibliothequeId, chaineId);
    db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, search_title, file_path, library_id, poster_url, available)
      VALUES (?, ?, 'video', 'Une video', 'une video', 'une video', ?, ?, '/api/artwork/avatar-de-la-chaine', 1)`)
      .run(randomUUID(), videoId, fichier, bibliothequeId);

    await illustrerVideoWeb({ library: bibliotheque, catalogId: videoId, chaineId, chemin: lecture.chemin,
      identite: trouvee("abc12345678"), langue: "fr-FR" });

    const media = db.prepare("SELECT poster_url FROM media_items WHERE catalog_id = ?").get(videoId) as { poster_url: string };
    expect(media.poster_url).toBe("/api/artwork/vignette-propre");
  });

  it("déclare identifiée une chaîne dont on connaît l'identifiant", async () => {
    // Elle restait `unmatched` : l'écran de correction la présentait « à identifier » alors qu'elle
    // l'était, et la case décochée la gardait dans la liste des choses à réparer.
    const fichier = `${racine}/YouTube/Greg Guillotin/Une video.mp4`;
    const lecture = lireCheminWeb(racine, fichier);
    if (!lecture.valide) throw new Error("chemin attendu valide");
    const chaineId = randomUUID();
    const videoId = randomUUID();
    db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, source_folder,
        external_provider, external_id, poster_url)
      VALUES (?, ?, 'show', 'Greg Guillotin', 'greg', 'greg', ?, 'youtube', 'UCM1c1okZ-7cPV7BEZ-pzUGg', '/api/artwork/avatar')`)
      .run(chaineId, bibliothequeId, lecture.chemin.chaineDossier);
    db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title)
      VALUES (?, ?, ?, 'episode', 'Une video', '0001', 'une video')`).run(videoId, bibliothequeId, chaineId);

    await illustrerVideoWeb({ library: bibliotheque, catalogId: videoId, chaineId, chemin: lecture.chemin,
      identite: trouvee("abc12345678"), langue: "fr-FR" });

    const chaine = db.prepare("SELECT match_status FROM catalog_items WHERE id = ?").get(chaineId) as { match_status: string };
    expect(chaine.match_status).toBe("automatic");
  });
});
