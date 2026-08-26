/**
 * Garde-fous d'une analyse de bibliothèque — étape 54, second volet.
 *
 * Une analyse conclut en marquant indisponibles les fichiers qu'elle n'a pas revus. Ce raisonnement
 * suppose que l'absence d'un fichier signifie sa suppression. Sur un NAS, cette supposition est fausse
 * bien plus souvent qu'on ne le croit : partage démonté, point de montage qui répond « répertoire
 * vide » au lieu d'une erreur, disque en veille, permissions perdues, racine renommée. Dans tous ces
 * cas, l'analyse voit une bibliothèque vide et efface un catalogue entier sans rien signaler.
 *
 * Ces fonctions sont pures et sans accès au disque afin d'être éprouvées sans monter quoi que ce soit.
 */

import path from "node:path";
import { db } from "./database.js";

export type SkipReason = "unstable" | "error";

export interface SkippedFile {
  filePath: string;
  reason: SkipReason;
  detail: string | null;
  attempts: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Enregistre qu'un fichier n'est pas entré dans le catalogue, et pourquoi.
 *
 * Le compteur de tentatives distingue le fichier momentanément occupé — copie en cours, repris au
 * passage suivant — de celui qui échoue analyse après analyse et réclame une intervention.
 */
export function recordSkippedFile(libraryId: string, filePath: string, reason: SkipReason, detail: string | null): void {
  db.prepare(`
    INSERT INTO scan_skips (library_id, file_path, reason, detail)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(library_id, file_path) DO UPDATE SET
      reason = excluded.reason, detail = excluded.detail,
      attempts = scan_skips.attempts + 1, last_seen_at = CURRENT_TIMESTAMP
  `).run(libraryId, filePath, reason, detail);
}

/** Retire un fichier du journal : il est entré dans le catalogue, ou il a disparu du disque. */
export function clearSkippedFile(libraryId: string, filePath: string): void {
  db.prepare("DELETE FROM scan_skips WHERE library_id = ? AND file_path = ?").run(libraryId, filePath);
}

/**
 * Oublie les fichiers que l'analyse n'a plus rencontrés : ils ne sont plus sur le disque.
 *
 * `seenPaths` contient des chemins normalisés ; le journal garde les chemins tels que rencontrés. La
 * comparaison normalise donc des deux côtés, faute de quoi la purge n'effacerait jamais rien sur les
 * systèmes où les deux formes diffèrent.
 */
export function pruneSkippedFiles(libraryId: string, seenPaths: Set<string>): void {
  const rows = db.prepare("SELECT file_path FROM scan_skips WHERE library_id = ?").all(libraryId) as Array<{ file_path: string }>;
  const remove = db.prepare("DELETE FROM scan_skips WHERE library_id = ? AND file_path = ?");
  for (const row of rows) if (!seenPaths.has(path.normalize(row.file_path))) remove.run(libraryId, row.file_path);
}

/** Les fichiers restés à la porte, les plus obstinés d'abord. */
export function listSkippedFiles(libraryId?: string): SkippedFile[] {
  const rows = (libraryId
    ? db.prepare("SELECT * FROM scan_skips WHERE library_id = ? ORDER BY attempts DESC, last_seen_at DESC LIMIT 500").all(libraryId)
    : db.prepare("SELECT * FROM scan_skips ORDER BY attempts DESC, last_seen_at DESC LIMIT 500").all()) as Array<{
      file_path: string; reason: SkipReason; detail: string | null; attempts: number;
      first_seen_at: string; last_seen_at: string;
    }>;
  return rows.map((row) => ({
    filePath: row.file_path,
    reason: row.reason,
    detail: row.detail,
    attempts: row.attempts,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  }));
}

/** En deçà de ce nombre, une disparition reste plausible : on ne bloque pas un ménage ordinaire. */
export const SMALL_LIBRARY_THRESHOLD = 10;

/** Au-delà de cette proportion, une disparition massive est traitée comme suspecte. */
export const MASS_DISAPPEARANCE_RATIO = 0.5;

export interface DisappearanceVerdict {
  /** Vrai si les absences peuvent être appliquées au catalogue. */
  accepted: boolean;
  /** Motif du refus, destiné à être remonté à la personne. Nul lorsque la décision est acceptée. */
  reason: string | null;
  /** Identifiant stable du motif, pour les tests et l'interface. */
  code: "ok" | "empty-root" | "mass-disappearance";
}

/**
 * Décide si les absences constatées peuvent être appliquées.
 *
 * @param previouslyAvailable Nombre de médias marqués disponibles avant l'analyse.
 * @param missing Nombre de médias disponibles que l'analyse n'a pas revus.
 * @param discovered Nombre de fichiers rencontrés pendant la marche.
 * @param confirmed Passe outre le garde-fou, lorsque la personne a explicitement confirmé.
 */
export function assessDisappearance(
  previouslyAvailable: number,
  missing: number,
  discovered: number,
  confirmed = false,
): DisappearanceVerdict {
  if (missing === 0) return { accepted: true, reason: null, code: "ok" };
  if (confirmed) return { accepted: true, reason: null, code: "ok" };

  // L'exemption des petites bibliothèques passe avant tout le reste, y compris avant la racine vide.
  // Vider un dossier de deux ou trois films est un geste courant, et le refuser laisserait ces fiches
  // affichées comme disponibles jusqu'à confirmation — absurde pour un unique fichier supprimé.
  // Marquer indisponible n'efface rien : une analyse ultérieure rétablit la disponibilité dès que les
  // fichiers réapparaissent. Le préjudice d'une erreur est donc proportionnel au volume, et c'est le
  // volume qui décide de la prudence à appliquer.
  if (previouslyAvailable < SMALL_LIBRARY_THRESHOLD) return { accepted: true, reason: null, code: "ok" };

  // Aucun fichier rencontré alors que la bibliothèque en contenait beaucoup : la racine est vide ou
  // illisible. C'est le cas le plus dangereux et le plus courant, et le plus facile à reconnaître.
  if (discovered === 0) {
    return {
      accepted: false,
      code: "empty-root",
      reason: `Aucun fichier trouvé alors que la bibliothèque en comptait ${previouslyAvailable}. `
        + "Le dossier est vide, déconnecté ou illisible : les médias sont conservés tels quels. "
        + "Vérifiez que le partage est monté, puis relancez l'analyse.",
    };
  }

  const ratio = missing / previouslyAvailable;
  if (ratio > MASS_DISAPPEARANCE_RATIO) {
    return {
      accepted: false,
      code: "mass-disappearance",
      reason: `${missing} médias sur ${previouslyAvailable} ont disparu en une seule analyse `
        + `(${Math.round(ratio * 100)} %). Une disparition de cette ampleur vient presque toujours d'un `
        + "dossier déplacé ou d'un partage partiellement monté. Les médias sont conservés : confirmez la "
        + "suppression si elle est voulue.",
    };
  }

  return { accepted: true, reason: null, code: "ok" };
}

/**
 * Décide si un fichier est stable, c'est-à-dire s'il a fini d'être écrit.
 *
 * Analyser un fichier en cours de copie produit une fiche fausse — durée tronquée, pistes manquantes,
 * parfois un fichier illisible — et cette fiche fausse persiste jusqu'à ce qu'une analyse ultérieure
 * remarque le changement de taille. Deux relevés séparés dans le temps suffisent à trancher : une
 * copie en cours voit sa taille grandir, un fichier terminé ne bouge plus.
 *
 * @param first Relevé initial.
 * @param second Relevé postérieur, pris après un délai d'observation.
 */
export function isStableFile(
  first: { size: number; modifiedMs: number },
  second: { size: number; modifiedMs: number },
): boolean {
  return first.size === second.size && Math.floor(first.modifiedMs) === Math.floor(second.modifiedMs);
}

/**
 * Faut-il observer ce fichier avant de l'analyser ?
 *
 * Un second relevé par fichier doublerait le coût d'une analyse sur des dizaines de milliers de
 * fichiers, pour un bénéfice nul sur ceux qui dorment depuis des mois. Seuls les fichiers récemment
 * écrits sont susceptibles d'être encore en cours de copie.
 *
 * @param modifiedMs Date de dernière écriture du fichier.
 * @param nowMs Heure courante.
 * @param windowMs Fenêtre au-delà de laquelle un fichier est considéré au repos.
 */
export function needsStabilityCheck(modifiedMs: number, nowMs: number, windowMs = 60_000): boolean {
  const age = nowMs - modifiedMs;
  // Une date d'écriture dans le futur trahit une horloge de NAS déréglée : on observe par prudence
  // plutôt que de considérer le fichier au repos sur la foi d'une date invraisemblable.
  if (age < 0) return true;
  return age < windowMs;
}
