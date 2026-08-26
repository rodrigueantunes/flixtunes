import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { MediaStream, PlaybackCapabilities } from "@flixtunes/contracts";
import { eac3ARenormaliser } from "./playback.js";

/**
 * Ce que le déplacement dans un film ne doit pas casser.
 *
 * Deux défauts distincts sont relevés ici, tous deux invisibles avant un saut et tous deux constatés
 * sur mobile et tablette le 25 août 2026.
 *
 * Ces cas lisent la source plutôt que d'exécuter FFmpeg : ce qui compte est la cohérence entre deux
 * décisions éloignées l'une de l'autre, pas un comportement d'exécution qu'aucun banc ne reproduit
 * sans un vrai fichier et un vrai décodeur.
 */
const playback = readFileSync(new URL("./playback.ts", import.meta.url), "utf8");
const lecteurAndroid = readFileSync(
  new URL("../../android/app/src/main/java/tv/flixtunes/app/PlayerActivity.kt", import.meta.url), "utf8");

describe("synchronisation après un saut hors de la fenêtre", () => {
  it("le son garde son écart avec l'image : les horodatages sont ramenés ensemble", () => {
    // `-ss` avant `-i` fait démarrer la vidéo à l'image-clé précédant la cible et l'audio à la cible.
    // Sans instruction, le multiplexeur ramène chaque piste à zéro séparément et supprime l'écart —
    // le son se décale, en remux seulement, jamais en transcodage.
    const sorties = playback.split("-hls_time");
    expect(sorties.length, "deux sorties HLS attendues").toBeGreaterThan(2);
    for (const [index, sortie] of sorties.slice(1).entries()) {
      const avant = sorties[index] ?? "";
      expect(avant + sortie, `sortie HLS ${index + 1} sans make_zero`).toContain("make_zero");
    }
  });

  it("le déplacement reste instantané : `-ss` demeure avant l'entrée", () => {
    // Le corriger en déplaçant `-ss` après `-i` coûterait des minutes d'attente sur un film de deux
    // heures. La correction ne doit pas se payer là.
    expect(playback).toContain("Arguments de positionnement du transcodage, à placer **avant** `-i`");
  });

  it("le commentaire n'annonce plus une option qui n'est pas passée", () => {
    // `-copyts` était décrit comme conservant les horodatages ; il n'a jamais figuré dans la commande.
    const startArgs = playback.slice(playback.indexOf("function startArgs("));
    expect(startArgs.slice(0, 200)).not.toContain("copyts");
  });

  it("les sous-titres suivent la fenêtre encodée sur Android", () => {
    // Demandés sans décalage, ils arrivaient en retard d'exactement la position du saut, et l'écart
    // grandissait à chaque avance. Le signe est l'opposé du décalage de fenêtre : `-itsoffset`
    // repousse vers l'avant, or il faut ramener le temps du film au temps du flux.
    const configurations = lecteurAndroid.split("SubtitleConfiguration.Builder");
    expect(configurations.length, "deux pistes attendues : interne et externe").toBeGreaterThan(2);
    for (const [index, bloc] of configurations.slice(1).entries()) {
      expect(bloc.slice(0, 400), `piste ${index + 1} sans décalage de fenêtre`)
        .toContain("offsetSeconds = -session.startOffsetSeconds");
    }
  });

  /**
   * La règle elle-même, exécutée.
   *
   * Ces cas-ci ne lisent pas la source : ils appellent le verdict. La r64 avait été vérifiée par
   * lecture seule, et sa condition trop étroite est passée entre les mailles — un test qui lit un
   * texte ne dit rien du cas qu'il ne mentionne pas.
   */
  describe("E-AC-3 recopié dans un fMP4", () => {
    const capacites = (extra: Partial<PlaybackCapabilities> = {}): PlaybackCapabilities => ({
      containers: ["mp4"], videoCodecs: ["hevc"], audioCodecs: ["aac", "eac3"], hls: true,
      maxWidth: 1920, maxHeight: 1080, hdr: false, hdrFormats: [], dolbyAtmos: false,
      immersiveAudioFormats: [], maxAudioChannels: 2, losslessAudio: false, maxVideoBitrate: null,
      dolbyVisionProfiles: [], audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false,
      adaptiveStreaming: true, dash: true, streamingProtocol: "dash", hlsSegmentContainer: "fmp4", ...extra,
    });
    const piste = (extra: Partial<MediaStream> = {}): MediaStream => ({
      index: 1, type: "audio", codec: "eac3", title: null, language: "fre", channels: 6, width: null,
      height: null, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false,
      isDefault: true, isForced: false, canExtractAsWebVtt: false, ...extra,
    });

    it("s'applique à une session partie de zéro, celle du saut dans la fenêtre", () => {
      // Le cas que la r64 manquait : un déplacement à l'intérieur de ce qui est déjà encodé ne relance
      // aucune session, et le flux garde son E-AC-3 recopié. Le journal du service l'a montré — sur
      // quatre sessions d'un même film depuis un mobile en accès distant, trois partaient de zéro.
      expect(eac3ARenormaliser("remux", piste(), capacites({ startSeconds: 0 }))).toBe(true);
      expect(eac3ARenormaliser("remux", piste(), capacites({ startSeconds: 610.541 }))).toBe(true);
    });

    it("ne touche jamais la lecture directe", () => {
      // L'E-AC-3 part alors au récepteur tel quel. La consigne est explicite et tient depuis la r64.
      expect(eac3ARenormaliser("direct", piste(), capacites())).toBe(false);
    });

    it("ne sacrifie jamais le Dolby Atmos", () => {
      expect(eac3ARenormaliser("remux", piste({ dolbyAtmos: true }), capacites())).toBe(false);
    });

    it("laisse les segments MPEG-TS tranquilles", () => {
      // Leur restitution ne montre pas ce défaut : rien ne justifie d'y perdre le multicanal.
      expect(eac3ARenormaliser("remux", piste(), capacites({ hlsSegmentContainer: "mpegts" }))).toBe(false);
    });

    it("ne concerne que l'E-AC-3", () => {
      for (const codec of ["aac", "ac3", "dts", "truehd", "flac"]) {
        expect(eac3ARenormaliser("remux", piste({ codec }), capacites()), codec).toBe(false);
      }
    });
  });

  it("la règle ne touche jamais la décision de mode : la lecture directe est préservée", () => {
    // Placée dans `audioCompatible`, elle aurait fait basculer en remux un fichier qui avait droit à
    // la lecture directe — une reprise à vingt minutes envoie `startSeconds` dès la première demande.
    const decisionMode = playback.slice(playback.indexOf("const audioCompatible ="), playback.indexOf("const containerCompatible"));
    expect(decisionMode, "la décision de mode doit l'ignorer").not.toContain("eac3CopieDansFmp4");

    // Elle agit là où le mode est déjà arrêté, sur le seul choix de l'encodeur audio.
    const regle = playback.slice(playback.indexOf("export function eac3ARenormaliser"));
    expect(regle.slice(0, 400), "jamais en lecture directe").toContain('mode !== "direct"');
    const copie = playback.slice(playback.indexOf("const audioCopyCompatible ="));
    expect(copie.slice(0, 220)).toContain("!eac3CopieDansFmp4");
  });

  it("le serveur accepte un décalage de la taille d'un film, pas seulement d'un réglage", () => {
    // La borne valait dix minutes : un saut à une heure trente demande −5400 s, et la borne l'écrasait
    // en silence — les sous-titres restaient décalés de tout le reste.
    const borne = playback.slice(playback.indexOf("function normalizedSubtitleOffset("));
    expect(borne.slice(0, 200)).toContain("86400");
    expect(borne.slice(0, 200)).not.toContain("600,");
  });
});
