import { describe, expect, it } from "vitest";
import { NOTE_VOTES_MIN, noteAffichable, noteSurCinq } from "./note.js";

describe("la note sur cinq étoiles (r14)", () => {
  it("proratise selon l'échelle du fournisseur, au dixième près", () => {
    expect(noteSurCinq(7.84, 10, 3000, "tmdb")).toEqual({ surCinq: 3.9, votes: 3000, source: "tmdb" });
    expect(noteSurCinq(81, 100, 50, "autre")?.surCinq).toBe(4.1);
    expect(noteSurCinq(3.6, 5, 12, "allocine")?.surCinq).toBe(3.6);
    expect(noteSurCinq(10, 10, 12, "tmdb")?.surCinq).toBe(5);
  });
  it("ne dit rien sans note, sans vote, ou hors de l'échelle", () => {
    expect(noteSurCinq(null, 10, 100, "tmdb")).toBeNull();
    expect(noteSurCinq(0, 10, 0, "tmdb")).toBeNull();
    expect(noteSurCinq(7, 10, 0, "tmdb")).toBeNull();
    expect(noteSurCinq(12, 10, 40, "tmdb")).toBeNull();
    expect(noteSurCinq(7, 0, 40, "tmdb")).toBeNull();
  });
  it("ne montre une note qu'à partir de dix votes", () => {
    expect(NOTE_VOTES_MIN).toBe(10);
    expect(noteAffichable(5, 1, "tmdb")).toBeNull();
    expect(noteAffichable(4.2, 9, "tmdb")).toBeNull();
    expect(noteAffichable(4.2, 10, "tmdb")).toEqual({ surCinq: 4.2, votes: 10, source: "tmdb" });
    expect(noteAffichable(null, 300, "tmdb")).toBeNull();
  });
});
