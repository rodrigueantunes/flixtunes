import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryFolder } from "@flixtunes/contracts";
import { db } from "./database.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import { analyserVideoWeb } from "./web-analyse.js";
import { lireCheminWeb } from "./web-chemins.js";

/**
 * Le code YouTube entre crochets, et ce qu'on fait quand il ne rend rien.
 *
 * La règle, telle qu'elle a été fixée le 12 septembre 2026 :
 *
 * - **un code dans le nom est résolu directement**, même pour une vidéo qui n'est pas de la chaîne —
 *   un identifiant YouTube est unique sur toute la plateforme ;
 * - **s'il ne rend rien, on fait la même recherche qu'avant**, avec le titre débarrassé du code et de
 *   ses crochets.
 *
 * Ces cas passent par le vrai chemin de l'analyse — quota, disjoncteur, décodage — avec un faux
 * YouTube à la place du réseau. C'est ce qui permet d'affirmer quelle requête part, et avec quel terme.
 */
const bibliothequeId = randomUUID();
const racine = `D:/${bibliothequeId}`;
const CHAINE = "UCM1c1okZ-7cPV7BEZ-pzUGg";
const bibliotheque: LibraryFolder = {
  id: bibliothequeId, name: "Web", path: racine, kind: "web", resolvedKind: "web",
  language: "fr-FR", organizeSeasons: false, enabled: true, itemCount: 0,
  scan: { mode: "files", status: "idle", discovered: 0, imported: 0, enriched: 0, removed: 0,
    startedAt: null, finishedAt: null, error: null },
};

type VideoConnue = { titre: string; chaine: string; date: string };

/** Un faux YouTube : les vidéos qu'il connaît par leur code, et ce que rend sa recherche. */
function fauxYoutube(videos: Record<string, VideoConnue>, trouveeParRecherche: ({ code: string } & VideoConnue) | null): URL[] {
  const appels: URL[] = [];
  const json = (charge: unknown) => new Response(JSON.stringify(charge), { status: 200, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", async (entree: string | URL) => {
    const url = new URL(String(entree));
    appels.push(url);
    if (url.pathname.endsWith("/videos")) {
      const code = url.searchParams.get("id") ?? "";
      const video = videos[code];
      return json({ items: video ? [{ id: code, snippet: { title: video.titre, channelTitle: video.chaine,
        publishedAt: `${video.date}T10:00:00Z`, thumbnails: {} }, contentDetails: { duration: "PT10M" } }] : [] });
    }
    if (url.pathname.endsWith("/search")) {
      return json({ items: trouveeParRecherche ? [{ id: { videoId: trouveeParRecherche.code }, snippet: {
        title: trouveeParRecherche.titre, channelTitle: trouveeParRecherche.chaine,
        publishedAt: `${trouveeParRecherche.date}T10:00:00Z`, thumbnails: {} } }] : [] });
    }
    return new Response("{}", { status: 404 });
  });
  return appels;
}

const fichier = (nom: string) => `${racine}/YouTube/Greg Guillotin/Le Pire Projet/${nom}`;
const recherches = (appels: URL[]) => appels.filter((url) => url.pathname.endsWith("/search"));
const resolutions = (appels: URL[]) => appels.filter((url) => url.pathname.endsWith("/videos"));

