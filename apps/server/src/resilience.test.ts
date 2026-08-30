import { describe, expect, it } from "vitest";
import { Cadence, CircuitBreaker, delaiDemande, LimiteDeDebit } from "./resilience.js";

describe("résilience des services externes", () => {
  it("ouvre le circuit après le seuil d'échecs", async () => {
    const breaker = new CircuitBreaker(2, 60_000); const fail = () => Promise.reject(new Error("panne"));
    await expect(breaker.run(fail)).rejects.toThrow("panne"); await expect(breaker.run(fail)).rejects.toThrow("panne");
    expect(breaker.state).toBe("open"); await expect(breaker.run(async () => "ok")).rejects.toThrow("isolé");
  });

  /**
   * Le défaut que ce test protège : quatre `429` de suite isolaient TMDB quarante-cinq secondes,
   * alors qu'il répondait. Vu de l'écran, le fournisseur « disparaissait » sans avoir été absent.
   */
  it("ne compte pas une limitation de débit comme une panne", async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    const freine = () => Promise.reject(new LimiteDeDebit("TMDB", 1_000));
    for (let essai = 0; essai < 5; essai += 1) {
      await expect(breaker.run(freine)).rejects.toBeInstanceOf(LimiteDeDebit);
    }
    expect(breaker.state).toBe("closed");
    await expect(breaker.run(async () => "ok")).resolves.toBe("ok");
  });

  it("dit combien de temps il reste avant de pouvoir réessayer", async () => {
    const breaker = new CircuitBreaker(1, 60_000);
    expect(breaker.msAvantReouverture()).toBe(0);
    await expect(breaker.run(() => Promise.reject(new Error("panne")))).rejects.toThrow("panne");
    const reste = breaker.msAvantReouverture();
    expect(reste).toBeGreaterThan(55_000);
    expect(reste).toBeLessThanOrEqual(60_000);
  });

  describe("le délai demandé par le fournisseur", () => {
    const entetes = (valeur?: string) => new Headers(valeur == null ? {} : { "retry-after": valeur });

    it("lit un nombre de secondes", () => {
      expect(delaiDemande(entetes("3"))).toBe(3_000);
    });

    it("lit une date, et la ramène à une durée", () => {
      const dans5s = new Date(Date.now() + 5_000).toUTCString();
      const lu = delaiDemande(entetes(dans5s));
      expect(lu).toBeGreaterThan(3_000);
      expect(lu).toBeLessThanOrEqual(6_000);
    });

    it("rend null plutôt qu'un chiffre inventé quand l'en-tête manque ou est illisible", () => {
      expect(delaiDemande(entetes())).toBeNull();
      expect(delaiDemande(entetes("bientôt"))).toBeNull();
    });

    it("plafonne un en-tête aberrant : une analyse ne dort pas une heure", () => {
      expect(delaiDemande(entetes("86400"), 60_000)).toBe(60_000);
    });

    it("ne rend jamais de délai négatif pour une date déjà passée", () => {
      expect(delaiDemande(entetes(new Date(Date.now() - 60_000).toUTCString()))).toBe(0);
    });
  });

  it("la cadence espace les départs sans jamais les perdre", async () => {
    const cadence = new Cadence(100); // 10 ms d'écart
    const debut = Date.now();
    for (let appel = 0; appel < 4; appel += 1) await cadence.attendreSonTour();
    // Trois intervalles au moins entre le premier et le quatrième départ.
    expect(Date.now() - debut).toBeGreaterThanOrEqual(25);
  });
});
