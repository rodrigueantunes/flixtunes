import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { MATCH_THRESHOLDS } from "./match-engine.js";
import {
  aRevoir, buildProviderStatuses, comparerCandidates, fetchMetadataWithProviders, resetProviderRuntimeCaches,
  providerEvidenceOverridesRejectedDetection, searchAllMetadata, tmdbConfirmedByFallback,
} from "./metadata-providers.js";
import type { MetadataSearchCandidate } from "@flixtunes/contracts";

const originalLicensed = {
  tmdbToken: config.tmdbToken,
  imdbApiUrl: config.imdbApiUrl,
  imdbApiToken: config.imdbApiToken,
  allocineApiUrl: config.allocineApiUrl,
  allocineApiToken: config.allocineApiToken,
  fanartApiKey: config.fanartApiKey,
  tvdbApiKey: config.tvdbApiKey,
  tvdbPin: config.tvdbPin,
};

afterEach(() => {
  Object.assign(config, originalLicensed);
  resetProviderRuntimeCaches();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fournisseurs de métadonnées", () => {
  it("garde les NFO actifs hors ligne et interdit le scraping implicite", () => {
    const providers = buildProviderStatuses({ tmdbToken: null, tvdbApiKey: null, fanartApiKey: null,
      imdbApiUrl: null, imdbApiToken: null, allocineApiUrl: null, allocineApiToken: null });
    expect(providers.find((provider) => provider.id === "local")).toMatchObject({ enabled: true, legalMode: "local" });
    expect(providers.find((provider) => provider.id === "tvmaze")).toMatchObject({ configured: true, enabled: true, legalMode: "open-api" });
    expect(providers.find((provider) => provider.id === "wikidata")).toMatchObject({ configured: true, enabled: true, legalMode: "open-api" });
    expect(providers.find((provider) => provider.id === "imdb")).toMatchObject({ enabled: false, legalMode: "licensed-api" });
    expect(providers.find((provider) => provider.id === "allocine")?.message).toContain("Pas de scraping");
  });

  it("active uniquement les connecteurs complètement configurés", () => {
    const providers = buildProviderStatuses({ tmdbToken: "tmdb", tvdbApiKey: "tvdb", fanartApiKey: "fanart",
      imdbApiUrl: "https://licensed.example", imdbApiToken: null,
      allocineApiUrl: "https://licensed.example", allocineApiToken: "token" });
    expect(providers.find((provider) => provider.id === "tmdb")?.enabled).toBe(true);
    expect(providers.find((provider) => provider.id === "imdb")?.enabled).toBe(false);
    expect(providers.find((provider) => provider.id === "allocine")?.enabled).toBe(true);
  });

  it("interroge réellement un connecteur IMDb licencié normalisé", async () => {
    config.imdbApiUrl = "https://licensed.example/search";
    config.imdbApiToken = "secret-test";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("query")).toBe("Dune");
      expect(url.searchParams.get("language")).toBe("fr-FR");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-test");
      return new Response(JSON.stringify({ results: [{ imdbId: "tt1160419", title: "Dune", year: 2021,
        overview: "Le désert d'Arrakis.", posterUrl: "https://images.example/dune.jpg" }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }));
    const results = await searchAllMetadata("movie", "Dune", "fr-FR", 2021);
    expect(results[0]).toMatchObject({ provider: "imdb", externalId: "tt1160419", title: "Dune", score: 1 });
  });

  it("utilise le fournisseur licencié comme repli d'enrichissement", async () => {
    config.imdbApiUrl = "https://licensed.example/search";
    config.imdbApiToken = "secret-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{
      id: "tt1160419", title: "Dune", originalTitle: "Dune", year: 2021, overview: "Arrakis",
      poster: "https://images.example/dune.jpg",
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const bundle = await fetchMetadataWithProviders({ kind: "movie", title: "Dune", year: 2021, showTitle: null,
      seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ provider: "imdb", externalId: "tt1160419", language: "fr-FR", confidence: 1 });
  });

  it("isole une panne TMDB et conserve les résultats d'un autre fournisseur", async () => {
    config.tmdbToken = "tmdb-indisponible";
    config.imdbApiUrl = "https://licensed.example/search";
    config.imdbApiToken = "secret-test";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("themoviedb.org")) throw new Error("TMDB hors ligne");
      return Response.json({ results: [{ imdbId: "tt1375666", title: "Inception", year: 2010 }] });
    }));
    const results = await searchAllMetadata("movie", "Inception", "fr-FR", 2010);
    expect(results[0]).toMatchObject({ provider: "imdb", externalId: "tt1375666" });
  });

  it("utilise réellement Fanart.tv comme repli d'affiche localisée", async () => {
    config.fanartApiKey = "fanart-test";
    const { augmentArtworkWithFanart } = await import("./metadata-providers.js");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain("/v3/movies/42");
      return new Response(JSON.stringify({ movieposter: [
        { url: "https://images.example/en.jpg", lang: "en", likes: "20" },
        { url: "https://images.example/fr.jpg", lang: "fr", likes: "3" },
      ], moviebackground: [{ url: "https://images.example/backdrop.jpg", lang: "00", likes: "1" }] }), { status: 200 });
    }));
    const bundle = await augmentArtworkWithFanart({ movie: { provider: "tmdb", externalId: "42", imdbId: null,
      title: "Film", originalTitle: null, overview: null, year: 2026, runtimeSeconds: null, posterSourceUrl: null,
      backdropSourceUrl: null, language: "fr-FR", confidence: 1 } }, "movie", "fr-FR");
    expect(bundle?.movie).toMatchObject({ posterSourceUrl: "https://images.example/fr.jpg", backdropSourceUrl: "https://images.example/backdrop.jpg" });
  });
});

