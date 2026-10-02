import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyReply } from "fastify";
import { getSetting, setSetting } from "./database.js";

/**
 * Ce qu'un récepteur Google Cast sait lire, appris en moins de trois secondes et retenu.
 *
 * Banc matériel du 2 octobre 2026 sur la Pixel Tablet : un HLS H.264 1080p est refusé dès son premier
 * segment, qu'il soit en TS ou en fMP4, en profil High ou Main, mire ou film. Le même flux en 720p est
 * lu, et un MP4 1080p en lecture directe aussi. La r6 essayait donc à l'aveugle une qualité que ce
 * récepteur ne lira jamais, en payant une conversion complète à chaque niveau.
 *
 * Trois clips noirs et muets de deux secondes, embarqués dans le paquet, répondent à la question avant
 * toute conversion : le récepteur refuse en 0,4 à 0,6 s ce qu'il ne sait pas lire, et commence à lire
 * ce qu'il accepte. Le verdict est conservé par récepteur.
 */
// Du plus exigeant au plus simple : un récepteur qui lit le HEVC 4K HDR10 lit le reste, et sa sonde
// s'arrête là. Les téléviseurs lents — 13 s pour trois clips sur un Philips de 2019 — y gagnent.
export const SONDES = {
  hevc_2160_hdr10: { dossier: "hevc-2160-hdr10", mime: "application/vnd.apple.mpegurl", fmp4: true },
  h264_1080: { dossier: "h264-1080", mime: "application/vnd.apple.mpegurl", fmp4: false },
  hevc_1080: { dossier: "hevc-1080", mime: "application/vnd.apple.mpegurl", fmp4: true },
} as const;
export type NomSonde = keyof typeof SONDES;
export type Verdict = "accepte" | "refuse" | "inconnu";

export interface CapacitesRecepteur {
  h264_1080?: boolean;
  hevc_1080?: boolean;
  hevc_2160_hdr10?: boolean;
  verifieLe?: number;
  modele?: string;
}

const CLE = "diffusion.capacites";
/** Un récepteur se met à jour : son verdict est refait au bout d'un mois. */
const VALIDITE_MS = 30 * 24 * 3600_000;
const racineSondes = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/sonde-cast");

function toutes(): Record<string, CapacitesRecepteur> {
  try { const brut = getSetting(CLE); return brut ? JSON.parse(brut) as Record<string, CapacitesRecepteur> : {}; }
  catch { return {}; }
}

/** Les capacités connues d'un récepteur, ou `null` s'il faut le sonder. */
export function capacitesConnues(id: string, modele?: string, maintenant = Date.now()): CapacitesRecepteur | null {
  const c = toutes()[id];
  if (!c?.verifieLe || maintenant - c.verifieLe > VALIDITE_MS) return null;
  if (modele && c.modele && c.modele !== modele) return null;
  return c;
}

/** Retient ce qui a été observé, par la sonde ou par un vrai essai. Un vrai essai corrige la sonde. */
export function retenirCapacites(id: string, observe: Partial<CapacitesRecepteur>, maintenant = Date.now()): CapacitesRecepteur {
  const tout = toutes();
  const fusion: CapacitesRecepteur = { ...tout[id], ...Object.fromEntries(Object.entries(observe).filter(([, v]) => v !== undefined)), verifieLe: maintenant };
  tout[id] = fusion;
  // Le registre reste petit : les récepteurs les plus anciennement vus partent d'abord.
  const ids = Object.keys(tout).sort((a, b) => (tout[b]!.verifieLe ?? 0) - (tout[a]!.verifieLe ?? 0)).slice(0, 64);
  try { setSetting(CLE, JSON.stringify(Object.fromEntries(ids.map((cle) => [cle, tout[cle]])))); } catch { /* verdict non persisté */ }
  return fusion;
}

export function oublierCapacites(id: string) {
  const tout = toutes(); delete tout[id];
  try { setSetting(CLE, JSON.stringify(tout)); } catch { /* rien à oublier */ }
}

/** Quand chaque segment de sonde a été demandé pour la dernière fois. */
const segmentsDemandes = new Map<string, number>();
/**
 * Un refus ne compte que si le récepteur a téléchargé le segment. Un récepteur qui ne joint pas le
 * NAS refuse aussi tous les clips : le retenir comme « ne lit rien » le condamnerait pour un mois.
 */
export function segmentDemande(dossier: string, depuis: number): boolean {
  return (segmentsDemandes.get(dossier) ?? 0) >= depuis;
}

