import { db } from "./database.js";

/**
 * Ce qu'on a fini par savoir des génériques d'un média, et comment on l'a su.
 *
 * Les chapitres nommés se relisent du fichier à chaque ouverture, pour rien : l'information y est
 * déjà. Ce qui se range ici, ce sont les repères qu'il a fallu **établir** — déduits des autres
 * épisodes de la saison, ou trouvés en comparant les sons. Les recalculer à chaque lecture serait
 * absurde : ils ne changent pas.
 *
 * ## Deux repères, deux provenances
 *
 * L'introduction et le générique de fin ne s'obtiennent pas de la même façon et ne valent pas la
 * même chose. La déduction entre voisins donne souvent le carton de fin sans rien dire de
 * l'introduction ; l'empreinte sonore fait exactement l'inverse.
 *
 * Une seule colonne de provenance pour les deux menait droit à la faute : la passe sonore, qui ne
 * connaît que l'introduction, aurait écrasé un générique de fin déduit — et la passe suivante,
 * portant une source jugée plus faible, aurait été refusée en bloc. Chaque repère porte donc la
 * sienne, et se remplace indépendamment de l'autre.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS marqueurs_generique (
    media_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
    credits_start_seconds REAL,
    source_credits TEXT,
    intro_start_seconds REAL,
    intro_end_seconds REAL,
    source_intro TEXT,
    ecoute_le TEXT,
    calcule_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * **La seconde écoute, et pourquoi il en fallait une.**
 *
 * Un épisode écouté sans résultat n'était plus jamais repris — « on n'écoute jamais deux fois », et
 * c'est la bonne règle pour une série sans thème commun : la réécouter serait du décodage pur perdu,
 * répété à chaque analyse.
 *
 * Mais elle est fausse quand la saison **a** un thème, et qu'on l'a prouvé ailleurs. Relevé sur
 * *Silo* saison 3 : six épisodes sur dix ont leur introduction trouvée par empreinte, quatre non — et
 * ces quatre-là étaient condamnés définitivement, alors que le thème existe et que les témoins pour
 * le reconnaître sont désormais bien meilleurs qu'au premier passage, puisque six d'entre eux
 * portent maintenant un repère.
 *
 * D'où cette colonne : elle borne la reprise à **une seule fois par épisode**, ce qui évite de
 * retomber dans le gaspillage qu'on avait corrigé. Une saison sans le moindre repère n'y a pas droit
 * du tout.
 */
const colonnesDesMarqueurs = db.prepare("PRAGMA table_info(marqueurs_generique)").all() as Array<{ name: string }>;
if (!colonnesDesMarqueurs.some((colonne) => colonne.name === "reecoute_le")) {
  db.exec("ALTER TABLE marqueurs_generique ADD COLUMN reecoute_le TEXT");
}

/**
 * Reprise de la forme à colonne unique livrée en r70.
 *
 * Le contenu est **entièrement dérivé** : chapitres relus, saisons recoupées, sons comparés. Le
 * reconstruire coûte une passe de scan, tandis que traduire l'ancienne colonne exigerait de deviner
 * à laquelle des deux bornes elle s'appliquait. On repart donc de zéro, et la première analyse
 * remplit à nouveau la table.
 */
const colonnes = (db.prepare("PRAGMA table_info(marqueurs_generique)").all() as unknown as Array<{ name: string }>)
  .map((colonne) => colonne.name);
