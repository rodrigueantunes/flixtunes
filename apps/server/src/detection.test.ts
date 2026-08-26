import { describe, expect, it } from "vitest";
import { AUTO_THRESHOLD, REVIEW_THRESHOLD, cleanTitle, detectContentType, detectMedia, folderContext, generateCandidates, isPlausibleYear, tokenize } from "./detection.js";
import { evaluateCorpus, generateNameCorpus, mutateSample, mutations } from "./detection-corpus.js";

const detect = (filePath: string, kind: "movie" | "tv" | "other" = "other") => detectMedia(filePath, kind).best;

describe("tokeniseur Unicode", () => {
  it("préserve accents, apostrophes et alphabets non latins", () => {
    expect(tokenize("Amélie").map((token) => token.value)).toEqual(["Amélie"]);
    expect(tokenize("L'Élève").filter((token) => token.kind === "mot").map((token) => token.value)).toEqual(["L'Élève"]);
    expect(tokenize("千と千尋").filter((token) => token.kind === "mot").map((token) => token.value)).toEqual(["千と千尋"]);
  });

  it("distingue année, nombre, groupe et séparateur", () => {
    // Une année entre parenthèses appartient au groupe : elle n'est pas un jeton année à part.
    const kinds = tokenize("Dune 2021 [tmdb-438631] CD 1").map((token) => token.kind);
    expect(kinds).toEqual(["mot", "separateur", "annee", "separateur", "groupe", "separateur", "mot", "separateur", "nombre"]);
    expect(tokenize("Dune (2021)").map((token) => token.kind)).toEqual(["mot", "separateur", "groupe"]);
  });

  it("découpe sans perdre un seul caractère", () => {
    for (const name of ["Dune (2021).mkv", "Film [incomplet", "Ép. 3 — final", "千と千尋 (2001)"]) {
      expect(tokenize(name).map((token) => token.value).join("")).toBe(name);
    }
  });
});

describe("nettoyage de titre", () => {
  it("retire le bruit de release sans amputer un titre qui commence par un de ces mots", () => {
    expect(cleanTitle("Arrival.2016.1080p.BluRay.x264")).toBe("Arrival 2016");
    expect(cleanTitle("French Connection")).toBe("French Connection");
    expect(cleanTitle("La French")).toBe("La French");
    expect(cleanTitle("Multi.Facettes.1080p")).toBe("Multi Facettes");
  });

  it("retire édition et numéro de partie du titre", () => {
    expect(cleanTitle("Blade Runner Director's Cut")).toBe("Blade Runner");
    expect(cleanTitle("Titanic CD1")).toBe("Titanic");
  });

  it("retire tout groupe entre crochets ou parenthèses", () => {
    expect(cleanTitle("[Team] Amélie (2001) [VOSTFR]")).toBe("Amélie");
    expect(cleanTitle("Voyage Azur {edition}")).toBe("Voyage Azur");
  });

  it("retire un suffixe d'équipe sans amputer un titre composé", () => {
    expect(cleanTitle("Voyage Azur -GROUPE")).toBe("Voyage Azur");
    // Sans espace avant le tiret, le suffixe est indistinguable d'un titre composé : il est conservé.
    expect(cleanTitle("Spider-Man")).toBe("Spider-Man");
    expect(cleanTitle("X-MEN")).toBe("X-MEN");
  });

  it("retire les marqueurs de nature qui servent au classement", () => {
    expect(cleanTitle("Voyage_Azur_Documentaire")).toBe("Voyage Azur");
    expect(cleanTitle("Ana y el Mar Live at Wembley")).toBe("Ana y el Mar");
  });
});

describe("contexte d'arborescence", () => {
  it("lit série, année et saison depuis les dossiers", () => {
    expect(folderContext("D:/TV/Severance (2022)/Season 02/x.mkv")).toMatchObject({
      showTitle: "Severance", year: 2022, season: 2, looksLikeShow: true,
    });
    expect(folderContext("D:/TV/Kaamelott/Saison 6/x.mkv")).toMatchObject({ showTitle: "Kaamelott", season: 6 });
  });

  it("range un dossier de spéciaux en saison 0", () => {
    expect(folderContext("D:/TV/Doctor Who/Specials/x.mkv")).toMatchObject({ season: 0, isSpecials: true, showTitle: "Doctor Who" });
    expect(folderContext("D:/TV/Kaamelott/Hors-serie/x.mkv")).toMatchObject({ season: 0, isSpecials: true });
  });
});

