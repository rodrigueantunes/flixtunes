import { describe, expect, it } from "vitest";
import { friendlyAcceleratorError, retenirLeMeilleur, signatureMaterielle } from "./capacity.js";
import type { AcceleratorProbe } from "@flixtunes/contracts";

function sonde(id: string, framesPerSecond: number | null): AcceleratorProbe {
  return {
    id: id as AcceleratorProbe["id"], label: id, vendor: "intel", encoder: `${id}_enc`,
    compiled: true, usable: framesPerSecond != null, framesPerSecond,
    relativeToSoftware: null, selected: false, error: framesPerSecond == null ? "échec" : null,
  };
}

/**
 * Ce fichier garde deux corrections nées d'un même incident.
 *
 * L'installation d'une révision a déclenché un micro-banc **pendant** que le paquet extrayait deux
 * cents mégaoctets et changeait le propriétaire de tout le partage. VA-API est passé de 471 à 408
 * images/seconde, le budget de 7,5 à 6,5, et le tableau a annoncé une perte de capacité qui n'existait
 * pas. Puis un second banc lancé sur un premier encore en cours a fait tomber la mesure à 280.
 */
describe("robustesse de la mesure de capacité", () => {
  it("garde le meilleur relevé : un banc sous charge sous-estime, il ne surestime jamais", () => {
    const signature = "ffmpeg|vaapi|x64||r61";
    const avant = JSON.stringify({ signature, measuredAt: "2026-08-24T10:00:00.000Z",
      probes: [sonde("vaapi", 471), sonde("software", 151)] });
    const sousCharge = [sonde("vaapi", 408), sonde("software", 89)];

    const retenu = retenirLeMeilleur(avant, signature, sousCharge);
    expect(retenu.find((probe) => probe.id === "vaapi")?.framesPerSecond).toBe(471);
    expect(retenu.find((probe) => probe.id === "software")?.framesPerSecond).toBe(151);
  });

  it("accepte une mesure meilleure que l'ancienne", () => {
    const signature = "s";
    const avant = JSON.stringify({ signature, measuredAt: "x", probes: [sonde("vaapi", 300)] });
    expect(retenirLeMeilleur(avant, signature, [sonde("vaapi", 471)])[0]?.framesPerSecond).toBe(471);
  });

  it("abandonne l'historique quand le matériel ou le moteur change", () => {
    const avant = JSON.stringify({ signature: "ffmpeg-7|vaapi|x64||r60", measuredAt: "x", probes: [sonde("vaapi", 471)] });
    // Moteur différent : la mesure d'hier ne décrit plus la machine d'aujourd'hui.
    expect(retenirLeMeilleur(avant, "ffmpeg-8|vaapi|x64||r60", [sonde("vaapi", 200)])[0]?.framesPerSecond).toBe(200);
  });

  it("survit à une mise à jour de paquet : re-mesurer n'est pas oublier", () => {
    // Le défaut réel : la mesure de r61 a été prise pendant l'installation de r61. La signature
    // complète ayant changé de `|r60` à `|r61`, le meilleur relevé de r60 était jeté avec elle, et le
    // tableau annonçait 396 im/s au lieu de 471 — une perte de capacité qui n'existait pas.
    const avant = JSON.stringify({ signature: "ffmpeg-7|vaapi|x64||r60", measuredAt: "x",
      probes: [sonde("vaapi", 471), sonde("software", 151)] });
    const apresMiseAJour = retenirLeMeilleur(avant, "ffmpeg-7|vaapi|x64||r61", [sonde("vaapi", 396), sonde("software", 120)]);
    expect(apresMiseAJour.find((p) => p.id === "vaapi")?.framesPerSecond).toBe(471);
    expect(apresMiseAJour.find((p) => p.id === "software")?.framesPerSecond).toBe(151);
  });

  it("lit aussi un enregistrement antérieur, dépourvu de signature matérielle", () => {
    const ancienFormat = JSON.stringify({ signature: "ffmpeg-7|vaapi|x64||r60", measuredAt: "x",
      probes: [sonde("vaapi", 471)] });
    expect(retenirLeMeilleur(ancienFormat, "ffmpeg-7|vaapi|x64||r62", [sonde("vaapi", 300)])[0]?.framesPerSecond).toBe(471);
  });

  it("ne ressuscite pas un accélérateur devenu inutilisable", () => {
    const signature = "s";
    const avant = JSON.stringify({ signature, measuredAt: "x", probes: [sonde("vaapi", 471)] });
    const retenu = retenirLeMeilleur(avant, signature, [sonde("vaapi", null)]);
    expect(retenu[0]?.framesPerSecond).toBeNull();
    expect(retenu[0]?.usable).toBe(false);
  });

  it("la signature matérielle ignore la révision, et rien d'autre", () => {
    expect(signatureMaterielle("ffmpeg-7|vaapi+qsv|h264_vaapi|x64|pilote>iHD|r61"))
      .toBe("ffmpeg-7|vaapi+qsv|h264_vaapi|x64|pilote>iHD");
    expect(signatureMaterielle("ffmpeg-7|vaapi|x64||r62"))
      .toBe(signatureMaterielle("ffmpeg-7|vaapi|x64||r60"));
  });

  it("supporte un enregistrement absent ou illisible", () => {
    expect(retenirLeMeilleur(null, "s", [sonde("vaapi", 300)])[0]?.framesPerSecond).toBe(300);
    expect(retenirLeMeilleur("{ceci n'est pas du JSON", "s", [sonde("vaapi", 300)])[0]?.framesPerSecond).toBe(300);
  });
});

