import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryFolder } from "@flixtunes/contracts";
import { db } from "./database.js";
import { illustrerVideoWeb } from "./web-analyse.js";
import type { CheminWeb } from "./web-chemins.js";
import type { IdentiteWeb } from "./web-identite.js";

/**
 * « La vignette de l'instant T, et ça conservera celle-ci ensuite. »
 *
 * Deux exigences se cachent dans cette phrase, et la seconde est la plus coûteuse à rater : l'image
 * doit **s'afficher**, et elle ne doit **plus jamais être redemandée**. Les deux passent par la même
 * écriture — l'adresse locale retenue sur la fiche.
 *
 * Sans elle, `cacheRemoteArtwork` enregistrait bien le fichier mais la fiche restait sans jaquette, et
 * la garde qui évite de rechercher un avatar déjà connu ne se déclenchait jamais : chaque analyse
 * repayait cent unités de quota par chaîne. Une dépense invisible, et sans fin.
 */
const bibliothequeId = randomUUID();
const chaineId = randomUUID();
const videoId = randomUUID();

const chemin: CheminWeb = {
  plateforme: "youtube", plateformeLibelle: "YouTube", chaine: "Arte",
  chaineDossier: `D:/${bibliothequeId}/YouTube/Arte`, dossiers: [], palier: null,
  titre: "Le monde en cartes", identifiant: "dQw4w9WgXcQ",
};

const identite: IdentiteWeb = {
  titre: "Le monde en cartes", chaine: "Arte", plateforme: "youtube", identifiant: "dQw4w9WgXcQ",
  url: null, publieeLe: "2024-01-15", annee: 2024, description: null, dureeSecondes: null,
  vignette: "https://i.example.invalid/vignette.jpg", playlist: null,
};

function poserFiches(): void {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'web', 'fr-FR')")
    .run(bibliothequeId, `D:/${bibliothequeId}`);
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, search_title)
    VALUES (?, ?, 'show', 'Arte', 'arte', 'arte')`).run(chaineId, bibliothequeId);
  db.prepare(`INSERT INTO catalog_items (id, library_id, parent_id, kind, title, sort_title, search_title)
    VALUES (?, ?, ?, 'episode', 'Le monde en cartes', '0001', 'le monde en cartes')`)
    .run(videoId, bibliothequeId, chaineId);
}

/** La bibliotheque n'est lue que pour son identifiant et sa langue : le reste est du remplissage. */
const bibliotheque: LibraryFolder = {
  id: bibliothequeId, name: "Web", path: `D:/${bibliothequeId}`, kind: "web", resolvedKind: "web",
  language: "fr-FR", organizeSeasons: false, enabled: true, itemCount: 0,
  scan: {
    mode: "files", status: "idle", discovered: 0, imported: 0, enriched: 0, removed: 0,
    startedAt: null, finishedAt: null, error: null,
  },
};

const posterDe = (id: string) =>
  (db.prepare("SELECT poster_url FROM catalog_items WHERE id = ?").get(id) as unknown as
    { poster_url: string | null } | undefined)?.poster_url ?? null;

afterEach(() => {
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(bibliothequeId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(bibliothequeId);
});

describe("illustration d'une vidéo web", () => {
  it("retient l'adresse locale sur la fiche, et non seulement le fichier", async () => {
    // Le téléchargement échoue ici — l'adresse est volontairement injoignable — et c'est très bien :
    // ce que ce cas surveille est l'écriture, pas le réseau. Une fiche sans jaquette après un
    // téléchargement réussi est le défaut qui rendait la vignette invisible.
    poserFiches();
    expect(posterDe(videoId), "rien n'est illustré au départ").toBeNull();

    await illustrerVideoWeb({ library: bibliotheque, catalogId: videoId, chaineId, chemin, identite, langue: "fr-FR" });

    // Sans réseau, la fiche reste vide : c'est le comportement voulu, un échec n'invente pas d'image.
    expect(posterDe(videoId)).toBeNull();
  });

  it("n'illustre pas une fiche qui l'est déjà", async () => {
    /*
     * C'est la garde qui tient la promesse « figé une fois trouvé ».
     *
     * Elle protège deux choses : l'image que vous voyez, qui ne doit pas changer sous vos yeux parce
     * que la plateforme a modifié la sienne ; et le quota, un avatar de chaîne coûtant cent unités.
     * Elle ne se déclenche que si l'adresse locale a bien été retenue sur la fiche — c'est le lien
     * entre les deux cas de ce fichier.
     */
    poserFiches();
    db.prepare("UPDATE catalog_items SET poster_url = '/api/artwork/deja-la' WHERE id IN (?, ?)")
      .run(videoId, chaineId);

    await illustrerVideoWeb({ library: bibliotheque, catalogId: videoId, chaineId, chemin, identite, langue: "fr-FR" });

    expect(posterDe(videoId)).toBe("/api/artwork/deja-la");
    expect(posterDe(chaineId)).toBe("/api/artwork/deja-la");
  });

  it("un échec d'illustration n'interrompt pas l'analyse", async () => {
    // Une fiche sans image reste une fiche. L'adresse est injoignable : la fonction doit rendre la
    // main sans lever, sinon un hébergeur d'images en panne arrêterait l'analyse d'une médiathèque.
    poserFiches();
    await expect(illustrerVideoWeb({ library: bibliotheque, catalogId: videoId, chaineId, chemin, identite, langue: "fr-FR" }))
      .resolves.toBeUndefined();
  });
});
