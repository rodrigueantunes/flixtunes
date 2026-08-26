import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptProviderSecret, encryptProviderSecret } from "./provider-settings.js";

describe("stockage sécurisé des fournisseurs", () => {
  it("chiffre les jetons avec AES-256-GCM et détecte une altération", () => {
    const key = randomBytes(32);
    const encrypted = encryptProviderSecret("jeton-tmdb-confidentiel", key);
    expect(encrypted).not.toContain("jeton-tmdb-confidentiel");
    expect(decryptProviderSecret(encrypted, key)).toBe("jeton-tmdb-confidentiel");
    expect(() => decryptProviderSecret(`${encrypted.slice(0, -2)}AA`, key)).toThrow();
  });
});
