import { db } from "./database.js";
import { parseProbeOutput } from "./ffprobe.js";
import { marqueursGenerique } from "./generique.js";
import { deduireDesVoisins, VOISINS_MINIMUM, type RepereConnu } from "./marqueurs-voisins.js";
import { marqueursRanges, retenirGeneriqueFin, retenirIntroduction } from "./marqueurs-memoire.js";

/**
 * Établir les repères de générique d'une saison entière, une fois pour toutes.
 *
 * Les chapitres nommés se relisent du fichier à chaque ouverture — c'est gratuit. Ce qui se calcule
 * ici, c'est ce qu'ils ne disent pas : les épisodes d'une saison régulière dont le fichier ne porte
 * aucun repère, mais dont les voisins en portent.
 *
 * **La passe tourne après un scan, jamais pendant une lecture.** C'est la règle qui gouverne tout ce
 * module : un repère absent au moment où l'on lance un épisode ne se calcule pas à ce moment-là, on
 * ne propose simplement rien. Le lecteur ne paie jamais.
 *
 * Elle est aussi conçue pour être relancée sans dommage : chaque passage recalcule et réécrit, et une
 * source plus sûre n'est jamais écrasée par une plus faible (voir `marqueurs-memoire`).
 */

interface LigneEpisode {
  id: string;
  show_title: string | null;
  season_number: number | null;
  runtime_seconds: number | null;
  embedded_metadata_json: string | null;
}

/** Ce que le fichier lui-même dit, sans rien déduire. */
function repereDuFichier(ligne: LigneEpisode): { duree: number; repere: RepereConnu | null } {
  let duree = ligne.runtime_seconds ?? 0;
  if (!ligne.embedded_metadata_json) return { duree, repere: null };
  let metadonnees;
  try { metadonnees = parseProbeOutput(JSON.parse(ligne.embedded_metadata_json)); } catch { return { duree, repere: null }; }
  duree = metadonnees.durationSeconds ?? duree;
  const marqueurs = marqueursGenerique(metadonnees.chapters, duree);
  if (marqueurs.creditsStartSeconds == null && marqueurs.intro == null) return { duree, repere: null };
  return {
    duree,
    repere: {
      dureeSecondes: duree,
      creditsStartSeconds: marqueurs.creditsStartSeconds,
      introStartSeconds: marqueurs.intro?.startSeconds ?? null,
      introEndSeconds: marqueurs.intro?.endSeconds ?? null,
    },
  };
}

/** Les repères des autres saisons de la même série, quand la saison visée est trop maigre. */
function repereDeLaSerie(showTitle: string, saisonExclue: number | null): RepereConnu[] {
  const lignes = db.prepare(`SELECT id, show_title, season_number, runtime_seconds, embedded_metadata_json
    FROM media_items
    WHERE kind = 'episode' AND available = 1 AND show_title = ?
      AND (season_number IS NOT ? AND (season_number IS NOT NULL OR ? IS NOT NULL))
    LIMIT 200`)
    .all(showTitle, saisonExclue, saisonExclue) as unknown as LigneEpisode[];
  return lignes.map(repereDuFichier).map(({ repere }) => repere).filter((repere): repere is RepereConnu => repere != null);
}

export interface BilanSaison {
  /** Épisodes examinés. */
  examines: number;
  /** Épisodes dont le fichier portait déjà un repère : rien à déduire. */
  dejaConnus: number;
  /** Épisodes qui ont reçu un repère par déduction. */
  deduits: number;
}

/**
 * Complète une saison à partir de ce que ses épisodes chapitrés révèlent.
 *
 * `showTitle` et `season` désignent la saison ; les deux viennent de la base et non d'un chemin, une
 * saison pouvant s'étaler sur plusieurs dossiers.
 */
export function completerSaison(showTitle: string, season: number | null): BilanSaison {
  const lignes = db.prepare(`SELECT id, show_title, season_number, runtime_seconds, embedded_metadata_json
    FROM media_items
    WHERE kind = 'episode' AND available = 1 AND show_title = ?
      AND (season_number IS ? OR season_number = ?)`)
    .all(showTitle, season, season) as unknown as LigneEpisode[];

  const bilan: BilanSaison = { examines: lignes.length, dejaConnus: 0, deduits: 0 };
  if (!lignes.length) return bilan;

  const connus: RepereConnu[] = [];
  const aCompleter: Array<{ id: string; duree: number }> = [];
  for (const ligne of lignes) {
    const { duree, repere } = repereDuFichier(ligne);
    if (repere) { connus.push(repere); bilan.dejaConnus += 1; }
    else if (duree > 0) aCompleter.push({ id: ligne.id, duree });
  }
  if (!aCompleter.length) return bilan;

  /*
   * Une saison trop maigre emprunte au reste de la série.
   *
   * Le cas est réel : une saison d'un seul épisode, un pilote rangé à part, une saison en cours dont
   * deux épisodes seulement sont là. Elle n'a alors aucun voisin, et sans ce repli elle n'aurait
   * jamais rien — alors que la série d'à côté en dit long.
   *
   * L'emprunt reste sûr **parce qu'il ne relâche rien** : le consensus exigé est le même, et les
   * séries qui changent de générique d'une saison à l'autre s'écartent d'elles-mêmes. *Silo* en est
   * la démonstration — 77,0 s d'introduction en saisons 1 et 2, 97,8 s en saison 3 : mélangées, ces
   * valeurs dépassent la dispersion tolérée et le repli refuse de conclure. Son carton de fin, lui,
   * fait 56,0 s dans les trois saisons et passe sans peine.
   */
  const voisinage = connus.length >= VOISINS_MINIMUM ? connus : [...connus, ...repereDeLaSerie(showTitle, season)];
  if (!voisinage.length) return bilan;

  for (const { id, duree } of aCompleter) {
    const deduction = deduireDesVoisins(duree, voisinage);
    let retenu = false;
    if (deduction.creditsStartSeconds != null) {
      retenu = retenirGeneriqueFin(id, deduction.creditsStartSeconds, "voisins") || retenu;
    }
    if (deduction.introStartSeconds != null && deduction.introEndSeconds != null) {
      retenu = retenirIntroduction(id, deduction.introStartSeconds, deduction.introEndSeconds, "voisins") || retenu;
    }
    if (retenu) bilan.deduits += 1;
  }
  return bilan;
}

/**
 * Passe complète sur toutes les saisons connues.
 *
 * Appelée après un scan. Elle ne lit aucun fichier — tout vient des métadonnées déjà rangées — et
 * traverse la médiathèque de référence en quelques centaines de millisecondes.
 */
export function completerToutesLesSaisons(): BilanSaison {
  const saisons = db.prepare(`SELECT DISTINCT show_title, season_number FROM media_items
    WHERE kind = 'episode' AND available = 1 AND show_title IS NOT NULL`)
    .all() as unknown as Array<{ show_title: string; season_number: number | null }>;
  const total: BilanSaison = { examines: 0, dejaConnus: 0, deduits: 0 };
  for (const saison of saisons) {
    const bilan = completerSaison(saison.show_title, saison.season_number);
    total.examines += bilan.examines;
    total.dejaConnus += bilan.dejaConnus;
    total.deduits += bilan.deduits;
  }
  return total;
}

/** Les repères retenus pour un média, ou `null` si rien n'a été établi. */
export function marqueursDeduits(mediaId: string) {
  return marqueursRanges(mediaId);
}
