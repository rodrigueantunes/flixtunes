import { describe, expect, it } from "vitest";
import { metadataMatchInputSchema } from "@flixtunes/contracts";
import { metadataProviderStatuses } from "./metadata-providers.js";

/**
 * Fournisseurs acceptés lors d'une correction manuelle — étape 55.
 *
 * Le schéma de validation n'énumérait pas `tvmaze` ni `wikidata`. L'interface proposait pourtant
 * leurs candidats : choisir une série issue de TVmaze — le cas de toutes celles absentes de TMDB —
 * recevait « Correspondance invalide », sans que rien n'indique que le fournisseur était en cause.
 *
 * Ce test lie la validation à la liste réelle des fournisseurs plutôt qu'à une énumération recopiée :
 * ajouter un fournisseur sans l'autoriser ici redeviendrait sinon possible, et le défaut se
 * reproduirait à l'identique.
 */

describe("fournisseurs acceptés par une correction manuelle", () => {
  it("accepte tout fournisseur que le serveur sait interroger", () => {
    // `local` n'a pas d'identifiant distant à choisir et Fanart ne fournit que des images : ils sont
    // visibles dans l'état des fournisseurs, mais ne sont pas des cibles de correspondance.
    const proposables = metadataProviderStatuses().filter((provider) => provider.role === "metadata").map((provider) => provider.id);
    expect(proposables.length).toBeGreaterThan(0);
    for (const identifiant of proposables) {
      const verdict = metadataMatchInputSchema.safeParse({ provider: identifiant, externalId: "1369" });
      expect(verdict.success, `le fournisseur « ${identifiant} » doit être acceptable`).toBe(true);
    }
  });

  it("accepte nommément TVmaze, dont proviennent les séries absentes de TMDB", () => {
    expect(metadataMatchInputSchema.safeParse({ provider: "tvmaze", externalId: "1369" }).success).toBe(true);
    expect(metadataMatchInputSchema.safeParse({ provider: "wikidata", externalId: "Q1361932" }).success).toBe(true);
  });

  it("refuse toujours un fournisseur inconnu et un identifiant fantaisiste", () => {
    // L'ouverture ne doit pas devenir un blanc-seing : le champ reste contraint.
    expect(metadataMatchInputSchema.safeParse({ provider: "inconnu", externalId: "1" }).success).toBe(false);
    expect(metadataMatchInputSchema.safeParse({ provider: "tvmaze", externalId: "1369; DROP TABLE" }).success).toBe(false);
    expect(metadataMatchInputSchema.safeParse({ provider: "tvmaze", externalId: "" }).success).toBe(false);
  });
});
