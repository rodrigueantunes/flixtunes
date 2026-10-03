import { z } from "zod";

export const contenuDiffuseSchema = z.object({
  genre: z.enum(["media", "direct"]), id: z.string().min(1).max(200),
  titre: z.string().max(240).default("FlixTunes"),
});
export type ContenuDiffuse = z.infer<typeof contenuDiffuseSchema>;
export const commandeDiffusionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("charger"), contenu: contenuDiffuseSchema, position: z.number().finite().min(0).max(604800).default(0),
    /** Hors de chez soi, la source n'est copiée qu'à débit raisonnable, sauf demande de la qualité maximale. */
    qualite: z.enum(["auto", "maximale"]).optional() }),
  z.object({ type: z.literal("pause") }), z.object({ type: z.literal("reprendre") }),
  z.object({ type: z.literal("arreter") }),
  /** Ferme l'application Cast du téléviseur, même sans diffusion connue : il revient à son écran. */
  z.object({ type: z.literal("reinitialiser") }),
  z.object({ type: z.literal("position"), valeur: z.number().finite().min(0).max(604800) }),
  z.object({ type: z.literal("volume"), valeur: z.number().finite().min(0).max(1) }),
]);
export type CommandeDiffusion = z.infer<typeof commandeDiffusionSchema>;
export const etatDiffusionSchema = z.object({
  contenu: contenuDiffuseSchema.nullable().default(null),
  lecture: z.enum(["repos", "chargement", "lecture", "pause", "erreur"]).default("repos"),
  position: z.number().finite().min(0).max(604800).default(0),
  duree: z.number().finite().min(0).max(604800).default(0),
  volume: z.number().finite().min(0).max(1).default(1),
  navigation: z.boolean().default(false),
  qualite: z.string().max(160).optional(),
  erreur: z.string().max(300).nullable().default(null),
  /** Pendant le chargement : ce que le serveur est en train de faire. */
  etape: z.enum(["connexion", "sonde", "preparation", "demarrage"]).optional(),
  /** Pourquoi la lecture est au repos : fin du média, arrêt demandé, ou récepteur pris par une autre application. */
  motifRepos: z.enum(["fin", "arret", "tiers"]).optional(),
});
export type EtatDiffusion = z.infer<typeof etatDiffusionSchema>;
export interface CibleDiffusion {
  id: string; nom: string; protocole: "flixtunes" | "googlecast" | "dlna";
  etat: EtatDiffusion | null; occupe: boolean;
  /** Le modèle annoncé par le récepteur, quand il le dit (« Pixel Tablet », « Chromecast »). */
  modele?: string;
  /** Le profil qui a lancé la diffusion en cours : tous les appareils la voient, et peuvent la piloter. */
  proprietaire?: string;
  /** Un téléviseur vu par un téléphone ou un navigateur hors de chez soi, que le NAS pilote à travers lui. */
  relais?: boolean;
}
export interface OrdreDiffusion { id: string; commande: CommandeDiffusion }
/** Ce que le téléviseur affiche : affiche, titre, épisode ou chaîne. */
export interface MetadonneesRelais {
  genre: "film" | "episode" | "video" | "direct"; titre: string; sousTitre?: string;
  serie?: string; saison?: number; episode?: number; annee?: number; image?: string;
}
/**
 * Ce qu'un relais exécute sur le téléviseur qu'il voit, avec le SDK Cast. Le NAS garde la décision :
 * qualité, préparation, replis ; le relais ne fait que transmettre et rendre compte.
 */
export type ActionRelais =
  | { type: "verifier" }
  | { type: "sonder"; url: string; mime: string; fmp4: boolean }
  | { type: "charger"; url: string; mime: string; direct: boolean; position: number; fmp4: boolean; metadonnees: MetadonneesRelais }
  | { type: "commande"; commande: { type: "pause" | "reprendre" | "arreter" } | { type: "position" | "volume"; valeur: number } }
  | { type: "liberer" };
export interface OrdreRelais { id: string; relais: ActionRelais }
export interface AccuseDiffusion {
  id: string; ok: boolean; erreur?: string;
  /** Pour un relais : le code d'erreur Cast (`CAST_LOAD_FAILED`…), qui décide du repli. */
  code?: string;
  /** Pour une sonde relayée : ce que le téléviseur a fait du clip. */
  verdict?: "accepte" | "refuse" | "inconnu";
}
export const etatDiffusionVide = (): EtatDiffusion => etatDiffusionSchema.parse({});
