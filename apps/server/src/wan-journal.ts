import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Le journal des accès distants.
 *
 * Avant lui, un échec d'authentification ne laissait **aucune trace** : une attaque en cours était
 * invisible, et une attaque réussie l'était davantage. C'est la seule chose qui permette de répondre
 * à « est-ce que quelqu'un essaie d'entrer ? » autrement que par une intuition.
 *
 * Il n'enregistre que ce qui décrit une tentative — date, source, profil visé, verdict, route. Jamais
 * de jeton, jamais de PIN, jamais de titre regardé : un journal de sécurité qui deviendrait un
 * journal d'habitudes de visionnage serait une fuite de plus, pas une protection.
 */

export type VerdictJournal =
  | "ouverture" | "pin-refuse" | "pin-bloque"
  | "session-absente" | "session-invalide" | "route-refusee";

export interface EntreeJournal {
  horodatage: string;
  verdict: VerdictJournal;
  source: string;
  profil: string | null;
  route: string | null;
  appareil: string | null;
}

const TAILLE_MAXIMALE = 2 * 1024 * 1024;
const MEMOIRE_MAXIMALE = 200;

/** Les dernières entrées, pour le diagnostic local sans lecture de fichier. */
const recentes: EntreeJournal[] = [];

function fichier(): string {
  return path.join(config.dataDir, "logs", "wan-acces.log");
}

/**
 * Une seule rotation, vers `.1`.
 *
 * Conserver davantage d'historique demanderait une politique de rétention, donc une décision sur ce
 * qu'on garde et combien de temps. Deux fichiers suffisent à voir une attaque en cours, qui est
 * l'usage recherché ici ; l'analyse au long cours appartient à l'étape d'administration.
 */
function rotationSiNecessaire(chemin: string): void {
  try {
    if (statSync(chemin).size < TAILLE_MAXIMALE) return;
    renameSync(chemin, `${chemin}.1`);
  } catch {
    // Fichier absent : il n'y a rien à faire tourner.
  }
}

export function journaliserAccesWan(entree: Omit<EntreeJournal, "horodatage">): void {
  const complete: EntreeJournal = { horodatage: new Date().toISOString(), ...entree };
  recentes.push(complete);
  if (recentes.length > MEMOIRE_MAXIMALE) recentes.shift();
  try {
    const chemin = fichier();
    mkdirSync(path.dirname(chemin), { recursive: true });
    rotationSiNecessaire(chemin);
    appendFileSync(chemin, `${JSON.stringify(complete)}\n`, "utf8");
  } catch {
    // Un journal qui ne peut pas s'écrire ne doit jamais empêcher de regarder un film. La trace en
    // mémoire reste disponible, et l'incident se verra au premier coup d'œil au diagnostic.
  }
}

export function accesWanRecents(limite = 50): EntreeJournal[] {
  return recentes.slice(-Math.max(1, Math.min(MEMOIRE_MAXIMALE, limite))).reverse();
}

/** Uniquement pour les tests. */
export function oublierAccesWanRecents(): void {
  recentes.length = 0;
}
