import { describe, expect, it } from "vitest";
import type { MetadataBundle } from "./tmdb.js";
import { applyLocalMetadataFallbacks } from "./scanner.js";

function localizedMovie(overview: string | null): MetadataBundle {
  return { movie: { provider: "tmdb", externalId: "1", imdbId: null, title: "La Chute du Président",
    originalTitle: "Angel Has Fallen", overview, year: 2019, runtimeSeconds: null,
    posterSourceUrl: null, backdropSourceUrl: null, language: "fr-FR", confidence: 1 } };
}

describe("priorité de localisation du scanner", () => {
  it("conserve le titre et le résumé français du fournisseur", () => {
    const bundle = applyLocalMetadataFallbacks({ kind: "movie", title: "Angel Has Fallen", year: 2019,
      showTitle: null, seasonNumber: null, episodeNumber: null, overview: "Embedded English overview" }, localizedMovie("Résumé français"));
    expect(bundle?.movie).toMatchObject({ title: "La Chute du Président", overview: "Résumé français" });
  });

  it("utilise le résumé local uniquement pour combler un champ absent", () => {
    const bundle = applyLocalMetadataFallbacks({ kind: "movie", title: "Angel Has Fallen", year: 2019,
      showTitle: null, seasonNumber: null, episodeNumber: null, overview: "Résumé local" }, localizedMovie(null));
    expect(bundle?.movie).toMatchObject({ title: "La Chute du Président", overview: "Résumé local" });
  });
});
