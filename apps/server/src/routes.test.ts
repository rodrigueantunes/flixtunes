import { describe, expect, it } from "vitest";
import { parseSingleRange } from "./routes.js";
import { backupPath } from "./maintenance.js";

describe("parseSingleRange", () => {
  it("gère une plage explicite", () => expect(parseSingleRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 }));
  it("gère une plage ouverte", () => expect(parseSingleRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 }));
  it("gère les derniers octets", () => expect(parseSingleRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 }));
  it("rejette une plage hors fichier", () => expect(parseSingleRange("bytes=101-120", 100)).toBeNull());
});

describe("validation des sauvegardes", () => {
  it("n'accepte que les noms générés par FlixTunes", () => {
    expect(backupPath("flixtunes-20260812-153045123.db")).toContain("backups");
    expect(backupPath("../flixtunes.db")).toBeNull();
    expect(backupPath("film.mkv")).toBeNull();
  });
});
