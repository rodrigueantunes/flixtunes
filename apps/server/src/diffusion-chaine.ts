import { config } from "./config.js";

/**
 * La chaîne de conversion matérielle de la diffusion : décodage et réduction par le circuit vidéo,
 * tone mapping sur l'image déjà réduite, encodage `h264_vaapi`.
 *
 * Elle répond à une mesure du 2 octobre 2026 sur le NAS de référence (Celeron N5105) : un film HEVC
 * 4K HDR10 converti en 1080p pour un téléviseur sortait à 0,33 fois le temps réel. L'encodeur
 * matériel n'y était pour rien : le processeur décodait du HEVC 10 bits en 4K, puis convertissait les
 * couleurs de chaque image en 4K avant de la réduire. Le récepteur recevait ses premiers segments, puis
 * attendait les suivants sans fin.
 *
 * Ces définitions servent à la fois au micro-banc qui qualifie la chaîne sur la machine et à la
 * conversion réelle : mesurer autre chose que ce qui sera exécuté ne qualifierait rien.
 */

/** `tonemapx` avec une sortie NV12, prête à remonter vers le circuit vidéo. */
export const TONEMAPX_NV12 = "tonemapx=tonemap=bt2390:desat=0:t=bt709:m=bt709:p=bt709:r=tv:format=nv12";

/**
 * Un seul périphérique VA-API, partagé par le décodeur, les filtres et l'encodeur.
 *
 * `-vaapi_device` en créerait un second sur le même nœud : c'est précisément ce qui avait bloqué une
 * conversion 1080p sur le NAS, et fait retirer le décodage matériel d'un précédent chemin.
 */
export function entreeDecodageMateriel(peripherique = config.hardwareDevice): string[] {
  return ["-init_hw_device", `vaapi=flixva:${peripherique}`, "-filter_hw_device", "flixva",
    "-hwaccel", "vaapi", "-hwaccel_device", "flixva", "-hwaccel_output_format", "vaapi"];
}

/** Les filtres entre le décodeur matériel et `h264_vaapi`. */
export function filtresDecodageMateriel(largeur: number, hauteur: number, hdr: boolean): string[] {
  return hdr
    ? [`scale_vaapi=w=${largeur}:h=${hauteur}:format=p010`, "hwdownload", "format=p010le", TONEMAPX_NV12, "hwupload"]
    : [`scale_vaapi=w=${largeur}:h=${hauteur}:format=nv12`];
}

/**
 * Les dimensions de sortie, calculées ici plutôt que confiées au filtre : l'image tient dans la boîte
 * en gardant ses proportions, n'est jamais agrandie, et garde des dimensions paires.
 */
export function dimensionsCible(largeurSource: number, hauteurSource: number, largeurMax: number, hauteurMax: number): { largeur: number; hauteur: number } {
  const echelle = Math.min(1, largeurMax / Math.max(1, largeurSource), hauteurMax / Math.max(1, hauteurSource));
  const pair = (valeur: number) => Math.max(2, 2 * Math.round(valeur / 2));
  return { largeur: pair(largeurSource * echelle), hauteur: pair(hauteurSource * echelle) };
}

/** Les sources que le décodeur matériel visé sait lire : HEVC 8 ou 10 bits, H.264 8 bits. */
export function sourceDecodableMateriellement(codec: string | null | undefined, profondeur: number | null | undefined): boolean {
  const bits = profondeur ?? 8;
  if (codec === "hevc") return bits <= 10;
  if (codec === "h264") return bits <= 8;
  return false;
}
