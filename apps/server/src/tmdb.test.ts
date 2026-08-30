import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { classificationAge, fetchMetadataBundle, numeroRelatif, resetTmdbRuntimeCaches, titleMatchScore, tmdbBreaker } from "./tmdb.js";
import { LimiteDeDebit } from "./resilience.js";

const originalToken = config.tmdbToken;

afterEach(() => {
  config.tmdbToken = originalToken;
  resetTmdbRuntimeCaches();
  vi.unstubAllGlobals();
});

describe("titleMatchScore", () => {
  it("normalise les classifications d'âge usuelles sans inventer d'âge pour un contenu non classé", () => {
    expect(classificationAge("Tous publics")).toBe(0);
    expect(classificationAge("-12")).toBe(12);
    expect(classificationAge("TV-14")).toBe(14);
    expect(classificationAge("FSK 16")).toBe(16);
    expect(classificationAge("Unrated")).toBeNull();
  });

  it("ignore les accents, la casse et les articles", () => {
    expect(titleMatchScore("Le Fabuleux Destin d'Amélie Poulain", "Fabuleux destin d Amelie Poulain")).toBe(1);
  });

  it("favorise fortement une année exacte", () => {
    expect(titleMatchScore("Dune", "Dune", 2021, 2021)).toBeGreaterThan(titleMatchScore("Dune", "Dune", 2021, 1984));
  });

  it("rejette les titres sans rapport", () => {
    expect(titleMatchScore("Blade Runner", "Le Seigneur des anneaux", 1982, 2001)).toBeLessThan(0.4);
  });

  it("préfère une affiche française et conserve le repli anglais côté serveur", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/movie")) return Response.json({ results: [{ id: 438631, title: "Dune", original_title: "Dune", release_date: "2021-09-15" }] });
      if (url.includes("/movie/438631")) return Response.json({
        id: 438631, title: "Dune", original_title: "Dune", overview: "Une épopée.", release_date: "2021-09-15",
        runtime: 155, original_language: "en", external_ids: { imdb_id: "tt1160419" },
        images: {
          posters: [
            { file_path: "/poster-de.jpg", iso_639_1: "de", vote_average: 10 },
            { file_path: "/poster-en.jpg", iso_639_1: "en", vote_average: 9 },
            { file_path: "/poster-fr.jpg", iso_639_1: "fr", vote_average: 7 },
          ],
          backdrops: [{ file_path: "/backdrop.jpg", iso_639_1: null, vote_average: 8 }],
        },
        credits: {
          cast: [{ id: 1190668, name: "Timothée Chalamet", profile_path: "/timothee.jpg", character: "Paul Atréides", order: 0 }],
          crew: [{ id: 137427, name: "Denis Villeneuve", profile_path: "/denis.jpg", job: "Director", department: "Directing" }],
        },
      });
      return new Response(null, { status: 404 });
    }));

    const bundle = await fetchMetadataBundle({
      kind: "movie", title: "Dune", year: 2021, showTitle: null, seasonNumber: null, episodeNumber: null,
    }, "fr-FR");
    expect(bundle?.movie).toMatchObject({
      title: "Dune", imdbId: "tt1160419", runtimeSeconds: 9300,
      posterSourceUrl: "https://image.tmdb.org/t/p/w500/poster-fr.jpg",
    });
    expect(bundle?.movie?.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "1190668", name: "Timothée Chalamet", role: "actor", character: "Paul Atréides",
        profileUrl: "/api/metadata/image/w185/timothee.jpg" }),
      expect.objectContaining({ externalId: "137427", name: "Denis Villeneuve", role: "director" }),
    ]));
  });

  it("utilise les textes anglais seulement quand la traduction française est absente", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/search/movie")) return Response.json({ results: [{ id: 1, title: "Titre recherché", release_date: "2024-01-01" }] });
      if (url.searchParams.get("language") === "fr-FR") return Response.json({ id: 1, original_title: "English title", overview: "", release_date: "2024-01-01", images: { posters: [] } });
      return Response.json({ id: 1, title: "English title", overview: "English overview", release_date: "2024-01-01",
        images: { posters: [{ file_path: "/english.jpg", iso_639_1: "en" }] } });
    }));
    const bundle = await fetchMetadataBundle({ kind: "movie", title: "Titre recherché", year: 2024, showTitle: null, seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ title: "English title", overview: "English overview", language: "fr-FR",
      posterSourceUrl: "https://image.tmdb.org/t/p/w500/english.jpg" });
  });

  it("construit la hiérarchie série, saison et épisode", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/tv")) return Response.json({ results: [{ id: 95396, name: "Severance", first_air_date: "2022-02-17" }] });
      if (url.includes("/season/1/episode/2")) return Response.json({ id: 1457735, name: "Demi-boucle", overview: "Épisode deux.", runtime: 53 });
      if (url.includes("/season/1")) return Response.json({
        id: 140181, name: "Saison 1", overview: "Première saison.", season_number: 1,
        images: { posters: [{ file_path: "/season-fr.jpg", iso_639_1: "fr", vote_average: 8 }] },
      });
      if (url.includes("/tv/95396")) return Response.json({
        id: 95396, name: "Severance", original_name: "Severance", overview: "Une équipe séparée.",
        first_air_date: "2022-02-17", original_language: "en", external_ids: { imdb_id: "tt11280740" },
        images: { posters: [{ file_path: "/show-fr.jpg", iso_639_1: "fr", vote_average: 8 }] },
      });
      return new Response(null, { status: 404 });
    }));

    const bundle = await fetchMetadataBundle({
      kind: "episode", title: "Épisode 2", year: null, showTitle: "Severance", seasonNumber: 1, episodeNumber: 2,
    }, "fr-FR");
    expect(bundle?.show?.title).toBe("Severance");
    expect(bundle?.season).toMatchObject({ title: "Saison 1", posterSourceUrl: "https://image.tmdb.org/t/p/w500/season-fr.jpg" });
    expect(bundle?.episode).toMatchObject({ title: "Demi-boucle", runtimeSeconds: 3180 });
  });

  it("préfère la traduction française explicite d'un épisode à son texte anglais", async () => {
    config.tmdbToken = "test-token";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/3/search/tv") return Response.json({ results: [
        { id: 125988, name: "Silo", first_air_date: "2023-05-04" },
      ] });
      if (url.pathname === "/3/tv/125988/season/1/episode/1") {
        expect(url.searchParams.get("append_to_response")?.split(",")).toContain("translations");
        return Response.json({
          id: 4278421, name: "Freedom Day", overview: "English overview.", runtime: 59,
          translations: { translations: [
            { iso_639_1: "fr", iso_3166_1: "CA", data: { name: "Jour de liberté (CA)" } },
            { iso_639_1: "fr", iso_3166_1: "FR", data: { name: "Jour de liberté", overview: "Résumé français." } },
          ] },
        });
      }
      if (url.pathname === "/3/tv/125988/season/1") return Response.json({
        id: 338142, name: "Saison 1", overview: "Première saison.", season_number: 1,
      });
      if (url.pathname === "/3/tv/125988") return Response.json({
        id: 125988, name: "Silo", original_name: "Silo", overview: "Dans un immense silo.",
        first_air_date: "2023-05-04", original_language: "en",
      });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bundle = await fetchMetadataBundle({
      kind: "episode", title: "Épisode 1", year: 2023, showTitle: "Silo", seasonNumber: 1, episodeNumber: 1,
    }, "fr-FR");
    expect(bundle?.episode).toMatchObject({ title: "Jour de liberté", overview: "Résumé français.", language: "fr-FR" });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/season/1/episode/1"))).toHaveLength(1);
  });

  it("continue l'élargissement après une suite de mauvaise année", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/3/search/movie") {
        const query = url.searchParams.get("query");
        const exactYear = url.searchParams.has("primary_release_year");
        if (query === "Destination Finale I" && exactYear) return Response.json({ results: [] });
        if (query === "Destination Finale I") return Response.json({ results: [
          { id: 19912, title: "Destination finale 4", release_date: "2009-08-26" },
        ] });
        if (query === "Destination Finale" && exactYear) return Response.json({ results: [
          { id: 9532, title: "Destination finale", release_date: "2000-03-17" },
        ] });
        return Response.json({ results: [] });
      }
      if (url.pathname === "/3/movie/9532") return Response.json({
        id: 9532, title: "Destination finale", release_date: "2000-03-17", images: { posters: [], backdrops: [] },
      });
      return new Response(null, { status: 404 });
    }));
    const bundle = await fetchMetadataBundle({ kind: "movie", title: "Destination Finale I", year: 2000,
      showTitle: null, seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ externalId: "9532", year: 2000 });
  });

  it("résout directement un identifiant IMDb exact", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/3/find/tt1160419") {
        expect(url.searchParams.get("external_source")).toBe("imdb_id");
        return Response.json({ movie_results: [{ id: 438631, title: "Dune", release_date: "2021-09-15" }] });
      }
      if (url.pathname === "/3/movie/438631") return Response.json({
        id: 438631, title: "Dune", release_date: "2021-09-15", images: { posters: [], backdrops: [] },
      });
      return new Response(null, { status: 404 });
    }));
    const bundle = await fetchMetadataBundle({ kind: "movie", title: "Nom sans rapport", year: 1900,
      showTitle: null, seasonNumber: null, episodeNumber: null, externalIds: { imdb: "tt1160419" } }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ externalId: "438631", confidence: 1 });
  });

  it("conserve le titre alternatif grâce auquel TMDB a retrouvé Hulk", async () => {
    config.tmdbToken = "test-token";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/3/search/movie") return Response.json({ results: [
        { id: 1724, title: "L'Incroyable Hulk", original_title: "The Incredible Hulk", release_date: "2008-06-12" },
        { id: 999, title: "Hulk : Le monstre vert", original_title: "Hulk: The Green Monster", release_date: "2008-01-01" },
      ] });
      if (url.pathname === "/3/movie/1724/alternative_titles") return Response.json({
        titles: [{ iso_3166_1: "FR", title: "Hulk" }, { iso_3166_1: "US", title: "The Incredible Hulk" }],
      });
      if (url.pathname === "/3/movie/999/alternative_titles") return Response.json({ titles: [] });
      if (url.pathname === "/3/movie/1724") return Response.json({
        id: 1724, title: "L'Incroyable Hulk", original_title: "The Incredible Hulk", release_date: "2008-06-12",
        images: { posters: [{ file_path: "/hulk.jpg", iso_639_1: "fr" }], backdrops: [] },
      });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const bundle = await fetchMetadataBundle({ kind: "movie", title: "Hulk", year: 2008,
      showTitle: null, seasonNumber: null, episodeNumber: null }, "fr-FR");
    expect(bundle?.movie).toMatchObject({ externalId: "1724", title: "L'Incroyable Hulk",
      posterSourceUrl: "https://image.tmdb.org/t/p/w500/hulk.jpg" });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/movie/1724/alternative_titles"))).toBe(true);
  });
});

