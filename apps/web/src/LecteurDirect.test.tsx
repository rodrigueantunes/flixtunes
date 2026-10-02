// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChaineDirect } from "@flixtunes/contracts";

const { apiMock, instances, HlsSimule } = vi.hoisted(() => {
  const instances: HlsSimule[] = [];
  class HlsSimule {
    static Events = { MANIFEST_PARSED: "manifeste", LEVEL_LOADED: "niveau", FRAG_BUFFERED: "segment", ERROR: "erreur" };
    static ErrorTypes = { NETWORK_ERROR: "reseau", MEDIA_ERROR: "media" };
    static ErrorDetails = { BUFFER_STALLED_ERROR: "tampon" };
    static isSupported() { return true; }
    static DefaultConfig = { loader: class {} };
    config: Record<string, any>;
    userConfig: Record<string, any>;
    levels = [{ details: { targetduration: 8 } }];
    currentLevel = 0;
    autoLevelCapping = -1;
    media: HTMLVideoElement | null = null;
    handlers = new Map<string, ((event: string, data: any) => void)[]>();
    constructor(config: Record<string, any>) { this.config = { ...config }; this.userConfig = config; instances.push(this); }
    on(event: string, callback: (event: string, data: any) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), callback]); }
    once(event: string, callback: (event: string, data: any) => void) {
      this.on(event, (e, d) => { if (!this.uniques.has(callback)) { this.uniques.add(callback); callback(e, d); } });
    }
    uniques = new Set<unknown>();
    emit(event: string, data = {}) { for (const callback of this.handlers.get(event) ?? []) callback(event, data); }
    attachMedia(media: HTMLVideoElement) { this.media = media; }
    loadSource = vi.fn();
    startLoad = vi.fn();
    stopLoad = vi.fn();
    destroy = vi.fn();
  }
  return { instances, HlsSimule, apiMock: { chaineLive: vi.fn(), resultatChaineLive: vi.fn(), sondesChaineLive: vi.fn(), analyserSourceLive: vi.fn(), convertirSourceLive: vi.fn(), arreterConversionLive: vi.fn() } };
});
vi.mock("hls.js", () => ({ default: HlsSimule }));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./course-adresses", () => ({ courirLesAdresses: async (sources: unknown[]) => sources }));
import { LecteurDirect } from "./LecteurDirect";

const chaine = { id: "chaine", nom: "Chaîne de test", numero: 1 } as ChaineDirect;
const source = "https://tv.test/master.m3u8";
let pause = false;
const vide = { length: 0, start: () => 0, end: () => 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  instances.length = 0;
  pause = false;
  vi.stubGlobal("MediaSource", class {});
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => pause);
  vi.spyOn(HTMLMediaElement.prototype, "buffered", "get").mockReturnValue(vide);
  vi.spyOn(HTMLMediaElement.prototype, "seekable", "get").mockReturnValue(vide);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: source, echecs: 0 }] });
  apiMock.resultatChaineLive.mockResolvedValue({});
  apiMock.sondesChaineLive.mockResolvedValue({ muettes: [] });
  apiMock.arreterConversionLive.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function ouvrir() {
  await act(async () => { render(<LecteurDirect chaine={chaine} precedente={null} onChaine={() => {}} onClose={() => {}} />); });
  expect(instances).toHaveLength(1);
  return instances[0]!;
}
async function avancer(secondes: number, telecharger = true) {
  for (let i = 0; i < secondes; i++) {
    await act(async () => {
      instances[0]!.media!.currentTime += 1;
      if (telecharger) instances[0]!.emit("segment");
      await vi.advanceTimersByTimeAsync(1_000);
    });
  }
}

it("ouvre le direct en HTTP local sans crypto.randomUUID", async () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  const hls = await ouvrir();
  expect(hls.loadSource).toHaveBeenCalledWith(source);
});

