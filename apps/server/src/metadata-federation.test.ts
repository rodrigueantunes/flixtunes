import { describe, expect, it } from "vitest";
import { QuotaLedger, applyConditionalResponse, conditionalHeaders, languageRank, mergeField, mergeFields,
  selectArtwork, validateArtwork, type ArtworkCandidate, type FieldCandidate } from "./metadata-federation.js";

const title = (over: Partial<FieldCandidate>): FieldCandidate => ({ field: "title", value: "Titre", source: "tmdb", ...over });

describe("fusion champ par champ", () => {
  it("fait toujours gagner une correction manuelle verrouillée", () => {
    const merged = mergeField([
      title({ value: "Titre corrigé", source: "manual", locked: true, language: "fr" }),
      title({ value: "Provider Title", source: "tmdb", confidence: 0.99, language: "fr" }),
    ]);
    expect(merged).toMatchObject({ value: "Titre corrigé", source: "manual", locked: true });
    expect(merged?.reason).toContain("verrouillé");
    expect(merged?.rejected[0]?.reason).toBe("Champ verrouillé");
  });

  it("fait gagner le NFO local sur un fournisseur distant", () => {
    const merged = mergeField([
      title({ value: "Distant", source: "tmdb", confidence: 0.99, language: "fr" }),
      title({ value: "Local", source: "nfo", confidence: 0.5, language: "fr" }),
    ]);
    expect(merged).toMatchObject({ value: "Local", source: "nfo" });
    expect(merged?.reason).toContain("locale");
  });

  it("préfère la langue de la bibliothèque à un fournisseur mieux classé", () => {
    const merged = mergeField([
      title({ value: "English Title", source: "tmdb", language: "en", confidence: 0.99 }),
      title({ value: "Titre français", source: "tmdb", language: "fr", confidence: 0.8 }),
    ], "fr-FR");
    expect(merged?.value).toBe("Titre français");
    expect(merged?.reason).toContain("langue de la bibliothèque");
  });

  it("retombe sur l'anglais quand la traduction manque", () => {
    const merged = mergeField([
      title({ value: "Título", source: "tmdb", language: "es" }),
      title({ value: "English Title", source: "tmdb", language: "en" }),
    ], "fr-FR");
    expect(merged?.value).toBe("English Title");
    expect(merged?.reason).toContain("anglais");
  });

  it("ignore les valeurs vides sans les compter comme candidates", () => {
    expect(mergeField([title({ value: "" }), title({ value: null })])).toBeNull();
    expect(mergeField([title({ value: "" }), title({ value: "Réel", source: "tvmaze" })])?.value).toBe("Réel");
  });

  it("ne pénalise pas un champ sans langue, comme une durée ou une année", () => {
    expect(languageRank(null, "fr-FR")).toBe(1);
    const merged = mergeField([
      { field: "runtimeSeconds", value: 7200, source: "tmdb" },
      { field: "runtimeSeconds", value: 7300, source: "filename" },
    ], "fr-FR");
    expect(merged).toMatchObject({ value: 7200, source: "tmdb" });
  });

  it("fusionne plusieurs champs indépendamment", () => {
    const merged = mergeFields([
      title({ value: "Titre", language: "fr" }),
      { field: "year", value: 2021, source: "tmdb" },
      { field: "overview", value: "Résumé", source: "nfo", language: "fr" },
    ], "fr-FR");
    expect(merged.map((entry) => entry.field).sort()).toEqual(["overview", "title", "year"]);
    expect(merged.find((entry) => entry.field === "overview")?.source).toBe("nfo");
  });
});

