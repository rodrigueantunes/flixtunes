import { createContext, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ContenuDiffuse } from "@flixtunes/contracts";

import { installerSurfaceDiffusion, type SurfaceDiffusion } from "./diffusion-surface";
export { surfaceDiffusion } from "./diffusion-surface";
export type { SurfaceDiffusion } from "./diffusion-surface";
/** Adaptateur passif : aucune action sur le lecteur tant qu'une commande n'a pas été demandée. */
export function useSurfaceDiffusion(adaptateur: SurfaceDiffusion) {
  const ref = useRef(adaptateur); ref.current = adaptateur;
  useEffect(() => installerSurfaceDiffusion(ref), []);
}
export type Catalogue = { profil: string; charger: (contenu: ContenuDiffuse) => Promise<void> | void };
const Contexte = createContext<{ ouvrir: () => void; inscrire: (catalogue: Catalogue | null) => void } | null>(null);
export function useCatalogueDiffusion(profil: string | null, charger: Catalogue["charger"]) {
  const contexte = useContext(Contexte), callback = useRef(charger); callback.current = charger;
  const inscrire = contexte?.inscrire;
  useEffect(() => { inscrire?.(profil ? { profil, charger: (c) => callback.current(c) } : null); return () => inscrire?.(null); }, [profil, inscrire]);
}
export function BoutonDiffusion() {
  const contexte = useContext(Contexte);
  return <button type="button" className="cast-button" onClick={() => contexte?.ouvrir()} aria-label="Caster ou piloter un appareil" title="Caster / Télécommande">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 8V5h18v14h-7M3 12a9 9 0 0 1 9 9M3 16a5 5 0 0 1 5 5"/><circle cx="3" cy="21" r="1" fill="currentColor"/></svg>
  </button>;
}
const PanneauDiffusion = lazy(() => import("./PanneauDiffusion"));

export function CentreDiffusion({ children }: { children: ReactNode }) {
  const [catalogue, inscrire] = useState<Catalogue | null>(null), [ouvert, setOuvert] = useState(false);
  const [dejaOuvert, setDejaOuvert] = useState(false);
  const monId = useRef<string | null>(null);
  const catalogueRef = useRef(catalogue); catalogueRef.current = catalogue;
  useEffect(() => {
    if (!catalogue) return;
    let abandon = false, fermer: (() => void) | undefined;
    void import("./recepteur-diffusion").then(({ connecterRecepteur }) => {
      if (!abandon) fermer = connecterRecepteur(catalogue, () => catalogueRef.current, monId);
    });
    return () => { abandon = true; fermer?.(); };
  }, [catalogue?.profil]);
  useEffect(() => { setOuvert(false); setDejaOuvert(false); }, [catalogue?.profil]);
  return <Contexte.Provider value={{ ouvrir: () => { setDejaOuvert(true); setOuvert(true); }, inscrire }}>
    {children}
    {dejaOuvert && catalogue && <Suspense fallback={null}><PanneauDiffusion catalogue={catalogue} monId={monId} ouvert={ouvert} fermerPanneau={() => setOuvert(false)} /></Suspense>}
  </Contexte.Provider>;
}
