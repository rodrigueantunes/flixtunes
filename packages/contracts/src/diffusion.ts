import { z } from "zod";

export const contenuDiffuseSchema = z.object({
  genre: z.enum(["media", "direct"]), id: z.string().min(1).max(200),
  titre: z.string().max(240).default("FlixTunes"),
});
export type ContenuDiffuse = z.infer<typeof contenuDiffuseSchema>;
export const commandeDiffusionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("charger"), contenu: contenuDiffuseSchema, position: z.number().finite().min(0).max(604800).default(0) }),
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
}
export interface OrdreDiffusion { id: string; commande: CommandeDiffusion }
export interface AccuseDiffusion { id: string; ok: boolean; erreur?: string }
export const etatDiffusionVide = (): EtatDiffusion => etatDiffusionSchema.parse({});
