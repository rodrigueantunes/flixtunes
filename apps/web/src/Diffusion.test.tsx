// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CentreDiffusion, BoutonDiffusion, RelaisDiffusion, useCatalogueDiffusion, useSurfaceDiffusion } from "./Diffusion";
const { diffusion, remoteSession } = vi.hoisted(() => ({ diffusion: vi.fn(), remoteSession: vi.fn() }));
vi.mock("./api", () => ({ api: { diffusion, remoteSession, saveProgress: vi.fn().mockResolvedValue(undefined) } }));
const pause = vi.fn();
const etat = { contenu: { genre: "media" as const, id: "film", titre: "Été à la télé" }, lecture: "lecture" as const, position: 123, duree: 3600, volume: 1, navigation: true, erreur: null };
function Client() {
  useCatalogueDiffusion("profil", () => {});
  useSurfaceDiffusion({ etat: () => etat, commander: pause });
  return <BoutonDiffusion />;
}
beforeEach(() => {
  vi.useFakeTimers(); pause.mockReset(); diffusion.mockReset(); remoteSession.mockReset().mockResolvedValue({ required: false, authenticated: true, account: null });
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
  // Un serveur antérieur à la r7 répond à la fin de la préparation : la confirmation est immédiate.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande?asynchrone=1", { type: "charger", contenu: etat.contenu, position: 123 });
  expect(pause).toHaveBeenCalledWith({ type: "pause" });
});
const cibleTv = (etatTv: unknown) => ({ id: "cast-tv", nom: "Téléviseur Philips", protocole: "googlecast", modele: "Philips 55OLED", etat: etatTv, occupe: false });
function serveurAsynchrone(etats: unknown[]) {
  let tour = 0;
  diffusion.mockImplementation(async (_profil: string, path: string) => {
    if (path === "lecteurs") return { id: "ft-moi", cle: "cle" };
    if (path.startsWith("lecteurs/")) return { ordres: [] };
    if (path === "cibles") return { cibles: [cibleTv(etats[Math.min(tour++, etats.length - 1)])] };
    if (path.includes("/commande?asynchrone=1")) { tour = 0; return { operation: "op" }; }
    if (path.includes("/commande")) return { ok: true };
    return {};
  });
}
it("suit les étapes de la préparation et ne met en pause qu’à la lecture confirmée", async () => {
  await ouvrir();
  serveurAsynchrone([null, { ...etat, lecture: "chargement", etape: "preparation", qualite: "Conversion compatible · 720p maximum" },
    { ...etat, lecture: "lecture", qualite: "Conversion compatible · 720p maximum" }]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  expect(pause).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(screen.getByText(/Préparation de la vidéo · Conversion compatible/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(pause).toHaveBeenCalledWith({ type: "pause" });
  expect(screen.getByRole("button", { name: /Diffusion en cours sur Téléviseur Philips/ })).toBeTruthy();
});
it("garde la lecture locale et montre l’erreur quand la préparation échoue", async () => {
  await ouvrir();
  serveurAsynchrone([{ ...etat, lecture: "chargement", etape: "connexion" }, { ...etat, lecture: "erreur", erreur: "Le récepteur Cast ne répond pas" }]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
  expect(pause).not.toHaveBeenCalled();
  expect(screen.getByText("Le récepteur Cast ne répond pas")).toBeTruthy();
});
it("annule une préparation depuis le panneau", async () => {
  await ouvrir();
  serveurAsynchrone([{ ...etat, lecture: "chargement", etape: "sonde" }]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Annuler" })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande", { type: "arreter" });
});
it("pose une mini-télécommande sur l’accueil pendant une diffusion", async () => {
  serveurAsynchrone([{ ...etat, lecture: "lecture" }]);
  function Accueil() { useCatalogueDiffusion("profil", () => {}); return <BoutonDiffusion />; }
  render(<CentreDiffusion><Accueil /></CentreDiffusion>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.dynamicImportSettled(); });
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("complementary", { name: "Diffusion sur Téléviseur Philips" })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mettre en pause sur le téléviseur" })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande", { type: "pause" });
});
it("fait du lecteur la télécommande, et reprend ici à la position du téléviseur", async () => {
  serveurAsynchrone([{ ...etat, lecture: "pause", position: 1800 }]);
  const reprendre = vi.fn();
  function Lecteur() {
    useCatalogueDiffusion("profil", () => {});
    useSurfaceDiffusion({ etat: () => ({ ...etat, lecture: "pause" }), commander: pause });
    return <RelaisDiffusion contenu="film" onReprendreIci={reprendre} />;
  }
  render(<CentreDiffusion><Lecteur /></CentreDiffusion>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.dynamicImportSettled(); });
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("heading", { name: "En pause sur Téléviseur Philips" })).toBeTruthy();
  // Le lecteur affiche déjà ce contenu : pas de mini-télécommande en double.
  expect(screen.queryByRole("complementary")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reprendre ici" })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande", { type: "arreter" });
  expect(reprendre).toHaveBeenCalledWith(1800);
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
it("réinitialise un téléviseur bloqué depuis le panneau", async () => {
  await ouvrir();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Réinitialiser le téléviseur" })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/cast-tv/commande", { type: "reinitialiser" });
});
it("dit qui a lancé la diffusion qu’un autre profil regarde", async () => {
  diffusion.mockImplementation(async (_profil: string, path: string) => {
    if (path === "lecteurs") return { id: "ft-moi", cle: "cle" };
    if (path.startsWith("lecteurs/")) return { ordres: [] };
    if (path === "cibles") return { cibles: [{ ...cibleTv({ ...etat, lecture: "lecture" }), proprietaire: "Papa" }] };
    return {};
  });
  function Accueil() { useCatalogueDiffusion("profil", () => {}); return <BoutonDiffusion />; }
  render(<CentreDiffusion><Accueil /></CentreDiffusion>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); await vi.dynamicImportSettled(); });
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole("complementary").textContent).toContain("Papa");
});

it("hors de chez soi, propose la qualité maximale pour un téléviseur relayé, et le dit quand ce navigateur ne caste pas", async () => {
  remoteSession.mockResolvedValue({ required: true, authenticated: true, account: "rodrigue" });
  diffusion.mockImplementation(async (_profil: string, path: string) => {
    if (path === "lecteurs") return { id: "ft-moi", cle: "cle" };
    if (path.startsWith("lecteurs/")) return { ordres: [] };
    if (path === "cibles") return { cibles: [{ id: "rl-tv", nom: "TV de Paul", protocole: "googlecast", modele: "Chromecast", relais: true, etat: null, occupe: false }] };
    if (path.includes("/commande")) return { operation: "op" };
    return {};
  });
  render(<CentreDiffusion><Client /></CentreDiffusion>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.click(screen.getByRole("button", { name: "Caster ou piloter un appareil" }));
  await act(async () => { await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(350); });
  // jsdom n'est pas Chrome : le panneau dit comment caster d'ici, sans bouton qui ne mènerait nulle part.
  expect(screen.getByText(/ouvrez FlixTunes dans Chrome/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Choisir un téléviseur de ce réseau" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /TV de Paul/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Qualité maximale/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Diffuser/ })); });
  expect(diffusion).toHaveBeenCalledWith("profil", "cibles/rl-tv/commande?asynchrone=1", { type: "charger", contenu: etat.contenu, position: 123, qualite: "maximale" });
});
