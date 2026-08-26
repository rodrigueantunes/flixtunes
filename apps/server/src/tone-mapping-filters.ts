import type { ToneMappingBackend } from "@flixtunes/contracts";

import { config } from "./config.js";

/**
 * Les filtres de conversion HDR vers SDR, un jeu par chemin.
 *
 * Ils vivaient dans `playback.ts`, qui construit la commande de conversion. Le calibrage a besoin des
 * mêmes : mesurer un chemin en réécrivant ses filtres reviendrait à mesurer autre chose que ce qui
 * sera exécuté, et l'écart passerait inaperçu jusqu'à ce qu'un chemin déclaré rapide se révèle lent
 * à l'usage. Les sortir ici donne une définition unique aux deux.
 *
 * `capacity.ts` ne peut pas les prendre dans `playback.ts` : celui-ci l'importe déjà, et le cycle
 * rendrait l'ordre d'initialisation dépendant de qui est chargé en premier.
 */

/** Le périphérique à ouvrir avant les filtres, pour les chemins qui en demandent un. */
export function toneMappingInputArgs(backend: ToneMappingBackend): string[] {
  if (backend === "libplacebo") return ["-init_hw_device", "vulkan=flixvk", "-filter_hw_device", "flixvk"];
  if (backend === "vaapi") return ["-init_hw_device", `vaapi=flixva:${config.hardwareDevice}`, "-filter_hw_device", "flixva"];
  if (backend === "opencl") return ["-init_hw_device", "opencl=flixcl", "-filter_hw_device", "flixcl"];
  return [];
}

export function toneMappingFilters(backend: ToneMappingBackend, sourcePeakNits: number, targetPeakNits = 100): string[] {
  // Le filtre `tonemap` raisonne en multiples du blanc de référence : 1000 nits sur un écran 100 nits valent 10.
  const relativePeak = Math.max(1, Math.round((sourcePeakNits / Math.max(50, targetPeakNits)) * 100) / 100);
  switch (backend) {
    case "libplacebo":
      return ["libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p"];
    case "vaapi":
      return ["format=p010", "hwupload", "tonemap_vaapi=format=nv12:matrix=bt709:primaries=bt709:transfer=bt709", "hwdownload", "format=nv12"];
    case "opencl":
      return ["format=p010", "hwupload",
        `tonemap_opencl=tonemap=bt2390:transfer=bt709:matrix=bt709:primaries=bt709:range=tv:format=nv12:peak=${relativePeak}`,
        "hwdownload", "format=nv12"];
    case "zscale":
      // npl=100 ramène le blanc de référence à 1,0. Toute autre valeur assombrit l'image d'un facteur npl/100.
      return ["zscale=transfer=linear:npl=100", "format=gbrpf32le", "zscale=primaries=bt709",
        `tonemap=hable:desat=0:peak=${relativePeak}`, "zscale=transfer=bt709:matrix=bt709:range=tv", "format=yuv420p"];
    case "software":
      return ["format=gbrpf32le", `tonemap=hable:desat=0:peak=${relativePeak}`, "format=yuv420p"];
    default:
      return [];
  }
}
