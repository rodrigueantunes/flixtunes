import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { db, getSetting } from "./database.js";
import { genererJetonDemande, jetonDemandeConfigure, jetonDemandeValide, revoquerJetonDemande } from "./live-demande.js";

/**
 * La demande de relecture du direct : un jeton qu'on ne garde pas en clair, et une route qui ne
 * s'ouvre qu'à lui.
 *
 * Le chemin heureux — la passe qui part — est éprouvé par `television-direct.test.ts`, qui sert de
 * vraies listes sur la boucle locale. Ici, on vérifie ce qui ferme la porte.
 */
describe("le jeton de la demande de relecture", () => {
  afterAll(() => revoquerJetonDemande());

  it("n'est gardé qu'en empreinte, et le dernier créé remplace le précédent", () => {
    const premier = genererJetonDemande();
    expect(premier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Une copie de la base ne doit pas donner le jeton.
    expect(getSetting("live.jeton_demande")).not.toContain(premier);
    expect(jetonDemandeValide(premier)).toBe(true);

    const second = genererJetonDemande();
    expect(jetonDemandeValide(premier)).toBe(false);
    expect(jetonDemandeValide(second)).toBe(true);
  });

  it("refuse ce qui n'est pas lui, et plus rien une fois révoqué", () => {
    const jeton = genererJetonDemande();
    expect(jetonDemandeValide(undefined)).toBe(false);
    expect(jetonDemandeValide("")).toBe(false);
    expect(jetonDemandeValide(`${jeton}x`)).toBe(false);

    revoquerJetonDemande();
    expect(jetonDemandeConfigure()).toBe(false);
    expect(jetonDemandeValide(jeton)).toBe(false);
  });
});

describe("la route de demande", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    // Le direct éteint est l'état de départ : la suite partage une seule base.
    db.prepare("DELETE FROM server_settings WHERE key = 'live.parametres'").run();
    app = await buildApp();
  });
  afterAll(async () => {
    revoquerJetonDemande();
    await app?.close();
  });

  const demander = (jeton?: string) => app.inject({
    method: "POST", url: "/api/live/rafraichissement",
    headers: jeton === undefined ? {} : { authorization: `Bearer ${jeton}` },
  });

  it("répond 401 sans jeton, ou avec un autre que le sien", async () => {
    genererJetonDemande();
    expect((await demander()).statusCode).toBe(401);
    expect((await demander("faux")).statusCode).toBe(401);
  });

  it("répond 409 quand le direct est éteint, même avec le bon jeton", async () => {
    const reponse = await demander(genererJetonDemande());
    expect(reponse.statusCode).toBe(409);
    expect(reponse.json().message).toMatch(/désactivée/);
  });

  it("n'exige pas le jeton d'API, qui n'est pas le sien — mais la création du jeton, si", async () => {
    // Le jeton d'API protège les écritures des clients ; la demande vient d'un programme qui l'ignore.
    const jeton = genererJetonDemande();
    const precedent = config.apiToken;
    config.apiToken = "audit-secret";
    try {
      // Passée le garde global, arrêtée par le direct éteint : c'est bien la route qui a répondu.
      expect((await demander(jeton)).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: "/api/system/live/jeton" })).statusCode).toBe(401);
    } finally {
      config.apiToken = precedent;
    }
  });

  it("annonce un jeton actif sans jamais le rendre, et le révoque", async () => {
    const jeton = genererJetonDemande();
    const reglages = await app.inject({ method: "GET", url: "/api/system/live" });
    expect(reglages.json().jetonDemande).toBe(true);
    expect(reglages.body).not.toContain(jeton);

    expect((await app.inject({ method: "DELETE", url: "/api/system/live/jeton" })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/system/live" })).json().jetonDemande).toBe(false);
    expect((await demander(jeton)).statusCode).toBe(401);
  });
});
