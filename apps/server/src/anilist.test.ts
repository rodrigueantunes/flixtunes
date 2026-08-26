import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAnilist } from "./anilist.js";

/**
 * AniList, fournisseur d'animation sans clé.
 *
 * Il comble ce que TMDB rend mal : ses fiches japonaises portent le titre natif en kanji, illisible
 * depuis un nom de fichier romanisé. Relevé sur la médiathèque réelle, « Kaiju No 8 Hoshina's Day
 * Off » ressortait sous « 怪獣8号 保科の休日 ».
 *
 * Le réseau est simulé : un test qui interroge un service distant mesure la disponibilité de ce
 * service, pas la justesse du code.
 */
const reponse = (media: unknown[]) => ({
  ok: true,
  json: async () => ({ data: { Page: { media } } }),
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("recherche sur AniList", () => {
  it("compare les trois formes du titre", async () => {
    // Un fichier peut porter le romaji, l'anglais ou le natif, et rien ne dit lequel. C'est la
    // raison d'être de ce fournisseur.
    vi.stubGlobal("fetch", vi.fn(async () => reponse([{
      id: 1, title: { romaji: "Kaijuu 8-gou", english: "Kaiju No. 8", native: "怪獣8号" },
      startDate: { year: 2024 }, coverImage: { large: "https://exemple.invalid/a.jpg" },
    }])));
    const resultats = await searchAnilist("tv", "Kaiju No 8", 2024);
    expect(resultats).toHaveLength(1);
    expect(resultats[0]?.score).toBeGreaterThan(0.8);
  });

  it("affiche le titre anglais de préférence, sans perdre le natif", async () => {
    // Un catalogue francophone lit mal les kanjis ; le titre original reste conservé pour
    // l'appariement et pour la fiche.
    vi.stubGlobal("fetch", vi.fn(async () => reponse([{
      id: 2, title: { romaji: "Sen to Chihiro", english: "Spirited Away", native: "千と千尋の神隠し" },
      startDate: { year: 2001 },
    }])));
    const [candidat] = await searchAnilist("movie", "Spirited Away", 2001);
    expect(candidat?.title).toBe("Spirited Away");
    expect(candidat?.originalTitle).toBe("千と千尋の神隠し");
  });

  it("retire le balisage du résumé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponse([{
      id: 3, title: { romaji: "Akira", english: "Akira" }, startDate: { year: 1988 },
      description: "Néo-Tokyo, <i>2019</i>.<br>Une ville reconstruite.",
    }])));
    const [candidat] = await searchAnilist("movie", "Akira", 1988);
    expect(candidat?.overview).toBe("Néo-Tokyo, 2019.Une ville reconstruite.");
  });

  it("rend une liste vide plutôt que d'échouer quand le service ne répond pas", async () => {
    // Un fournisseur d'appoint injoignable ne doit jamais empêcher les autres de répondre.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau coupé"); }));
    expect(await searchAnilist("movie", "Akira", 1988)).toEqual([]);
  });

  it("rend une liste vide sur une réponse en erreur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await searchAnilist("movie", "Akira")).toEqual([]);
  });

  it("n'interroge pas le service pour une recherche trop courte", async () => {
    // Une lettre ramènerait des milliers d'œuvres sans rapport, et coûterait un appel pour rien.
    const appel = vi.fn();
    vi.stubGlobal("fetch", appel);
    expect(await searchAnilist("movie", "A")).toEqual([]);
    expect(appel).not.toHaveBeenCalled();
  });

  it("classe les meilleures correspondances en tête", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponse([
      { id: 4, title: { romaji: "Ghost in the Shell 2" }, startDate: { year: 2004 } },
      { id: 5, title: { romaji: "Ghost in the Shell" }, startDate: { year: 1995 } },
    ])));
    const resultats = await searchAnilist("movie", "Ghost in the Shell", 1995);
    expect(resultats[0]?.externalId).toBe("5");
  });
});
