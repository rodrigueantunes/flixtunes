import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { MATCH_THRESHOLDS } from "./match-engine.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Reprise ciblée des fiches restées sans correspondance.
 *
 * Sur la médiathèque réelle, 65 fiches sur 1 449 étaient restées de côté — et rien ne les reprenait
 * jamais. Une analyse de métadonnées complète les aurait rattrapées, mais au prix de 1 449 requêtes
 * au fournisseur là où 65 suffisaient : personne ne relance cela souvent, et les fiches restaient
 * telles quelles.
 *
 * Ces tests portent sur la **sélection** : quelles fiches sont reprises, lesquelles sont laissées
 * tranquilles. C'est la partie qui décide du coût et du risque ; l'appel au fournisseur lui-même est
 * couvert par les tests d'élargissement de requête.
 */

const libraryId = randomUUID();
const racine = `D:/reprise-${libraryId}`;

/** La requête de sélection utilisée par la reprise, telle qu'elle est écrite dans le coordinateur. */
function fichesAReprendre(): string[] {
  return (db.prepare(`SELECT title FROM catalog_items
    WHERE library_id = ? AND kind IN ('movie', 'show') AND metadata_locked = 0
      AND (match_status = 'unmatched' OR COALESCE(match_confidence, 0) < ?)
    ORDER BY title`).all(libraryId, MATCH_THRESHOLDS.automatic) as Array<{ title: string }>)
    .map((row) => row.title);
}

/** Ajoute une fiche dans l'état voulu. */
function fiche(titre: string, statut: string, confiance: number | null, verrouillee = false): void {
  db.prepare(`INSERT INTO catalog_items
    (id, library_id, kind, title, sort_title, search_title, year, match_status, match_confidence, metadata_locked)
    VALUES (?, ?, 'movie', ?, ?, ?, 2000, ?, ?, ?)`)
    .run(randomUUID(), libraryId, titre, titre.toLowerCase(), normaliseForSearch(titre),
      statut, confiance, verrouillee ? 1 : 0);
}

beforeAll(() => {
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, 'movie', 'fr-FR')")
    .run(libraryId, racine);

  fiche("Sans correspondance", "unmatched", null);
  fiche("Confiance faible", "automatic", 0.61);
  fiche("Juste sous le seuil", "automatic", MATCH_THRESHOLDS.automatic - 0.01);
  fiche("Bien appariee", "automatic", 0.97);
  fiche("Exactement au seuil", "automatic", MATCH_THRESHOLDS.automatic);
  fiche("Corrigee a la main", "unmatched", null, true);
  fiche("Manuelle et sure", "manual", 1, true);
});

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
});

describe("choix des fiches à reprendre", () => {
  it("reprend celles restées sans correspondance", () => {
    expect(fichesAReprendre()).toContain("Sans correspondance");
  });

  it("reprend celles dont la confiance est basse", () => {
    // Ce sont les 23 fiches « à revoir » du catalogue réel : appariées, mais pas assez sûrement pour
    // qu'on s'en contente.
    expect(fichesAReprendre()).toContain("Confiance faible");
    expect(fichesAReprendre()).toContain("Juste sous le seuil");
  });

  it("laisse tranquilles celles qui sont bien appariées", () => {
    // C'est ce qui fait tenir le coût : 65 requêtes au lieu de 1 449.
    expect(fichesAReprendre()).not.toContain("Bien appariee");
  });

  it("traite le seuil comme atteint, non dépassé", () => {
    // Une fiche exactement au seuil est acceptée par l'analyse : la reprise doit s'accorder avec elle,
    // sinon les mêmes fiches reviendraient à chaque passage sans jamais en sortir.
    expect(fichesAReprendre()).not.toContain("Exactement au seuil");
  });

  it("ne touche jamais à une fiche corrigée à la main", () => {
    // Le verrou dit que la personne a tranché. Le reprendre reviendrait à défaire son travail — et
    // c'est le pire défaut possible sur une correction manuelle : silencieux et répété.
    const reprises = fichesAReprendre();
    expect(reprises).not.toContain("Corrigee a la main");
    expect(reprises).not.toContain("Manuelle et sure");
  });

  it("ne retient que ce qui reste à faire", () => {
    expect(fichesAReprendre()).toEqual(["Confiance faible", "Juste sous le seuil", "Sans correspondance"]);
  });
});
