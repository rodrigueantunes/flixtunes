import { describe, expect, it } from "vitest";
import { RANG_SANS_PAYS, estChaineFrancaise, nomDuPays, paysDeLaChaine, paysDuDrapeau, paysDuLibelle, paysDuTvgId, rangDuPays } from "./pays.js";

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

describe("les chaînes reconnues à leur seul nom", () => {
  it("reconnaît les françaises, décorations comprises", () => {
    expect(estChaineFrancaise("TF1")).toBe(true);
    // Le corpus décore : définition, langue, secours, et souvent les trois à la fois.
    expect(estChaineFrancaise("FR | TF1 FHD [1080p]")).toBe(true);
    expect(estChaineFrancaise("M6 HD")).toBe(true);
    // Le « + » devient le mot « plus » : sans cela, Canal+ se confondrait avec les mille « Canal 8 ».
    expect(estChaineFrancaise("Canal+ Sport 360")).toBe(true);
    expect(estChaineFrancaise("France 3 Alsace")).toBe(true);
    expect(estChaineFrancaise("Guadeloupe La 1ère")).toBe(true);
  });

  it("essaie avant de dépouiller, sinon « France 2 » deviendrait « 2 »", () => {
    expect(estChaineFrancaise("France 2")).toBe(true);
    expect(estChaineFrancaise("FRANCE TF1")).toBe(true);
  });

  it("ne conclut pas sur ce qui porte le même nom ailleurs", () => {
    // Mille chaînes hispanophones s'appellent « Canal » suivi d'un chiffre : aucune n'est française.
    expect(estChaineFrancaise("Canal 8")).toBe(false);
    // Eurosport et beIN portent le même nom dans quinze pays ; leurs versions françaises se
    // reconnaissent à leur `tvg-id`, qui passe de toute façon avant nous.
    expect(estChaineFrancaise("Eurosport 1")).toBe(false);
    expect(estChaineFrancaise("beIN Sports 1")).toBe(false);
    expect(estChaineFrancaise("HBO")).toBe(false);
  });

  it("ne vaut jamais contre une déclaration", () => {
    // Canal+ existe en Pologne : ce qu'annonce le `tvg-id` l'emporte sur ce que suggère le nom.
    expect(paysDeLaChaine({ tvgId: "CanalPlusSport.pl", nom: "Canal+ Sport" })).toBe("pl");
    expect(paysDeLaChaine({ tvgId: null, groupe: "Sports", nom: "Canal+ Sport" })).toBe("fr");
  });
});

describe("l'ordre des pays dans la grille", () => {
  it("met la France en tête, puis l'alphabet des noms français", () => {
    expect(rangDuPays("fr")).toBe(0);
    // « Allemagne » avant « Argentine » avant « Belgique » : c'est l'ordre qu'on lit à l'écran, donc
    // celui des noms français, et non celui des codes ISO où `ar` précéderait `de`.
    expect(rangDuPays("de")).toBeLessThan(rangDuPays("ar"));
    expect(rangDuPays("ar")).toBeLessThan(rangDuPays("be"));
  });

  it("ferme la marche avec ce qu'on ne sait pas nommer, puis l'absence de pays", () => {
    expect(rangDuPays("jp")).toBeLessThan(rangDuPays("nz"));
    expect(rangDuPays("nz")).toBeLessThan(RANG_SANS_PAYS);
    expect(rangDuPays(null)).toBe(RANG_SANS_PAYS);
  });
});
