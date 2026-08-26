// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

/**
 * Ces cas portent sur le **vrai** module d'API, sans double.
 *
 * Les tests d'interface remplacent `./api` par un objet simulé. C'est utile pour éprouver les
 * composants, mais cela masque tout défaut du module lui-même — et un défaut y est passé : une
 * seconde clé `catalog` dans l'objet exporté écrasait silencieusement la première. Aucune erreur de
 * compilation, aucun test en échec, et pourtant les pages Films et Séries appelaient la route du
 * centre de correspondances, recevaient un tableau au lieu d'une page, et se vidaient entièrement.
 *
 * D'où ces vérifications : que chaque méthode existe, qu'elle est unique, et qu'elle vise la bonne
 * route. Elles s'exécutent contre le module réel avec `fetch` intercepté.
 */

const appels: string[] = [];

beforeEach(() => {
  appels.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    appels.push(String(url));
    return Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, offset: 0, limit: 60 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("module d'API", () => {
  it("ne déclare aucune méthode en double", () => {
    // Une clé répétée dans un objet littéral n'échoue pas : la dernière gagne. Le seul moyen de
    // s'en prémunir est de vérifier que chaque nom attendu désigne bien ce qu'on croit.
    const noms = Object.keys(api);
    expect(new Set(noms).size, "noms dupliqués dans l'objet exporté").toBe(noms.length);
  });

  it("distingue la pagination du catalogue du centre de correspondances", () => {
    expect(typeof api.catalogPage).toBe("function");
    expect(typeof api.catalog).toBe("function");
    expect(api.catalogPage).not.toBe(api.catalog);
  });

  it("interroge la route de parcours avec les critères transmis", async () => {
    await api.catalogPage("profil-1", { kind: "movies", sort: "release", filter: "watched", query: "azur", letter: "v", offset: 60, limit: 30 });
    expect(appels).toHaveLength(1);
    const url = appels[0]!;
    expect(url, "la route de parcours et non celle du centre de correspondances").toContain("/catalog/browse?");
    for (const attendu of ["profileId=profil-1", "kind=movies", "sort=release", "filter=watched", "q=azur", "letter=v", "offset=60", "limit=30"]) {
      expect(url, `paramètre ${attendu}`).toContain(attendu);
    }
  });

  it("omet les critères absents plutôt que de transmettre « undefined »", async () => {
    await api.catalogPage("profil-1", { kind: "shows" });
    const url = appels[0]!;
    expect(url).not.toContain("undefined");
    expect(url).toContain("kind=shows");
  });

  it("interroge le centre de correspondances sur sa propre route", async () => {
    await api.catalog("bibliotheque-1", "azur");
    const url = appels[0]!;
    expect(url).toContain("libraryId=bibliotheque-1");
    expect(url, "cette route ne doit pas passer par le parcours").not.toContain("/catalog/browse");
  });

  it("expose les réglages de conversion et leur enregistrement sur la même route", async () => {
    // Ces réglages n'existaient qu'en variables d'environnement, inaccessibles sans SSH. Les deux
    // méthodes visent la même ressource : les séparer serait une occasion de les faire diverger.
    await api.conversionPreferences();
    expect(appels[0]).toContain("/system/conversion-preferences");
    appels.length = 0;
    await api.saveConversionPreferences({ expert: true });
    expect(appels[0]).toContain("/system/conversion-preferences");
  });

  it("relance les mesures sur sa propre route", async () => {
    // Le calibrage survit à ce qui le corrige : une mise à jour de paquet ou un accès au périphérique
    // réparé ne changent pas toujours sa signature. Cette route existe pour trancher sans deviner.
    await api.recalibrate();
    expect(appels[0]).toContain("/system/capacity/recalibrate");
    expect(appels[0], "ne doit pas viser le rapport de capacité").not.toMatch(/capacity$/);
  });
});
