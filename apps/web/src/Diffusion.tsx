import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CibleDiffusion, CommandeDiffusion, ContenuDiffuse } from "@flixtunes/contracts";
import { api } from "./api";

import { installerSurfaceDiffusion, surfaceDiffusion, type SurfaceDiffusion } from "./diffusion-surface";
import { diffusionActive } from "./diffusion-utilitaires";
export { surfaceDiffusion } from "./diffusion-surface";
export type { SurfaceDiffusion } from "./diffusion-surface";
/** Adaptateur passif : aucune action sur le lecteur tant qu'une commande n'a pas été demandée. */
export function useSurfaceDiffusion(adaptateur: SurfaceDiffusion) {
  const ref = useRef(adaptateur); ref.current = adaptateur;
  useEffect(() => installerSurfaceDiffusion(ref), []);
}
export type Catalogue = { profil: string; charger: (contenu: ContenuDiffuse) => Promise<void> | void };
/** Un transfert lancé depuis ce client : le lecteur local ne se met en pause qu'à la lecture confirmée. */
export type Transfert = { cible: string; contenu: string; surface: ReturnType<typeof surfaceDiffusion> };
export interface ContexteDiffusion {
  ouvrir: () => void;
  inscrire: (catalogue: Catalogue | null) => void;
  /** Les cibles du profil, tenues à jour par un seul suivi pour tout le client. */
  cibles: CibleDiffusion[];
  /** La diffusion en cours de ce profil, s'il y en a une. */
  active: CibleDiffusion | null;
  commander: (id: string, c: CommandeDiffusion) => Promise<void>;
  attendreTransfert: (transfert: Transfert) => void;
  profil: string | null;
}
const Contexte = createContext<ContexteDiffusion | null>(null);
export const useDiffusion = () => useContext(Contexte);
export function useCatalogueDiffusion(profil: string | null, charger: Catalogue["charger"]) {
  const contexte = useContext(Contexte), callback = useRef(charger); callback.current = charger;
  const inscrire = contexte?.inscrire;
  useEffect(() => { inscrire?.(profil ? { profil, charger: (c) => callback.current(c) } : null); return () => inscrire?.(null); }, [profil, inscrire]);
}
export function BoutonDiffusion() {
  const contexte = useContext(Contexte), active = contexte?.active;
  const libelle = active ? `Diffusion en cours sur ${active.nom} — piloter` : "Caster ou piloter un appareil";
  return <button type="button" className={`cast-button${active ? " actif" : ""}`} onClick={() => contexte?.ouvrir()} aria-label={libelle} title={active ? `Diffusion sur ${active.nom}` : "Caster / Télécommande"}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 8V5h18v14h-7M3 12a9 9 0 0 1 9 9M3 16a5 5 0 0 1 5 5"/><circle cx="3" cy="21" r="1" fill="currentColor"/>{active && <path d="M7 9h10v6h-3" strokeWidth="2.6"/>}</svg>
  </button>;
}
const PanneauDiffusion = lazy(() => import("./PanneauDiffusion"));
const MiniTelecommande = lazy(() => import("./TelecommandeDiffusion").then((m) => ({ default: m.MiniTelecommande })));
const TelecommandeLecteur = lazy(() => import("./TelecommandeDiffusion").then((m) => ({ default: m.TelecommandeLecteur })));

/**
 * Le lecteur devient la télécommande du récepteur qui diffuse son contenu : lecture, pause,
 * position et volume pilotent le téléviseur, et « Reprendre ici » ramène la lecture sur cet appareil.
 */
export function RelaisDiffusion({ contenu, onReprendreIci }: { contenu: string; onReprendreIci: (position: number) => void }) {
  const contexte = useContext(Contexte), active = contexte?.active;
  if (!contexte || !active || active.etat?.contenu?.id !== contenu) return null;
  return <Suspense fallback={null}><TelecommandeLecteur cible={active} contexte={contexte} onReprendreIci={onReprendreIci} /></Suspense>;
}

export function CentreDiffusion({ children }: { children: ReactNode }) {
  const [catalogue, inscrire] = useState<Catalogue | null>(null), [ouvert, setOuvert] = useState(false);
  const [dejaOuvert, setDejaOuvert] = useState(false);
  const [cibles, setCibles] = useState<CibleDiffusion[]>([]);
  const monId = useRef<string | null>(null);
  const catalogueRef = useRef(catalogue); catalogueRef.current = catalogue;
  const transfert = useRef<Transfert | null>(null);
  const ouvertRef = useRef(ouvert); ouvertRef.current = ouvert;
  const activeRef = useRef<CibleDiffusion | null>(null);
  const relancer = useRef<() => void>(() => {});
  useEffect(() => {
    if (!catalogue) return;
    let abandon = false, fermer: (() => void) | undefined;
    void import("./recepteur-diffusion").then(({ connecterRecepteur }) => {
      if (!abandon) fermer = connecterRecepteur(catalogue, () => catalogueRef.current, monId);
    });
    return () => { abandon = true; fermer?.(); };
  }, [catalogue?.profil]);
  useEffect(() => { setOuvert(false); setDejaOuvert(false); setCibles([]); transfert.current = null; }, [catalogue?.profil]);
  // Un seul suivi des cibles pour tout le client, chargé après le premier affichage.
  useEffect(() => {
    if (!catalogue) return;
    let abandon = false, suivi: { relancer: () => void; arreter: () => void } | undefined;
    void import("./suivi-diffusion").then(({ suivreLesCibles }) => {
      if (abandon) return;
      suivi = suivreLesCibles(catalogue.profil, { monId: () => monId.current, transfert,
        rapide: () => ouvertRef.current || !!activeRef.current || !!transfert.current, publier: setCibles });
      relancer.current = suivi.relancer;
    });
    return () => { abandon = true; suivi?.arreter(); relancer.current = () => {}; };
  }, [catalogue?.profil]);
  const active = useMemo(() => diffusionActive(cibles), [cibles]);
  activeRef.current = active;
  const commander = useCallback(async (id: string, c: CommandeDiffusion) => {
    const profil = catalogueRef.current?.profil; if (!profil) return;
    await api.diffusion(profil, `cibles/${encodeURIComponent(id)}/commande`, c);
    relancer.current();
  }, []);
  const attendreTransfert = useCallback((t: Transfert) => { transfert.current = t; relancer.current(); }, []);
  const ouvrir = useCallback(() => { setDejaOuvert(true); setOuvert(true); relancer.current(); }, []);
  const valeur = useMemo<ContexteDiffusion>(() => ({ ouvrir, inscrire, cibles, active, commander, attendreTransfert, profil: catalogue?.profil ?? null }),
    [ouvrir, cibles, active, commander, attendreTransfert, catalogue?.profil]);
  // La mini-télécommande laisse la place au lecteur qui affiche déjà ce contenu, et au panneau.
  const surface = surfaceDiffusion();
  const lecteurSurLeContenu = !!active && surface?.current.etat().contenu?.id === active.etat?.contenu?.id;
  return <Contexte.Provider value={valeur}>
    {children}
    {active && catalogue && !ouvert && !lecteurSurLeContenu && <Suspense fallback={null}><MiniTelecommande cible={active} contexte={valeur} /></Suspense>}
    {dejaOuvert && catalogue && <Suspense fallback={null}><PanneauDiffusion catalogue={catalogue} monId={monId} ouvert={ouvert} fermerPanneau={() => setOuvert(false)} /></Suspense>}
  </Contexte.Provider>;
}
