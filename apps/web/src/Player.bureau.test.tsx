// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, PlaybackInfo, Profile } from "@flixtunes/contracts";
import type { EtatLecteurBureau, PontLecteur } from "./bureau";

/**
 * Le lecteur du client Web, mais c'est VLC qui décode.
 *
 * C'est le même composant, le même fichier, la même interface : ce qui change est la **surface** sur
 * laquelle il joue. Ces épreuves servent à s'en assurer, parce que c'est exactement le genre de
 * promesse qui se défait en silence — un client de bureau qui, six mois plus tard, aurait sa propre
 * barre de progression et ses propres défauts.
 */
const { apiMock } = vi.hoisted(() => ({ apiMock: {
  media: vi.fn(), playbackInfo: vi.fn(), subtitlePreference: vi.fn(), playbackNeighbors: vi.fn(), startPlayback: vi.fn(),
  playbackSession: vi.fn(), stopPlayback: vi.fn(), saveProgress: vi.fn(), saveSubtitlePreference: vi.fn(),
  playbackUrl: vi.fn((url: string) => `http://nas.local${url}`),
  subtitleUrl: vi.fn((mediaId: string, index: number) => `http://nas.local/sub/${mediaId}/${index}.vtt`),
  externalSubtitleUrl: vi.fn((mediaId: string, id: number) => `http://nas.local/ext/${mediaId}/${id}.vtt`),
  timelineSheetUrl: vi.fn((mediaId: string, planche: number) => `/sheet/${mediaId}/${planche}.jpg`),
} }));
vi.mock("./api", () => ({ api: apiMock }));

import { oublierLaSurfacePartagee } from "./surface-lecture";
import { Player } from "./Player";

const REPOS: EtatLecteurBureau = {
  ouvert: false, position: 0, duree: 0, enLecture: false, vitesse: 1,
  imagesAffichees: 0, imagesPerdues: 0, termine: false, erreur: null,
};

/** La coque, remplacée par un double, telle que le préchargement l'expose à la page. */
function poserLaCoque() {
  const commandes: string[] = [];
  let pousser: (etat: EtatLecteurBureau) => void = () => undefined;
  const lecteur: PontLecteur = {
    ouvrir: (uri) => { commandes.push(`ouvrir ${uri}`); return Promise.resolve({ ok: true }); },
    lire: () => { commandes.push("lire"); return Promise.resolve(); },
    pause: () => { commandes.push("pause"); return Promise.resolve(); },
    allerA: (secondes) => { commandes.push(`allerA ${secondes}`); return Promise.resolve(); },
    vitesse: (valeur) => { commandes.push(`vitesse ${valeur}`); return Promise.resolve(); },
    volume: () => Promise.resolve(),
    fermer: () => { commandes.push("fermer"); return Promise.resolve(); },
    etat: () => Promise.resolve(REPOS),
    surEtat: (rappel) => { pousser = rappel; return () => { pousser = () => undefined; }; },
  };
  let annoncerPleinEcran: (actif: boolean) => void = () => undefined;
  let pleinEcran = false;
  Object.defineProperty(globalThis, "flixtunesBureau", {
    value: {
      version: "2", serveur: () => Promise.resolve("http://nas.local"), definirServeur: () => Promise.resolve({ ok: true }),
      oublierServeur: () => Promise.resolve({ ok: true }), lecteur,
      pleinEcran: (actif?: boolean) => {
        pleinEcran = actif ?? !pleinEcran;
        commandes.push(`pleinEcran ${pleinEcran}`);
        act(() => annoncerPleinEcran(pleinEcran));
        return Promise.resolve(pleinEcran);
      },
      surPleinEcran: (rappel: (actif: boolean) => void) => { annoncerPleinEcran = rappel; return () => { annoncerPleinEcran = () => undefined; }; },
    },
    configurable: true, writable: true,
  });
  return { commandes, pousser: (etat: Partial<EtatLecteurBureau>) => act(() => { pousser({ ...REPOS, ouvert: true, ...etat }); }) };
}

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR",
  protected: false, isChild: false, age: null, subtitleMode: "off", preferredAudioLanguages: ["fr"], preferredSubtitleLanguages: ["fr"] };
