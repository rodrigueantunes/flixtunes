import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./resilience.js";

describe("résilience des services externes", () => {
  it("ouvre le circuit après le seuil d'échecs", async () => {
    const breaker = new CircuitBreaker(2, 60_000); const fail = () => Promise.reject(new Error("panne"));
    await expect(breaker.run(fail)).rejects.toThrow("panne"); await expect(breaker.run(fail)).rejects.toThrow("panne");
    expect(breaker.state).toBe("open"); await expect(breaker.run(async () => "ok")).rejects.toThrow("isolé");
  });
});