describe("départage entre fournisseurs à score égal", () => {
  const candidate = (provider: MetadataSearchCandidate["provider"], score: number): MetadataSearchCandidate => ({
    provider, kind: "movie", externalId: `${provider}-1`, title: "Le Bon Film", originalTitle: null,
    overview: null, year: 2020, posterUrl: null, score,
  });

  it("place TMDB devant Wikidata quand les deux sont parfaits", () => {
    // Constaté à l'usage : Wikidata passait devant. Le tri ne portait que sur le score, et `sort`
    // étant stable, c'était l'ordre de lancement des requêtes qui décidait — Wikidata est interrogé
    // en premier. Un détail d'implémentation choisissait la fiche.
    const trié = [candidate("wikidata", 1), candidate("tmdb", 1)].sort(comparerCandidates);
    expect(trié[0]?.provider).toBe("tmdb");
  });

  it("place TMDB devant TVmaze à score égal", () => {
    const trié = [candidate("tvmaze", 0.95), candidate("tmdb", 0.95)].sort(comparerCandidates);
    expect(trié[0]?.provider).toBe("tmdb");
  });

  it("ne fait jamais passer la préférence de fournisseur avant le score", () => {
    // Une fiche Wikidata exacte vaut mieux qu'une fiche TMDB approximative : le fournisseur ne
    // départage qu'à égalité, il ne rattrape pas une mauvaise correspondance.
    const trié = [candidate("tmdb", 0.7), candidate("wikidata", 1)].sort(comparerCandidates);
    expect(trié[0]?.provider).toBe("wikidata");
  });

  it("classe un fournisseur inconnu après ceux qu'on connaît, sans le rejeter", () => {
    const inconnu = { ...candidate("tmdb", 1), provider: "autre" as MetadataSearchCandidate["provider"] };
    const trié = [inconnu, candidate("wikidata", 1)].sort(comparerCandidates);
    expect(trié[0]?.provider).toBe("wikidata");
    expect(trié).toHaveLength(2);
  });
});