describe("numérotation absolue", () => {
  // Découpage réel d'une série longue : les épisodes sont numérotés en continu sur le disque alors
  // que le fournisseur les range par saison.
  const saisons = [
    { season_number: 0, episode_count: 12 },
    { season_number: 1, episode_count: 32 },
    { season_number: 2, episode_count: 21 },
    { season_number: 3, episode_count: 18 },
    { season_number: 4, episode_count: 25 },
  ];

  it("convertit un numéro continu en couple saison/épisode", () => {
    // 78 = 32 + 21 + 18 + 7 : septième épisode de la saison 4.
    expect(numeroRelatif(saisons, 78)).toEqual({ season: 4, episode: 7 });
    expect(numeroRelatif(saisons, 33)).toEqual({ season: 2, episode: 1 });
    expect(numeroRelatif(saisons, 53)).toEqual({ season: 2, episode: 21 });
    expect(numeroRelatif(saisons, 54)).toEqual({ season: 3, episode: 1 });
  });

  it("ne touche pas à un numéro qui tient dans la première saison", () => {
    // C'est le cas ordinaire, déjà traité par la recherche directe : y toucher serait une régression.
    expect(numeroRelatif(saisons, 1)).toBeNull();
    expect(numeroRelatif(saisons, 32)).toBeNull();
  });

  it("ignore les spéciaux et refuse de désigner un épisode au hasard", () => {
    // La saison 0 ne compte pas dans une numérotation continue : sans cela, tout serait décalé de 12.
    expect(numeroRelatif(saisons, 96)).toEqual({ season: 4, episode: 25 });
    // Au-delà du total connu, mieux vaut aucun titre qu'un titre faux.
    expect(numeroRelatif(saisons, 97)).toBeNull();
    expect(numeroRelatif(saisons, 5000)).toBeNull();
  });

  it("reste muet quand la structure des saisons est absente ou inexploitable", () => {
    expect(numeroRelatif(undefined, 78)).toBeNull();
    expect(numeroRelatif([], 78)).toBeNull();
    expect(numeroRelatif([{ season_number: 1 }], 78)).toBeNull();
    expect(numeroRelatif(saisons, 0)).toBeNull();
    expect(numeroRelatif(saisons, -3)).toBeNull();
    expect(numeroRelatif(saisons, 4.5)).toBeNull();
  });
});

