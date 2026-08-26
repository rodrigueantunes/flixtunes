import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCorrection, listAudit, mergeTarget, mergedSources, previewMassCorrection, undoCorrection } from "./corrections.js";
import { db } from "./database.js";

const libraryId = randomUUID();

function catalogItem(over: { title?: string; season?: number | null; episode?: number | null; locked?: boolean } = {}): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, season_number, episode_number,
    match_status, metadata_locked, match_confidence)
    VALUES (?, ?, 'episode', ?, ?, ?, ?, 'automatic', ?, 0.7)`)
    .run(id, libraryId, over.title ?? "Titre", (over.title ?? "Titre").toLowerCase(),
      over.season ?? 1, over.episode ?? 1, over.locked ? 1 : 0);
  return id;
}

function read(id: string) {
  return db.prepare(`SELECT title, year, season_number, episode_number, external_provider, external_id,
    match_status, metadata_locked FROM catalog_items WHERE id = ?`).get(id) as {
      title: string; year: number | null; season_number: number | null; episode_number: number | null;
      external_provider: string | null; external_id: string | null; match_status: string; metadata_locked: number;
    };
}

beforeEach(() => {
  // Le chemin dérive de l'identifiant : la colonne est UNIQUE, et un chemin fixe faisait ignorer
  // l'insertion dès la deuxième exécution — l'identifiant tiré au hasard n'existait alors pas et
  // toutes les fiches échouaient sur la clé étrangère. Le test se rendait lui-même rouge, et ne
  // passait que juste après un nettoyage manuel de la base.
  db.prepare("INSERT OR IGNORE INTO library_folders (id, name, path, kind, language) VALUES (?, 'Corrections', ?, 'tv', 'fr-FR')")
    .run(libraryId, `D:/corrections-${libraryId}`);
});
afterEach(() => {
  db.prepare("DELETE FROM correction_audit").run();
  db.prepare("DELETE FROM catalog_merges").run();
  db.prepare("DELETE FROM catalog_items WHERE library_id = ?").run(libraryId);
});
afterAll(() => {
  // La bibliothèque part avec le reste : ce qu'un fichier de tests laisse en base, un autre le paie.
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
});

describe("corrections durables", () => {
  it("force une correspondance et verrouille la fiche contre les prochains scans", () => {
    const id = catalogItem({ title: "Mauvais titre" });
    const result = applyCorrection({ type: "rematch", catalogId: id, provider: "tmdb", externalId: "550", title: "Bon titre", year: 1999 });
    expect(read(id)).toMatchObject({ title: "Bon titre", year: 1999, external_id: "550", match_status: "manual", metadata_locked: 1 });
    expect(result.summary).toContain("550");
  });

  it("corrige une numérotation d'épisode erronée", () => {
    const id = catalogItem({ season: 1, episode: 42 });
    applyCorrection({ type: "renumber", catalogId: id, seasonNumber: 2, episodeNumber: 3 });
    expect(read(id)).toMatchObject({ season_number: 2, episode_number: 3, metadata_locked: 1 });
  });

  it("regroupe un doublon sans supprimer la moindre fiche", () => {
    const target = catalogItem({ title: "Version 4K" });
    const source = catalogItem({ title: "Version 1080p" });
    applyCorrection({ type: "merge", targetId: target, sourceId: source });
    expect(mergeTarget(source)).toBe(target);
    expect(mergedSources(target)).toEqual([source]);
    // Les deux fiches existent toujours : rien n'a été effacé.
    expect(read(source).title).toBe("Version 1080p");
    expect(read(target).title).toBe("Version 4K");
  });

  it("aplatit une chaîne de regroupements au lieu de créer un cycle", () => {
    const first = catalogItem(); const second = catalogItem(); const third = catalogItem();
    applyCorrection({ type: "merge", targetId: first, sourceId: second });
    applyCorrection({ type: "merge", targetId: second, sourceId: third });
    // Le troisième pointe sur la cible finale, pas sur un intermédiaire.
    expect(mergeTarget(third)).toBe(first);
    expect(() => applyCorrection({ type: "merge", targetId: third, sourceId: first })).toThrow(/cycle/);
    expect(() => applyCorrection({ type: "merge", targetId: first, sourceId: first })).toThrow(/elle-même/);
  });

  it("sépare une fiche d'un regroupement", () => {
    const target = catalogItem(); const source = catalogItem();
    applyCorrection({ type: "merge", targetId: target, sourceId: source });
    applyCorrection({ type: "split", sourceId: source });
    expect(mergeTarget(source)).toBe(source);
    expect(mergedSources(target)).toEqual([]);
    expect(() => applyCorrection({ type: "split", sourceId: source })).toThrow(/aucun regroupement/);
  });

  it("annule une correction en rétablissant l'état exact d'avant", () => {
    const id = catalogItem({ title: "Original", season: 1, episode: 5 });
    const before = read(id);
    const { auditId } = applyCorrection({ type: "renumber", catalogId: id, seasonNumber: 9, episodeNumber: 9 });
    expect(read(id).season_number).toBe(9);
    expect(undoCorrection(auditId)).toBe(true);
    expect(read(id)).toMatchObject(before);
    // Une annulation ne s'applique qu'une fois.
    expect(undoCorrection(auditId)).toBe(false);
  });

  it("annule un regroupement", () => {
    const target = catalogItem(); const source = catalogItem();
    const { auditId } = applyCorrection({ type: "merge", targetId: target, sourceId: source });
    expect(undoCorrection(auditId)).toBe(true);
    expect(mergeTarget(source)).toBe(source);
  });

  it("journalise chaque commande avec sa portée et son résumé", () => {
    const id = catalogItem();
    applyCorrection({ type: "lock", catalogId: id });
    applyCorrection({ type: "unlock", catalogId: id });
    const entries = listAudit();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.command)).toEqual(["unlock", "lock"]);
    expect(entries.every((entry) => entry.scope === id && entry.summary.length > 0)).toBe(true);
    expect(listAudit({ command: "lock" })).toHaveLength(1);
    expect(listAudit({ scope: "inexistant" })).toHaveLength(0);
  });

  it("marque l'entrée comme annulée dans le journal", () => {
    const id = catalogItem();
    const { auditId } = applyCorrection({ type: "lock", catalogId: id });
    undoCorrection(auditId);
    expect(listAudit()[0]).toMatchObject({ id: auditId, undone: true });
  });

  it("n'écrit rien quand la commande échoue", () => {
    expect(() => applyCorrection({ type: "rematch", catalogId: "inexistant", provider: "tmdb", externalId: "1" }))
      .toThrow(/introuvable/);
    expect(listAudit()).toHaveLength(0);
  });

  it("exclut les fiches verrouillées d'une correction de masse et le dit", () => {
    const free = catalogItem(); const locked = catalogItem({ locked: true });
    const preview = previewMassCorrection([free, locked, "inexistant"]);
    expect(preview.scope).toBe(1);
    expect(preview.skipped).toEqual(expect.arrayContaining([
      { catalogId: locked, reason: "Correction manuelle verrouillée" },
      { catalogId: "inexistant", reason: "Fiche introuvable" },
    ]));
  });

  it("ne modifie rien lors d'une prévisualisation", () => {
    const id = catalogItem({ title: "Intact" });
    previewMassCorrection([id]);
    expect(read(id).title).toBe("Intact");
    expect(listAudit()).toHaveLength(0);
  });
});