describe("franchise du diagnostic", () => {
  it("n'accuse le nœud de rendu que si le message décrit vraiment son absence", () => {
    // « no such file » est intercepté plus haut, par la branche « pilote absent » : on emploie donc
    // une formulation qui atteint réellement la branche du nœud de rendu.
    expect(friendlyAcceleratorError("Failed to initialise VAAPI connection: /dev/dri/renderD128 does not exist"))
      .toBe("Le nœud de rendu /dev/dri n'est pas visible depuis le service.");
  });

  it("n'accuse pas le nœud de rendu quand la session s'ouvre et que le filtre échoue", () => {
    // Le cas réel : l'encodeur VA-API tournait à 408 im/s dans le même processus, et le tone mapping
    // était annoncé « nœud non visible ». Le diagnostic envoyait vérifier des droits corrects.
    const message = "[vf#0:0 @ 0x55] Error reinitializing filters! /dev/dri/renderD128 "
      + "Task finished with error code: -22 (Invalid argument)";
    expect(friendlyAcceleratorError(message))
      .not.toBe("Le nœud de rendu /dev/dri n'est pas visible depuis le service.");
  });

  it("nomme la bibliothèque manquante plutôt qu'un matériel absent", () => {
    expect(friendlyAcceleratorError("[AVHWDeviceContext] Unable to open the libvulkan library!"))
      .toContain("Vulkan");
    expect(friendlyAcceleratorError("Failed to get number of OpenCL platforms: -1001"))
      .toContain("OpenCL");
  });

  /**
   * Le refus du HDR par le circuit vidéo a son propre message.
   *
   * Relevé mot pour mot sur un Celeron N5105 — GPU de onzième génération — après trois semaines
   * passées à croire à un défaut de droits ou de pilote. Intel n'expose la conversion HDR de son
   * moteur vidéo qu'à partir de la douzième génération : le libellé doit le dire, faute de quoi on
   * cherche un réglage qui n'existe pas.
   */
  it("distingue « ce matériel ne sait pas » de « ce matériel est absent »", () => {
    const refus = friendlyAcceleratorError("[Parsed_tonemap_vaapi_2 @ 0x7fe6] VAAPI driver doesn't support HDR");
    expect(refus).toContain("12");
    expect(refus).not.toContain("absent");

    // Le message générique reste pour ce qui l'est vraiment.
    expect(friendlyAcceleratorError("Unable to open the libvulkan library!")).toContain("Vulkan");
    expect(friendlyAcceleratorError("failed to open /dev/dri/renderD128: No such file or directory"))
      .toContain("rendu");
  });
});