/**
 * Le défaut mesuré en r87 : TMDB « disparaissait » au bout de quelques centaines de fiches, puis
 * revenait trente à soixante secondes plus tard. Il n'était jamais tombé — il demandait d'attendre,
 * et le coupe-circuit comptait cette demande comme une panne.
 */
describe("TMDB face à une limitation de débit", () => {
  const filmDune = {
    id: 438631, title: "Dune", original_title: "Dune", overview: "Une épopée.",
    release_date: "2021-09-15", runtime: 155, original_language: "en",
  };

  it("attend le délai demandé, puis obtient la fiche", async () => {
    config.tmdbToken = "test-token";
    const attentes: number[] = [];
    let recherches = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/movie")) {
        recherches += 1;
        // Le premier appel est freiné, le second passe : c'est le comportement d'un service vivant.
        if (recherches === 1) {
          attentes.push(1);
          return new Response(null, { status: 429, headers: { "retry-after": "0" } });
        }
        return Response.json({ results: [filmDune] });
      }
      if (url.includes("/movie/438631")) return Response.json({ ...filmDune, external_ids: {} });
      return new Response(null, { status: 404 });
    }));

    const bundle = await fetchMetadataBundle({
      kind: "movie", title: "Dune", year: 2021, showTitle: null, seasonNumber: null, episodeNumber: null,
    }, "fr-FR");

    expect(attentes).toHaveLength(1);
    expect(recherches).toBe(2);
    expect(bundle?.movie?.title).toBe("Dune");
  });

  it("renonce en disant « limite de débit », et non « panne »", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "0" } })));

    await expect(fetchMetadataBundle({
      kind: "movie", title: "Dune", year: 2021, showTitle: null, seasonNumber: null, episodeNumber: null,
    }, "fr-FR")).rejects.toBeInstanceOf(LimiteDeDebit);

    // Et surtout : le fournisseur n'est pas isolé pour autant. C'est tout l'objet de la correction.
    expect(tmdbBreaker.state).toBe("closed");
  });

  it("porte le code HTTP dans le message, pour que l'écran puisse le dire", async () => {
    config.tmdbToken = "test-token";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(fetchMetadataBundle({
      kind: "movie", title: "Dune", year: 2021, showTitle: null, seasonNumber: null, episodeNumber: null,
    }, "fr-FR")).rejects.toThrow("TMDB 503");
  });
});
