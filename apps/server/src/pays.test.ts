import { describe, expect, it } from "vitest";
import { nomDuPays, paysDeLaChaine, paysDuDrapeau, paysDuLibelle, paysDuTvgId } from "./pays.js";

/**
 * Le pays est ce qui rend la recherche utilisable sur un corpus mondial : « canal » y rend plus de
 * mille chaînes parce que le mot est espagnol et portugais. Les cas ci-dessous viennent tous du
 * corpus réel, y compris ceux où il faut savoir **ne pas** conclure.
 */

describe("le pays lu dans le tvg-id", () => {
  it("prend le suffixe, en écartant la mention de qualité", () => {
    expect(paysDuTvgId("TF1.fr")).toBe("fr");
    // Le corpus écrit `CanalPlusSport360.fr@SD` : sans le retrait du `@SD`, plus rien ne ressemble
    // à un code pays et la chaîne perd son origine.
    expect(paysDuTvgId("CanalPlusSport360.fr@SD")).toBe("fr");
    expect(paysDuTvgId("Canal.Sur.Andalucía.es")).toBe("es");
  });

  it("ne conclut pas sur ce qui n'est pas un suffixe de pays", () => {
    expect(paysDuTvgId("Canal+ France")).toBeNull();
    expect(paysDuTvgId("608049aefa2b8ae93c2c3a63")).toBeNull();
    expect(paysDuTvgId(null)).toBeNull();
  });
});

describe("le pays lu dans un drapeau", () => {
  it("convertit les indicateurs régionaux en code pays", () => {
    // Un drapeau **est** la paire de lettres : aucune table à tenir, et cela vaut pour tous les pays.
    expect(paysDuDrapeau("🇫🇷法兰西公共")).toBe("fr");
    expect(paysDuDrapeau("Brazil 🇧🇷")).toBe("br");
    expect(paysDuDrapeau("Channels 🇪🇸")).toBe("es");
    expect(paysDuDrapeau("Généralistes")).toBeNull();
  });
});

describe("le pays lu dans un intitulé", () => {
  it("reconnaît les formes rencontrées, en français comme en anglais", () => {
    expect(paysDuLibelle("FRANCE")).toBe("fr");
    expect(paysDuLibelle("Chaînes françaises")).toBe("fr");
    expect(paysDuLibelle("Italy")).toBe("it");
    expect(paysDuLibelle("TV AO VIVO | Brasil")).toBe("br");
  });

  it("exige un mot entier, pour ne pas voir un pays où il n'y en a pas", () => {
    // « India » se trouve dans « Indiana », et c'est le genre de faux positif qui remplit un filtre
    // de chaînes qui n'ont rien à y faire.
    expect(paysDuLibelle("Indiana Local TV")).toBeNull();
    expect(paysDuLibelle("Franchise Movies")).toBeNull();
    // Mais « Chilean » désigne bien le Chili : la frontière de mot suffit, la troncature non.
    expect(paysDuLibelle("Chile Deportes")).toBe("cl");
  });
});

describe("le pays d'une chaîne", () => {
  it("croit le tvg-id avant le drapeau, et le drapeau avant l'intitulé", () => {
    // Les deux premiers se contredisent une fois sur quatre quand ils sont tous deux présents.
    expect(paysDeLaChaine({ tvgId: "TF1.fr", groupe: "Brazil 🇧🇷" })).toBe("fr");
    expect(paysDeLaChaine({ tvgId: null, groupe: "🇧🇷 Italy" })).toBe("br");
    expect(paysDeLaChaine({ tvgId: "sans-suffixe", groupe: "FRANCE" })).toBe("fr");
  });

  it("rend null plutôt que d'inventer", () => {
    // Une chaîne sans indice reste visible partout : elle est seulement absente des filtres par pays.
    expect(paysDeLaChaine({ tvgId: null, groupe: "News", nom: "Canal 8" })).toBeNull();
    expect(paysDeLaChaine({})).toBeNull();
  });
});

describe("le nom affiché", () => {
  it("donne le nom français, et se rabat sur le code quand il est inconnu", () => {
    expect(nomDuPays("fr")).toBe("France");
    expect(nomDuPays("br")).toBe("Brésil");
    // Un code venu d'un `tvg-id` qu'aucune table ne nomme : mieux vaut « NZ » qu'un pays inventé.
    expect(nomDuPays("nz")).toBe("NZ");
  });
});