describe("indisponibilité de TMDB", () => {
  const entite = (confidence: number) => ({
    provider: "wikidata" as const, externalId: "Q42", imdbId: null, title: "Amistad",
    originalTitle: null, overview: null, year: 1997, runtimeSeconds: null,
    posterSourceUrl: null, backdropSourceUrl: null, language: "fr-FR", confidence,
  });

  it("ramène un repli sous le seuil d'acceptation automatique", () => {
    // Mesuré sur la médiathèque réelle : 39 films restés sur Wikidata alors que TMDB les rend
    // aujourd'hui à un score parfait — Amistad, BAC Nord, Camping 3. Une analyse complète dépasse la
    // limite de débit, le coupe-circuit s'ouvre quarante-cinq secondes, et pendant ce temps chaque
    // fiche basculait sur un fournisseur de secours dont le résultat était figé comme certitude.
    const revu = aRevoir({ movie: entite(1) });
    expect(revu.movie!.confidence).toBeLessThan(MATCH_THRESHOLDS.automatic);
  });

  it("laisse le contenu intact : c'est la certitude qui baisse, pas la fiche", () => {
    // Mieux vaut une fiche Wikidata qu'aucune fiche. Ce qui change, c'est qu'elle sera réexaminée.
    const revu = aRevoir({ movie: entite(1) });
    expect(revu.movie!.title).toBe("Amistad");
    expect(revu.movie!.year).toBe(1997);
  });

  it("n'augmente jamais la confiance d'un repli déjà faible", () => {
    const revu = aRevoir({ movie: entite(0.3) });
    expect(revu.movie!.confidence).toBe(0.3);
  });

  it("traite de la même façon les séries, saisons et épisodes", () => {
    const revu = aRevoir({ show: entite(1), season: entite(1), episode: entite(1) });
    for (const partie of [revu.show, revu.season, revu.episode]) {
      expect(partie!.confidence).toBeLessThan(MATCH_THRESHOLDS.automatic);
    }
  });

  it("ne re-promeut pas à 100 % un fournisseur agrégé pendant une panne TMDB", async () => {
    // Régression observée dans le journal réel : BAC Nord revenait de TMDB vers Wikidata et Silo
    // restait sur TVmaze. L'échec TMDB était absorbé par Promise.allSettled, puis la candidate de
    // secours recréée plus bas échappait à aRevoir.
    vi.stubEnv("NODE_ENV", "production");
    config.tmdbToken = "tmdb-indisponible";
    config.imdbApiUrl = "https://licensed.example/search";
    config.imdbApiToken = "secret-test";
    config.allocineApiUrl = null;
    config.allocineApiToken = null;
    config.fanartApiKey = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("themoviedb.org")) throw new Error("TMDB hors ligne");
      if (url.includes("licensed.example")) return Response.json({ results: [
        { imdbId: "tt10954984", title: "BAC Nord", year: 2021 },
      ] });
      if (url.includes("wikidata.org")) return Response.json({ search: [] });
      if (url.includes("graphql.anilist.co")) return Response.json({ data: { Page: { media: [] } } });
      throw new Error(url);
    }));

    const bundle = await fetchMetadataWithProviders({ kind: "movie", title: "BAC Nord", year: 2021,
      showTitle: null, seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ provider: "imdb", title: "BAC Nord" });
    expect(bundle!.movie!.confidence).toBeLessThan(MATCH_THRESHOLDS.automatic);
  });
});

