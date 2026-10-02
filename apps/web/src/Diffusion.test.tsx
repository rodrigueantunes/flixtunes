// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CentreDiffusion, BoutonDiffusion, useCatalogueDiffusion, useSurfaceDiffusion } from "./Diffusion";
const { diffusion } = vi.hoisted(() => ({ diffusion: vi.fn() }));
vi.mock("./api", () => ({ api: { diffusion, saveProgress: vi.fn().mockResolvedValue(undefined) } }));
const pause = vi.fn();
const etat = { contenu: { genre: "media" as const, id: "film", titre: "Été à la télé" }, lecture: "lecture" as const, position: 123, duree: 3600, volume: 1, navigation: true, erreur: null };
function Client() {
  useCatalogueDiffusion("profil", () => {});
  useSurfaceDiffusion({ etat: () => etat, commander: pause });
  return <BoutonDiffusion />;
}
beforeEach(() => {
  vi.useFakeTimers(); pause.mockReset(); diffusion.mockReset();
  diffusion.mockImplementation(async (_profil: string, path: string) => {
    if (path === "lecteurs") return { id: "ft-moi", cle: "cle" };
    if (path.startsWith("lecteurs/")) return { ordres: [] };
    if (path === "cibles") return { cibles: [{ id: "cast-tv", nom: "Téléviseur Philips", protocole: "googlecast", etat: null, occupe: false }] };
    if (path.includes("/commande")) return { ok: true };
    return {};
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function ouvrir() {
  render(<CentreDiffusion><Client /></CentreDiffusion>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.click(screen.getByRole("button", { name: "Caster ou piloter un appareil" }));
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(350); });
  fireEvent.click(screen.getByRole("button", { name: /Téléviseur Philips/ }));
}
it("transmet le contenu et la position, puis met le lecteur local en pause après confirmation", async () => {
  await ouvrir();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande", { type: "charger", contenu: etat.contenu, position: 123 });
  expect(pause).toHaveBeenCalledWith({ type: "pause" });
});
it("conserve la lecture locale si le téléviseur refuse le flux", async () => {
  await ouvrir();
  diffusion.mockRejectedValueOnce(new Error("Format refusé"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  expect(screen.getByRole("alert").textContent).toContain("Format refusé"); expect(pause).not.toHaveBeenCalled();
});
it("attend l’accusé du lecteur FlixTunes, au lieu de confondre transmission et lecture", async () => {
  await ouvrir();
  diffusion.mockImplementation(async (_profil: string, path: string) => {
    if (path.includes("/commande")) return { ordre: "o1" };
    if (path.includes("/ordres/")) return { resultat: { id: "o1", ok: false, erreur: "Démarrage impossible" } };
    if (path === "cibles") return { cibles: [{ id: "cast-tv", nom: "Téléviseur Philips", protocole: "flixtunes", etat: null, occupe: false }] };
    return { ordres: [] };
  });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); await vi.advanceTimersByTimeAsync(600); });
  expect(pause).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("Démarrage impossible");
});
it("fermer le panneau ne transmet pas d’arrêt au récepteur", async () => {
  await ouvrir(); diffusion.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
  expect(screen.queryByRole("dialog")).toBeNull(); expect(diffusion).not.toHaveBeenCalled();
});
it("ne lance pas de vidéo cachée lorsque le choix AirPlay est annulé", async () => {
  const choisir = vi.fn();
  Object.defineProperty(HTMLVideoElement.prototype, "webkitShowPlaybackTargetPicker", { value: choisir, configurable: true });
  const jouer = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pauser = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  try {
    await ouvrir();
    diffusion.mockImplementation(async (_profil, path) => path === "airplay" ? { url: "/cast-test.mp4", cle: "test", position: 123, decalage: 0 } : { ordres: [], cibles: [] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Préparer AirPlay" })); });
    fireEvent.click(screen.getByRole("button", { name: "Choisir l’appareil AirPlay" }));
    expect(choisir).toHaveBeenCalledOnce(); expect(jouer).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    const video = screen.getByLabelText("Lecture AirPlay");
    fireEvent.error(video);
    expect(screen.getByRole("alert").textContent).toContain("AirPlay n’a pas pu lire");
    expect(screen.getByRole("button", { name: "Réessayer en format compatible" })).toBeTruthy();
    Object.defineProperty(video, "webkitCurrentPlaybackTargetIsWireless", { value: true, configurable: true });
    await act(async () => { fireEvent(video, new Event("webkitcurrentplaybacktargetiswirelesschanged")); });
    expect(jouer).toHaveBeenCalledOnce(); expect(pause).not.toHaveBeenCalled();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    await act(async () => { fireEvent.playing(video); });
    expect(pause).toHaveBeenCalledWith({ type: "pause" });
    cleanup();
    expect(diffusion).toHaveBeenCalledWith("profil", "airplay/test/arreter", {});
  } finally {
    cleanup(); jouer.mockRestore(); pauser.mockRestore();
    Reflect.deleteProperty(HTMLVideoElement.prototype, "webkitShowPlaybackTargetPicker");
  }
});
it("remplace l’accès AirPlay refusé par une préparation compatible et conserve la nouvelle URL", async () => {
  Object.defineProperty(HTMLVideoElement.prototype, "webkitShowPlaybackTargetPicker", { value: vi.fn(), configurable: true });
  const pauser = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  try {
    await ouvrir();
    diffusion.mockImplementation(async (_profil, path, corps) => path === "airplay"
      ? { url: corps.compatible ? "/compatible.m3u8" : "/direct.mp4", cle: corps.compatible ? "second" : "premier", position: 0, decalage: 0 }
      : { ordres: [], cibles: [] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Préparer AirPlay" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Réessayer en format compatible" })); });
    expect(diffusion).toHaveBeenCalledWith("profil", "airplay/premier/arreter", {});
    expect(diffusion).toHaveBeenCalledWith("profil", "airplay", expect.objectContaining({ compatible: true }));
    expect(screen.getByLabelText("Lecture AirPlay").getAttribute("src")).toBe("/compatible.m3u8");
    expect(pause).not.toHaveBeenCalled();
  } finally { cleanup(); pauser.mockRestore(); Reflect.deleteProperty(HTMLVideoElement.prototype, "webkitShowPlaybackTargetPicker"); }
});
