import { randomUUID } from "node:crypto";
import { db, inTransaction } from "./database.js";

/**
 * Corrections durables — étape 53.
 *
 * Toute commande est transactionnelle et journalisée avec son état avant et après. Deux invariants
 * gouvernent ce module :
 *
 * 1. **Rien n'est supprimé.** Fusionner deux fiches enregistre une appartenance de groupe ; les fiches
 *    et les fichiers restent en place. Séparer revient donc à retirer une ligne.
 * 2. **Une correction manuelle n'est jamais écrasée.** Corriger verrouille la fiche, et le scan suivant
 *    doit respecter ce verrou.
 */

export type CorrectionCommand =
  | { type: "rematch"; catalogId: string; provider: string; externalId: string; title?: string; year?: number | null }
  | { type: "renumber"; catalogId: string; seasonNumber: number | null; episodeNumber: number | null }
  | { type: "lock"; catalogId: string }
  | { type: "unlock"; catalogId: string }
  | { type: "merge"; targetId: string; sourceId: string }
  | { type: "split"; sourceId: string };

export interface AuditEntry {
  id: string;
  at: string;
  command: CorrectionCommand["type"];
  scope: string;
  summary: string;
  undone: boolean;
}

export interface CorrectionResult { auditId: string; summary: string }

interface CatalogSnapshot {
  id: string; title: string; year: number | null; season_number: number | null; episode_number: number | null;
  external_provider: string | null; external_id: string | null; match_status: string; metadata_locked: number;
  match_confidence: number | null;
}

const snapshotColumns = `id, title, year, season_number, episode_number, external_provider, external_id,
  match_status, metadata_locked, match_confidence`;

function snapshot(catalogId: string): CatalogSnapshot | null {
  return db.prepare(`SELECT ${snapshotColumns} FROM catalog_items WHERE id = ?`).get(catalogId) as CatalogSnapshot | undefined ?? null;
}

function restore(state: CatalogSnapshot): void {
  db.prepare(`UPDATE catalog_items SET title = ?, year = ?, season_number = ?, episode_number = ?,
    external_provider = ?, external_id = ?, match_status = ?, metadata_locked = ?, match_confidence = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(state.title, state.year, state.season_number, state.episode_number, state.external_provider,
      state.external_id, state.match_status, state.metadata_locked, state.match_confidence, state.id);
}


function record(command: CorrectionCommand["type"], scope: string, summary: string, before: unknown, after: unknown): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO correction_audit (id, command, scope, summary, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, command, scope, summary, JSON.stringify(before ?? null), JSON.stringify(after ?? null));
  return id;
}

/** Fiche cible d'un regroupement, ou la fiche elle-même si elle n'est pas fusionnée. */
export function mergeTarget(catalogId: string): string {
  const row = db.prepare("SELECT target_id FROM catalog_merges WHERE source_id = ?").get(catalogId) as { target_id: string } | undefined;
  return row?.target_id ?? catalogId;
}

export function mergedSources(targetId: string): string[] {
  return (db.prepare("SELECT source_id FROM catalog_merges WHERE target_id = ? ORDER BY merged_at").all(targetId) as Array<{ source_id: string }>)
    .map((row) => row.source_id);
}

/**
 * Applique une correction dans une transaction unique.
 * En cas d'erreur, rien n'est écrit : ni la modification, ni l'entrée d'audit.
 */
export function applyCorrection(command: CorrectionCommand): CorrectionResult {
  return inTransaction((): CorrectionResult => {
    switch (command.type) {
      case "rematch": {
        const before = snapshot(command.catalogId);
        if (!before) throw new Error("Fiche introuvable");
        db.prepare(`UPDATE catalog_items SET external_provider = ?, external_id = ?, title = COALESCE(?, title),
          year = COALESCE(?, year), match_status = 'manual', metadata_locked = 1, match_confidence = 1,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(command.provider, command.externalId, command.title ?? null, command.year ?? null, command.catalogId);
        const after = snapshot(command.catalogId);
        const summary = `Correspondance forcée sur ${command.provider} ${command.externalId}`;
        return { auditId: record("rematch", command.catalogId, summary, before, after), summary };
      }
      case "renumber": {
        const before = snapshot(command.catalogId);
        if (!before) throw new Error("Fiche introuvable");
        db.prepare(`UPDATE catalog_items SET season_number = ?, episode_number = ?, metadata_locked = 1,
          match_status = 'manual', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(command.seasonNumber, command.episodeNumber, command.catalogId);
        const after = snapshot(command.catalogId);
        const summary = `Numérotation corrigée en S${command.seasonNumber ?? "?"}E${command.episodeNumber ?? "?"}`;
        return { auditId: record("renumber", command.catalogId, summary, before, after), summary };
      }
      case "lock":
      case "unlock": {
        const before = snapshot(command.catalogId);
        if (!before) throw new Error("Fiche introuvable");
        if (command.type === "lock") {
          db.prepare("UPDATE catalog_items SET metadata_locked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(command.catalogId);
        } else {
          // Déverrouiller, c'est rendre la fiche réévaluable — pas la rendre anonyme.
          //
          // Cette commande effaçait aussi `external_provider` et `external_id`. La fiche perdait alors
          // le seul point d'ancrage qui permettait à l'analyse suivante de la retrouver, et comme une
          // fiche s'identifie par son titre et son année, une analyse qui ne retrouvait plus le titre
          // du fournisseur en fabriquait une **seconde** à partir du nom de fichier. Le média
          // basculait sur la nouvelle, et la bonne restait derrière, vide et sans jaquette.
          //
          // Mesuré sur la médiathèque réelle : dix-sept films détruits ainsi, soit la totalité des
          // films alors « non appariés ». Chacun avait pourtant la bonne correspondance TMDB avant
          // qu'on ne le répare — c'est la réparation qui les cassait.
          //
          // Le statut passe en revue : la fiche est reprise par la prochaine analyse ciblée, sans être
          // tenue pour acquise, et sans perdre ce qu'elle sait d'elle-même.
          db.prepare(`UPDATE catalog_items SET metadata_locked = 0, match_status = 'review', match_confidence = NULL,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(command.catalogId);
        }
        const after = snapshot(command.catalogId);
        const summary = command.type === "lock" ? "Fiche verrouillée contre les prochains scans" : "Verrou retiré";
        return { auditId: record(command.type, command.catalogId, summary, before, after), summary };
      }
      case "merge": {
        if (command.sourceId === command.targetId) throw new Error("Une fiche ne peut pas être fusionnée avec elle-même");
        if (!snapshot(command.sourceId) || !snapshot(command.targetId)) throw new Error("Fiche introuvable");
        // Une chaîne de fusions est aplatie : la cible finale est toujours une fiche non fusionnée.
        const target = mergeTarget(command.targetId);
        if (target === command.sourceId) throw new Error("Ce regroupement créerait un cycle");
        const before = db.prepare("SELECT target_id FROM catalog_merges WHERE source_id = ?").get(command.sourceId) ?? null;
        db.prepare(`INSERT INTO catalog_merges (source_id, target_id) VALUES (?, ?)
          ON CONFLICT(source_id) DO UPDATE SET target_id = excluded.target_id, merged_at = CURRENT_TIMESTAMP`)
          .run(command.sourceId, target);
        const summary = "Doublon regroupé, aucune fiche ni aucun fichier supprimé";
        return { auditId: record("merge", command.sourceId, summary, before, { target_id: target }), summary };
      }
      case "split": {
        const before = db.prepare("SELECT target_id FROM catalog_merges WHERE source_id = ?").get(command.sourceId) ?? null;
        if (!before) throw new Error("Cette fiche n'appartient à aucun regroupement");
        db.prepare("DELETE FROM catalog_merges WHERE source_id = ?").run(command.sourceId);
        const summary = "Fiche séparée du regroupement";
        return { auditId: record("split", command.sourceId, summary, before, null), summary };
      }
    }
  });
}

