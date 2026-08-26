import { describe, expect, it } from "vitest";
import { AUDIO_VIDEO_TOLERANCE_MS, corpus, corpusByProperty, corpusExpectations, referenceClients, validateCorpus } from "./corpus.js";

describe("corpus de qualification de lecture", () => {
  it("décrit un manifeste cohérent et entièrement synthétique", () => {
    expect(validateCorpus()).toEqual([]);
  });

  it("couvre chaque propriété technique exigée par le plan", () => {
    for (const property of ["conteneur", "codec-video", "codec-audio", "hdr", "canaux", "sous-titres", "cadence", "cas-limite"] as const) {
      expect(corpusByProperty(property).length, `propriété ${property}`).toBeGreaterThan(0);
    }
  });

  it("couvre les cas limites nommés dans le dossier d'étape", () => {
    const limits = corpusByProperty("cas-limite").map((fixture) => fixture.id);
    expect(limits).toEqual(expect.arrayContaining([
      "cas-piste-defaut-incorrecte", "cas-audio-retarde", "cas-cadence-variable", "cas-b-frames", "cas-fichier-tronque",
    ]));
  });

  it("confronte chaque client de référence à au moins une fixture", () => {
    const covered = new Set(corpusExpectations().map(({ expectation }) => expectation.client));
    for (const client of Object.keys(referenceClients)) expect(covered.has(client as never), `client ${client}`).toBe(true);
  });

  it("n'annonce jamais une capacité que le client réel ne déclare pas", () => {
    // Un navigateur ne promet ni multicanal ni audio sans perte : le banc doit rester conservateur.
    expect(referenceClients["web-chromium"].maxAudioChannels).toBe(2);
    expect(referenceClients["web-chromium"].losslessAudio).toBe(false);
    expect(referenceClients["web-chromium"].hdrFormats).toEqual([]);
    expect(referenceClients["android-tv"].hdrFormats).toContain("hdr10");
    expect(referenceClients.windows.losslessAudio).toBe(true);
  });

  it("attend une lecture directe du cas nominal sur tous les clients", () => {
    const nominal = corpus.find((fixture) => fixture.id === "mp4-h264-aac");
    expect(nominal?.expectations.every((expectation) => expectation.mode === "direct")).toBe(true);
    expect(nominal?.expectations).toHaveLength(Object.keys(referenceClients).length);
  });

  it("fixe une synchronisation A/V attendue et une tolérance perceptible", () => {
    expect(AUDIO_VIDEO_TOLERANCE_MS).toBeLessThanOrEqual(40);
    const nominal = corpus.find((fixture) => fixture.id === "mp4-h264-aac");
    expect(nominal?.expectedAudioVideoOffsetMs).toBe(0);
    const delayed = corpus.find((fixture) => fixture.id === "cas-audio-retarde");
    expect(delayed?.expectedAudioVideoOffsetMs).toBe(500);
    // Un décalage attendu n'a de sens que s'il dépasse largement la tolérance du banc.
    expect(Math.abs(delayed!.expectedAudioVideoOffsetMs!)).toBeGreaterThan(AUDIO_VIDEO_TOLERANCE_MS * 2);
  });

  it("documente la limite connue du fichier tronqué au lieu de la masquer", () => {
    const truncated = corpus.find((fixture) => fixture.id === "cas-fichier-tronque");
    expect(truncated?.postProcess).toBe("truncate");
    expect(truncated?.knownLimitation).toBeTruthy();
  });
});