describe("pipeline d'images", () => {
  const poster = (over: Partial<ArtworkCandidate>): ArtworkCandidate => ({
    kind: "poster", url: "https://exemple/affiche.jpg", source: "tmdb", width: 1000, height: 1500, ...over,
  });

  it("accepte une affiche 2:3 de définition suffisante", () => {
    expect(validateArtwork(poster({}))).toMatchObject({ ok: true });
  });

  it("refuse une réponse qui n'est pas une image", () => {
    expect(validateArtwork(poster({ contentType: "text/html" }))).toMatchObject({ ok: false });
    expect(validateArtwork(poster({ contentType: "text/html" })).reason).toContain("Type de contenu");
  });

  it("refuse une vignette minuscule et un pixel de suivi", () => {
    expect(validateArtwork(poster({ width: 120, height: 180 })).ok).toBe(false);
    expect(validateArtwork(poster({ width: 1, height: 1 })).ok).toBe(false);
  });

  it("refuse une affiche aux mauvaises proportions", () => {
    expect(validateArtwork(poster({ width: 1600, height: 900 })).reason).toContain("Proportions");
  });

  it("choisit l'affiche de la langue de la bibliothèque puis l'anglaise", () => {
    const selection = selectArtwork([
      poster({ url: "en.jpg", language: "en" }), poster({ url: "fr.jpg", language: "fr" }),
      poster({ url: "es.jpg", language: "es" }),
    ], "poster", "fr-FR");
    expect(selection.chosen?.url).toBe("fr.jpg");
    expect(selectArtwork([poster({ url: "en.jpg", language: "en" }), poster({ url: "es.jpg", language: "es" })],
      "poster", "fr-FR").chosen?.url).toBe("en.jpg");
  });

  it("ne retient l'image extraite de la vidéo qu'en dernier recours", () => {
    const extracted = poster({ url: "extraite.jpg", source: "local", extracted: true, language: null });
    expect(selectArtwork([extracted, poster({ url: "fr.jpg", language: "fr" })], "poster", "fr-FR").chosen?.url).toBe("fr.jpg");
    const alone = selectArtwork([extracted], "poster", "fr-FR");
    expect(alone.chosen?.url).toBe("extraite.jpg");
    expect(alone.reason).toContain("extraite");
  });

  it("explique chaque image écartée", () => {
    const selection = selectArtwork([
      poster({ url: "trop-petite.jpg", width: 100, height: 150 }),
      poster({ url: "bonne.jpg", language: "fr" }),
    ], "poster", "fr-FR");
    expect(selection.chosen?.url).toBe("bonne.jpg");
    expect(selection.rejected).toHaveLength(1);
    expect(selection.rejected[0]?.reason).toContain("Largeur");
  });

  it("applique des proportions différentes selon la nature de l'image", () => {
    expect(validateArtwork({ kind: "backdrop", url: "b.jpg", source: "tmdb", width: 1920, height: 1080 }).ok).toBe(true);
    expect(validateArtwork({ kind: "backdrop", url: "b.jpg", source: "tmdb", width: 1000, height: 1500 }).ok).toBe(false);
  });
});

describe("quotas fournisseurs", () => {
  it("autorise jusqu'à la limite puis refuse sur la fenêtre", () => {
    const ledger = new QuotaLedger({ tvmaze: { limit: 3, windowMs: 1000 } });
    const start = 1_000_000;
    expect([0, 1, 2].every((offset) => ledger.consume("tvmaze", start + offset))).toBe(true);
    expect(ledger.consume("tvmaze", start + 3)).toBe(false);
    // La fenêtre glisse : les anciennes requêtes sortent du décompte.
    expect(ledger.consume("tvmaze", start + 1500)).toBe(true);
  });

  it("laisse passer un fournisseur sans quota déclaré", () => {
    const ledger = new QuotaLedger({});
    expect(ledger.consume("wikidata")).toBe(true);
  });

  it("expose l'état pour l'administration", () => {
    const ledger = new QuotaLedger({ tmdb: { limit: 40, windowMs: 10_000 } });
    ledger.consume("tmdb", 5_000);
    const snapshot = ledger.snapshot(6_000);
    expect(snapshot[0]).toMatchObject({ provider: "tmdb", limit: 40, used: 1 });
    expect(snapshot[0]?.resetAt).toBe(15_000);
  });
});

describe("cache HTTP conditionnel", () => {
  const entry = { payload: { titre: "Ancien" }, etag: 'W/"abc"', lastModified: "Wed, 01 Jan 2025 00:00:00 GMT", storedAt: 1 };

  it("émet les en-têtes conditionnels d'une entrée connue", () => {
    expect(conditionalHeaders(entry)).toEqual({
      "If-None-Match": 'W/"abc"', "If-Modified-Since": "Wed, 01 Jan 2025 00:00:00 GMT",
    });
    expect(conditionalHeaders(null)).toEqual({});
  });

  it("conserve la charge utile sur un 304 sans la retélécharger", () => {
    const outcome = applyConditionalResponse(entry, { status: 304 }, 5_000);
    expect(outcome).toMatchObject({ status: "revalidated" });
    expect(outcome.status === "revalidated" && outcome.entry.payload).toEqual({ titre: "Ancien" });
    expect(outcome.status === "revalidated" && outcome.entry.storedAt).toBe(5_000);
  });

  it("remplace l'entrée sur une réponse complète", () => {
    const outcome = applyConditionalResponse(entry, { status: 200, etag: '"neuf"', payload: { titre: "Neuf" } }, 9_000);
    expect(outcome).toMatchObject({ status: "updated" });
    expect(outcome.status === "updated" && outcome.entry).toMatchObject({ etag: '"neuf"', payload: { titre: "Neuf" } });
  });

  it("continue de servir le cache quand le fournisseur est injoignable", () => {
    expect(applyConditionalResponse(entry, null)).toMatchObject({ status: "offline" });
    expect(applyConditionalResponse(entry, { status: 503 })).toMatchObject({ status: "offline" });
  });

  it("signale l'indisponibilité seulement quand rien n'est connu", () => {
    expect(applyConditionalResponse(null, null)).toMatchObject({ status: "unavailable" });
    expect(applyConditionalResponse(null, { status: 304 })).toMatchObject({ status: "unavailable" });
  });
});
