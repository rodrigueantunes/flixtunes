import { describe, expect, it } from "vitest";

import type { PlaybackCapabilities } from "@flixtunes/contracts";

import { plafonnerDefinition } from "./playback.js";

/**
 * Le plafond de définition du mode expert.
 *
 * L'appareil annonce ce qu'il sait afficher, et le cas courant s'en contente. Ce réglage sert à le
 * contredire — brider sur un réseau chargé, ou constater qu'un film n'est pas rabaissé quand on
 * soupçonne qu'il l'est.
 */
const appareil = (largeur: number, hauteur: number) => ({
  maxWidth: largeur, maxHeight: hauteur, videoCodecs: ["h264"], audioCodecs: ["aac"],
} as unknown as PlaybackCapabilities);

describe("plafond de définition", () => {
  it("laisse tout passer en automatique", () => {
    const capacites = appareil(3840, 2160);
    expect(plafonnerDefinition(capacites, "auto")).toBe(capacites);
  });

  it("rabaisse un appareil 4K au plafond demandé", () => {
    const plafonne = plafonnerDefinition(appareil(3840, 2160), "1080");
    expect(plafonne.maxHeight).toBe(1080);
    expect(plafonne.maxWidth).toBe(1920);
  });

  it("ne relève jamais ce que l'appareil annonce", () => {
    // Lui envoyer une image qu'il ne sait pas décoder ne donne pas une image plus fine : la lecture
    // échoue. Le plafond ne peut que réduire.
    const plafonne = plafonnerDefinition(appareil(1920, 1080), "2160");
    expect(plafonne.maxHeight).toBe(1080);
    expect(plafonne.maxWidth).toBe(1920);
  });

  it("rend l'objet d'origine quand le plafond ne change rien", () => {
    const capacites = appareil(1280, 720);
    expect(plafonnerDefinition(capacites, "1080")).toBe(capacites);
  });

  it("suit la hauteur en 16/9 pour la largeur", () => {
    // Un plafond exprimé en hauteur seule laisserait passer une image deux fois trop large sur un
    // format panoramique.
    const plafonne = plafonnerDefinition(appareil(5120, 2160), "1440");
    expect(plafonne.maxHeight).toBe(1440);
    expect(plafonne.maxWidth).toBe(2560);
  });

  it("ignore une valeur qui n'est pas une hauteur", () => {
    // Un réglage enregistré puis retiré par une mise à jour ne doit pas casser la lecture.
    const capacites = appareil(3840, 2160);
    expect(plafonnerDefinition(capacites, "")).toBe(capacites);
    expect(plafonnerDefinition(capacites, "maximum")).toBe(capacites);
    expect(plafonnerDefinition(capacites, "0")).toBe(capacites);
  });
});
