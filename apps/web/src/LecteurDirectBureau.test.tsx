// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChaineDirect } from "@flixtunes/contracts";
import type { EtatLecteurBureau } from "./bureau";
const { apiMock } = vi.hoisted(() => ({ apiMock: { chaineLive: vi.fn(), resultatChaineLive: vi.fn() } }));
vi.mock("./api", () => ({ api: apiMock }));
import { LecteurDirectBureau } from "./LecteurDirectBureau";

const source = { url: "https://amont.test/a.m3u8", relais: "http://localhost:3000/api/live/relais?t=secret", identifiant: "a" };
const ouvrir = vi.fn(), fermer = vi.fn(), pause = vi.fn(), lire = vi.fn();
let ecouteur: (e: EtatLecteurBureau) => void;
let ecouteurPleinEcran: (actif: boolean) => void;
const repli = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  ouvrir.mockResolvedValue({ ok: true }); fermer.mockResolvedValue(undefined); pause.mockResolvedValue(undefined); lire.mockResolvedValue(undefined);
  apiMock.chaineLive.mockResolvedValue({ sources: [source] }); apiMock.resultatChaineLive.mockResolvedValue(undefined);
  vi.stubGlobal("flixtunesBureau", { version: "4", pleinEcran: vi.fn().mockResolvedValue(true),
    surPleinEcran: (f: typeof ecouteurPleinEcran) => { ecouteurPleinEcran = f; return () => {}; },
    direct: { ouvrir, fermer, diagnostic: vi.fn().mockResolvedValue(null) },
    lecteur: { lire, pause, volume: vi.fn().mockResolvedValue(undefined), vitesse: vi.fn().mockResolvedValue(undefined),
      surEtat: (f: typeof ecouteur) => { ecouteur = f; return () => {}; } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function monter() {
  await act(async () => { render(<LecteurDirectBureau chaine={{ id: "test", nom: "Test" } as ChaineDirect}
    precedente={null} onChaine={() => {}} onClose={() => {}} onRepli={repli} />); });
}
const joue = (imagesAffichees: number) => ecouteur({ ouvert: true, position: imagesAffichees / 25, duree: 0, enLecture: true,
  vitesse: 1, imagesAffichees, imagesPerdues: 0, pistes: [], termine: false, erreur: null });
it("ouvre le relais dans VLC, conserve l'interface transparente puis ferme le natif", async () => {
  await monter();
  expect(ouvrir).toHaveBeenCalledWith(source.relais);
  expect(apiMock.chaineLive).toHaveBeenCalledWith("test", "bureau-vlc", expect.any(AbortSignal));
  expect(document.body.classList.contains("bureau-video")).toBe(true);
  expect(document.querySelector("video")).toBeNull();
  await act(async () => { joue(25); await vi.advanceTimersByTimeAsync(4_000); });
  expect(document.querySelector(".lecteur-direct")?.classList.contains("commandes")).toBe(false);
  cleanup(); expect(fermer).toHaveBeenCalled(); expect(document.body.classList.contains("bureau-video")).toBe(false);
});
it("une pause volontaire ne déclenche pas de reprise", async () => {
  await monter(); fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(ouvrir).toHaveBeenCalledTimes(1); expect(repli).not.toHaveBeenCalled(); expect(pause).toHaveBeenCalled();
});
it("le bouton suit le plein écran modifié par F11 ou Échap dans la coque", async () => {
  await monter();
  act(() => ecouteurPleinEcran(true));
  expect(screen.getByRole("button", { name: "Quitter le plein écran" })).toBeTruthy();
  act(() => ecouteurPleinEcran(false));
  expect(screen.getByRole("button", { name: "Plein écran" })).toBeTruthy();
});
it("renouvelle l'accès avant une reprise et finit par passer au Web", async () => {
  await monter();
  apiMock.chaineLive.mockResolvedValue({ sources: [{ ...source, relais: "http://localhost:3000/api/live/relais?t=nouveau" }] });
  await act(async () => { await vi.advanceTimersByTimeAsync(26_000); });
  expect(ouvrir).toHaveBeenLastCalledWith("http://localhost:3000/api/live/relais?t=nouveau");
  await act(async () => { await vi.advanceTimersByTimeAsync(55_000); });
  expect(ouvrir).toHaveBeenCalledTimes(3); expect(repli).toHaveBeenCalledTimes(1);
});
it("n'ouvre pas VLC si la réponse de la chaîne arrive après fermeture", async () => {
  let finir!: (v: unknown) => void;
  apiMock.chaineLive.mockImplementation(() => new Promise((r) => { finir = r; }));
  await monter(); cleanup();
  await act(async () => { finir({ sources: [source] }); });
  expect(ouvrir).not.toHaveBeenCalled();
});
