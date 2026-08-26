import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDetails, listCatalog } from "./catalog-view.js";
import { db } from "./database.js";

const libraryId = randomUUID();
const profileId = randomUUID();
const catalogId = randomUUID();
const media4k = randomUUID();
const media1080 = randomUUID();
const mediaCinemaScope = randomUUID();
const title = `Film multi-version ${catalogId}`;

db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Versions', ?, 'movie', 'fr-FR')")
  .run(libraryId, `D:/versions-${libraryId}`);
db.prepare("INSERT INTO profiles (id, name, avatar_color, language) VALUES (?, 'Versions', '#2968ff', 'fr-FR')").run(profileId);
db.prepare(`INSERT INTO catalog_items (id, library_id, kind, title, sort_title, year)
  VALUES (?, ?, 'movie', ?, ?, 2026)`).run(catalogId, libraryId, title, title.toLocaleLowerCase("fr"));

const probe4k = JSON.stringify({ streams: [{ index: 0, codec_type: "video", codec_name: "hevc", width: 3840, height: 2160,
  color_transfer: "smpte2084", color_primaries: "bt2020" }] });
const probe1080 = JSON.stringify({ streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }] });
const probeCinemaScope = JSON.stringify({ streams: [{ index: 0, codec_type: "video", codec_name: "hevc", width: 1920, height: 804 }] });
const insert = db.prepare(`INSERT INTO media_items (id, catalog_id, kind, title, sort_title, file_path, file_size,
  embedded_metadata_json, library_id, runtime_seconds, year, available) VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, ?, 5400, 2026, 1)`);
insert.run(media4k, catalogId, title, title.toLocaleLowerCase("fr"), `D:/versions/${title} 2160p.mkv`, 20_000_000_000, probe4k, libraryId);
insert.run(media1080, catalogId, title, title.toLocaleLowerCase("fr"), `D:/versions/${title} 1080p.mkv`, 4_000_000_000, probe1080, libraryId);
insert.run(mediaCinemaScope, catalogId, title, title.toLocaleLowerCase("fr"), `D:/versions/${title} CinemaScope.mkv`, 3_000_000_000, probeCinemaScope, libraryId);

afterAll(() => {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM catalog_items WHERE id = ?").run(catalogId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  db.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
});

describe("films possédant plusieurs fichiers", () => {
  it("n'affiche qu'une carte de catalogue", () => {
    const page = listCatalog(profileId, { kind: "movies", query: title, limit: 20 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.catalogId).toBe(catalogId);
  });

  it("expose chaque fichier et sa qualité avant la lecture", () => {
    const details = getDetails(profileId, catalogId);
    expect(details?.versions).toEqual([
      expect.objectContaining({ mediaId: media4k, quality: "4K · HDR10 · HEVC/H.265" }),
      expect.objectContaining({ mediaId: media1080, quality: "1080p · SDR · H.264" }),
      expect.objectContaining({ mediaId: mediaCinemaScope, quality: "1080p · SDR · HEVC/H.265" }),
    ]);
    expect(details?.qualities).toEqual(["4K · HDR10 · HEVC/H.265", "1080p · SDR · H.264", "1080p · SDR · HEVC/H.265"]);
  });
});