describe("les reprises du lecteur de direct", () => {
  const details = (decalage = 0) => ({ live: true, totalduration: 200, targetduration: 6,
    fragments: Array.from({ length: 34 }, (_, i) => ({ sn: i + decalage, start: i * 6,
      duration: 6, programDateTime: 100_000 + i * 6_000 })) });
  async function rendrePret(candidat: InstanceType<typeof HlsSimule>, decalage = 0) {
    vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
    vi.spyOn(HTMLMediaElement.prototype, "buffered", "get")
      .mockReturnValue({ length: 1, start: () => 0, end: () => 200 });
    await act(async () => { candidat.emit("manifeste"); });
    await act(async () => { candidat.emit("niveau", { details: details(decalage) }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  }
  it("prépare une autre source et la raccorde par l'heure de programme", async () => {
    apiMock.chaineLive.mockResolvedValue({ sources: [{ url: source, echecs: 0, identifiant: "a" },
      { url: "https://secours.test/live.m3u8", echecs: 0, identifiant: "b" }] });
    const principale = await ouvrir();
    await avancer(17);
    await act(async () => {
      principale.emit("niveau", { details: details() });
      principale.emit("erreur", { fatal: true, type: "reseau", details: "coupure" });
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(instances).toHaveLength(3);
    expect(principale.destroy).not.toHaveBeenCalled();
    expect(instances[2]!.loadSource).toHaveBeenCalledWith("https://secours.test/live.m3u8");
    await rendrePret(instances[2]!, 10_000);
    expect(principale.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".lecteur-direct-sources")?.textContent).toContain("2/2");
    expect(instances[2]!.destroy).not.toHaveBeenCalled();
    // Le premier fournisseur est encore en retrait, mais reste le seul secours du second.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await act(async () => {
      instances[2]!.emit("erreur", { fatal: true, type: "reseau", details: "seconde panne" });
      await vi.advanceTimersByTimeAsync(4_100);
    });
    expect(instances).toHaveLength(5);
    expect(instances[4]!.loadSource).toHaveBeenCalledWith(source);
    expect(instances[2]!.destroy).not.toHaveBeenCalled();
    await rendrePret(instances[4]!);
    expect(instances[2]!.destroy).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".lecteur-direct-sources")?.textContent).toContain("1/2");
  });
  it("renouvelle un lien WAN sans détruire la lecture avant que sa relève soit prête", async () => {
    apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "/api/live/relais?t=ancien", identifiant: "exact", echecs: 0 }] });
    const principale = await ouvrir();
    await avancer(17);
    principale.emit("niveau", { details: details() });
    apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "/api/live/relais?t=nouveau", identifiant: "exact", echecs: 0 }] });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(instances).toHaveLength(2);
    expect(instances[1]!.loadSource).toHaveBeenCalledWith("/api/live/relais?t=nouveau");
    expect(principale.destroy).not.toHaveBeenCalled();
    await rendrePret(instances[1]!);
    expect(principale.destroy).toHaveBeenCalledTimes(1);
    expect(instances[1]!.destroy).not.toHaveBeenCalled();
  });
  it("renouvelle un relais invalidé par un redémarrage (404) et borne les tentatives", async () => {
    apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "/api/live/relais?t=ancien", identifiant: "exact", echecs: 0 }] });
    const principale = await ouvrir();
    await avancer(17);
    principale.emit("niveau", { details: details() });
    apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "/api/live/relais?t=nouveau", identifiant: "exact", echecs: 0 }] });
    await act(async () => {
      for (let i = 0; i < 5; i++) principale.emit("erreur", { fatal: false, response: { code: 404 }, type: "reseau" });
    });
    expect(apiMock.chaineLive).toHaveBeenCalledTimes(2);
    expect(principale.destroy).not.toHaveBeenCalled();
    expect(instances[1]!.loadSource).toHaveBeenCalledWith("/api/live/relais?t=nouveau");
    await rendrePret(instances[1]!);
    expect(principale.destroy).toHaveBeenCalledTimes(1);
  });
  it("réouvre une adresse unique après un échec, même si le rang reste zéro", async () => {
    await ouvrir();
    await act(async () => { await vi.advanceTimersByTimeAsync(23_000); });
    expect(instances.length).toBeGreaterThanOrEqual(2);
    expect(instances.at(-1)!.loadSource).toHaveBeenCalledWith(source);
  });

  it("répare une image figée en rechargeant le maître et garde l'ancien lecteur pendant la préparation", async () => {
    const principale = await ouvrir();
    await avancer(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(instances).toHaveLength(2);
    expect(instances[1]!.loadSource).toHaveBeenCalledWith(source);
    expect(principale.destroy).not.toHaveBeenCalled();
    expect(apiMock.resultatChaineLive).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(instances).toHaveLength(3);
    expect(principale.destroy).toHaveBeenCalled();
  });

  it("n'empile pas les reprises et ne confond pas téléchargement et image stable", async () => {
    const principale = await ouvrir();
    await avancer(17);
    expect(apiMock.resultatChaineLive).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (let i = 0; i < 8; i++) principale.emit("erreur", { fatal: true, type: "reseau", details: "session expiree" });
    });
    expect(instances).toHaveLength(2);
    expect(principale.destroy).not.toHaveBeenCalled();
  });

  it("respecte une pause et annule la relance en fermant le lecteur", async () => {
    await ouvrir();
    await avancer(3);
    pause = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(instances).toHaveLength(1);
    cleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instances).toHaveLength(1);
  });

  it("ne jette pas un tampon qui joue lorsque la préparation du secours échoue", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "buffered", "get")
      .mockReturnValue({ length: 1, start: () => 0, end: () => 60 });
    const principale = await ouvrir();
    await avancer(17);
    await act(async () => { principale.emit("erreur", { fatal: true, type: "reseau", details: "coupure" }); });
    await avancer(11, false);
    expect(instances).toHaveLength(2);
    expect(principale.destroy).not.toHaveBeenCalled();
  });
});


