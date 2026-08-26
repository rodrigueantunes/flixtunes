import type { MetadataFieldProvenance } from "@flixtunes/contracts";
import { db } from "./database.js";
import type { ParsedMedia } from "./media-parser.js";
import type { EntityMetadata } from "./tmdb.js";

type Field = MetadataFieldProvenance["field"];

export function recordMetadataField(input: Omit<MetadataFieldProvenance, "updatedAt">): void {
  db.prepare(`INSERT INTO metadata_field_values
    (catalog_id, field, value_json, source, source_id, language, confidence, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(catalog_id, field) DO UPDATE SET
      value_json = CASE WHEN metadata_field_values.locked = 1 THEN metadata_field_values.value_json ELSE excluded.value_json END,
      source = CASE WHEN metadata_field_values.locked = 1 THEN metadata_field_values.source ELSE excluded.source END,
      source_id = CASE WHEN metadata_field_values.locked = 1 THEN metadata_field_values.source_id ELSE excluded.source_id END,
      language = CASE WHEN metadata_field_values.locked = 1 THEN metadata_field_values.language ELSE excluded.language END,
      confidence = CASE WHEN metadata_field_values.locked = 1 THEN metadata_field_values.confidence ELSE excluded.confidence END,
      locked = MAX(metadata_field_values.locked, excluded.locked), updated_at = CURRENT_TIMESTAMP`)
    .run(input.catalogId, input.field, JSON.stringify(input.value), input.source, input.sourceId, input.language,
      Math.max(0, Math.min(1, input.confidence)), input.locked ? 1 : 0);
}

export function recordEntityProvenance(catalogId: string, metadata: EntityMetadata | null, parsed?: ParsedMedia): void {
  const source = metadata?.provider ?? "filename";
  const sourceId = metadata?.externalId ?? null;
  const language = metadata?.language ?? null;
  const confidence = metadata?.confidence ?? 0.45;
  const fields: Array<[Field, string | number | null | undefined]> = metadata ? [
    ["title", metadata.title], ["originalTitle", metadata.originalTitle], ["overview", metadata.overview],
    ["year", metadata.year], ["runtimeSeconds", metadata.runtimeSeconds], ["poster", metadata.posterSourceUrl],
    ["backdrop", metadata.backdropSourceUrl],
  ] : [["title", parsed?.title], ["overview", parsed?.overview], ["year", parsed?.year]];
  for (const [field, value] of fields) if (value !== undefined && value !== null && value !== "") {
    recordMetadataField({ catalogId, field, value, source, sourceId, language, confidence, locked: false });
  }
}

export function listMetadataProvenance(catalogId: string): MetadataFieldProvenance[] {
  const rows = db.prepare(`SELECT catalog_id, field, value_json, source, source_id, language, confidence, locked, updated_at
    FROM metadata_field_values WHERE catalog_id = ? ORDER BY field`).all(catalogId) as Array<{
      catalog_id: string; field: Field; value_json: string | null; source: MetadataFieldProvenance["source"];
      source_id: string | null; language: string | null; confidence: number; locked: number; updated_at: string;
    }>;
  return rows.map((row) => ({ catalogId: row.catalog_id, field: row.field,
    value: row.value_json == null ? null : JSON.parse(row.value_json) as string | number | null,
    source: row.source, sourceId: row.source_id, language: row.language, confidence: row.confidence,
    locked: row.locked === 1, updatedAt: row.updated_at }));
}
