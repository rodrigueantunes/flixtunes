import { describe, expect, it } from "vitest";
import { playbackCapabilitiesSchema } from "@flixtunes/contracts";
import { reparerCapacites } from "./capacites-client.js";

/** Ce qu'un client Android envoie quand tout va bien. */
function capacitesNormales(): Record<string, unknown> {
  return {
    containers: ["mp4", "matroska"], videoCodecs: ["h264", "hevc"], audioCodecs: ["aac", "ac3"],
    hls: true, dash: false, maxWidth: 3840, maxHeight: 2160, hdr: true,
    hdrFormats: ["hdr10", "dolbyvision"], dolbyVisionProfiles: [5, 8], maxAudioChannels: 8,
  };
}

function accepte(corps: unknown): boolean {
  return playbackCapabilitiesSchema.safeParse(reparerCapacites(corps).corps).success;
}

/**
 * Le défaut d'origine : un projecteur relevé le 25 août 2026 annonçait une enveloppe `0 × 0` —
 * `Display.Mode` ne rapporte parfois aucun mode tant que la surface n'est pas prête. `maxWidth` à zéro
 * était refusé par `.positive()`, la demande de lecture repartait en 400, et l'écran n'affichait que
 * « Capacités de lecture invalides » sans nommer le champ. Un appareil capable de lire ne lisait plus
 * rien, pour un chiffre qui n'aurait servi qu'à choisir une définition de sortie.
 */
describe("réparation des capacités annoncées", () => {
  it("ne touche à rien quand tout est valide", () => {
    const { corps, rapport } = reparerCapacites(capacitesNormales());
    expect(rapport.champs).toEqual([]);
    expect(corps).toEqual(capacitesNormales());
  });

  it("laisse lire un appareil qui annonce une enveloppe nulle", () => {
    const projecteur = { ...capacitesNormales(), maxWidth: 0, maxHeight: 0 };
    expect(accepte(projecteur), "c'est le cas exact du projecteur").toBe(true);
    const { corps, rapport } = reparerCapacites(projecteur);
    expect(rapport.champs).toContain("maxWidth");
    expect(rapport.champs).toContain("maxHeight");
    // Rien n'est inventé : le champ disparaît et c'est le schéma qui pose son défaut.
    expect(corps).not.toHaveProperty("maxWidth");
    expect(playbackCapabilitiesSchema.parse(corps).maxWidth).toBe(3840);
  });

  it("laisse lire un appareil sans conteneur annoncé", () => {
    expect(accepte({ ...capacitesNormales(), containers: [] })).toBe(true);
    expect(reparerCapacites({ ...capacitesNormales(), containers: [] }).corps.containers).toEqual(["mp4"]);
  });

  it("écarte les valeurs inconnues sans refuser le reste", () => {
    const { corps } = reparerCapacites({
      ...capacitesNormales(),
      containers: ["mp4", "conteneur-de-demain"],
      hdrFormats: ["hdr10", "format-inconnu"],
      dolbyVisionProfiles: [5, 99],
    });
    expect(corps.containers).toEqual(["mp4"]);
    expect(corps.hdrFormats).toEqual(["hdr10"]);
    expect(corps.dolbyVisionProfiles).toEqual([5]);
  });

  it("traite un débit ou un nombre de canaux nul comme une absence de limite", () => {
    const { corps } = reparerCapacites({ ...capacitesNormales(), maxVideoBitrate: 0, maxAudioChannels: 0 });
    expect(corps.maxVideoBitrate).toBeNull();
    expect(corps).not.toHaveProperty("maxAudioChannels");
    expect(playbackCapabilitiesSchema.parse(corps).maxAudioChannels).toBe(8);
  });

  it("ramène un index de piste négatif à « aucun choix »", () => {
    const { corps } = reparerCapacites({ ...capacitesNormales(), audioStreamIndex: -1, subtitleStreamIndex: -1 });
    expect(corps.audioStreamIndex).toBeNull();
    expect(corps.subtitleStreamIndex).toBeNull();
  });

  it("supporte un corps absurde sans lever", () => {
    for (const absurde of [null, undefined, 42, "texte", []]) {
      expect(() => reparerCapacites(absurde)).not.toThrow();
    }
  });
});
