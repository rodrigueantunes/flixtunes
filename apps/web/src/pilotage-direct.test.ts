import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetCacheDirect, debitRetenu, familleLecteur, formatAdresse, imagesPresentees, identifiantLectureDirect, JournalDirect, reserveDeDepart, retenirDebit } from "./pilotage-direct";

afterEach(() => vi.unstubAllGlobals());

describe("pilotage Web du direct", () => {
  it("crée des sessions distinctes acceptées par le serveur en HTTP local", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 30 }, () => identifiantLectureDirect());
    expect(new Set(ids).size).toBe(30);
    expect(ids.every((id) => /^[a-zA-Z0-9-]{1,64}$/.test(id))).toBe(true);
  });
  it("ne bloque pas l'affichage si les API crypto sont absentes", () => {
    vi.stubGlobal("crypto", undefined);
    expect(identifiantLectureDirect()).toMatch(/^[a-zA-Z0-9-]{1,64}$/);
  });
  it("garde une réserve compatible avec les fenêtres courtes", () => {
    expect(reserveDeDepart(60)).toBe(8);
    expect(reserveDeDepart(9)).toBe(3);
    expect(reserveDeDepart(0)).toBe(8);
  });
  it("retient le débit mesuré pour démarrer dans la bonne qualité, lissé et borné (r12)", () => {
    const memoire = new Map<string, string>();
    const avant = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true,
      value: { getItem: (c: string) => memoire.get(c) ?? null, setItem: (c: string, v: string) => { memoire.set(c, v); } } });
    try {
      expect(debitRetenu()).toBeUndefined();
      retenirDebit(10_000_000); expect(debitRetenu()).toBe(10_000_000);
      // Une soirée sur un réseau lent ne fixe pas le départ des suivantes.
      retenirDebit(2_000_000); expect(debitRetenu()).toBe(7_600_000);
      retenirDebit(Number.NaN); retenirDebit(100_000); expect(debitRetenu()).toBe(7_600_000);
    } finally {
      if (avant) Object.defineProperty(globalThis, "localStorage", avant); else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
  it("ne compte pas une image perdue comme une image présentée", () => {
    expect(imagesPresentees({ getVideoPlaybackQuality: () => ({ totalVideoFrames: 12, droppedVideoFrames: 10 }) } as HTMLVideoElement)).toBe(2);
    expect(imagesPresentees({} as HTMLVideoElement)).toBeNull();
  });
  it("reconnaît les familles et les formats sans confondre le segment d'un HLS avec sa playlist", () => {
    expect(familleLecteur("Chrome/140 OPR/130")).toBe("web-chromium");
    expect(familleLecteur("Firefox/140")).toBe("web-firefox");
    expect(familleLecteur("Version/18 Safari/600")).toBe("web-safari");
    expect(formatAdresse("/api/live/relais?t=opaque&f=mpd")).toBe("dash");
    expect(formatAdresse("https://tv.test/live.m3u8?f=ts")).toBe("hls");
    expect(formatAdresse("https://tv.test/direct")).toBe("inconnu");
  });
  it("borne la mémoire selon la machine", () => {
    expect(budgetCacheDirect(2)).toBe(16 * 1024 * 1024);
    expect(budgetCacheDirect(8)).toBe(32 * 1024 * 1024);
  });
});
