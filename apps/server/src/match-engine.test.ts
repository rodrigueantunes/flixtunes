import { describe, expect, it } from "vitest";
import { rankMetadataMatches, scoreMetadataMatch } from "./match-engine.js";

const candidate = { provider: "tmdb" as const, externalId: "42", kind: "movie" as const, title: "Blade Runner",
  originalTitle: "Blade Runner", year: 1982, overview: null, posterUrl: null, score: 0 };

describe("moteur de correspondance", () => {
  it("valide un titre et une année exacts avec une explication", () => {
    expect(scoreMetadataMatch({ title: "Blade.Runner", year: 1982 }, candidate)).toMatchObject({ status: "automatic", reasons: ["titre exact", "année exacte"] });
  });
  it("donne la priorité absolue à un identifiant externe", () => {
    expect(scoreMetadataMatch({ title: "Mauvais titre", year: 2020, externalIds: { tmdb: "42" } }, candidate))
      .toMatchObject({ score: 1, status: "automatic" });
  });
  it("rejette une correspondance sans rapport", () => {
    expect(scoreMetadataMatch({ title: "Casablanca", year: 1942 }, candidate).status).toBe("rejected");
  });
  it("place une correspondance moyenne dans la file de revue", () => {
    const partial = { ...candidate, title: "Blade Runner Final Cut", originalTitle: null };
    expect(scoreMetadataMatch({ title: "Blade Runner 2049", year: null }, partial).status).toBe("review");
  });
  it("n'automatise jamais un titre exact portant une année très éloignée", () => {
    const wrong = { ...candidate, title: "Destination Finale", originalTitle: null, year: 2009 };
    expect(scoreMetadataMatch({ title: "Destination Finale", year: 2000 }, wrong)).toMatchObject({ status: "review" });
  });
  it("préserve les alphabets non latins dans la comparaison", () => {
    const japanese = { ...candidate, title: "千と千尋の神隠し", originalTitle: null, year: 2001 };
    expect(scoreMetadataMatch({ title: "千と千尋の神隠し", year: 2001 }, japanese).status).toBe("automatic");
  });
  it("considère un titre alternatif fournisseur comme une preuve explicite", () => {
    const hulk = { ...candidate, externalId: "1724", title: "L'Incroyable Hulk",
      originalTitle: "The Incredible Hulk", alternativeTitles: ["Hulk"], year: 2008 };
    expect(scoreMetadataMatch({ title: "Hulk", year: 2008 }, hulk)).toMatchObject({
      status: "automatic", reasons: ["titre alternatif exact", "année exacte"],
    });
  });
});