it("prépare une relève native sans retirer la source avant que la vidéo soit prête", async () => {
  vi.spyOn(HlsSimule, "isSupported").mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  await act(async () => { render(<LecteurDirect chaine={chaine} precedente={null} onChaine={() => {}} onClose={() => {}} />); });
  const [principal, secours] = Array.from(document.querySelectorAll("video"));
  await act(async () => { fireEvent.error(principal!); });
  expect(principal!.getAttribute("src")).toBe(source);
  expect(secours!.getAttribute("src")).toBe(source);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  vi.spyOn(HTMLMediaElement.prototype, "buffered", "get").mockImplementation(function (this: HTMLMediaElement) {
    return this === secours ? { length: 1, start: () => 0, end: () => 20 } : vide;
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(principal!.getAttribute("src")).toBeNull();
  expect(secours!.className).not.toContain("releve");
});


it("annule une préparation native quand le lecteur se ferme", async () => {
  vi.spyOn(HlsSimule, "isSupported").mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  const vue = render(<LecteurDirect chaine={chaine} precedente={null} onChaine={() => {}} onClose={() => {}} />);
  await act(async () => {});
  const [principal, secours] = Array.from(document.querySelectorAll("video"));
  await act(async () => { fireEvent.error(principal!); });
  vue.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(secours!.getAttribute("src")).toBeNull();
});

it("affiche le diagnostic sans divulguer l'adresse ni le jeton de la source", async () => {
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "/api/live/relais?t=jeton-confidentiel", identifiant: "exact", echecs: 0 }] });
  await ouvrir();
  const details = document.querySelector("details")!;
  await act(async () => { details.open = true; fireEvent(details, new Event("toggle")); });
  expect(details.textContent).toContain("Réserve disponible");
  expect(details.textContent).toContain("1/1");
  expect(details.textContent).not.toContain("jeton-confidentiel");
});

it("attend une réserve avant la première lecture puis démarre sans attendre une chaîne entière", async () => {
  const hls = await ouvrir();
  let reserve = 2;
  vi.spyOn(HTMLMediaElement.prototype, "buffered", "get").mockImplementation(() => ({ length: 1, start: () => 0, end: () => reserve }));
  await act(async () => { hls.emit("manifeste"); await vi.advanceTimersByTimeAsync(300); });
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  reserve = 9;
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
});

