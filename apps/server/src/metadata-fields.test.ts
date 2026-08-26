import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "./database.js";
import { listMetadataProvenance, recordMetadataField } from "./metadata-fields.js";

describe("provenance des métadonnées v2", () => {
  it("conserve une correction verrouillée face aux rafraîchissements automatiques", () => {
    const suffix = randomUUID(); const libraryId = `lib-${suffix}`; const catalogId = `cat-${suffix}`;
    db.prepare("INSERT INTO library_folders (id,name,path,kind) VALUES (?, ?, ?, 'movie')").run(libraryId, "Test", `C:\\${suffix}`);
    db.prepare("INSERT INTO catalog_items (id,library_id,kind,title,sort_title) VALUES (?,?,'movie','Film','film')").run(catalogId, libraryId);
    try {
      recordMetadataField({ catalogId, field: "title", value: "Titre corrigé", source: "manual", sourceId: null,
        language: "fr-FR", confidence: 1, locked: true });
      recordMetadataField({ catalogId, field: "title", value: "Remote title", source: "tmdb", sourceId: "42",
        language: "en-US", confidence: .99, locked: false });
      expect(listMetadataProvenance(catalogId)).toContainEqual(expect.objectContaining({ field: "title", value: "Titre corrigé", source: "manual", locked: true }));
    } finally { db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId); }
  });
});