describe("détection des séries", () => {
  it("reconnaît SxxExx avec un score d'auto-validation", () => {
    const best = detect("D:/TV/Severance/Season 01/Severance.S01E03.The.Grim.Barbarity.mkv", "tv");
    expect(best).toMatchObject({ rule: "saison-episode", kind: "episode", seasonNumber: 1, episodeNumbers: [3], showTitle: "Severance" });
    expect(best.score).toBeGreaterThanOrEqual(AUTO_THRESHOLD);
  });

  it("développe un double épisode dans les deux notations", () => {
    expect(detect("D:/TV/Show/Season 02/Show.S02E05E06.mkv", "tv").episodeNumbers).toEqual([5, 6]);
    expect(detect("D:/TV/Show/Season 02/Show.S02E05-E06.mkv", "tv").episodeNumbers).toEqual([5, 6]);
    expect(detect("D:/TV/Show/Season 01/Show.1x03-04.mkv", "tv").episodeNumbers).toEqual([3, 4]);
  });

  it("reconnaît la forme courte 1x02", () => {
    expect(detect("D:/TV/Show/Season 01/Show.1x02.Titre.mkv", "tv")).toMatchObject({
      rule: "saison-episode-court", seasonNumber: 1, episodeNumbers: [2],
    });
  });

  it("reconnaît un épisode daté d'émission quotidienne", () => {
    expect(detect("D:/TV/Journal/Journal.2026.03.14.Edition.mkv", "tv")).toMatchObject({
      rule: "date-diffusion", airDate: "2026-03-14",
    });
  });

  it("refuse une fausse date dont le mois ou le jour est impossible", () => {
    const result = detectMedia("D:/TV/Show/Show.2026.31.99.mkv", "tv");
    expect(result.best.rule).not.toBe("date-diffusion");
  });

  it("range spéciaux et OVA en saison 0 sans écraser la numérotation normale", () => {
    expect(detect("D:/TV/Doctor Who/Specials/Christmas.Invasion.mkv", "tv")).toMatchObject({ rule: "special", seasonNumber: 0 });
    expect(detect("D:/Anime/Serie/Season 01/Serie.OVA.02.mkv", "tv").seasonNumber).toBe(0);
  });

  it("reconnaît un marqueur d'épisode employé seul", () => {
    // Neuf cent douze fichiers de la médiathèque réelle portent cette forme — Dragon Ball Z, Naruto,
    // Dragon Ball Super, FullMetal Alchemist. Aucune règle ne les reconnaissait, et six séries
    // entières apparaissaient dans l'accueil des films.
    for (const nom of ["E001", "EP001", "Ep001", "e001", "Épisode 1", "Episode 1"]) {
      expect(detect(`D:/TV/Dragon Ball Z/Saison 1/${nom}.mkv`, "tv"), nom).toMatchObject({
        rule: "marqueur-episode", kind: "episode", showTitle: "Dragon Ball Z", seasonNumber: 1, episodeNumbers: [1],
      });
    }
    // Le point que laisse un « E001..mkv » ne doit pas devenir un titre.
    expect(detect("D:/TV/Dragon Ball/Saison 1/E001..mkv", "tv").title).toBe("Épisode 1");
    // Ni la balise de langue, ni le suffixe d'équipe ne nomment l'épisode.
    expect(detect("D:/TV/Naruto/Saison 1/E001[VOSTFR].mkv", "tv").episodeNumbers).toEqual([1]);
    expect(detect("D:/TV/Naruto/Saison 1/E001-GROUPE.mkv", "tv").title).toBe("Épisode 1");
    // Un vrai titre d'épisode, lui, est conservé.
    expect(detect("D:/TV/Show/Saison 2/Episode 3 - Le Signal.mkv", "tv").title).toBe("Le Signal");
    expect(detect("D:/TV/Show/Saison 2/E05E06.mkv", "tv").episodeNumbers).toEqual([5, 6]);
  });

  it("range en saison 1 un épisode posé sans dossier de saison", () => {
    // Convention de Plex et de Jellyfin : « FullMetal Alchemist/E01.mkv » n'a pas d'autre lecture.
    expect(detect("D:/TV/FullMetal Alchemist/E01.mkv", "tv")).toMatchObject({
      rule: "marqueur-episode", showTitle: "FullMetal Alchemist", seasonNumber: 1, episodeNumbers: [1],
    });
  });

  it("ne prend pas une initiale de titre pour un marqueur d'épisode", () => {
    for (const [nom, kind] of [["E.T. l Extraterrestre (1982)", "movie"], ["Escape from New York (1981)", "movie"],
      ["Empire of Dreams (2004)", "movie"], ["E.T. l Extraterrestre (1982)", "other"]] as const) {
      expect(detect(`D:/Films/${nom}.mkv`, kind).rule, nom).not.toBe("marqueur-episode");
    }
  });

  it("laisse SxxExx l'emporter sur le marqueur seul", () => {
    const result = detectMedia("D:/TV/Show/Saison 1/Show.S01E03.Titre.mkv", "tv");
    expect(result.best.rule).toBe("saison-episode");
    expect(result.candidates.some((entry) => entry.rule === "marqueur-episode")).toBe(false);
    expect(result.decision).toBe("auto");
  });

  it("rattache à la série les dossiers qui ne sont pas des saisons", () => {
    // « Bonus », « Pilote » et « Autres » sont des dossiers de série : leur contenu appartient à la
    // série, en saison 0, et jamais aux films.
    for (const dossier of ["Bonus", "Pilote", "Autres", "Extras", "Making of"]) {
      expect(detect(`D:/TV/Kaamelott/${dossier}/Betisier Livre I.mkv`, "tv"), dossier).toMatchObject({
        kind: "episode", showTitle: "Kaamelott", seasonNumber: 0,
      });
    }
  });

  it("n'autorise aucun film dans une bibliothèque déclarée série", () => {
    // L'invariant qui manquait : la personne a rangé ce dossier dans « Séries TV », et cette
    // déclaration vaut mieux que l'incapacité d'une expression régulière à lire un nom de fichier.
    for (const nom of ["E001", "video_001", "Un nom sans le moindre indice", "Bande Annonce Livre II",
      "Show.S01E01", "Show (2021) 1080p", "Kaamelott opening par l'orchestre national de Lyon"]) {
      const result = detectMedia(`D:/TV/Une Serie/Saison 1/${nom}.mkv`, "tv");
      expect(result.best.kind, nom).toBe("episode");
      // Le nom de série peut venir du fichier lorsqu'il en porte un ; sinon, du dossier.
      expect(result.best.showTitle, nom).toBeTruthy();
      // La lecture « film » reste consultable pour expliquer la décision, mais ne peut pas gagner.
      const film = result.candidates.find((entry) => entry.kind === "movie");
      if (film) expect(film.score, nom).toBeLessThan(result.best.score);
    }
  });

  it("accepte la numérotation absolue seulement avec un contexte de série", () => {
    const anime = detect("D:/Anime/One Piece/Season 01/One Piece - 1045.mkv", "tv");
    expect(anime).toMatchObject({ rule: "numerotation-absolue", episodeNumbers: [1045] });
    // Dans une bibliothèque de films, un nombre isolé ne doit jamais produire un épisode.
    const movie = detectMedia("D:/Films/Film - 1045.mkv", "movie");
    expect(movie.best.kind).toBe("movie");
    expect(movie.candidates.some((entry) => entry.rule === "numerotation-absolue")).toBe(false);
  });
});

