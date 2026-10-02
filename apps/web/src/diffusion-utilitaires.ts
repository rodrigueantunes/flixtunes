import type { EtatDiffusion } from "@flixtunes/contracts";
import { surfaceDiffusion } from "./diffusion-surface";

let transferee: ReturnType<typeof surfaceDiffusion> = null;
let transfertA = 0;
export const marquerTransfert = (s: typeof transferee) => { transferee = s; transfertA = Date.now(); };
export function progressionLocaleSuspendue(): boolean {
  const surface = surfaceDiffusion();
  if (!surface || !transferee || transferee !== surface) return false;
  if (Date.now() - transfertA > 2000 && surface.current.etat().lecture === "lecture") { transferee = null; return false; }
  return true;
}

export const etatDiffusionVide = (): EtatDiffusion => ({ contenu: null, lecture: "repos", position: 0, duree: 0, volume: 1, navigation: false, erreur: null });
export const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const message = (e: unknown) => e instanceof Error ? e.message : "Appareil indisponible";
