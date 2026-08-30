// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaItem, PlaybackInfo, Profile } from "@flixtunes/contracts";

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  media: vi.fn(), playbackInfo: vi.fn(), subtitlePreference: vi.fn(), playbackNeighbors: vi.fn(), startPlayback: vi.fn(),
  playbackSession: vi.fn(), stopPlayback: vi.fn(), saveProgress: vi.fn(), saveSubtitlePreference: vi.fn(),
  playbackUrl: vi.fn((url: string) => `http://nas.local${url}`),
  subtitleUrl: vi.fn((mediaId: string, index: number, offset: number) => `/sub/${mediaId}/${index}/${offset}`),
  externalSubtitleUrl: vi.fn((mediaId: string, id: number) => `/ext/${mediaId}/${id}`),
  // `timelineThumbnailUrl` a disparu avec le passage aux planches de vignettes ; le mock en gardait le
  // nom. Rien ne le montrait, aucun cas n'empruntant ce chemin — le premier à le faire aurait échoué
  // sur une erreur sans rapport avec ce qu'il éprouve.
  timelineSheetUrl: vi.fn((mediaId: string, planche: number) => `/sheet/${mediaId}/${planche}.jpg`),
} }));
vi.mock("./api", () => ({ api: apiMock }));

import { browserCapabilities, dynamicRangeChoices, formatPlaybackTime, Player, resumePosition } from "./Player";

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null,
  subtitleMode: "off", preferredAudioLanguages: ["fr"], preferredSubtitleLanguages: ["fr"] };
const media: MediaItem = { id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie",
  title: "Voyage Azur", sortTitle: "voyage azur", year: 2026, overview: null, posterUrl: null, backdropUrl: null,
  addedAt: null, showTitle: null, seasonNumber: null, episodeNumber: null, runtimeSeconds: 3600,
  progressPercent: 0, completed: false };

const stream = (over: Partial<PlaybackInfo["streams"][number]>): PlaybackInfo["streams"][number] => ({
  index: 0, type: "audio", codec: "aac", title: null, language: null, channels: 2, width: null, height: null,
  hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: false, isForced: false,
  canExtractAsWebVtt: false, ...over,
});

const info: PlaybackInfo = {
  mediaId: "media-1", container: "mp4", durationSeconds: 3600, externalSubtitles: [],
  streams: [
    stream({ index: 0, type: "video", codec: "h264", width: 1920, height: 1080, isDefault: true }),
    stream({ index: 1, type: "audio", codec: "aac", language: "fra", isDefault: true }),
    stream({ index: 2, type: "audio", codec: "aac", language: "eng" }),
    stream({ index: 3, type: "subtitle", codec: "subrip", language: "fra", canExtractAsWebVtt: true }),
    stream({ index: 4, type: "subtitle", codec: "hdmv_pgs_subtitle", language: "eng", canExtractAsWebVtt: false }),
  ],
};

