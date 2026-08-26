import { describe, expect, it } from "vitest";
import { secureSecretEqual } from "./security.js";

describe("comparaison des secrets", () => {
  it("accepte uniquement une valeur identique", () => {
    expect(secureSecretEqual("secret-local", "secret-local")).toBe(true);
    expect(secureSecretEqual("secret-locaL", "secret-local")).toBe(false);
    expect(secureSecretEqual(undefined, "secret-local")).toBe(false);
  });
});
