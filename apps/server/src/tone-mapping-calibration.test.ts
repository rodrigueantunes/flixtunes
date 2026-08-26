import { describe, expect, it } from "vitest";

import type { ToneMappingProbe } from "@flixtunes/contracts";

import { rankToneMapping } from "./capacity.js";
import { selectToneMappingBackend } from "./playback.js";

/**
 * Le classement des chemins de tone mapping, et ce que « auto » en fait.
 *
 * L'enjeu est mesurable : sur le NAS de référence, la conversion d'un film HDR passait par
 * `zscale` puis `tonemap=hable` en logiciel, et c'est ce qui mettait le processeur à genoux —
 * davantage que l'encodage. La règle du projet interdisant de retenir un chemin matériel non mesuré,
 * la seule sortie honnête était de le mesurer.
 */
const sonde = (partiel: Partial<ToneMappingProbe> & Pick<ToneMappingProbe, "id">): ToneMappingProbe => ({
  label: partiel.id, hardware: false, compiled: true, usable: true, framesPerSecond: null,
  relativeToSoftware: null, selected: false, error: null, ...partiel,
});

describe("classement des chemins de tone mapping", () => {
  it("retient le plus rapide et le rapporte au chemin logiciel", () => {
    const classees = rankToneMapping([
      sonde({ id: "zscale", framesPerSecond: 30 }),
      sonde({ id: "vaapi", hardware: true, framesPerSecond: 120 }),
      sonde({ id: "software", framesPerSecond: 28 }),
    ]);
    expect(classees.find((probe) => probe.selected)?.id).toBe("vaapi");
    expect(classees.find((probe) => probe.id === "vaapi")?.relativeToSoftware).toBe(4);
    expect(classees.find((probe) => probe.id === "software")?.relativeToSoftware).toBeCloseTo(0.93, 2);
  });

  it("écarte un chemin matériel plus lent que le logiciel", () => {
    // Le cas qui justifiait l'interdiction : un tone mapping matériel émulé répond, donc paraît
    // disponible, mais coûte plus cher que ce qu'il remplace. Mesurer le démasque ; le déclarer non.
    const classees = rankToneMapping([
      sonde({ id: "zscale", framesPerSecond: 60 }),
      sonde({ id: "opencl", hardware: true, framesPerSecond: 12 }),
    ]);
    expect(classees.find((probe) => probe.selected)?.id).toBe("zscale");
    expect(classees.find((probe) => probe.id === "opencl")?.relativeToSoftware).toBe(0.2);
  });

  it("ne retient jamais un chemin qui n'a pas converti", () => {
    const classees = rankToneMapping([
      sonde({ id: "vaapi", hardware: true, usable: false, framesPerSecond: null, error: "Pilote absent" }),
      sonde({ id: "zscale", framesPerSecond: 25 }),
    ]);
    expect(classees.find((probe) => probe.selected)?.id).toBe("zscale");
    expect(classees.find((probe) => probe.id === "vaapi")?.relativeToSoftware).toBeNull();
  });

  it("ne compare rien quand aucun chemin logiciel n'a servi de référence", () => {
    const [seul] = rankToneMapping([sonde({ id: "vaapi", hardware: true, framesPerSecond: 90 })]);
    expect(seul?.selected).toBe(true);
    expect(seul?.relativeToSoftware).toBeNull();
  });
});

describe("choix du chemin en fonction de la mesure", () => {
  const complet = {
    filters: new Set(["libplacebo", "tonemap_vaapi", "tonemap_opencl", "zscale", "tonemap"]),
    hwaccels: new Set(["vulkan", "vaapi", "opencl"]),
    encoders: new Set<string>(),
  };
  const sansVulkan = { ...complet, hwaccels: new Set(["vaapi", "opencl"]) };

  it("suit la mesure en automatique", () => {
    expect(selectToneMappingBackend(complet, "auto", false, "vaapi")).toMatchObject({ backend: "vaapi", hardware: true });
    expect(selectToneMappingBackend(sansVulkan, "auto", false, "opencl")).toMatchObject({ backend: "opencl", hardware: true });
  });

  it("revient au comportement d'avant quand rien n'a été mesuré", () => {
    // Sans mesure, seul libplacebo est admis sans épreuve locale : c'est le seul chemin que le projet
    // avait déjà qualifié. Les autres restent en retrait plutôt que d'être supposés bons.
    expect(selectToneMappingBackend(complet, "auto", false, null)).toMatchObject({ backend: "libplacebo" });
    expect(selectToneMappingBackend(sansVulkan, "auto", false, null)).toMatchObject({ backend: "zscale", hardware: false });
  });

  it("ne retient pas un chemin mesuré que la compilation ne fournit plus", () => {
    // Un calibrage survit à une mise à jour de FFmpeg. Si le filtre a disparu entre-temps, le suivre
    // produirait une commande que FFmpeg refuse, et la lecture échouerait au lieu de ralentir.
    const sansVaapi = { ...complet, filters: new Set(["zscale", "tonemap"]), hwaccels: new Set<string>() };
    expect(selectToneMappingBackend(sansVaapi, "auto", false, "vaapi")).toMatchObject({ backend: "zscale", hardware: false });
  });

  it("un choix explicite prime sur la mesure", () => {
    // C'est le mode expert : la personne voit les chiffres et décide malgré eux.
    expect(selectToneMappingBackend(complet, "opencl", false, "vaapi")).toMatchObject({ backend: "opencl" });
    expect(selectToneMappingBackend(complet, "libplacebo", false, "vaapi")).toMatchObject({ backend: "libplacebo" });
  });

  it("le repli logiciel forcé ignore la mesure comme le choix", () => {
    expect(selectToneMappingBackend(complet, "vaapi", true, "vaapi")).toMatchObject({ backend: "zscale", hardware: false });
  });
});