describe("capacités du lecteur Web", () => {
  it("annonce que le navigateur ne peut pas imposer une piste dans un fichier Direct Play", () => {
    expect(browserCapabilities(2, null, false).directAudioStreamSelection).toBe(false);
  });

  it("rend la relance compatible conservatrice", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const capabilities = browserCapabilities(null, null, true);
    expect(capabilities.videoCodecs).toEqual([]);
    expect(capabilities.hdr).toBe(false);
    expect(capabilities.hdrFormats).toEqual([]);
    expect(capabilities.hlsSegmentContainer).toBe("mpegts");
    expect(capabilities.maxWidth).toBe(1920);
    expect(capabilities.maxHeight).toBe(1080);
    expect(capabilities.modePreference).toBe("compatible");
  });

  it("déclare Dolby Digital quand le navigateur en répond avec certitude", () => {
    // Ces deux codecs n'étaient sondés nulle part. Un film en EAC3 — la piste par défaut de presque
    // tous les Blu-ray — partait donc en remux pour son seul son, là où il pouvait être servi tel quel.
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const capabilities = browserCapabilities(null, null, false);
    expect(capabilities.audioCodecs).toEqual(expect.arrayContaining(["eac3", "ac3"]));
  });

  it("n'annonce pas un son sur un « peut-être »", () => {
    // L'asymétrie est voulue et vaut d'être défendue : une erreur sur l'image lève une erreur du
    // lecteur, qu'on rattrape ; une erreur sur le son donne un film muet, que rien ne signale. Le
    // reste des codecs se contente d'une réponse non vide, ceux-ci exigent « probably ».
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("maybe");
    const capabilities = browserCapabilities(null, null, false);
    expect(capabilities.audioCodecs).toContain("aac");
    expect(capabilities.audioCodecs).not.toContain("eac3");
    expect(capabilities.audioCodecs).not.toContain("ac3");
  });

  it("ne déclare aucun son exotique en relance compatible", () => {
    // La relance compatible existe pour tout confier au serveur : y annoncer des codecs relancerait
    // la négociation vers le chemin dont on vient précisément de se replier.
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    expect(browserCapabilities(null, null, true).audioCodecs).not.toContain("eac3");
  });

  it("demande l'incrustation d'un sous-titre image avec son décalage", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const capabilities = browserCapabilities(null, null, false, "auto", 4, true, -2.5);
    expect(capabilities.externalSubtitleId).toBe(4);
    expect(capabilities.burnSubtitles).toBe(true);
    expect(capabilities.subtitleOffsetSeconds).toBe(-2.5);
  });

  it("n'impose pas le plafond navigateur de 10 Mb/s à un serveur du réseau local", () => {
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const withConnection = (connection: Record<string, unknown>) => {
      Object.defineProperty(navigator, "connection", { value: connection, configurable: true });
      return browserCapabilities(null, null, false);
    };
    // Wi-Fi ou Ethernet : `downlink` est plafonné et ne décrit pas le lien vers le NAS.
    expect(withConnection({ downlink: 10, type: "wifi", effectiveType: "4g" }).networkMbps).toBeNull();
    expect(withConnection({ downlink: 10, effectiveType: "4g" }).networkMbps).toBeNull();
    // Réseau mobile lent : la contrainte est réelle et doit borner l'échelle de qualité.
    expect(withConnection({ downlink: 1.4, type: "cellular", effectiveType: "3g" }).networkMbps).toBe(1.4);
    expect(withConnection({ downlink: 2, effectiveType: "2g" }).networkMbps).toBe(2);
  });

  it("formate les durées et calcule une reprise avec retour de contexte", () => {
    expect(formatPlaybackTime(65.9)).toBe("1:05");
    expect(formatPlaybackTime(3661)).toBe("1:01:01");
    expect(resumePosition(1000, 50, 10)).toBe(490);
    expect(resumePosition(1000, 95, 10)).toBe(0);
    expect(resumePosition(Number.NaN, 50, 10)).toBe(0);
  });

  it("propose Dolby Vision et HDR10+ quand les deux existent dans le même flux", () => {
    const hybrid = stream({ index: 0, type: "video", codec: "hevc", hdr: true, hdrFormat: "dolbyvision",
      availableHdrFormats: ["dolbyvision", "hdr10plus"], dolbyVisionProfile: 8 });
    expect(dynamicRangeChoices(hybrid, ["dolbyvision", "hdr10plus", "hdr10"]).map((choice) => choice.value))
      .toEqual(["auto", "dolbyvision", "hdr10plus", "hdr10", "sdr"]);
  });
});

