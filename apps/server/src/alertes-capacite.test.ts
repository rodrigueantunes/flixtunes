import { describe, expect, it } from "vitest";

import type { AcceleratorProbe } from "@flixtunes/contracts";

import { buildCapacityAlerts } from "./capacity.js";

/**
 * Les alertes du tableau de capacité.
 *
 * Une alerte réclame une action ; si l'action est impossible, elle ne renseigne pas, elle encombre.
 * Le tableau conseillait « installez le pilote NVIDIA » sur un NAS Intel, trois fois de suite avec AMD
 * et l'encodeur des puces ARM, pendant que la seule ligne utile passait inaperçue.
 */
const sonde = (partiel: Partial<AcceleratorProbe> & Pick<AcceleratorProbe, "id">): AcceleratorProbe => ({
  label: partiel.id, vendor: "cpu", encoder: "x", compiled: true, usable: false, framesPerSecond: null,
  relativeToSoftware: null, selected: false, error: "Pilote absent ou non chargé sur ce serveur.", ...partiel,
});

const contexte = { budgetUnits: 3, usedUnits: 0, freeMemoryBytes: 8e9, totalMemoryBytes: 16e9,
  temperatureCelsius: 40, scanPaused: false };

describe("alertes du tableau de capacité", () => {
  it("se tait sur le matériel absent dès qu'un accélérateur fonctionne", () => {
    const alertes = buildCapacityAlerts({
      ...contexte,
      accelerators: [
        sonde({ id: "software", vendor: "cpu", usable: true, framesPerSecond: 57, relativeToSoftware: 1, error: null }),
        sonde({ id: "vaapi", vendor: "intel", usable: true, framesPerSecond: 191, relativeToSoftware: 3.35, selected: true, error: null }),
        sonde({ id: "nvenc", vendor: "nvidia" }),
        sonde({ id: "amf", vendor: "amd" }),
        sonde({ id: "v4l2m2m", vendor: "arm" }),
      ],
    });
    expect(alertes.map((alerte) => alerte.message).join(" ")).not.toMatch(/nvenc|amf|v4l2m2m/i);
  });

  it("les signale tant qu'aucun accélérateur n'a été retenu", () => {
    // Là, ils comptent : c'est peut-être l'un d'eux qui manque à l'appel, et le message dit lequel.
    const alertes = buildCapacityAlerts({
      ...contexte,
      accelerators: [
        sonde({ id: "software", vendor: "cpu", usable: true, framesPerSecond: 57, relativeToSoftware: 1, selected: true, error: null }),
        sonde({ id: "vaapi", vendor: "intel" }),
      ],
    });
    expect(alertes.some((alerte) => /VA-API|vaapi/i.test(alerte.message))).toBe(true);
  });

  it("garde l'avertissement d'un accélérateur plus lent que le processeur", () => {
    // Celui-ci reste utile même quand un autre fonctionne : il désigne un chemin qu'il vaut mieux
    // éviter, ce qu'aucune autre ligne ne dit.
    const alertes = buildCapacityAlerts({
      ...contexte,
      accelerators: [
        sonde({ id: "software", vendor: "cpu", usable: true, framesPerSecond: 57, relativeToSoftware: 1, error: null }),
        sonde({ id: "vaapi", vendor: "intel", usable: true, framesPerSecond: 191, relativeToSoftware: 3.35, selected: true, error: null }),
        sonde({ id: "qsv", vendor: "intel", usable: true, framesPerSecond: 20, relativeToSoftware: 0.35, error: null }),
      ],
    });
    expect(alertes.some((alerte) => /plus lent que le processeur/.test(alerte.message))).toBe(true);
  });

  it("reste alarmiste quand aucun encodeur ne répond", () => {
    const alertes = buildCapacityAlerts({ ...contexte, accelerators: [sonde({ id: "vaapi", vendor: "intel" })] });
    expect(alertes.some((alerte) => alerte.level === "critical")).toBe(true);
  });
});
