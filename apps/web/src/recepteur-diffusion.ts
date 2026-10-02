import type { RefObject } from "react";
import type { AccuseDiffusion, OrdreDiffusion } from "@flixtunes/contracts";
import { api } from "./api";
import { pontBureau } from "./bureau";
import type { Catalogue } from "./Diffusion";
import { surfaceDiffusion } from "./diffusion-surface";
import { attendre, message, etatDiffusionVide } from "./diffusion-utilitaires";
export function connecterRecepteur(catalogue: Catalogue, catalogueRef: () => Catalogue | null, monId: RefObject<string | null>): () => void {
 let abandon = false, inscription: { id: string; cle: string } | null = null;
    let accuses: AccuseDiffusion[] = [];
    const boucle = async () => {
      while (!abandon) {
        try {
          if (!inscription) {
            inscription = await api.diffusion<{ id: string; cle: string }>(catalogue.profil, "lecteurs", { nom: pontBureau() ? "FlixTunes Bureau" : "FlixTunes Web" });
            if (abandon) return;
            monId.current = inscription.id;
          }
          const etat = surfaceDiffusion()?.current.etat() ?? etatDiffusionVide();
          const r: { ordres: OrdreDiffusion[] } = await api.diffusion(catalogue.profil, `lecteurs/${inscription.id}`, { cle: inscription.cle, etat, accuses });
          if (abandon) return;
          accuses = [];
          for (const ordre of r.ordres) {
            if (abandon) break;
            try {
              if (ordre.commande.type === "charger") {
                const commande = ordre.commande; await catalogueRef()?.charger(commande.contenu);
                const limite = Date.now() + 20_000;
                while (!abandon && Date.now() < limite && (surfaceDiffusion()?.current.etat().contenu?.id !== commande.contenu.id || surfaceDiffusion()!.current.etat().lecture !== "lecture")) await attendre(250);
                if (abandon || surfaceDiffusion()?.current.etat().contenu?.id !== commande.contenu.id || surfaceDiffusion()!.current.etat().lecture !== "lecture") throw new Error("Le contenu n’a pas démarré sur le lecteur");
                if (commande.contenu.genre === "media" && commande.position > 0) await surfaceDiffusion()!.current.commander({ type: "position", valeur: commande.position });
              } else {
                if (!surfaceDiffusion()) throw new Error("Aucune lecture en cours"); await surfaceDiffusion()!.current.commander(ordre.commande);
              }
              accuses.push({ id: ordre.id, ok: true });
            } catch (e) { accuses.push({ id: ordre.id, ok: false, erreur: message(e).slice(0, 300) }); }
          }
        } catch { inscription = null; }
        if (!abandon) await attendre(2000);
      }
    };
    void boucle(); return () => { abandon = true; monId.current = null; };


}
