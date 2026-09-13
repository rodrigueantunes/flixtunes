import { describe, expect, it } from "vitest";
import { lireLeReleve } from "./live-releve.js";

/**
 * Le relevé ne sert qu'à ranger : s'il est douteux, il ne doit rien ranger du tout. Chaque cas
 * ci-dessous est une façon d'être douteux.
 */

const maintenant = Date.parse("2026-09-14T08:00:00Z");
const releve = (champs: Record<string, unknown>) => JSON.stringify({
  version: 1, genere_le: "2026-09-14T07:05:00+00:00", joignables: [], muettes: [], ...champs,
});

describe("le relevé des sondes", () => {
  it("dit de chaque adresse si elle répondait", () => {
    const lu = lireLeReleve(releve({ joignables: ["http://a"], muettes: ["http://b"] }), maintenant);
    expect(lu?.get("http://a")).toBe(1);
    expect(lu?.get("http://b")).toBe(0);
    // Une adresse absente du relevé n'y figure pas : son rang reste neutre.
    expect(lu?.has("http://c")).toBe(false);
  });

  it("tient pour joignable une adresse qui a répondu dans au moins une liste", () => {
    const lu = lireLeReleve(releve({ joignables: ["http://a"], muettes: ["http://a"] }), maintenant);
    expect(lu?.get("http://a")).toBe(1);
  });

  it("ignore un relevé de plus d'un jour, ou daté dans l'avenir", () => {
    expect(lireLeReleve(releve({ genere_le: "2026-09-12T07:05:00+00:00" }), maintenant)).toBeNull();
    expect(lireLeReleve(releve({ genere_le: "2026-09-16T07:05:00+00:00" }), maintenant)).toBeNull();
  });

  it("ignore ce qui n'est pas un relevé", () => {
    expect(lireLeReleve("pas du json", maintenant)).toBeNull();
    expect(lireLeReleve("[]", maintenant)).toBeNull();
    expect(lireLeReleve(releve({ version: 2 }), maintenant)).toBeNull();
    expect(lireLeReleve(releve({ genere_le: "hier" }), maintenant)).toBeNull();
    // Des entrées qui ne sont pas des adresses sont passées, sans jeter le reste.
    expect(lireLeReleve(releve({ joignables: [42, "http://a"] }), maintenant)?.get("http://a")).toBe(1);
  });
});