/** Les clips sont publics et sans valeur : servis sans session, comme un fichier statique, au réseau local seulement. */
export async function servirSonde(dossier: string, fichier: string, reply: FastifyReply) {
  const connu = Object.values(SONDES).some((s) => s.dossier === dossier);
  if (!connu || !/^(index\.m3u8|init\.mp4|s\d\.(?:ts|m4s))$/.test(fichier)) return reply.code(404).send();
  if (/^s\d/.test(fichier)) segmentsDemandes.set(dossier, Date.now());
  try {
    const contenu = await readFile(path.join(racineSondes, dossier, fichier));
    const type = fichier.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : fichier.endsWith(".ts") ? "video/mp2t" : "video/mp4";
    return reply.header("Access-Control-Allow-Origin", "*").header("Cache-Control", "no-store").type(type).send(contenu);
  } catch { return reply.code(404).send(); }
}

export interface SourceVideo { codec: string | null; hauteur: number; hdr: boolean; mp4Direct: boolean }

/**
 * Un niveau de qualité à essayer. `source` copie la vidéo telle quelle ; les autres la convertissent
 * en H.264 SDR, jamais au-delà de `hauteurMax`.
 */
export interface NiveauDiffusion {
  nom: "source" | "conversion" | "compatible";
  qualiteSource: boolean;
  compatible: boolean;
  hauteurMax: number;
  /** Pour la copie : jusqu'où le récepteur accepte le HEVC, et s'il accepte le HDR. */
  hevcHauteurMax?: number;
  hdr?: boolean;
  /** Le fichier d'origine servi tel quel, pour un téléviseur DLNA qui lit son conteneur. */
  fichierTelQuel?: boolean;
}

/**
 * Le plan des essais, du meilleur au plus sûr, d'après ce que le récepteur a dit savoir lire.
 *
 * Un verdict inconnu laisse l'essai en place : seul un refus constaté l'écarte. Le plan garde toujours
 * un niveau de conversion compatible en dernier recours.
 */
export function planDeQualite(source: SourceVideo | null, capacites: CapacitesRecepteur | null, direct: boolean): NiveauDiffusion[] {
  const c = capacites ?? {};
  const h264Max = c.h264_1080 === false ? 720 : 1080;
  const plan: NiveauDiffusion[] = [];
  if (direct) {
    // La définition d'une chaîne n'est connue qu'une fois le flux ouvert. Un récepteur qui refuse le
    // 1080p refuserait la copie de la plupart des chaînes HD : la conversion compatible part d'emblée.
    if (c.h264_1080 !== false) plan.push({ nom: "source", qualiteSource: true, compatible: false, hauteurMax: 2160 });
    plan.push({ nom: "compatible", qualiteSource: false, compatible: true, hauteurMax: 720 });
    return plan;
  }
  const copie = copieAdmise(source, c);
  if (copie) plan.push(copie);
  const hauteurSource = source?.hauteur && source.hauteur > 0 ? source.hauteur : 1080;
  if (h264Max >= 1080 && hauteurSource > 720) plan.push({ nom: "conversion", qualiteSource: false, compatible: false, hauteurMax: 1080 });
  plan.push({ nom: "compatible", qualiteSource: false, compatible: true, hauteurMax: 720 });
  return plan;
}

function copieAdmise(source: SourceVideo | null, c: CapacitesRecepteur): NiveauDiffusion | null {
  const base: NiveauDiffusion = { nom: "source", qualiteSource: true, compatible: false, hauteurMax: 2160 };
  if (!source) return base;
  if (source.codec === "hevc") {
    const grand = source.hauteur > 1080;
    if (source.hdr || grand) {
      if (c.hevc_2160_hdr10 === false) return null;
      return { ...base, hevcHauteurMax: 2160, hdr: true };
    }
    if (c.hevc_1080 === false) return null;
    return { ...base, hevcHauteurMax: 1080, hdr: false };
  }
  if (source.codec === "h264" && source.hauteur > 720 && c.h264_1080 === false && !source.mp4Direct) return null;
  return base;
}

/** Ce qu'un échec ou une réussite réelle apprend sur le récepteur. */
export function enseignement(niveau: NiveauDiffusion, source: SourceVideo | null, reussi: boolean, refusRapide: boolean): Partial<CapacitesRecepteur> {
  if (!reussi && !refusRapide) return {};
  if (niveau.nom === "conversion") return { h264_1080: reussi };
  if (niveau.nom === "source" && source?.codec === "hevc") {
    return source.hdr || source.hauteur > 1080 ? { hevc_2160_hdr10: reussi } : { hevc_1080: reussi };
  }
  return {};
}