describe("détection des films", () => {
  it("privilégie l'année entre parenthèses sur une année nue", () => {
    const parenthesised = detect("D:/Films/Dune (2021)/Dune (2021).mkv", "movie");
    const bare = detect("D:/Films/Dune.2021.1080p.mkv", "movie");
    expect(parenthesised).toMatchObject({ rule: "film-annee", year: 2021, title: "Dune" });
    expect(parenthesised.score).toBeGreaterThan(bare.score);
  });

  it("distingue deux remakes homonymes par leur année", () => {
    expect(detect("D:/Films/Dune (1984)/Dune (1984).mkv", "movie").year).toBe(1984);
    expect(detect("D:/Films/Dune (2021)/Dune (2021).mkv", "movie").year).toBe(2021);
  });

  it("classe documentaire, concert et court-métrage", () => {
    expect(detectContentType("Planet Earth Documentary")).toBe("documentary");
    expect(detectContentType("Queen Live at Wembley")).toBe("concert");
    expect(detectContentType("Court-metrage Paris")).toBe("short");
    expect(detect("D:/Films/Oceans.Documentaire.2010.mkv", "movie").contentType).toBe("documentary");
  });

  it("retient l'édition et le numéro de partie", () => {
    const edition = detect("D:/Films/Blade Runner (1982) Director's Cut.mkv", "movie");
    expect(edition.edition?.toLowerCase()).toContain("director");
    expect(edition.title).toBe("Blade Runner");
    const part = detectMedia("D:/Films/Titanic (1997) CD2.mkv", "movie");
    expect(part.best.part ?? part.candidates.find((entry) => entry.part)?.part).toBe(2);
  });

  it("fait gagner un identifiant externe sur toute autre règle", () => {
    const result = detectMedia("D:/Films/Inconnu [tmdb-438631].mkv", "movie");
    expect(result.best.rule).toBe("identifiant");
    expect(result.best.externalIds.tmdb).toBe("438631");
    expect(result.decision).toBe("auto");
  });

  it("reconnaît les suffixes d'identifiants employés par Jellyfin", () => {
    expect(detectMedia("D:/Films/Inconnu [tmdbid-438631].mkv", "movie").best.externalIds.tmdb).toBe("438631");
    expect(detectMedia("D:/Films/Inconnu [imdbid-tt1160419].mkv", "movie").best.externalIds.imdb).toBe("tt1160419");
    expect(detectMedia("D:/Films/Inconnu [tvdbid-12345].mkv", "movie").best.externalIds.tvdb).toBe("12345");
  });

  it("utilise le dossier individuel d'un film quand le fichier est générique", () => {
    expect(detectMedia("D:/Films/BAC Nord (2021)/video.mkv", "movie")).toMatchObject({
      decision: "auto",
      best: { rule: "film-dossier", title: "BAC Nord", year: 2021 },
    });
  });

  it("met en revue un conflit serré entre le dossier et le nom du film", () => {
    const result = detectMedia("D:/Films/BAC Nord (2021)/Boite Noire (2021).mkv", "movie");
    expect(result.decision).toBe("revue");
    expect(result.reason).toMatch(/film-dossier.*film-annee|film-annee.*film-dossier/);
  });

  it("conserve accents et titres multilingues", () => {
    expect(detect("D:/Films/Amélie (2001).mkv", "movie").title).toBe("Amélie");
    expect(detect("D:/Films/千と千尋の神隠し (2001).mkv", "movie").title).toBe("千と千尋の神隠し");
  });
});

