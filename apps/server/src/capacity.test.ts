import { describe, expect, it } from "vitest";
import type { AcceleratorProbe } from "@flixtunes/contracts";
import { budgetFromBenchmark, buildCapacityAlerts, calibrationSignature, decideAdmission, decodeCostFactor,
  effectiveScanConcurrency, estimateSessionCost, frameWork, friendlyAcceleratorError, rankAccelerators } from "./capacity.js";

function probe(id: AcceleratorProbe["id"], framesPerSecond: number | null, overrides: Partial<AcceleratorProbe> = {}): AcceleratorProbe {
  return {
    id, label: id, vendor: id === "software" ? "cpu" : "intel", encoder: id === "software" ? "libx264" : `h264_${id}`,
    compiled: true, usable: framesPerSecond != null, framesPerSecond, relativeToSoftware: null, selected: false,
    error: null, ...overrides,
  };
}

const generousState = { budgetUnits: 8, usedUnits: 0, activeTranscodes: 0, maximumTranscodes: 2, freeMemoryBytes: 8e9 };

describe("modèle de coût de conversion", () => {
  it("reproduit les débits mesurés au banc", () => {
    // Ajusté sur 720p et 2160p, vérifié sur 1080p et sur une échelle ABR.
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }] })).toBe(1);
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 1280, height: 720 }] })).toBe(0.66);
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 3840, height: 2160 }] })).toBe(2.84);
    expect(estimateSessionCost({ mode: "transcode", variants: [
      { width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 854, height: 480 }, { width: 640, height: 360 },
    ] })).toBe(1.61);
  });

  it("ne facture le décodage qu'une fois pour une échelle ABR", () => {
    const single = estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }] });
    const ladder = estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }] });
    expect(ladder).toBeLessThan(single * 2);
    expect(ladder).toBeGreaterThan(single);
  });

  it("distingue lecture directe, remux et transcodage", () => {
    expect(estimateSessionCost({ mode: "direct", variants: [{ width: 3840, height: 2160 }] })).toBe(0);
    expect(estimateSessionCost({ mode: "remux", variants: [{ width: 1920, height: 1080 }] })).toBe(0.2);
  });

  it("facture le décodage selon le codec source", () => {
    const variants = [{ width: 1920, height: 1080 }];
    // Décodage seul mesuré à 1080p : H.264 1388 i/s, HEVC 1322, AV1 700, MPEG-2 1901.
    expect(estimateSessionCost({ mode: "transcode", variants, sourceCodec: "h264" })).toBe(1);
    expect(estimateSessionCost({ mode: "transcode", variants, sourceCodec: "av1" })).toBe(1.38);
    expect(estimateSessionCost({ mode: "transcode", variants, sourceCodec: "mpeg2video" })).toBe(0.9);
    // Un codec non mesuré garde le facteur neutre au lieu d'une valeur supposée.
    expect(estimateSessionCost({ mode: "transcode", variants, sourceCodec: "vc1" })).toBe(1);
    expect(decodeCostFactor("HEVC")).toBe(1.05);
    expect(decodeCostFactor(null)).toBe(1);
  });

  it("majore le coût selon la cadence et le tone mapping", () => {
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }], frameRate: 50 })).toBe(2);
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }], toneMapping: "zscale" })).toBe(1.43);
    expect(estimateSessionCost({ mode: "transcode", variants: [{ width: 1920, height: 1080 }], toneMapping: "libplacebo" })).toBe(1.83);
  });

  it("convertit un débit mesuré en budget de sessions", () => {
    expect(frameWork(1920, 1080)).toBeCloseTo(1, 2);
    expect(budgetFromBenchmark(468, 0.6)).toBe(7.4);
    expect(budgetFromBenchmark(84, 0.6)).toBe(1.3);
    expect(budgetFromBenchmark(null)).toBe(1);
  });
});

describe("calibrage des accélérateurs", () => {
  it("préfère un accélérateur qui soutient au moins 80 % du débit logiciel", () => {
    const ranked = rankAccelerators([probe("software", 266), probe("nvenc", 227), probe("qsv", 84)]);
    expect(ranked.find((entry) => entry.selected)?.id).toBe("nvenc");
    expect(ranked.find((entry) => entry.id === "qsv")?.relativeToSoftware).toBe(0.32);
  });

  it("écarte un pilote qui répond mais reste plus lent que le processeur", () => {
    // Cas mesuré sur Quick Sync : 84 images/s contre 266 en logiciel.
    const ranked = rankAccelerators([probe("software", 266), probe("qsv", 84)]);
    expect(ranked.find((entry) => entry.selected)?.id).toBe("software");
  });

  it("écarte un pilote compilé mais inutilisable", () => {
    const ranked = rankAccelerators([probe("software", 266), probe("amf", null, { usable: false, error: "Pilote absent" })]);
    expect(ranked.find((entry) => entry.selected)?.id).toBe("software");
    expect(ranked.find((entry) => entry.id === "amf")?.selected).toBe(false);
  });

  it("respecte un choix explicite de l'administrateur", () => {
    const ranked = rankAccelerators([probe("software", 266), probe("qsv", 84)], "qsv");
    expect(ranked.find((entry) => entry.selected)?.id).toBe("qsv");
  });

  it("refait le calibrage quand le moteur ou les accélérateurs changent", () => {
    const base = calibrationSignature("ffmpeg 8.1", ["cuda", "vulkan"], ["libx264", "h264_nvenc"]);
    expect(calibrationSignature("ffmpeg 8.1", ["vulkan", "cuda"], ["h264_nvenc", "libx264"])).toBe(base);
    expect(calibrationSignature("ffmpeg 8.2", ["cuda", "vulkan"], ["libx264", "h264_nvenc"])).not.toBe(base);
    expect(calibrationSignature("ffmpeg 8.1", ["cuda"], ["libx264", "h264_nvenc"])).not.toBe(base);
  });

  it("traduit les échecs de pilote en langage utilisable", () => {
    expect(friendlyAcceleratorError("DLL amfrt64.dll failed to open")).toContain("Pilote absent");
    expect(friendlyAcceleratorError("/dev/dri/renderD128: Permission denied")).toContain("accessible");
    expect(friendlyAcceleratorError("Unknown encoder 'h264_qsv'")).toContain("compilation");
  });
});