/** Annule une correction en réécrivant l'état capturé avant son application. */
export function undoCorrection(auditId: string): boolean {
  return inTransaction((): boolean => {
    const entry = db.prepare("SELECT id, command, scope, before_json, undone FROM correction_audit WHERE id = ?")
      .get(auditId) as { id: string; command: CorrectionCommand["type"]; scope: string; before_json: string; undone: number } | undefined;
    if (!entry || entry.undone === 1) return false;
    const before = JSON.parse(entry.before_json) as CatalogSnapshot | { target_id: string } | null;
    if (entry.command === "merge") {
      if (before && "target_id" in before) {
        db.prepare("INSERT INTO catalog_merges (source_id, target_id) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET target_id = excluded.target_id")
          .run(entry.scope, before.target_id);
      } else db.prepare("DELETE FROM catalog_merges WHERE source_id = ?").run(entry.scope);
    } else if (entry.command === "split") {
      if (before && "target_id" in before) {
        db.prepare("INSERT INTO catalog_merges (source_id, target_id) VALUES (?, ?)").run(entry.scope, before.target_id);
      }
    } else if (before && "id" in before) restore(before);
    db.prepare("UPDATE correction_audit SET undone = 1 WHERE id = ?").run(auditId);
    return true;
  });
}

export function listAudit(filter: { command?: CorrectionCommand["type"]; scope?: string; limit?: number } = {}): AuditEntry[] {
  const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
  const rows = db.prepare(`SELECT id, at, command, scope, summary, undone FROM correction_audit
    WHERE (? IS NULL OR command = ?) AND (? IS NULL OR scope = ?) ORDER BY at DESC, rowid DESC LIMIT ?`)
    .all(filter.command ?? null, filter.command ?? null, filter.scope ?? null, filter.scope ?? null, limit) as Array<{
      id: string; at: string; command: CorrectionCommand["type"]; scope: string; summary: string; undone: number;
    }>;
  return rows.map((row) => ({ id: row.id, at: row.at, command: row.command, scope: row.scope, summary: row.summary, undone: row.undone === 1 }));
}

export interface MassPreview {
  scope: number;
  /** Fiches que la commande de masse ne touchera pas, avec la raison. */
  skipped: Array<{ catalogId: string; reason: string }>;
}

/**
 * Prévisualise une correction de masse sans rien écrire.
 * Une fiche déjà verrouillée manuellement est exclue : c'est la règle qui empêche une action groupée
 * d'effacer un travail fait à la main.
 */
export function previewMassCorrection(catalogIds: string[]): MassPreview {
  const skipped: MassPreview["skipped"] = [];
  let scope = 0;
  for (const catalogId of catalogIds) {
    const state = snapshot(catalogId);
    if (!state) { skipped.push({ catalogId, reason: "Fiche introuvable" }); continue; }
    if (state.metadata_locked === 1) { skipped.push({ catalogId, reason: "Correction manuelle verrouillée" }); continue; }
    scope += 1;
  }
  return { scope, skipped };
}
