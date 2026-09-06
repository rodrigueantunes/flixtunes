import { db } from "./database.js";
import { cacheRemoteArtwork } from "./artwork.js";
import { chercherYoutube, identifierChaineYoutube, resoudreYoutube } from "./web-fournisseurs.js";
import { identifiantDepuisUrl, type IdentiteWeb } from "./web-identite.js";

/**
 * Corriger à la main la correspondance d'une chaîne ou d'une vidéo.
 *
 * **Un chemin entièrement séparé de celui des films et des séries, et c'est délibéré.**
 *
 * Le centre de correspondances existant liste ce qui est `unmatched` ou `review`, plafonné à 250
 * lignes triées par confiance croissante. Relevé sur une médiathèque réelle : 1 555 épisodes portent
 * déjà ce statut, et une bibliothèque web en ajouterait des milliers — les films et les séries
 * seraient chassés des 250 places par des vidéos. Étendre cet écran l'aurait donc dégradé pour
 * réparer autre chose.
 *
 * Rien de ce qui sert au catalogue n'est touché ici : ni sa requête, ni son schéma de validation, ni
 * son plafond. Une vidéo ne peut pas devenir la correspondance d'un film, et un film ne peut pas
 * devenir celle d'une vidéo — les deux mondes ne se croisent nulle part.
 */

/** Ce qu'une ligne de correction web présente. */
export interface CorrespondanceWeb {
  id: string;
  /** `chaine` ou `video` — le mot qu'emploie l'écran, pas le type interne du catalogue. */
  genre: "chaine" | "video";
  titre: string;
  /** Le nom de la chaîne dont dépend une vidéo, pour la situer. */
  chaine: string | null;
  posterUrl: string | null;
  publieeLe: string | null;
  /** Identifiant de plateforme déjà retenu, s'il y en a un. */
  identifiant: string | null;
  /** `automatic` quand la plateforme a répondu, `unmatched` sinon, `manual` après correction. */
  statut: string;
  verrouillee: boolean;
}

/**
 * Ce qui attend une correction dans les bibliothèques web.
 *
 * Par défaut, seules les fiches non résolues — c'est le cas d'usage : on vient réparer ce qui manque.
 * `toutes` sert à retrouver une fiche déjà appariée pour la corriger quand même, ce que la promesse
 * « on peut modifier la correspondance manuellement » suppose.
 */
export function listerCorrespondancesWeb(options: {
  libraryId?: string;
  toutes?: boolean;
  limite?: number;
} = {}): CorrespondanceWeb[] {
  const limite = Math.min(500, Math.max(1, options.limite ?? 200));
  const filtreStatut = options.toutes ? "" : "AND c.match_status <> 'automatic' AND c.match_status <> 'manual'";
  const filtreBibliotheque = options.libraryId ? "AND c.library_id = ?" : "";
  const parametres: string[] = options.libraryId ? [options.libraryId] : [];

  const lignes = db.prepare(`
    SELECT c.id, c.kind, c.title, c.poster_url, c.external_id, c.match_status, c.metadata_locked,
      parent.title AS palier, grand.title AS chaine,
      (SELECT m.air_date FROM media_items m WHERE m.catalog_id = c.id LIMIT 1) AS air_date
    FROM catalog_items c
    LEFT JOIN catalog_items parent ON parent.id = c.parent_id
    LEFT JOIN catalog_items grand ON grand.id = parent.parent_id
    WHERE c.kind IN ('show', 'episode')
      AND EXISTS (SELECT 1 FROM library_folders lib WHERE lib.id = c.library_id AND lib.kind = 'web')
      ${filtreStatut} ${filtreBibliotheque}
    ORDER BY CASE c.kind WHEN 'show' THEN 0 ELSE 1 END, c.sort_title
    LIMIT ${limite}
  `).all(...parametres) as Array<{
    id: string; kind: "show" | "episode"; title: string; poster_url: string | null; external_id: string | null;
    match_status: string; metadata_locked: number; palier: string | null; chaine: string | null; air_date: string | null;
  }>;

  return lignes.map((ligne) => ({
    id: ligne.id,
    genre: ligne.kind === "show" ? "chaine" : "video",
    titre: ligne.title,
    chaine: ligne.kind === "show" ? null : ligne.chaine,
    posterUrl: ligne.poster_url,
    publieeLe: ligne.air_date,
    identifiant: ligne.external_id,
    statut: ligne.match_status,
    verrouillee: ligne.metadata_locked === 1,
  }));
}

/** L'identifiant de plateforme retenu pour la chaîne dont dépend cette fiche, s'il existe. */
function chaineDe(catalogId: string): { id: string; nom: string; identifiant: string | null } | null {
  const ligne = db.prepare(`
    WITH RECURSIVE ancetres(id, parent_id, kind, title, external_id, profondeur) AS (
      SELECT id, parent_id, kind, title, external_id, 0 FROM catalog_items WHERE id = ?
      UNION ALL
      SELECT p.id, p.parent_id, p.kind, p.title, p.external_id, ancetres.profondeur + 1
      FROM catalog_items p JOIN ancetres ON ancetres.parent_id = p.id)
    SELECT id, title, external_id FROM ancetres WHERE kind = 'show' LIMIT 1
  `).get(catalogId) as { id: string; title: string; external_id: string | null } | undefined;
  return ligne ? { id: ligne.id, nom: ligne.title, identifiant: ligne.external_id } : null;
}