describe("contrôle d'admission", () => {
  it("n'affame jamais une lecture directe", () => {
    const saturated = { ...generousState, usedUnits: 8, activeTranscodes: 2 };
    expect(decideAdmission({ mode: "direct", variants: [{ width: 3840, height: 2160 }] }, saturated))
      .toMatchObject({ accepted: true, degraded: false, costUnits: 0 });
  });

  it("accepte une session qui tient dans le budget", () => {
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1920, height: 1080 }] }, generousState))
      .toMatchObject({ accepted: true, degraded: false, maxHeight: null });
  });

  it("réduit la définition avant de refuser", () => {
    const decision = decideAdmission(
      { mode: "transcode", variants: [{ width: 3840, height: 2160 }], height: 2160 },
      { ...generousState, budgetUnits: 3, usedUnits: 1.5 },
    );
    expect(decision).toMatchObject({ accepted: true, degraded: true, maxHeight: 1440 });
    expect(decision.reason).toContain("1440p");
    expect(decision.costUnits).toBeLessThan(2.84);
  });

  it("refuse seulement quand même la définition la plus basse ne tient pas", () => {
    const decision = decideAdmission(
      { mode: "transcode", variants: [{ width: 1920, height: 1080 }], height: 1080 },
      { ...generousState, budgetUnits: 1, usedUnits: 0.9 },
    );
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toContain("réduite");
  });

  it("respecte le plafond de conversions simultanées et la mémoire libre", () => {
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1280, height: 720 }] },
      { ...generousState, activeTranscodes: 2 })).toMatchObject({ accepted: false });
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1280, height: 720 }] },
      { ...generousState, freeMemoryBytes: 64 * 1024 * 1024 }).reason).toContain("Mémoire");
  });

  it("n'ouvre pas de conversion au-delà de la limite thermique mais laisse passer le direct", () => {
    const hot = { ...generousState, temperatureCelsius: 92 };
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1280, height: 720 }] }, hot).accepted).toBe(false);
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1280, height: 720 }] }, hot).reason).toContain("92 °C");
    expect(decideAdmission({ mode: "direct", variants: [{ width: 3840, height: 2160 }] }, hot).accepted).toBe(true);
    expect(decideAdmission({ mode: "transcode", variants: [{ width: 1280, height: 720 }] },
      { ...generousState, temperatureCelsius: 60 }).accepted).toBe(true);
  });
});

describe("priorité des analyses", () => {
  it("cède la place aux conversions puis repart seule", () => {
    expect(effectiveScanConcurrency(2, 0, 0.1)).toBe(2);
    expect(effectiveScanConcurrency(2, 1, 0.1)).toBe(1);
    expect(effectiveScanConcurrency(2, 0, 0.9)).toBe(0);
    expect(effectiveScanConcurrency(2, 2, 0.95)).toBe(0);
  });
});

describe("alertes de capacité", () => {
  const base = { budgetUnits: 8, usedUnits: 1, freeMemoryBytes: 8e9, totalMemoryBytes: 16e9,
    temperatureCelsius: null, scanPaused: false };

  it("signale un accélérateur compilé mais inutilisable avec une action", () => {
    const ranked = rankAccelerators([probe("software", 266), probe("amf", null, { usable: false, error: "Pilote absent ou non chargé." })]);
    const alerts = buildCapacityAlerts({ ...base, accelerators: ranked });
    const alert = alerts.find((entry) => entry.message.includes("amf"));
    expect(alert?.level).toBe("warning");
    expect(alert?.action).toBeTruthy();
  });

  it("explique pourquoi un pilote plus lent est écarté", () => {
    const alerts = buildCapacityAlerts({ ...base, accelerators: rankAccelerators([probe("software", 266), probe("qsv", 84)]) });
    expect(alerts.some((entry) => entry.message.includes("32 %"))).toBe(true);
  });

  it("prévient avant la saturation et sur la surchauffe", () => {
    const ranked = rankAccelerators([probe("software", 266)]);
    expect(buildCapacityAlerts({ ...base, accelerators: ranked, usedUnits: 7.5 })
      .some((entry) => entry.message.includes("presque saturé"))).toBe(true);
    expect(buildCapacityAlerts({ ...base, accelerators: ranked, temperatureCelsius: 92 })
      .some((entry) => entry.level === "critical")).toBe(true);
    expect(buildCapacityAlerts({ ...base, accelerators: ranked, freeMemoryBytes: 1e9 })
      .some((entry) => entry.message.includes("mémoire libre"))).toBe(true);
  });

  it("reste silencieux sur un serveur sain", () => {
    expect(buildCapacityAlerts({ ...base, accelerators: rankAccelerators([probe("software", 266)]) })).toEqual([]);
  });

  it("n'annonce pas une panne d'encodeur pendant le micro-banc", () => {
    const alerts = buildCapacityAlerts({ ...base, accelerators: [], calibrating: true });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "info" });
    expect(buildCapacityAlerts({ ...base, accelerators: [] }).some((entry) => entry.level === "critical")).toBe(true);
  });
});
