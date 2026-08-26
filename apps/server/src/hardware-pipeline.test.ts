import { describe, expect, it } from "vitest";

import { selectVideoEncoder } from "./playback.js";

/**
 * Ce que la chaîne confie réellement au circuit vidéo.
 *
 * Deux leçons y sont figées, apprises l'une après l'autre sur le NAS. Toute conversion HDR vers SDR
 * renvoyait l'encodage au processeur, même là où le matériel savait le faire — corrigé. Et la
 * correction suivante, qui portait le décodage sur le circuit vidéo, ouvrait un second périphérique
 * VA-API et bloquait la conversion — retirée, faute d'un banc qui la qualifie.
 */
const intel = { encoders: new Set(["h264_vaapi", "libx264"]), hwaccels: new Set(["vaapi"]) };

describe("chemin VA-API", () => {
  it("n'ouvre qu'un seul périphérique VA-API", () => {
    // Le décodage matériel avait été ajouté sous la forme `-hwaccel vaapi -hwaccel_device <nœud>` en
    // plus de `-vaapi_device <nœud>`. Deux périphériques VA-API sur le même nœud de rendu dans un seul
    // processus : FFmpeg se bloquait, ne produisait aucun segment, et ne se terminait pas — donc le
    // repli vers le logiciel, accroché à sa fin, ne se déclenchait jamais. Relevé sur le NAS avec un
    // simple 1080p.
    const selection = selectVideoEncoder(intel, "auto");
    expect(selection.encoder).toBe("h264_vaapi");
    expect(selection.inputArgs).toEqual(["-vaapi_device", "/dev/dri/renderD128"]);
  });

  it("laisse le décodage au processeur tant qu'aucun banc ne l'a qualifié", () => {
    // Le gain mesuré vient du micro-banc, qui **encode** une mire : il n'exerce aucun décodage. Un
    // chemin matériel non mesuré ne se prend pas d'office — c'est la règle du projet, et l'oublier a
    // coûté une lecture qui ne démarrait plus.
    expect(selectVideoEncoder(intel, "auto").inputArgs).not.toContain("-hwaccel");
  });

  it("transfère les images vers le périphérique en toute fin de chaîne", () => {
    // L'ordre est ce qui rend possible l'encodage matériel après des filtres logiciels : tone mapping
    // et redimensionnement d'abord, transfert ensuite, encodage enfin.
    expect(selectVideoEncoder(intel, "auto").filterSuffix).toEqual(["format=nv12", "hwupload"]);
  });

  it("laisse le format de pixels au périphérique", () => {
    expect(selectVideoEncoder(intel, "auto").softwarePixels).toBe(false);
  });

  it("rend la main au logiciel quand le repli est demandé", () => {
    const selection = selectVideoEncoder(intel, "auto", true);
    expect(selection.encoder).toBe("libx264");
    expect(selection.inputArgs).toEqual([]);
    expect(selection.filterSuffix).toEqual([]);
  });

  it("respecte un choix explicite d'administrateur", () => {
    expect(selectVideoEncoder(intel, "software").encoder).toBe("libx264");
    expect(selectVideoEncoder(intel, "vaapi").encoder).toBe("h264_vaapi");
  });
});