describe("TVmaze comme preuve, TMDB comme fiche", () => {
  const candidate = (externalId: string, year: number, providerSearchRank: number): MetadataSearchCandidate & { providerSearchRank: number } => ({
    provider: "tmdb", kind: "tv", externalId, title: "Silo", originalTitle: "Silo", year,
    overview: null, posterUrl: null, score: 1, providerSearchRank,
  });
  const fallback = {
    provider: "tvmaze" as const, externalId: "38052", imdbId: null, title: "Silo", originalTitle: null,
    overview: null, year: 2023, runtimeSeconds: null, posterSourceUrl: null, backdropSourceUrl: null,
    language: "fr-FR", confidence: 1,
  };

  it("charge la fiche TMDB de la même année au lieu de conserver TVmaze", () => {
    const selected = tmdbConfirmedByFallback([
      candidate("125988", 2023, 0), candidate("256215", 2017, 1),
    ], fallback);
    expect(selected).toMatchObject({ provider: "tmdb", externalId: "125988", year: 2023 });
  });

  it("reste prudent si le fournisseur secondaire n'apporte aucune année", () => {
    expect(tmdbConfirmedByFallback([candidate("125988", 2023, 0), candidate("256215", 2017, 1)],
      { ...fallback, year: null })).toBeNull();
  });

  it("résout réellement Silo par TVmaze puis charge ses détails français depuis TMDB", async () => {
    vi.stubEnv("NODE_ENV", "production");
    config.tmdbToken = "tmdb-test";
    config.tvdbApiKey = null;
    config.tvdbPin = null;
    config.imdbApiUrl = null;
    config.imdbApiToken = null;
    config.allocineApiUrl = null;
    config.allocineApiToken = null;
    config.fanartApiKey = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/search/tv") return Response.json({ results: [
        { id: 125988, name: "Silo", original_name: "Silo", first_air_date: "2023-05-04" },
        { id: 256215, name: "Silo", original_name: "Silo", first_air_date: "2017-01-01" },
      ] });
      if (url.hostname === "api.themoviedb.org" && url.pathname === "/3/tv/125988") return Response.json({
        id: 125988, name: "Silo", original_name: "Silo", overview: "Synopsis français.",
        first_air_date: "2023-05-04", original_language: "en", images: { posters: [], backdrops: [] },
      });
      if (url.hostname === "api.tvmaze.com" && url.pathname === "/search/shows") return Response.json([{ score: 1, show: {
        id: 38052, name: "Silo", language: "English", premiered: "2023-05-04", summary: "English synopsis.",
      } }]);
      if (url.hostname === "api.tvmaze.com" && url.pathname === "/shows/38052/akas") return Response.json([]);
      if (url.hostname === "api.tvmaze.com" && url.pathname === "/shows/38052") return Response.json({
        id: 38052, name: "Silo", language: "English", premiered: "2023-05-04", summary: "English synopsis.",
      });
      if (url.hostname.includes("wikidata.org")) return Response.json({ search: [] });
      if (url.hostname === "graphql.anilist.co") return Response.json({ data: { Page: { media: [] } } });
      throw new Error(url.toString());
    }));

    const bundle = await fetchMetadataWithProviders({ kind: "episode", title: "Épisode 1", showTitle: "Silo",
      year: null, seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.show).toMatchObject({
      provider: "tmdb", externalId: "125988", title: "Silo", overview: "Synopsis français.",
    });
  });
});

describe("arbitrage entre la détection locale et les fournisseurs", () => {
  it("rattrape OSS 117 quand deux fournisseurs confirment exactement la même œuvre", () => {
    expect(providerEvidenceOverridesRejectedDetection("automatic",
      ["titre exact", "œuvre confirmée par 2 fournisseurs"])).toBe(true);
  });

  it("ne contourne pas un rejet local avec une preuve isolée, approchante ou ambiguë", () => {
    expect(providerEvidenceOverridesRejectedDetection("automatic", ["titre exact"])).toBe(false);
    expect(providerEvidenceOverridesRejectedDetection("automatic",
      ["titre très proche", "œuvre confirmée par 2 fournisseurs"])).toBe(false);
    expect(providerEvidenceOverridesRejectedDetection("review",
      ["titre exact", "œuvre confirmée par 2 fournisseurs"])).toBe(false);
  });
});
