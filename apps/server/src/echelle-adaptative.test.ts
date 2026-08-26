import { describe, expect, it } from "vitest";
import type { ColorEngineSupport } from "./playback.js";
import type { MediaStream, PlaybackCapabilities } from "@flixtunes/contracts";
import { echelleAdaptativeRetenue, echelleAdaptativeUtile, ffmpegVersion, planColorPipeline,
  regulationDebitArgs, selectAdaptiveProfile } from "./playback.js";

/**
 * Deux décisions qui ne coûtent rien à vérifier ici et cher à se tromper sur le NAS : construire une
 * échelle adaptative, et brider la vitesse de production d'une conversion.
 */

const capacites: PlaybackCapabilities = {
  containers: ["mp4"], videoCodecs: ["h264"], audioCodecs: ["aac"],
  hls: true, maxWidth: 3840, maxHeight: 2160, hdr: false, hdrFormats: [], dolbyAtmos: false,
  immersiveAudioFormats: [], maxAudioChannels: 2, losslessAudio: false, maxVideoBitrate: null,
  dolbyVisionProfiles: [], audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false,
  adaptiveStreaming: true, dash: false, streamingProtocol: "hls",
};

const videoSdr: MediaStream = { index: 0, type: "video", codec: "hevc", title: null, language: null, channels: null,
  width: 3840, height: 2160, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false,
  isDefault: true, isForced: false, canExtractAsWebVtt: false };
const videoHdr: MediaStream = { ...videoSdr, hdr: true, hdrFormat: "hdr10" };

const moteur: ColorEngineSupport = {
  filters: new Set(["scale", "zscale", "tonemap"]), hwaccels: new Set<string>(), encoders: new Set(["libx264"]),
};
const planSdr = planColorPipeline(videoSdr, capacites, moteur, "transcode");
const planToneMapping = planColorPipeline(videoHdr, capacites, moteur, "transcode");

const cible = (capabilities: PlaybackCapabilities) => selectAdaptiveProfile(capabilities, 3840, 2160);

describe("échelle adaptative", () => {
  it("s'abstient sur un lien qui ne sera jamais le goulot", () => {
    // Trois cents mégabits mesurés pour un flux de vingt : le processeur du NAS est la seule
    // ressource rare, et quatre encodages au lieu d'un la gaspillent sans rien apporter.
    const lan: PlaybackCapabilities = { ...capacites, networkMbps: 300 };
    expect(echelleAdaptativeUtile(lan, cible(lan))).toBe(false);
    expect(echelleAdaptativeRetenue(lan, "transcode", planSdr, 3840, 2160)).toBe(false);
  });

  it("la construit quand la marge est mince", () => {
    // Le cas relevé sur une lecture réelle : source à 26,5 Mb/s sur un chemin mesuré à 29,4.
    const etroit: PlaybackCapabilities = { ...capacites, networkMbps: 29.4 };
    expect(echelleAdaptativeUtile(etroit, cible(etroit))).toBe(true);
    expect(echelleAdaptativeRetenue(etroit, "transcode", planSdr, 3840, 2160)).toBe(true);
  });

  it("s'abstient quand l'appareil n'annonce rien", () => {
    expect(echelleAdaptativeUtile(capacites, cible(capacites))).toBe(false);
  });

  it("retient un plafond de débit imposé comme une contrainte", () => {
    const plafonne: PlaybackCapabilities = { ...capacites, maxVideoBitrate: 15_000_000 };
    expect(echelleAdaptativeUtile(plafonne, cible(plafonne))).toBe(true);
  });

  it("est écartée par une conversion colorimétrique et par le remux", () => {
    const etroit: PlaybackCapabilities = { ...capacites, networkMbps: 29.4 };
    expect(planToneMapping.filters.length).toBeGreaterThan(0);
    expect(echelleAdaptativeRetenue(etroit, "transcode", planToneMapping, 3840, 2160)).toBe(false);
    expect(echelleAdaptativeRetenue(etroit, "remux", planSdr, 3840, 2160)).toBe(false);
  });
});

describe("régulation du débit de conversion", () => {
  it("lit le numéro de version du moteur, et seulement lorsqu'il en porte un", () => {
    expect(ffmpegVersion("ffmpeg version 8.1 Copyright (c) 2000-2026")).toEqual({ major: 8, minor: 1 });
    expect(ffmpegVersion("ffmpeg version n7.1.1-Jellyfin")).toEqual({ major: 7, minor: 1 });
    expect(ffmpegVersion("ffmpeg version 2026-01-12-git-1a2b3c")).toBeNull();
    expect(ffmpegVersion(null)).toBeNull();
  });

  it("bride la production à un multiple du temps réel, après une rafale initiale", () => {
    expect(regulationDebitArgs("ffmpeg version 8.1", 2, 60))
      .toEqual(["-readrate", "2.00", "-readrate_initial_burst", "60"]);
  });

  it("ne bride rien sans la rafale initiale, qui retarderait la première image", () => {
    // `-readrate_initial_burst` n'existe qu'à partir de 6.1 : en dessous, mieux vaut le comportement
    // d'avant qu'une première image plus lente.
    expect(regulationDebitArgs("ffmpeg version 6.0.1", 2, 60)).toEqual([]);
    expect(regulationDebitArgs("ffmpeg version 6.1", 2, 60)).not.toEqual([]);
    expect(regulationDebitArgs("ffmpeg version 2026-01-12-git-1a2b3c", 2, 60)).toEqual([]);
  });

  it("se désactive entièrement à débit nul", () => {
    expect(regulationDebitArgs("ffmpeg version 8.1", 0, 60)).toEqual([]);
  });
});
