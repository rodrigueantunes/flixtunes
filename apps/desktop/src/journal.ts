import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Ce que le client de bureau écrit quand quelque chose se passe.
 *
 * **Il n'écrivait rien.** `console.log` n'existait que sous `FLIXTUNES_VLC_VERBEUX=1`, et la sortie
 * standard d'une application Electron empaquetée sous Windows ne va nulle part — ni console, ni
 * fichier. Quand l'application ne marchait pas, il n'y avait donc **rien à lire** : chaque incident
 * se diagnostiquait par déduction, ce qui revient à deviner. C'est le défaut qui rendait tous les
 * autres invisibles, et c'est pour cela qu'il se corrige en premier.
 *
 * Le journal n'est pas un outil de développement : il est écrit pour la personne qui devra un jour
 * dire pourquoi l'écran est resté noir. D'où trois choix.
 *
 * **Il vit à côté des réglages**, dans `userData` — le seul dossier dont on soit certain qu'il existe
 * et qu'on ait le droit d'y écrire, sur les trois systèmes.
 *
 * **Il est borné.** Un journal qui grossit sans fin finit par remplir un disque, et c'est une panne
 * bien pire que celle qu'il documentait. Un demi-mégaoctet, une seule génération conservée : de quoi
 * garder plusieurs séances, pas de quoi peser.
 *
 * **Il n'échoue jamais bruyamment.** Un journal qui lève une exception ferait tomber ce qu'il devait
 * expliquer — le comble. Toute erreur d'écriture est avalée : au pire on perd des lignes, jamais
 * l'application.
 */

/** Un demi-mégaoctet : plusieurs séances, et un poids qu'on ne remarque pas. */
const TAILLE_MAX = 512 * 1024;

/** Un seul fichier de rechange. Deux générations suffisent à couvrir la séance précédente. */
const FICHIER = "flixtunes.log";
const PRECEDENT = "flixtunes.log.1";

let dossier: string | null = null;

/** Où écrire. Appelé une fois au démarrage, quand Electron sait enfin où sont les données. */
export function ouvrirLeJournal(dossierDonnees: string): void {
  dossier = dossierDonnees;
  try {
    mkdirSync(dossierDonnees, { recursive: true });
  } catch {
    // Un dossier de données inaccessible est un problème plus grave que l'absence de journal, et il
    // se manifestera ailleurs. Ici, on renonce en silence.
    dossier = null;
  }
}

/** Le chemin du journal, quand il y en a un. Exporté pour qu'un écran d'erreur puisse le citer. */
export function cheminDuJournal(): string | null {
  return dossier ? path.join(dossier, FICHIER) : null;
}

function fairePlace(chemin: string): void {
  try {
    if (statSync(chemin).size < TAILLE_MAX) return;
  } catch {
    return; // pas encore de fichier : rien à faire de la place
  }
  const ancien = path.join(path.dirname(chemin), PRECEDENT);
  try { unlinkSync(ancien); } catch { /* il n'existait pas */ }
  try { renameSync(chemin, ancien); } catch { /* verrouillé : on continuera d'écrire dedans */ }
}

/**
 * Une ligne dans le journal, horodatée, et la même à l'écran quand une console existe.
 *
 * Le niveau n'est pas décoratif : c'est ce qui permet de retrouver une panne dans un fichier qui
 * contient aussi le déroulement normal. `erreur` est réservé à ce qui empêche quelque chose.
 */
function ecrire(niveau: "info" | "alerte" | "erreur", message: string, details?: unknown): void {
  const horodatage = new Date().toISOString();
  const suite = details === undefined ? "" : ` ${formater(details)}`;
  const ligne = `${horodatage} [${niveau}] ${message}${suite}\n`;
  // La console reste servie : en développement, c'est elle qu'on regarde.
  if (niveau === "erreur") console.error(ligne.trimEnd());
  else console.log(ligne.trimEnd());
  const chemin = cheminDuJournal();
  if (!chemin) return;
  try {
    fairePlace(chemin);
    appendFileSync(chemin, ligne, "utf8");
  } catch {
    /* voir l'en-tête : un journal ne fait jamais tomber ce qu'il documente */
  }
}

/** Ce qu'on sait dire d'une valeur quelconque sans risquer de lever à son tour. */
function formater(valeur: unknown): string {
  if (valeur instanceof Error) return `${valeur.name}: ${valeur.message}${valeur.stack ? `\n${valeur.stack}` : ""}`;
  if (typeof valeur === "string") return valeur;
  try { return JSON.stringify(valeur); } catch { return String(valeur); }
}

export const journal = {
  info: (message: string, details?: unknown) => ecrire("info", message, details),
  alerte: (message: string, details?: unknown) => ecrire("alerte", message, details),
  erreur: (message: string, details?: unknown) => ecrire("erreur", message, details),
};
