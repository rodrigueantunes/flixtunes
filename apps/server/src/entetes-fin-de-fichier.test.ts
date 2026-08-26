import { describe, expect, it } from "vitest";
import type { PlaybackCapabilities, PlaybackInfo } from "@flixtunes/contracts";
import { decidePlayback } from "./playback.js";
import { essaiDirectPertinent } from "./essai-direct.js";

/**
 * Un Matroska dont les pistes sont définies après les données.
 *
 * Le fichier est légal, FFmpeg le lit, le navigateur le joue. Media3 non : il analyse le flux d'un
 * bout à l'autre, atteint les données sans avoir vu la moindre définition de piste, et rend une image
 * noire, sans son et sans avance rapide. **Sans lever d'erreur** — donc sans repli, sans quarantaine
 * de codec, et sans rien dans les journaux qui le désigne.
 *
 * Relevé le 25 août 2026 sur deux séries dont les pistes tiennent dans les derniers octets du
 * fichier, quand un fichier ordinaire les place vers l'octet quatre mille. Les deux se lisaient sur
 * le Web et sur aucun appareil Android, mobile comme téléviseur.
 */
const fichier = (extra: Partial<PlaybackInfo> = {}): PlaybackInfo => ({
  mediaId: "media-h",
  container: "matroska",
  durationSeconds: 1519,
  trackHeadersAfterData: true,
  streams: [
    { index: 0, type: "video", codec: "hevc", title: null, language: null, channels: null, width: 1920, height: 1080,
      hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: true, isForced: false, canExtractAsWebVtt: false },
    { index: 1, type: "audio", codec: "aac", title: "French", language: "fre", channels: 2, width: null, height: null,
      hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: true, isForced: false, canExtractAsWebVtt: false },
  ],
  ...extra,
});

const client = (extra: Partial<PlaybackCapabilities> = {}): PlaybackCapabilities => ({
  containers: ["mp4", "webm", "matroska"], videoCodecs: ["hevc", "h264"], audioCodecs: ["aac"],
  hls: true, dash: true, maxWidth: 3840, maxHeight: 2160, hdr: false, hdrFormats: [], dolbyAtmos: false,
  immersiveAudioFormats: [], maxAudioChannels: 6, losslessAudio: false, maxVideoBitrate: null,
  dolbyVisionProfiles: [], audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false,
  adaptiveStreaming: true, streamingProtocol: "hls", ...extra,
});

describe("pistes définies après les données", () => {
  it("un lecteur linéaire ne reçoit pas la lecture directe", () => {
    // Le téléviseur déclare pourtant accepter le Matroska : c'est bien le rangement du fichier, et
    // non le conteneur, qui l'écarte.
    const decision = decidePlayback(fichier(), client({ seekableTrackHeaders: false, deviceClass: "tv" }));
    expect(decision.mode).not.toBe("direct");
    expect(decision.reasons.join(" ")).toContain("fin de fichier");
  });

  it("le remux suffit : rien n'est réencodé", () => {
    // FFmpeg réécrit l'en-tête en tête de flux ; l'image et le son sont copiés au bit près.
    const decision = decidePlayback(fichier(), client({ seekableTrackHeaders: false, deviceClass: "mobile" }));
    expect(decision.mode).toBe("remux");
    expect(decision.transcodeVideo).toBe(false);
    expect(decision.transcodeAudio).toBe(false);
  });

  it("un navigateur garde sa lecture directe", () => {
    // Il suit le renvoi du `SeekHead` sans y penser. Lui imposer un remux ferait travailler le NAS
    // pour rien — et c'est le cas qui fonctionne aujourd'hui.
    const decision = decidePlayback(fichier(), client({ deviceClass: "web" }));
    expect(decision.mode).toBe("direct");
  });

  it("Android d'avant r68 est corrigé par le serveur seul", () => {
    // Une application qui ne déclare pas encore sa limite est reconnue à sa classe d'appareil : le
    // correctif n'attend donc pas que le téléphone soit mis à jour.
    for (const deviceClass of ["mobile", "tv"] as const) {
      expect(decidePlayback(fichier(), client({ deviceClass })).mode, deviceClass).not.toBe("direct");
    }
  });

  it("un fichier ordinaire n'est pas touché", () => {
    const decision = decidePlayback(fichier({ trackHeadersAfterData: false }),
      client({ seekableTrackHeaders: false, deviceClass: "tv" }));
    expect(decision.mode).toBe("direct");
  });

  it("le mode direct demandé explicitement ne passe pas outre", () => {
    // Le bouton « Essayer en direct » ne doit pas ramener une image noire : c'est le seul échec dont
    // on sait par avance qu'il ne se verra pas.
    const decision = decidePlayback(fichier(),
      client({ seekableTrackHeaders: false, deviceClass: "tv", modePreference: "direct" }));
    expect(decision.mode).not.toBe("direct");
  });

  it("le pari sur la lecture directe s'abstient, faute d'échec visible", () => {
    // Le pari repose sur trois signaux — une erreur, un compteur, une quarantaine. Ici il n'y en a
    // aucun : le lecteur ne se plaint pas, il ne rend rien.
    const verdict = essaiDirectPertinent({
      entetesEnFinDeFichier: true, sousTitresAIncruster: false, traitementAudioDemande: false,
      pisteAudioImposee: false, definitionCompatible: true, plafondDefinitionChoisi: false,
      codecAudioDecodable: true, codecEnQuarantaine: false, debitSousLePlafondConstate: true,
    });
    expect(verdict.tenter).toBe(false);
    expect(verdict.motif).toContain("fin de fichier");
  });
});