if (colonnes.length && !colonnes.includes("ecoute_le") && colonnes.includes("source_intro")) {
  db.exec("ALTER TABLE marqueurs_generique ADD COLUMN ecoute_le TEXT");
}
if (colonnes.includes("source") && !colonnes.includes("source_intro")) {
  db.exec(`
    DROP TABLE marqueurs_generique;
    CREATE TABLE marqueurs_generique (
      media_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
      credits_start_seconds REAL,
      source_credits TEXT,
      intro_start_seconds REAL,
      intro_end_seconds REAL,
      source_intro TEXT,
      ecoute_le TEXT,
      calcule_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * D'où vient un repère, de la plus faible à la plus forte.
 *
 * `chapitre` ne se range jamais en base — il se relit du fichier — mais la valeur existe pour que le
 * classement soit complet et que le code n'ait pas à traiter ce cas à part.
 */
export const SOURCES = ["voisins", "empreinte", "chapitre"] as const;
export type SourceMarqueur = (typeof SOURCES)[number];

/** Une source au moins aussi sûre remplace ; une plus faible s'abstient. */
export function remplace(nouvelle: SourceMarqueur, existante: SourceMarqueur | null): boolean {
  if (existante == null) return true;
  return SOURCES.indexOf(nouvelle) >= SOURCES.indexOf(existante);
}

export interface MarqueursRanges {
  creditsStartSeconds: number | null;
  sourceCredits: SourceMarqueur | null;
  introStartSeconds: number | null;
  introEndSeconds: number | null;
  sourceIntro: SourceMarqueur | null;
}

interface LigneMarqueurs {
  credits_start_seconds: number | null;
  source_credits: string | null;
  intro_start_seconds: number | null;
  intro_end_seconds: number | null;
  source_intro: string | null;
}

const source = (valeur: string | null): SourceMarqueur | null =>
  valeur != null && (SOURCES as readonly string[]).includes(valeur) ? valeur as SourceMarqueur : null;

export function marqueursRanges(mediaId: string): MarqueursRanges | null {
  const ligne = db.prepare(`SELECT credits_start_seconds, source_credits, intro_start_seconds,
      intro_end_seconds, source_intro FROM marqueurs_generique WHERE media_id = ?`)
    .get(mediaId) as unknown as LigneMarqueurs | undefined;
  if (!ligne) return null;
  return {
    creditsStartSeconds: ligne.credits_start_seconds,
    sourceCredits: source(ligne.source_credits),
    introStartSeconds: ligne.intro_start_seconds,
    introEndSeconds: ligne.intro_end_seconds,
    sourceIntro: source(ligne.source_intro),
  };
}

/** Retient un début de générique de fin, sauf si une méthode plus sûre l'a déjà établi. */
export function retenirGeneriqueFin(mediaId: string, debutSecondes: number, provenance: SourceMarqueur): boolean {
  const existant = marqueursRanges(mediaId);
  if (!remplace(provenance, existant?.sourceCredits ?? null)) return false;
  db.prepare(`INSERT INTO marqueurs_generique (media_id, credits_start_seconds, source_credits, calcule_le)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(media_id) DO UPDATE SET credits_start_seconds = excluded.credits_start_seconds,
      source_credits = excluded.source_credits, calcule_le = excluded.calcule_le`)
    .run(mediaId, debutSecondes, provenance);
  return true;
}

/** Retient une introduction, aux mêmes conditions et sans toucher au générique de fin. */
export function retenirIntroduction(mediaId: string, debutSecondes: number, finSecondes: number,
  provenance: SourceMarqueur): boolean {
  const existant = marqueursRanges(mediaId);
  if (!remplace(provenance, existant?.sourceIntro ?? null)) return false;
  db.prepare(`INSERT INTO marqueurs_generique (media_id, intro_start_seconds, intro_end_seconds, source_intro, calcule_le)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(media_id) DO UPDATE SET intro_start_seconds = excluded.intro_start_seconds,
      intro_end_seconds = excluded.intro_end_seconds, source_intro = excluded.source_intro,
      calcule_le = excluded.calcule_le`)
    .run(mediaId, debutSecondes, finSecondes, provenance);
  return true;
}

/**
 * Retient qu'on a écouté cet épisode, même si l'on n'y a rien trouvé.
 *
 * Sans cette trace, une saison sans thème commun serait réécoutée à **chaque** analyse, pour rien et
 * indéfiniment — quelques secondes de décodage par épisode, multipliées par le nombre d'analyses.
 * Une série qui n'a pas de générique n'en aura pas davantage au prochain scan.
 */
export function retenirEcoute(mediaId: string, seconde = false): void {
  /*
   * La seconde écoute s'inscrit dans sa propre colonne.
   *
   * Écraser `ecoute_le` suffirait à retenir qu'on a écouté, mais on perdrait ce qui borne la reprise :
   * sans trace distincte, la saison au thème prouvé redeviendrait éligible à chaque analyse, et l'on
   * réécouterait indéfiniment les épisodes qui ne donnent rien. Une fois, pas deux.
   */
  db.prepare(`INSERT INTO marqueurs_generique (media_id, ecoute_le, reecoute_le, calcule_le)
    VALUES (?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(media_id) DO UPDATE SET ecoute_le = CURRENT_TIMESTAMP${seconde ? ", reecoute_le = CURRENT_TIMESTAMP" : ""}`)
    .run(mediaId, seconde ? new Date().toISOString() : null);
}

/** Oublie ce qu'une méthode avait établi, pour le refaire autrement. */
export function oublierMarqueurs(provenance: SourceMarqueur): number {
  const credits = db.prepare("UPDATE marqueurs_generique SET credits_start_seconds = NULL, source_credits = NULL WHERE source_credits = ?")
    .run(provenance).changes;
  const intro = db.prepare(`UPDATE marqueurs_generique SET intro_start_seconds = NULL, intro_end_seconds = NULL,
    source_intro = NULL WHERE source_intro = ?`).run(provenance).changes;
  db.exec("DELETE FROM marqueurs_generique WHERE source_credits IS NULL AND source_intro IS NULL AND ecoute_le IS NULL");
  return Number(credits) + Number(intro);
}
