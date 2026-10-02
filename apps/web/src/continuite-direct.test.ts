import { describe, expect, it } from "vitest";
import { QualiteContinue, doitPreparerSecours, raccordAutorise, lienDirectARenouveler } from "./continuite-direct";
import { tempsPourRepere } from "./releve-direct";

describe("continuité du direct", () => {
  it("anticipe une panne mais respecte une publication normale de segments", () => {
    expect(doitPreparerSecours(25, 13_000, 8)).toBe(true);
    expect(doitPreparerSecours(25, 10_000, 8)).toBe(false);
    expect(doitPreparerSecours(40, 13_000, 8)).toBe(false);
  });
  it("n'oscille pas avec les relevés rapprochés et remonte progressivement", () => {
    const q = new QualiteContinue();
    expect(q.ajuster(12, 5, -1, 3, 0)).toBe(2);
    expect(q.ajuster(12, 5, 2, 3, 250)).toBe(2);
    expect(q.ajuster(4, 5, 2, 3, 500)).toBe(0);
    expect(q.ajuster(30, 5, 0, 0, 1_000)).toBe(0);
    expect(q.ajuster(30, 5, 0, 0, 20_000)).toBe(0);
    expect(q.ajuster(30, 5, 0, 0, 21_000)).toBe(1);
    expect(q.ajuster(30, 5, 1, 1, 21_250)).toBe(1);
  });
  it("un nouveau manque de réserve interrompt l'accalmie", () => {
    const q = new QualiteContinue();
    q.ajuster(30, 3, 0, 0, 0);
    q.ajuster(20, 3, 0, 0, 19_000);
    expect(q.ajuster(30, 3, 0, 0, 21_000)).toBe(0);
  });
  it("n'assimile pas les numéros de segments de deux fournisseurs", () => {
    const segments = [{ sn: 42, start: 10, duration: 6 }];
    expect(raccordAutorise(false, null, null)).toBe(false);
    expect(tempsPourRepere(segments, { sn: 42, decalage: 2, pdt: null }, false)).toBeNull();
    expect(tempsPourRepere(segments, { sn: 42, decalage: 2, pdt: null }, true)).toBe(12);
    expect(tempsPourRepere([{ ...segments[0]!, programDateTime: 100_000 }],
      { sn: 999, decalage: 0, pdt: 103_000 }, false)).toBe(13);
  });
});


it("renouvelle les 404 de notre relais sans confondre un fournisseur distant", () => {
  expect(lienDirectARenouveler(404, "/api/live/relais?t=ancien", "https://tv.example")).toBe(true);
  expect(lienDirectARenouveler(404, "https://autre.example/api/live/relais?t=x", "https://tv.example")).toBe(false);
  expect(lienDirectARenouveler(404, "/film.m3u8", "https://tv.example")).toBe(false);
});
