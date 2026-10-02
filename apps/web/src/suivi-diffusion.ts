import type { CibleDiffusion } from "@flixtunes/contracts";
import { api } from "./api";
import { surfaceDiffusion } from "./diffusion-surface";
import { marquerTransfert } from "./diffusion-utilitaires";
import type { Transfert } from "./Diffusion";

/**
 * La boucle qui suit les cibles du profil, chargée après le premier affichage : l'accueil n'en a pas
 * besoin pour se dessiner, seulement pour dire ensuite qu'une diffusion est en cours.
 *
 * Plus serrée quand une diffusion est en cours ou que le panneau est ouvert, au repos sinon, et
 * suspendue quand la page est cachée. Le lecteur local ne se met en pause qu'à la lecture confirmée.
 */
export function suivreLesCibles(profil: string, options: {
  monId: () => string | null; transfert: { current: Transfert | null };
  rapide: () => boolean; publier: (cibles: CibleDiffusion[]) => void;
}): { relancer: () => void; arreter: () => void } {
  let abandon = false, minuteur: ReturnType<typeof setTimeout> | undefined;
  const tour = async () => {
    clearTimeout(minuteur);
    if (abandon) return;
    if (typeof document === "undefined" || document.visibilityState !== "hidden") {
      try {
        const r = await api.diffusion<{ cibles: CibleDiffusion[] }>(profil, "cibles");
        if (abandon) return;
        const liste = r.cibles.filter((c) => c.id !== options.monId());
        options.publier(liste);
        const t = options.transfert.current, cible = t && liste.find((c) => c.id === t.cible);
        if (t && cible?.etat?.contenu?.id === t.contenu && cible.etat.lecture === "lecture") {
          options.transfert.current = null;
          if (t.surface && t.surface === surfaceDiffusion()) { marquerTransfert(t.surface); void t.surface.current.commander({ type: "pause" }); }
        } else if (t && (!cible || cible.etat?.lecture === "erreur")) {
          // Échec ou récepteur disparu : la lecture locale continue, le panneau montre l'erreur.
          options.transfert.current = null;
        }
      } catch { /* Serveur momentanément injoignable : le prochain tour réessaiera. */ }
    }
    if (!abandon) minuteur = setTimeout(() => { void tour(); }, options.rapide() ? 1500 : 5000);
  };
  const visible = () => { if (document.visibilityState === "visible") void tour(); };
  document.addEventListener("visibilitychange", visible);
  void tour();
  return {
    relancer: () => { void tour(); },
    arreter: () => { abandon = true; clearTimeout(minuteur); document.removeEventListener("visibilitychange", visible); },
  };
}
