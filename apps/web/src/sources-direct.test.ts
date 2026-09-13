import { describe, expect, it } from "vitest";
import { COURSE_MAX, debutDeVague, premiereAdresse, prochaineAdresse, regrouperLesSources } from "./sources-direct";

/**
 * Le repli et le menu des sources, éprouvés sans le lecteur. Deux promesses : toutes les sources
 * entrent dans le repli et dans le menu, et celles qui ne répondent pas ne font plus attendre.
 */

const source = (url: string, empreinte = url) => ({ url, empreinte });

describe("le repli automatique", () => {
  it("parcourt toutes les adresses, bien au-delà de la huitième", () => {
    const urls = Array.from({ length: 30 }, (_, index) => `u${index}`);
    expect(prochaineAdresse(urls, 7, new Set())).toBe(8);
    expect(prochaineAdresse(urls, 28, new Set())).toBe(29);
    expect(prochaineAdresse(urls, 29, new Set())).toBeNull();
  });

  it("saute les adresses que le serveur a trouvées muettes", () => {
    const urls = ["a", "b", "c", "d"];
    expect(prochaineAdresse(urls, 0, new Set(["b", "c"]))).toBe(3);
    expect(prochaineAdresse(urls, 0, new Set(["b", "c", "d"]))).toBeNull();
  });

  it("reprend à la mieux classée de celles qui répondent", () => {
    expect(premiereAdresse(["a", "b", "c"], new Set(["a"]))).toBe(1);
    // Si toutes se taisent, il faut bien essayer quelque chose : la première.
    expect(premiereAdresse(["a", "b"], new Set(["a", "b"]))).toBe(0);
  });

  it("court par vagues de douze", () => {
    expect(COURSE_MAX).toBe(12);
    expect([0, 11, 12, 23, 24, 80].map(debutDeVague)).toEqual([0, 0, 12, 12, 24, 72]);
  });
});

describe("le menu des sources", () => {
  it("montre tout, et range les muettes à la fin sans en perdre une", () => {
    const adresses = Array.from({ length: 20 }, (_, index) => source(`u${index}`));
    const muettes = new Set(["u0", "u5"]);
    const groupes = regrouperLesSources(adresses, muettes);
    expect(groupes).toHaveLength(20);
    expect(groupes.slice(-2).map((groupe) => [groupe.source.url, groupe.muette])).toEqual([["u0", true], ["u5", true]]);
    expect(groupes[0]).toMatchObject({ index: 1, muette: false });
  });

  it("réunit les doublons d'affichage, et ouvre le membre qui répond", () => {
    // Deux adresses du même hôte et du même chemin, qui ne diffèrent que par un jeton.
    const adresses = [source("h/flux?jeton=1", "h/flux"), source("autre/flux"), source("h/flux?jeton=2", "h/flux")];
    const groupes = regrouperLesSources(adresses, new Set(["h/flux?jeton=1"]));
    expect(groupes.map((groupe) => [groupe.index, groupe.doublons, groupe.muette])).toEqual([[2, 2, false], [1, 1, false]]);
  });
});