beforeEach(() => {
  saveProviderConfiguration({ youtubeApiKey: "cle-d-essai" });
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeId, racine);
  // La chaîne est déjà identifiée : c'est l'état réel, et c'est ce qui permet la recherche de repli.
  const lecture = lireCheminWeb(racine, fichier("x.mp4"));
  if (!lecture.valide) throw new Error("chemin attendu valide");
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title, source_folder,
      external_provider, external_id)
    VALUES (?, ?, 'show', 'Greg Guillotin', 'greg', 'greg', ?, 'youtube', ?)`)
    .run(randomUUID(), bibliothequeId, lecture.chemin.chaineDossier, CHAINE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  saveProviderConfiguration({ youtubeApiKey: null });
  db.prepare("DELETE FROM server_settings WHERE key = 'web_quota_youtube'").run();
  db.prepare("DELETE FROM web_recherches_vaines WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(bibliothequeId);
});

describe("un code entre crochets", () => {
  it("est résolu directement, sans recherche", async () => {
    const appels = fauxYoutube({
      qbmeKsooC5s: { titre: "MAKING OF - Le Pire Projet #12 (dernier épisode) : on fait l'bilan !", chaine: "Greg Guillotin", date: "2023-03-02" },
    }, null);

    const lecture = await analyserVideoWeb(bibliotheque,
      fichier("MAKING OF - Le Pire Projet #12 (dernier épisode) ： on fait l'bilan ! [qbmeKsooC5s].mp4"), null);

    expect(lecture.valide).toBe(true);
    if (!lecture.valide) return;
    expect(lecture.identite.identifiant).toBe("qbmeKsooC5s");
    expect(lecture.identite.publieeLe).toBe("2023-03-02");
    expect(recherches(appels), "une unité de quota, pas cent").toHaveLength(0);
  });

  it("vaut même pour une vidéo d'une autre chaîne", async () => {
    // Un clip d'un autre artiste rangé sous la chaîne : aucune recherche limitée à la chaîne ne le
    // trouverait. Le code, unique sur toute la plateforme, le désigne sans ambiguïté.
    const appels = fauxYoutube({
      sBXCZRkvvPo: { titre: "Rim'K - Air Max ft. Ninho (Clip Officiel)", chaine: "Rim'K", date: "2017-03-10" },
    }, null);

    const lecture = await analyserVideoWeb(bibliotheque, fichier("Rim'K - Air Max ft. Ninho (Clip Officiel) [sBXCZRkvvPo].mp4"), null);

    expect(lecture.valide).toBe(true);
    if (!lecture.valide) return;
    expect(lecture.identite.identifiant).toBe("sBXCZRkvvPo");
    expect(lecture.identite.publieeLe).toBe("2017-03-10");
    expect(recherches(appels)).toHaveLength(0);
  });
});

describe("un code qui ne rend rien", () => {
  it("fait la recherche habituelle, avec le titre sans le code ni les crochets", async () => {
    // Une lettre de travers dans le code : YouTube ne connaît pas cette vidéo.
    const appels = fauxYoutube({}, {
      code: "qbmeKsooC5s", titre: "MAKING OF - Le Pire Projet #12 (dernier épisode) : on fait l'bilan !",
      chaine: "Greg Guillotin", date: "2023-03-02",
    });

    const lecture = await analyserVideoWeb(bibliotheque,
      fichier("MAKING OF - Le Pire Projet #12 (dernier épisode) ： on fait l'bilan ! [qbmeKsooC5X].mp4"), null);

    expect(resolutions(appels).map((url) => url.searchParams.get("id"))).toEqual(["qbmeKsooC5X"]);
    expect(recherches(appels)).toHaveLength(1);
    expect(recherches(appels)[0]?.searchParams.get("q"))
      .toBe("MAKING OF - Le Pire Projet #12 (dernier épisode) : on fait l'bilan !");
    expect(recherches(appels)[0]?.searchParams.get("channelId")).toBe(CHAINE);
    expect(lecture.valide && lecture.identite.identifiant).toBe("qbmeKsooC5s");
    expect(lecture.valide && lecture.identite.publieeLe).toBe("2023-03-02");
  });

  it("ne retient jamais le code faux comme identité", async () => {
    // La recherche de repli ne trouve rien non plus : la vidéo reste sans correspondance, et surtout
    // sans le code mal tapé, qui l'attribuerait à une vidéo qui n'existe pas.
    fauxYoutube({}, null);

    const lecture = await analyserVideoWeb(bibliotheque, fichier("Sujet introuvable [qbmeKsooC5X].mp4"), null);

    expect(lecture.valide && lecture.identite.identifiant).toBeNull();
  });

  it("fait la recherche sans les crochets d'un code mal recopié", async () => {
    // Dix caractères : ce n'est pas un identifiant, rien n'est résolu. Mais ce n'est pas du titre non
    // plus, et il ne doit pas partir dans la recherche.
    const appels = fauxYoutube({}, null);

    await analyserVideoWeb(bibliotheque, fichier("Le Pire Projet #11 ： la finale [qbmeKsooC5].mp4"), null);

    expect(resolutions(appels)).toHaveLength(0);
    expect(recherches(appels)[0]?.searchParams.get("q")).toBe("Le Pire Projet #11 : la finale");
  });
});

describe("ce qui reste du titre", () => {
  it("garde le texte entre crochets qui n'a rien d'un code", () => {
    for (const [nom, titre] of [
      ["Concert [Live].mp4", "Concert [Live]"],
      ["Bande annonce [Teaser].mp4", "Bande annonce [Teaser]"],
      ["Retrospective [2024].mp4", "Retrospective [2024]"],
      ["Enquete (partie 2).mp4", "Enquete (partie 2)"],
    ] as const) {
      const lecture = lireCheminWeb(racine, fichier(nom));
      expect(lecture.valide && lecture.chemin.titre, nom).toBe(titre);
    }
  });
});