const media: MediaItem = { id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie",
  title: "Voyage Azur", sortTitle: "voyage azur", year: 2026, overview: null, posterUrl: null, backdropUrl: null,
  addedAt: null, showTitle: null, seasonNumber: null, episodeNumber: null, runtimeSeconds: 3600,
  progressPercent: 0, completed: false };

const stream = (over: Partial<PlaybackInfo["streams"][number]>): PlaybackInfo["streams"][number] => ({
  index: 0, type: "audio", codec: "aac", title: null, language: null, channels: 2, width: null, height: null,
  hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: false, isForced: false,
  canExtractAsWebVtt: false, ...over,
});

// Un Matroska en HEVC : le cas exact que le NAS convertissait pour un navigateur et qu'il sert
// désormais tel quel.
const info: PlaybackInfo = {
  mediaId: "media-1", container: "matroska", durationSeconds: 3600, externalSubtitles: [],
  streams: [
    stream({ index: 0, type: "video", codec: "hevc", width: 1920, height: 1080, isDefault: true }),
    stream({ index: 1, type: "audio", codec: "truehd", language: "fra", channels: 8, isDefault: true }),
    stream({ index: 3, type: "subtitle", codec: "subrip", language: "fra", canExtractAsWebVtt: true }),
  ],
};

const VTT = `WEBVTT

00:00:10.000 --> 00:00:14.000
On y est presque.

00:00:20.000 --> 00:00:25.000
Regarde là-bas.
`;

