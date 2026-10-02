import type { CibleDiffusion, EtatDiffusion } from "@flixtunes/contracts";
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

/** La diffusion en cours de ce profil : en préparation, en lecture ou en pause, sur un appareil libre. */
export function diffusionActive(cibles: CibleDiffusion[]): CibleDiffusion | null {
  return cibles.find((c) => !c.occupe && c.protocole !== "flixtunes" && c.etat?.contenu && ["chargement", "lecture", "pause"].includes(c.etat.lecture))
    ?? null;
}

export function libelleProtocole(c: CibleDiffusion): string {
  const protocole = c.protocole === "googlecast" ? "Google Cast" : c.protocole === "dlna" ? "DLNA" : "Lecteur FlixTunes";
  return c.modele && c.modele !== c.nom ? `${protocole} · ${c.modele}` : protocole;
}

/** Ce qui se passe, dit à la personne : l'étape de la préparation, puis l'état de la lecture. */
export function libelleEtat(etat: EtatDiffusion, nom: string): string {
  if (etat.lecture === "chargement") {
    switch (etat.etape) {
      case "connexion": return `Connexion à ${nom}…`;
      case "sonde": return `Vérification des formats que lit ${nom}…`;
      case "preparation": return `Préparation de la vidéo${etat.qualite ? ` · ${etat.qualite}` : ""}…`;
      case "demarrage": return `Démarrage sur ${nom}…`;
      default: return `Chargement sur ${nom}…`;
    }
  }
  if (etat.lecture === "lecture") return `Lecture sur ${nom}`;
  if (etat.lecture === "pause") return `En pause sur ${nom}`;
  if (etat.lecture === "erreur") return etat.erreur ?? `La lecture sur ${nom} a échoué`;
  if (etat.motifRepos === "fin") return "Lecture terminée";
  if (etat.motifRepos === "tiers") return `${nom} a été repris par une autre application`;
  return "Aucune lecture en cours";
}

export function duree(secondes: number): string {
  const s = Math.max(0, Math.floor(secondes)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
