import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetCacheDirect, familleLecteur, formatAdresse, imagesPresentees, identifiantLectureDirect, JournalDirect, reserveDeDepart, vitesseContinue } from "./pilotage-direct";

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
  it("régule sans consommer une réserve critique ni annuler un recul manuel", () => {
    expect(vitesseContinue(48, 40, 25, false)).toBe(1.03);
    expect(vitesseContinue(59, 55, 20, false)).toBe(1.06);
    expect(vitesseContinue(48, 40, 3, false)).toBe(1);
    expect(vitesseContinue(40, 55, 20, false)).toBe(0.98);
    expect(vitesseContinue(59, 40, 20, true)).toBe(1);
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
