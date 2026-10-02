import type { CommandeDiffusion, EtatDiffusion } from "@flixtunes/contracts";

export interface SurfaceDiffusion {
  etat(): EtatDiffusion;
  commander(c: Exclude<CommandeDiffusion, { type: "charger" }>): Promise<void> | void;
}
let surface: { current: SurfaceDiffusion } | null = null;
export const surfaceDiffusion = () => surface;
/** État passif sans dépendance React : les modules différés ne réimportent pas leur parent. */
export function installerSurfaceDiffusion(ref: { current: SurfaceDiffusion }) {
  surface = ref;
  return () => { if (surface === ref) surface = null; };
}