it("choisit directement le relais déjà validé pour le navigateur", async () => {
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: source, relais: "/api/live/relais?u=opaque", echecs: 0, cheminPrefere: "relais" }] });
  const hls = await ouvrir();
  expect(hls.loadSource).toHaveBeenCalledWith("/api/live/relais?u=opaque");
  await avancer(17);
  expect(apiMock.resultatChaineLive).toHaveBeenCalledWith(chaine.id, source, true, undefined, "relais");
});

it("ne donne pas un transport TS au lecteur HLS et libère sa conversion à la fermeture", async () => {
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "https://tv.test/live.ts", echecs: 0 }] });
  apiMock.convertirSourceLive.mockResolvedValue({ id: "conversion", url: "/api/live/compat/conversion/live.m3u8" });
  const hls = await ouvrir();
  expect(hls.loadSource).toHaveBeenCalledWith("/api/live/compat/conversion/live.m3u8");
  expect(apiMock.convertirSourceLive).toHaveBeenCalledTimes(1);
  cleanup();
  expect(apiMock.arreterConversionLive).toHaveBeenCalledWith("conversion");
});

it("préfère une playlist lisible au transport qui nécessite une conversion", async () => {
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "https://tv.test/live.ts", echecs: 0 }, { url: source, echecs: 0 }] });
  const hls = await ouvrir();
  expect(hls.loadSource).toHaveBeenCalledWith(source);
  expect(apiMock.convertirSourceLive).not.toHaveBeenCalled();
});

it("recrée une conversion disparue sans recommencer en boucle", async () => {
  apiMock.chaineLive.mockResolvedValue({ sources: [{ url: "https://tv.test/live.ts", echecs: 0 }] });
  apiMock.convertirSourceLive.mockResolvedValue({ id: "conversion", url: "/api/live/compat/conversion/live.m3u8" });
  const hls = await ouvrir();
  await act(async () => { hls.emit("erreur", { fatal: true, type: "reseau", details: "manifestLoadError", response: { code: 404 } }); });
  expect(apiMock.convertirSourceLive).toHaveBeenCalledTimes(2);
  await act(async () => { instances.at(-1)!.emit("erreur", { fatal: true, type: "reseau", details: "manifestLoadError", response: { code: 404 } }); });
  expect(apiMock.convertirSourceLive).toHaveBeenCalledTimes(2);
});

it("détecte une image figée même lorsque l'horloge et le son peuvent avancer", async () => {
  const hls = await ouvrir();
  Object.defineProperty(hls.media, "getVideoPlaybackQuality", { configurable: true,
    value: () => ({ totalVideoFrames: 20, droppedVideoFrames: 0 }) });
  await avancer(10);
  expect(instances.length).toBeGreaterThan(1);
  expect(apiMock.resultatChaineLive).not.toHaveBeenCalled();
});

it("efface le bandeau et le diagnostic après le dernier geste, même si une commande garde le focus", async () => {
  await ouvrir();
  const lecteur = document.querySelector(".lecteur-direct")!;
  const barre = document.querySelector(".lecteur-direct-barre")!;
  const details = document.querySelector("details")!;
  await act(async () => {
    (barre.querySelector("button") as HTMLButtonElement).focus();
    details.open = true; fireEvent(details, new Event("toggle"));
    await vi.advanceTimersByTimeAsync(3_000);
    fireEvent.pointerMove(lecteur);
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(lecteur.className).toContain("commandes");
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(lecteur.className).not.toContain("commandes");
  expect(barre.getAttribute("aria-hidden")).toBe("true");
  expect(details.hidden).toBe(true);
  expect(details.open).toBe(false);
  await act(async () => { fireEvent.keyDown(window, { key: "Tab" }); });
  expect(lecteur.className).toContain("commandes");
  expect(details.hidden).toBe(false);
});