describe("ambiguïté entre œuvres", () => {
  const dune = (externalId: string, year: number) => ({ ...candidate, externalId, title: "Dune", originalTitle: null, year });

  it("place deux remakes homonymes sans année en revue", () => {
    const ranked = rankMetadataMatches({ title: "Dune", year: null }, [dune("1984", 1984), dune("2021", 2021)]);
    expect(ranked).toMatchObject({ status: "review", margin: 0 });
  });

  it("ne confond pas la corroboration de deux fournisseurs avec une ambiguïté", () => {
    const tmdb = dune("tmdb-2021", 2021);
    const wikidata = { ...tmdb, provider: "wikidata" as const, externalId: "Q105645032" };
    expect(rankMetadataMatches({ title: "Dune", year: 2021 }, [tmdb, wikidata]).status).toBe("automatic");
  });

  it("reconnaît une même œuvre malgré une année de festival différente selon les fournisseurs", () => {
    const tmdb = { ...dune("tmdb-bac", 2021), title: "BAC Nord" };
    const wikidata = { ...tmdb, provider: "wikidata" as const, externalId: "Q-bac", year: 2020 };
    const ranked = rankMetadataMatches({ title: "BAC Nord", year: 2021 }, [tmdb, wikidata]);
    expect(ranked.status).toBe("automatic");
    expect(ranked.runnerUp).toBeNull();
    expect(ranked.reasons).toContain("œuvre confirmée par 2 fournisseurs");
  });

  it("retient la fiche TMDB illustrée de BAC Nord face à l'année de festival Wikidata", () => {
    const tmdb = { ...dune("115479", 2021), title: "BAC Nord", posterUrl: "/poster-bac-nord.jpg" };
    const wikidata = { ...tmdb, provider: "wikidata" as const, externalId: "Q85852782", year: 2020, posterUrl: null };
    const ranked = rankMetadataMatches({ title: "BAC Nord", year: 2020 }, [wikidata, tmdb]);
    expect(ranked).toMatchObject({ status: "automatic", candidate: { provider: "tmdb", externalId: "115479" }, runnerUp: null });
    expect(ranked.reasons).toContain("fiche riche retenue malgré une année de sortie voisine");
  });

  it("reconnaît une même œuvre quand un fournisseur affiche son titre traduit et l'autre son titre original", () => {
    const tmdb = { ...candidate, externalId: "363088", title: "Ant-Man et la Guêpe",
      originalTitle: "Ant-Man and the Wasp", year: 2018, score: 0.94 };
    const tvdb = { ...candidate, provider: "tvdb" as const, externalId: "28", title: "Ant-Man and the Wasp",
      originalTitle: null, year: 2018, score: 0.94 };
    const wikidata = { ...candidate, provider: "wikidata" as const, externalId: "Q22957393",
      title: "Ant-Man et la Guêpe", originalTitle: "Ant-Man and the Wasp", year: 2018, score: 0.94 };
    const ranked = rankMetadataMatches({ title: "Ant-Man 2", year: 2018 }, [tmdb, tvdb, wikidata]);
    expect(ranked).toMatchObject({ status: "automatic", candidate: { externalId: "363088" }, runnerUp: null });
    expect(ranked.reasons).toContain("œuvre confirmée par 3 fournisseurs");
  });

  it("choisit TMDB à égalité même si Wikidata a répondu en premier", () => {
    const wikidata = { ...candidate, provider: "wikidata" as const, externalId: "Q209538",
      title: "Iron Man 3", originalTitle: null, year: 2013, posterUrl: null };
    const tmdb = { ...candidate, externalId: "68721", title: "Iron Man 3", year: 2013,
      posterUrl: "/api/metadata/image/w342/poster.jpg" };
    expect(rankMetadataMatches({ title: "Iron Man 3", year: 2013 }, [wikidata, tmdb]))
      .toMatchObject({ status: "automatic", candidate: { provider: "tmdb", externalId: "68721" } });
  });

  it("laisse un titre et une année exacts gagner sur le bonus homonyme d'une suite", () => {
    const film = { ...candidate, externalId: "68721", title: "Iron Man 3", year: 2013 };
    const bonus = { ...candidate, externalId: "1425459", title: "Iron Man 3 Unmasked", year: 2013 };
    const ranked = rankMetadataMatches({ title: "Iron Man 3", year: 2013 }, [film, bonus]);
    expect(ranked).toMatchObject({ status: "automatic", candidate: { externalId: "68721" },
      runnerUp: { externalId: "1425459" }, margin: 0 });
  });

  it("garde en revue deux fiches réellement exactes du même fournisseur", () => {
    const first = { ...candidate, externalId: "a", title: "Superman", year: 2025 };
    const duplicate = { ...candidate, externalId: "b", title: "Superman", year: 2025 };
    expect(rankMetadataMatches({ title: "Superman", year: 2025 }, [first, duplicate]))
      .toMatchObject({ status: "review", margin: 0 });
  });

  it("départage Superman par le rang TMDB quand deux fiches sont réellement exactes", () => {
    const film = { ...candidate, externalId: "1061474", title: "Superman", year: 2025, providerSearchRank: 0 };
    const homonyme = { ...candidate, externalId: "secondaire", title: "Superman", year: 2025, providerSearchRank: 3 };
    expect(rankMetadataMatches({ title: "Superman", year: 2025 }, [homonyme, film]))
      .toMatchObject({ status: "automatic", candidate: { externalId: "1061474" }, margin: 0 });
  });

  it("ne laisse jamais le rang TMDB battre un meilleur score", () => {
    const exact = { ...candidate, externalId: "exact", title: "Superman", year: 2025, providerSearchRank: 4 };
    const premier = { ...candidate, externalId: "premier", title: "Superman Archives", year: 2025, providerSearchRank: 0 };
    expect(rankMetadataMatches({ title: "Superman", year: 2025 }, [premier, exact]).candidate?.externalId).toBe("exact");
  });

  it("ne transforme pas deux fiches homonymes d'un même fournisseur en corroboration", () => {
    const ranked = rankMetadataMatches({ title: "Dune", year: 2021 }, [dune("a", 2021), dune("b", 2021)]);
    expect(ranked).toMatchObject({ status: "review", margin: 0 });
  });

  it("un identifiant exact reste décisif même devant un titre trompeur", () => {
    const ranked = rankMetadataMatches({ title: "Mauvais titre", year: 1900, externalIds: { tmdb: "2021" } },
      [dune("2021", 2021), { ...candidate, externalId: "autre", title: "Mauvais titre", year: 1900 }]);
    expect(ranked).toMatchObject({ status: "automatic", candidate: { externalId: "2021" } });
  });
});

describe("départage entre candidates, cas relevés sur la médiathèque réelle", () => {
  const film = (title: string, year: number) => ({
    provider: "tmdb" as const, kind: "movie" as const, externalId: "1", title, originalTitle: null, year,
    overview: null, posterUrl: null, score: 0,
  });

  it("préfère le titre exact à une inclusion noyée dans un titre plus long", () => {
    // « Incontrolable (2005).mkv » était apparié à « Steve-O - L'incontrolable de jackass » : le
    // documentaire gagnait grâce à son année exacte, tandis que le vrai film — daté 2006 chez le
    // fournisseur — payait l'écart d'un an. L'inclusion comptait autant qu'un titre entier.
    const source = { title: "Incontrolable", year: 2005 };
    const bon = scoreMetadataMatch(source, film("Incontrôlable", 2006));
    const noyé = scoreMetadataMatch(source, film("Steve-O - L'incontrolable de jackass", 2005));
    expect(bon.score).toBeGreaterThan(noyé.score);
  });

  it("laisse gagner une inclusion serrée, qui reste une bonne correspondance", () => {
    // « James Bond - Spectre » contre « Spectre » : le texte en trop est court, la correspondance
    // est bonne, et elle doit rester automatique. C'est la contrepartie à ne pas casser.
    const décision = scoreMetadataMatch({ title: "James Bond - Spectre", year: 2015 }, film("Spectre", 2015));
    expect(décision.status).toBe("automatic");
  });

  it("ne remonte pas une inclusion très longue au rang de correspondance sûre", () => {
    // « Realite » dans « Le Triangle des Bermudes - du Mythe à la Réalité » : sept caractères dans
    // quarante-cinq. Le fournisseur rend aussi le bon film ; celui-ci ne doit pas lui disputer la place.
    const décision = scoreMetadataMatch({ title: "Realite", year: 2014 },
      film("Le Triangle des Bermudes - du Mythe à la Réalité", 2014));
    const exact = scoreMetadataMatch({ title: "Realite", year: 2014 }, film("Réalité", 2014));
    expect(exact.score).toBeGreaterThan(décision.score);
  });
});
