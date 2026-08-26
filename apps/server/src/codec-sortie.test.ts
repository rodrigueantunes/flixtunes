import { describe, expect, it } from "vitest";

import { codecDeSortie, selectVideoEncoder } from "./playback.js";

/**
 * Le codec dans lequel une conversion ressort.
 *
 * Convertir un film HEVC vers H.264 coûte deux fois : il faut environ le double de débit pour la même
 * qualité, et le réencodage travaille davantage. Sur une source 4K HDR c'est la différence entre un
 * flux qui passe sur un réseau domestique et un flux qui ne passe pas.
 */
describe("choix du codec de sortie", () => {
  it("conserve le HEVC quand la source l'emploie et que l'appareil l'annonce", () => {
    expect(codecDeSortie(["h264", "hevc"], "hevc", "fmp4")).toBe("hevc");
  });

  it("ne convertit jamais vers un codec que l'appareil n'a pas annoncé", () => {
    expect(codecDeSortie(["h264"], "hevc", "fmp4")).toBe("h264");
  });

  it("ne fait jamais passer une source H.264 en HEVC", () => {
    // Un appareil qui annonce le HEVC ne le décode pas toujours aussi bien que du H.264, et la
    // quarantaine de codecs existe précisément parce que cette déclaration ment parfois. Changer de
    // codec sans nécessité, c'est prendre ce risque pour rien.
    expect(codecDeSortie(["h264", "hevc"], "h264", "fmp4")).toBe("h264");
    expect(codecDeSortie(["h264", "hevc"], "vp9", "fmp4")).toBe("h264");
  });

  it("refuse le HEVC en MPEG-TS", () => {
    // Tous les lecteurs ne transportent pas le HEVC dans ce conteneur ; fMP4 est exigé.
    expect(codecDeSortie(["h264", "hevc"], "hevc", "mpegts")).toBe("h264");
  });

  it("obéit à un choix explicite, dans les deux sens", () => {
    expect(codecDeSortie(["h264"], "h264", "fmp4", "hevc")).toBe("hevc");
    expect(codecDeSortie(["h264", "hevc"], "hevc", "fmp4", "h264")).toBe("h264");
  });

  it("traite une source de codec inconnu comme du H.264", () => {
    expect(codecDeSortie(["h264", "hevc"], null, "fmp4")).toBe("h264");
    expect(codecDeSortie(["h264", "hevc"], undefined, "fmp4")).toBe("h264");
  });
});

describe("encodeurs HEVC", () => {
  const intel = { encoders: new Set(["h264_vaapi", "hevc_vaapi", "libx264", "libx265"]), hwaccels: new Set(["vaapi"]) };

  it("préfère le circuit vidéo, comme pour le H.264", () => {
    const selection = selectVideoEncoder(intel, "auto", false, "hevc");
    expect(selection.encoder).toBe("hevc_vaapi");
    expect(selection.filterSuffix).toEqual(["format=nv12", "hwupload"]);
    // Un seul périphérique VA-API, comme pour le H.264 : en ouvrir un second sur le même nœud de
    // rendu bloquait la conversion sans que rien ne se termine.
    expect(selection.inputArgs).toEqual(["-vaapi_device", "/dev/dri/renderD128"]);
  });

  it("se rabat sur le logiciel plutôt que d'échouer quand le matériel n'encode pas en HEVC", () => {
    const sansHevcMateriel = { encoders: new Set(["h264_vaapi", "libx264", "libx265"]), hwaccels: new Set(["vaapi"]) };
    expect(selectVideoEncoder(sansHevcMateriel, "auto", false, "hevc").encoder).toBe("libx265");
  });

  it("revient au H.264 quand aucun encodeur HEVC n'existe", () => {
    // Le flux doit sortir dans tous les cas : mieux vaut un codec moins efficace que pas de lecture.
    const sansHevc = { encoders: new Set(["h264_vaapi", "libx264"]), hwaccels: new Set(["vaapi"]) };
    expect(selectVideoEncoder(sansHevc, "auto", false, "hevc").encoder).toBe("h264_vaapi");
  });

  it("le repli logiciel forcé reste logiciel, en HEVC comme en H.264", () => {
    expect(selectVideoEncoder(intel, "auto", true, "hevc").encoder).toBe("libx265");
    expect(selectVideoEncoder(intel, "auto", true, "h264").encoder).toBe("libx264");
  });
});
