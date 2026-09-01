import { describe, expect, it } from "vitest";
import { appellationsPossibles, indexerLaReference } from "./reference-chaines.js";

/**
 * La table de référence répond à une question que les quatre indices déduits laissaient ouverte pour
 * les trois quarts du corpus : de quel pays est cette chaîne ? Ce qui est éprouvé ici, c'est sa
 * prudence — elle doit refuser d'identifier plutôt que de se tromper.
 */

const table = (entrees: unknown[]) => indexerLaReference(JSON.stringify(entrees));

describe("l'index de la référence", () => {
  it("range une chaîne par son nom et par ses autres écritures", () => {
    const index = table([
      { id: "TF1.fr", name: "TF1", alt_names: ["TF1 HD", "La Une"], country: "FR", categories: ["general"] },
    ]);
    expect(index.get("tf1")?.pays).toBe("fr");
    // Les autres écritures comptent autant : c'est là que se trouve ce qu'on rencontre dans les listes.
    expect(index.get("la une")?.pays).toBe("fr");
  });

  it("refuse d'identifier un nom que deux pays se disputent", () => {
    /*
     * « News » existe partout. Trancher au hasard remplirait la grille d'attributions fausses, et une
     * erreur silencieuse vaut moins que l'aveu d'ignorance qu'on avait déjà.
     */
    const index = table([
      { name: "News", country: "US" },
      { name: "News", country: "GB" },
      { name: "Unique", country: "FR" },
    ]);
    expect(index.has("news")).toBe(false);
    expect(index.get("unique")?.pays).toBe("fr");
  });

  it("garde un homonyme du même pays : ce qu'on en retire est identique", () => {
    const index = table([
      { name: "Sport", country: "FR", categories: ["sports"] },
      { name: "Sport", country: "FR", categories: ["general"] },
    ]);
    expect(index.get("sport")?.pays).toBe("fr");
  });

  it("écarte les chaînes fermées et celles sans pays", () => {
    // Une chaîne éteinte ne doit pas prêter son identité à une homonyme encore diffusée.
    const index = table([
      { name: "Ancienne", country: "FR", closed: "2019-01-01" },
      { name: "Apatride", country: null },
    ]);
    expect(index.size).toBe(0);
  });

  it("retient le caractère adulte, que des profils enfants existent", () => {
    const index = table([{ name: "Quelque Chose", country: "FR", is_nsfw: true }]);
    expect(index.get("quelque chose")?.adulte).toBe(true);
  });
});

describe("le dépouillement d'un nom", () => {
  it("essaie chaque couche, de la plus décorée à la plus nue", () => {
    /*
     * Les noms du corpus sont décorés, ceux de la table sont propres : sans cela, « TF1 FHD 1080p »
     * ne rejoignait jamais « TF1 ». Mesuré sur le corpus, 2 775 chaînes identifiées sans ce
     * dépouillement contre 4 236 avec.
     */
    expect(appellationsPossibles("tf1 fhd 1080p")).toEqual(["tf1 fhd 1080p", "tf1 fhd", "tf1"]);
    expect(appellationsPossibles("fr m6 hd")).toEqual(["fr m6 hd", "fr m6", "m6"]);
  });

  it("essaie avant de dépouiller, sinon « France 2 » deviendrait « 2 »", () => {
    // La forme entière est toujours proposée en premier : c'est elle qui a le plus de chances d'être
    // le vrai nom, et le dépouillement n'est qu'un recours.
    expect(appellationsPossibles("france 2")[0]).toBe("france 2");
  });

  it("ne dépouille jamais jusqu'au vide", () => {
    expect(appellationsPossibles("hd")).toEqual(["hd"]);
    expect(appellationsPossibles("")).toEqual([]);
  });
});