describe("seuils de décision", () => {
  it("valide seul une détection franche", () => {
    expect(detectMedia("D:/Films/Dune (2021).mkv", "movie").decision).toBe("auto");
    expect(detectMedia("D:/TV/Show/Season 01/Show.S01E01.mkv", "tv").decision).toBe("auto");
  });

  it("demande une revue quand la confiance est insuffisante", () => {
    const result = detectMedia("D:/Films/Un titre sans indice.mkv", "movie");
    expect(result.decision).toBe("rejet");
    expect(result.reason).toBeTruthy();
    expect(result.best.score).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("explique toujours sa décision par des indices lisibles", () => {
    const result = detectMedia("D:/TV/Show/Season 01/Show.S01E01.Titre.mkv", "tv");
    expect(result.best.evidence.length).toBeGreaterThan(0);
    expect(result.best.evidence.join(" ")).toContain("S01E01");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("propose toujours plusieurs candidats classés par score décroissant", () => {
    const candidates = generateCandidates("D:/TV/Show/Season 01/Show.S01E02.2021.mkv", "tv");
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates.every((entry, index) => index === 0 || entry.score <= candidates[index - 1]!.score)).toBe(true);
  });
});

describe("années plausibles", () => {
  it("refuse de prendre un nombre du titre pour une année de sortie", () => {
    expect(isPlausibleYear(2049)).toBe(false);
    expect(isPlausibleYear(1899)).toBe(false);
    expect(isPlausibleYear(1999)).toBe(true);
    // « Blade Runner 2049 » sans année explicite garde son nombre dans le titre.
    expect(detect("D:/Films/Blade Runner 2049.1080p.BluRay.x264.mkv", "movie")).toMatchObject({
      title: "Blade Runner 2049", year: null,
    });
    // Avec une année explicite, c'est elle qui gagne, jamais le nombre du titre.
    expect(detect("D:/Films/Blade Runner 2049 (2017).mkv", "movie")).toMatchObject({
      title: "Blade Runner 2049", year: 2017,
    });
  });
});

describe("corpus de noms", () => {
  it("atteint l'objectif de 99 % sur un échantillon déterministe", () => {
    const evaluation = evaluateCorpus(generateNameCorpus(1_000));
    expect(evaluation.accuracy).toBeGreaterThanOrEqual(0.99);
    expect(evaluation.byCategory.every((category) => category.total > 0)).toBe(true);
  });

  it("reste au-dessus de 99 % sous chaque mutation de nom", () => {
    const corpus = generateNameCorpus(1_000);
    for (const mutation of mutations) {
      const evaluation = evaluateCorpus(corpus.map((sample) => mutateSample(sample, mutation)));
      expect(evaluation.accuracy, `mutation ${mutation.name}`).toBeGreaterThanOrEqual(0.99);
    }
  });

  it("produit un corpus identique à chaque exécution", () => {
    expect(generateNameCorpus(50).map((sample) => sample.path))
      .toEqual(generateNameCorpus(50).map((sample) => sample.path));
  });
});
