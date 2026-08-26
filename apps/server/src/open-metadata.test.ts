import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTvmazeBundle, fetchWikidataBundle, resetOpenMetadataCaches, searchTvmaze, searchWikidata } from "./open-metadata.js";
import { parseMediaPath } from "./media-parser.js";

afterEach(() => { vi.unstubAllGlobals(); resetOpenMetadataCaches(); });

describe("agents de métadonnées sans clé", () => {
  it("identifie une série TVmaze et localise son titre français", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/shows")) return Response.json([{ score: 1, show: {
        id: 42, name: "The Watchers", premiered: "2024-01-01", summary: "<p>Une série</p>",
        image: { original: "https://images.example/show.jpg" }, externals: { imdb: "tt42", thetvdb: 99 },
      } }]);
      if (url.endsWith("/shows/42/akas")) return Response.json([{ name: "Les Veilleurs", country: { code: "FR" } }]);
      if (url.endsWith("/shows/42")) return Response.json({ id: 42, name: "The Watchers", premiered: "2024-01-01",
        summary: "<p>Une série</p>", image: { original: "https://images.example/show.jpg" }, externals: { imdb: "tt42", thetvdb: 99 } });
      if (url.endsWith("/shows/42/seasons")) return Response.json([{ id: 4201, number: 1, image: { original: "https://images.example/season.jpg" } }]);
      // Toute la série en un appel : c'est ce qui rend la récupération par épisode acceptable, là où
      // un appel par fichier aurait produit des milliers de requêtes pendant un premier scan.
      if (url.endsWith("/shows/42/episodes")) return Response.json([
        { id: 5001, name: "Premier signal", season: 1, number: 1, summary: "<p>Le commencement.</p>",
          image: { original: "https://images.example/e1.jpg" } },
        { id: 5002, name: "La relève", season: 1, number: 2, summary: null },
      ]);
      throw new Error(url);
    }));
    const candidates = await searchTvmaze("Les Veilleurs", "fr-FR", 2024);
    expect(candidates[0]).toMatchObject({ provider: "tvmaze", title: "Les Veilleurs", posterUrl: "https://images.example/show.jpg" });
    const bundle = await fetchTvmazeBundle({ kind: "episode", title: "Premier signal", showTitle: "Les Veilleurs",
      year: 2024, seasonNumber: 1, episodeNumber: 1 }, "fr-FR");
    expect(bundle?.show).toMatchObject({ provider: "tvmaze", title: "Les Veilleurs", imdbId: "tt42" });
    expect(bundle?.season?.posterSourceUrl).toBe("https://images.example/season.jpg");
    // Le détail de l'épisode : sans lui, le résumé de la série était recopié sur chacun d'eux.
    expect(bundle?.episode).toMatchObject({
      provider: "tvmaze", externalId: "5001", title: "Premier signal", overview: "Le commencement.",
      posterSourceUrl: "https://images.example/e1.jpg",
    });
  });

  it("laisse le résumé d'un épisode vide plutôt que d'emprunter celui de la série", async () => {
    // Un texte emprunté induit en erreur sur ce qu'on s'apprête à regarder ; une absence, non.
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/shows")) return Response.json([{ score: 1, show: {
        id: 42, name: "The Watchers", premiered: "2024-01-01", summary: "<p>Le synopsis de la serie.</p>" } }]);
      if (url.endsWith("/shows/42/akas")) return Response.json([]);
      if (url.endsWith("/shows/42")) return Response.json({ id: 42, name: "The Watchers", premiered: "2024-01-01",
        summary: "<p>Le synopsis de la serie.</p>" });
      if (url.endsWith("/shows/42/seasons")) return Response.json([{ id: 4201, number: 1 }]);
      if (url.endsWith("/shows/42/episodes")) return Response.json([{ id: 5002, name: "La releve", season: 1, number: 2, summary: null }]);
      throw new Error(url);
    }));
    const bundle = await fetchTvmazeBundle({ kind: "episode", title: "La releve", showTitle: "The Watchers",
      year: 2024, seasonNumber: 1, episodeNumber: 2 }, "en-US");
    expect(bundle?.episode?.title).toBe("La releve");
    expect(bundle?.episode?.overview, "aucun emprunt au synopsis de la serie").toBeNull();
    expect(bundle?.show?.overview).toContain("synopsis de la serie");
  });

  it("ne présente pas un épisode TVmaze anglais comme une traduction française", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/shows")) return Response.json([{ score: 1, show: {
        id: 125, name: "Silo", language: "English", premiered: "2023-05-04", summary: "English show summary." } }]);
      if (url.endsWith("/shows/125/akas")) return Response.json([]);
      if (url.endsWith("/shows/125")) return Response.json({
        id: 125, name: "Silo", language: "English", premiered: "2023-05-04", summary: "English show summary.",
      });
      if (url.endsWith("/shows/125/seasons")) return Response.json([{ id: 12501, number: 1 }]);
      if (url.endsWith("/shows/125/episodes")) return Response.json([{
        id: 125001, name: "Freedom Day", season: 1, number: 1, summary: "English episode summary.",
      }]);
      if (url.includes("wikidata.org") || url.includes("wikipedia.org")) return Response.json({ search: [], entities: {} });
      throw new Error(url);
    }));

    const bundle = await fetchTvmazeBundle({ kind: "episode", title: "Épisode 1", showTitle: "Silo",
      year: 2023, seasonNumber: 1, episodeNumber: 1 }, "fr-FR");
    expect(bundle?.episode).toMatchObject({
      title: "Épisode 1", originalTitle: "Freedom Day", overview: null, language: "fr-FR",
    });
  });

  it("complète le résumé français d'une série avec Wikidata/Wikipédia", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.tvmaze.com/search")) return Response.json([{ score: 1, show: { id: 42, name: "Ahsoka", premiered: "2023-08-22", image: { original: "https://img/ahsoka.jpg" }, externals: {} } }]);
      if (url.includes("api.tvmaze.com/shows/42/akas")) return Response.json([]);
      if (url.endsWith("/shows/42")) return Response.json({ id: 42, name: "Ahsoka", premiered: "2023-08-22", summary: "English summary", image: { original: "https://img/ahsoka.jpg" }, externals: {} });
      if (url.includes("wbsearchentities")) return Response.json({ search: [{ id: "Q107010632", label: "Ahsoka", description: "série télévisée américaine" }] });
      if (url.includes("wbgetentities")) return Response.json({ entities: { Q107010632: { labels: { fr: { value: "Ahsoka" }, en: { value: "Ahsoka" } }, descriptions: { fr: { value: "série Star Wars" } }, sitelinks: { frwiki: { title: "Ahsoka (série tévisée)" } }, claims: { P577: [{ mainsnak: { datavalue: { value: { time: "+2023-08-22T00:00:00Z" } } } }] } } } });
      if (url.includes("fr.wikipedia.org")) return Response.json({ extract: "Ahsoka est une série télévisée américaine de l'univers Star Wars." });
      if (url.includes("/seasons")) return Response.json([]);
      return new Response("introuvable", { status: 404 });
    }) as typeof fetch;
    try {
      const bundle = await fetchTvmazeBundle(parseMediaPath("D:/TV/Ahsoka (2023)/Saison 1/Ahsoka.S01E01.mkv", "tv"), "fr-FR");
      expect(bundle?.show?.overview).toContain("série télévisée américaine");
      expect(bundle?.show?.posterSourceUrl).toBe("https://img/ahsoka.jpg");
    } finally { globalThis.fetch = originalFetch; resetOpenMetadataCaches(); }
  });

  it("identifie un film Wikidata et construit son affiche Wikimedia", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("wbsearchentities")) return Response.json({ search: [{ id: "Q7", label: "Dune", description: "film de science-fiction" }] });
      if (url.includes("wbgetentities")) return Response.json({ entities: { Q7: {
        labels: { fr: { value: "Dune" }, en: { value: "Dune" } }, descriptions: { fr: { value: "film de science-fiction" } },
        sitelinks: { frwiki: { title: "Dune (film, 2021)" } }, claims: { P577: [{ mainsnak: { datavalue: { value: { time: "+2021-01-01T00:00:00Z" } } } }],
          P18: [{ mainsnak: { datavalue: { value: "Dune poster.jpg" } } }], P345: [{ mainsnak: { datavalue: { value: "tt1160419" } } }] },
      } } });
      if (url.includes("wikipedia.org/api/rest_v1/page/summary")) return Response.json({ extract: "Un long métrage de science-fiction." });
      throw new Error(url);
    }));
    const candidates = await searchWikidata("Dune", "fr-FR", 2021);
    expect(candidates[0]).toMatchObject({ provider: "wikidata", title: "Dune", year: 2021 });
    const bundle = await fetchWikidataBundle({ kind: "movie", title: "Dune", year: 2021, showTitle: null,
      seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ imdbId: "tt1160419", provider: "wikidata" });
    expect(bundle?.movie?.posterSourceUrl).toContain("Special:Redirect/file/Dune%20poster.jpg");
  });
});