/**
 * Les candidats proposés pour une fiche web.
 *
 * Pour une **chaîne**, on cherche une chaîne. Pour une **vidéo**, on cherche dans sa chaîne — jamais
 * ailleurs : c'est la règle qui vaut pour l'analyse automatique, et une correction manuelle n'a pas
 * de raison d'être plus permissive. Une vidéo dont la chaîne n'est pas identifiée n'a donc pas de
 * candidat, et l'écran doit le dire plutôt que de proposer n'importe quoi.
 */
export async function candidatsPourFicheWeb(catalogId: string, requete?: string): Promise<{
  candidats: IdentiteWeb[];
  motif: string | null;
}> {
  const fiche = db.prepare("SELECT id, kind, title FROM catalog_items WHERE id = ?")
    .get(catalogId) as { id: string; kind: string; title: string } | undefined;
  if (!fiche) return { candidats: [], motif: "Fiche introuvable." };

  const terme = requete?.trim() || fiche.title;

  if (fiche.kind === "show") {
    const trouvee = await identifierChaineYoutube(terme).catch(() => null);
    if (!trouvee) return { candidats: [], motif: "Aucune chaîne trouvée pour ce nom." };
    return {
      candidats: [{
        titre: terme, chaine: terme, plateforme: "youtube", identifiant: trouvee.identifiant,
        url: `https://www.youtube.com/channel/${trouvee.identifiant}`, publieeLe: null, annee: null,
        description: null, dureeSecondes: null, vignette: trouvee.avatar, playlist: null,
      }],
      motif: null,
    };
  }

  const chaine = chaineDe(catalogId);
  if (!chaine?.identifiant) {
    return { candidats: [], motif: "La chaîne n'est pas encore identifiée : corrigez-la d'abord." };
  }
  const trouvee = await chercherYoutube(chaine.identifiant, terme).catch(() => null);
  return trouvee ? { candidats: [trouvee], motif: null } : { candidats: [], motif: "Aucune vidéo de cette chaîne ne correspond." };
}

/**
 * Appliquer une correspondance choisie à la main.
 *
 * L'identifiant peut être collé tel quel ou tiré d'une adresse — c'est ce qu'on a sous la main quand
 * on vient de la trouver dans un navigateur. Le résultat est **verrouillé** : une correction est une
 * intention exprimée, et aucune analyse ultérieure ne doit la défaire.
 */
export async function appliquerCorrespondanceWeb(
  catalogId: string,
  identifiantOuAdresse: string,
  langue: string,
): Promise<{ applique: boolean; message: string }> {
  const fiche = db.prepare("SELECT id, kind FROM catalog_items WHERE id = ?")
    .get(catalogId) as { id: string; kind: string } | undefined;
  if (!fiche) return { applique: false, message: "Fiche introuvable." };

  const brut = identifiantOuAdresse.trim();
  const identifiant = identifiantDepuisUrl(brut) ?? brut;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(identifiant)) {
    return { applique: false, message: "Identifiant de plateforme illisible." };
  }

  if (fiche.kind === "show") {
    // Une chaîne se corrige par son identifiant : on ne redemande pas son avatar ici, l'analyse
    // suivante s'en chargera si la fiche n'en a pas — et si elle en a un, il reste figé.
    db.prepare(`UPDATE catalog_items SET external_provider = 'youtube', external_id = ?,
      match_status = 'manual', match_confidence = 1, metadata_locked = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(identifiant, catalogId);
    return { applique: true, message: "Chaîne corrigée et verrouillée." };
  }

  const identite = await resoudreYoutube(identifiant).catch(() => null);
  if (!identite) return { applique: false, message: "Cette vidéo n'a pas pu être lue sur la plateforme." };

  db.prepare(`UPDATE catalog_items SET title = COALESCE(?, title), overview = COALESCE(?, overview),
    external_provider = 'youtube', external_id = ?, match_status = 'manual', match_confidence = 1,
    metadata_locked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(identite.titre, identite.description, identifiant, catalogId);
  db.prepare(`UPDATE media_items SET title = COALESCE(?, title), air_date = COALESCE(?, air_date),
    updated_at = CURRENT_TIMESTAMP WHERE catalog_id = ?`)
    .run(identite.titre, identite.publieeLe, catalogId);

  // La vignette d'une correction remplace celle qu'on avait : c'est le seul cas où « figé » cède, et
  // il est voulu — on vient précisément de dire que l'ancienne était fausse.
  if (identite.vignette) {
    const adresse = await cacheRemoteArtwork(catalogId, "poster", identite.vignette, langue, "youtube")
      .catch(() => null);
    if (adresse) {
      db.prepare("UPDATE catalog_items SET poster_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(adresse, catalogId);
    }
  }
  return { applique: true, message: "Vidéo corrigée et verrouillée." };
}