describe("le lecteur quand VLC décode", () => {
  let coque: ReturnType<typeof poserLaCoque>;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    coque = poserLaCoque();
    // La surface est partagée pour toute la séance — c'est ce qui la rend insensible au montage
    // double du mode strict. Chaque épreuve repart donc d'une page neuve.
    oublierLaSurfacePartagee();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(VTT) } as Response)));
    apiMock.media.mockResolvedValue(media);
    apiMock.playbackInfo.mockResolvedValue(info);
    apiMock.subtitlePreference.mockResolvedValue(null);
    apiMock.playbackNeighbors.mockResolvedValue({ previous: null, next: null });
    apiMock.startPlayback.mockResolvedValue({ id: "session-1", mediaId: "media-1", mode: "direct", status: "ready",
      url: "/api/media/media-1/stream", videoEncoder: "copy", audioEncoder: "copy", reason: "Lecture directe", error: null });
    apiMock.stopPlayback.mockResolvedValue(undefined);
    apiMock.saveSubtitlePreference.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis as object, "flixtunesBureau");
  });

  const monter = (surProfil: Partial<Profile> = {}) => render(
    <Player mediaId="media-1" profile={{ ...profile, ...surProfil }} onClose={() => undefined} onPlayMedia={() => undefined} />,
  );

  it("confie le flux à VLC au lieu de le poser dans une balise vidéo", async () => {
    const { container } = monter();
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    // Aucune balise vidéo : l'image est peinte par un autre processus, dans la fenêtre du dessous.
    expect(container.querySelector("video")).toBeNull();
  });

  it("annonce au serveur ce que VLC sait lire, et le serveur sert alors le fichier tel quel", async () => {
    monter();
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalled());
    const annonce = apiMock.startPlayback.mock.calls[0]![1] as { containers: string[]; videoCodecs: string[]; audioCodecs: string[]; deviceClass: string };
    expect(annonce.containers).toContain("matroska");
    expect(annonce.videoCodecs).toContain("hevc");
    expect(annonce.audioCodecs).toContain("truehd");
    expect(annonce.deviceClass).toBe("desktop");
  });

  it("efface le fond de la page pour laisser voir la vidéo, et le rend en partant", async () => {
    /*
     * La fenêtre qui porte l'interface est transparente : un lecteur au fond noir masquerait
     * exactement ce qu'il sert à regarder. Le catalogue, lui, doit rester opaque.
     *
     * `html` autant que `body`, et ce n'est pas du zèle : la feuille de style donne un fond aux
     * deux. N'effacer que celui de `body` laissait `:root` à `#080b12`, et la vidéo jouait derrière
     * une vitre peinte. Mesuré sur la page en fonctionnement avant d'être corrigé.
     */
    const vue = monter();
    await waitFor(() => expect(document.body).toHaveClass("bureau-video"));
    expect(document.documentElement).toHaveClass("bureau-video");
    vue.unmount();
    expect(document.body).not.toHaveClass("bureau-video");
    expect(document.documentElement).not.toHaveClass("bureau-video");
  });

  it("arrête VLC en quittant le lecteur", async () => {
    const vue = monter();
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    vue.unmount();
    expect(coque.commandes).toContain("fermer");
  });

  it("affiche la réplique du moment, et la retire quand elle est passée", async () => {
    monter({ subtitleMode: "always" });
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    // Le WebVTT est chargé depuis la même adresse qu'une balise `<track>` aurait utilisée.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("http://nas.local/sub/media-1/3.vtt"));

    await coque.pousser({ duree: 3600, position: 5, enLecture: true });
    expect(screen.queryByText("On y est presque.")).toBeNull();
    await coque.pousser({ duree: 3600, position: 12, enLecture: true });
    await waitFor(() => expect(screen.getByText("On y est presque.")).toBeInTheDocument());
    await coque.pousser({ duree: 3600, position: 16, enLecture: true });
    await waitFor(() => expect(screen.queryByText("On y est presque.")).toBeNull());
  });

  it("suit la position de VLC dans l'horloge du lecteur", async () => {
    monter();
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    // Le premier état est celui de l'ouverture : c'est lui qui apprend la durée, et le lecteur y place
    // alors la reprise — ici le début, le film n'ayant jamais été vu.
    await coque.pousser({ duree: 3600, position: 0, enLecture: true });
    await coque.pousser({ duree: 3600, position: 125, enLecture: true });
    // La barre lit la même position, et l'annonce à qui n'a que la voix.
    await waitFor(() => expect(screen.getByLabelText("Position de lecture"))
      .toHaveAttribute("aria-valuetext", "2:05 sur 1:00:00"));
  });

  it("reprend le film où on l'avait laissé", async () => {
    // La reprise se joue au moment où la durée devient connue — l'équivalent de « métadonnées lues »
    // pour une balise vidéo. C'est le geste le plus fragile de la bascule : il passe par le seul
    // chemin où le lecteur *écrit* la position au lieu de la lire.
    apiMock.media.mockResolvedValue({ ...media, progressPercent: 40 });
    monter({ resumeMode: "continue", resumeRewindSeconds: 5 });
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    await coque.pousser({ duree: 3600, position: 0, enLecture: true });
    // 40 % de 3 600 s, moins les cinq secondes de contexte demandées par le profil.
    expect(coque.commandes).toContain("allerA 1435");
  });

  it("demande le plein écran à la coque, et non au document", async () => {
    /*
     * Le geste le plus facile à rater de toute la bascule. Un plein écran demandé au document aurait
     * agrandi la fenêtre transparente qui porte les commandes — et laissé la vidéo à sa place, dans
     * une fenêtre restée petite derrière. On aurait vu des commandes plein écran devant un fond noir.
     */
    monter();
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    const bouton = screen.getByLabelText("Plein écran");
    await act(async () => { bouton.click(); });
    expect(coque.commandes).toContain("pleinEcran true");
    expect(document.fullscreenElement ?? null).toBeNull();
    // Et le bouton sait qu'on y est : la coque le lui a dit, puisque le document ne le dira jamais.
    await waitFor(() => expect(screen.getByLabelText("Quitter le plein écran")).toBeInTheDocument());
  });

  it("n'offre pas l'incrustation, qui est un service rendu à une balise vidéo", async () => {
    monter();
    await waitFor(() => expect(coque.commandes).toContain("ouvrir http://nas.local/api/media/media-1/stream"));
    expect(screen.queryByLabelText("Image dans l’image")).toBeNull();
  });
});