describe("changement de piste en cours de lecture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    apiMock.media.mockResolvedValue(media);
    apiMock.playbackInfo.mockResolvedValue(info);
    apiMock.subtitlePreference.mockResolvedValue(null);
    apiMock.playbackNeighbors.mockResolvedValue({ previous: null, next: null });
    apiMock.startPlayback.mockResolvedValue({ id: "session-1", mediaId: "media-1", mode: "direct", status: "ready",
      url: "/api/media/media-1/stream", videoEncoder: "copy", audioEncoder: "copy", reason: "Lecture directe", error: null });
    apiMock.stopPlayback.mockResolvedValue(undefined);
    apiMock.saveSubtitlePreference.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  // Les libellés mêlent langue, technologie et nombre de canaux : les pistes sont ciblées par leur groupe de radios.
  const audioRadios = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="audio"]'));
  const subtitleRadios = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="subtitle"]'));

  const openTracks = async () => {
    render(<Player mediaId="media-1" profile={profile} onClose={vi.fn()} onPlayMedia={vi.fn()} />);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Pistes" }));
  };

  it("reprend à la position réelle même quand le flux transcodé ne déclare que quelques secondes", async () => {
    apiMock.startPlayback.mockResolvedValue({ id: "session-2", mediaId: "media-1", mode: "transcode", status: "ready",
      url: "/api/playback/session-2/manifest.m3u8", videoEncoder: "libx264", audioEncoder: "aac",
      reason: "Transcodage", error: null });
    apiMock.media.mockResolvedValue({ ...media, progressPercent: 40 });
    render(<Player mediaId="media-1" profile={{ ...profile, resumeMode: "continue", resumeRewindSeconds: 5 }}
      onClose={vi.fn()} onPlayMedia={vi.fn()} />);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(1));
    const video = document.querySelector("video")!;
    // Le manifeste HLS n'annonce que les huit premières secondes déjà encodées.
    Object.defineProperty(video, "duration", { value: 8, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    fireEvent(video, new Event("loadedmetadata"));
    // La durée réelle du média est de 3 600 s : 40 % moins 5 s de retour de contexte.
    await waitFor(() => expect(video.currentTime).toBeCloseTo(3600 * 0.4 - 5, 0));
  });

  it("enregistre la progression sur la durée réelle et non sur celle du flux", async () => {
    apiMock.media.mockResolvedValue({ ...media, progressPercent: 0 });
    render(<Player mediaId="media-1" profile={profile} onClose={vi.fn()} onPlayMedia={vi.fn()} />);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(1));
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "duration", { value: 12, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 300, writable: true, configurable: true });
    fireEvent(video, new Event("pause"));
    await waitFor(() => expect(apiMock.saveProgress).toHaveBeenCalledWith("media-1", "profile-1", 300, 3600));
  });

  it("applique immédiatement une nouvelle piste audio sans attendre un bouton de relance", async () => {
    await openTracks();
    fireEvent.click(audioRadios()[1]!);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(2));
    const [, capabilities] = apiMock.startPlayback.mock.calls[1]!;
    expect(capabilities.audioStreamIndex).toBe(2);
    expect(sessionStorage.getItem("flixtunes:profile-1:media-1:audio")).toBe("2");
  });

  it("ne réutilise pas sur un film le numéro de piste mémorisé pour un autre", async () => {
    // Cas réel : l'index 1 retenu sur un autre titre désigne ici la VO, tandis que la VF par défaut
    // est l'index 2. L'ancienne clé globale au profil faisait démarrer ce film en anglais.
    sessionStorage.setItem("flixtunes:profile-1:audio", "1");
    apiMock.playbackInfo.mockResolvedValue({ ...info, streams: info.streams.map((candidate) => candidate.type !== "audio" ? candidate
      : candidate.index === 1 ? { ...candidate, language: "eng", isDefault: false }
        : candidate.index === 2 ? { ...candidate, language: "fre", isDefault: true } : candidate) });
    await openTracks();
    const [, capabilities] = apiMock.startPlayback.mock.calls[0]!;
    expect(capabilities.audioStreamIndex).toBe(2);
  });

  it("ne renégocie pas la session pour un sous-titre texte", async () => {
    await openTracks();
    // 0 = Désactivés, 1 = piste texte SRT, 2 = piste image PGS.
    fireEvent.click(subtitleRadios()[1]!);
    await waitFor(() => expect(document.querySelector("track")).toBeTruthy());
    expect(apiMock.startPlayback).toHaveBeenCalledTimes(1);
    expect(document.querySelector("track")?.getAttribute("src")).toContain("/sub/media-1/3/");
  });

  it("affiche les sous-titres sur fond transparent et applique taille et couleur sans relancer la vidéo", async () => {
    await openTracks();
    const video = document.querySelector("video")!;
    expect(video).toHaveClass("subtitles-normal", "subtitles-color-white");
    expect(video).not.toHaveClass("subtitles-background");
    fireEvent.change(screen.getByLabelText("Taille"), { target: { value: "large" } });
    fireEvent.change(screen.getByLabelText("Couleur"), { target: { value: "yellow" } });
    expect(video).toHaveClass("subtitles-large", "subtitles-color-yellow");
    expect(apiMock.startPlayback).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(apiMock.saveSubtitlePreference).toHaveBeenLastCalledWith(
      "media-1", "profile-1", expect.objectContaining({ size: "large", background: false, color: "yellow" }),
    ));
  });

  it("éteint les réglages d'apparence devant un sous-titre image", async () => {
    /*
     * Un PGS de Blu-ray n'est pas du texte : c'est une suite d'images déjà composées avec leur police
     * et leur couleur. Aucun des six réglages ne peut s'y appliquer — ni quand VLC les dessine, ni
     * quand le serveur les incruste. Les laisser actifs faisait promettre à l'interface ce qu'elle ne
     * pouvait pas tenir : on tourne le bouton « Taille » et rien ne bouge.
     */
    await openTracks();
    expect(screen.getByLabelText("Taille")).not.toBeDisabled();
    // 2 = la piste image PGS.
    fireEvent.click(subtitleRadios()[2]!);
    await waitFor(() => expect(screen.getByLabelText("Taille")).toBeDisabled());
    for (const nom of ["Couleur", "Position", "Police", "Encodage"]) {
      expect(screen.getByLabelText(nom)).toBeDisabled();
    }
    expect(screen.getByText(/Ce sous-titre est une image/)).toBeInTheDocument();
  });

  it("renégocie la session pour un sous-titre à incruster", async () => {
    await openTracks();
    fireEvent.click(subtitleRadios()[2]!);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(2));
    const [, capabilities] = apiMock.startPlayback.mock.calls[1]!;
    expect(capabilities.subtitleStreamIndex).toBe(4);
    expect(capabilities.burnSubtitles).toBe(true);
  });

  it("revient au flux sans incrustation quand les sous-titres sont désactivés", async () => {
    await openTracks();
    fireEvent.click(subtitleRadios()[2]!);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(2));
    fireEvent.click(subtitleRadios()[0]!);
    await waitFor(() => expect(apiMock.startPlayback).toHaveBeenCalledTimes(3));
    const [, capabilities] = apiMock.startPlayback.mock.calls[2]!;
    expect(capabilities.burnSubtitles).toBe(false);
    expect(capabilities.subtitleStreamIndex).toBeNull();
  });
});
