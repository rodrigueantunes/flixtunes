import type { MediaItem } from "@flixtunes/contracts";

/**
 * Ce que le rayon Web retrouve en revenant d'une vidéo.
 *
 * Lire une vidéo remplace tout l'écran par le lecteur : le rayon est démonté, et avec lui la chaîne
 * ouverte, le dossier où l'on était et l'ordre choisi. Au retour, on repartait de la liste des
 * chaînes — après être descendu de trois dossiers pour trouver celle-là.
 *
 * Même raisonnement que pour la télévision en direct, et la même conclusion : rien ne périme ici,
 * parce qu'il ne s'agit pas de données du serveur mais **d'un choix de la personne**, et un choix ne
 * se démode pas pendant qu'on regarde une vidéo. La mémoire ne survit pas au rechargement de la page :
 * elle accélère une session, elle ne décide pas de ce qui reste vrai d'une session à l'autre.
 */
export interface SouvenirWeb {
  /** La chaîne ouverte, ou `null` si l'on était sur la liste des chaînes. */
  chaine: MediaItem | null;
  /** Les dossiers traversés sous cette chaîne, dans l'ordre. */
  chemin: string[];
  /** L'ordre choisi : `recent`, `ancien` ou `titre`. */
  tri: string;
}

const VIERGE: SouvenirWeb = { chaine: null, chemin: [], tri: "recent" };

let souvenir: SouvenirWeb = { ...VIERGE };

export function lireSouvenirWeb(): SouvenirWeb {
  return souvenir;
}

export function retenirSouvenirWeb(part: Partial<SouvenirWeb>): void {
  souvenir = { ...souvenir, ...part };
}

/**
 * Oublier ce qui a été retenu.
 *
 * À appeler quand le profil change : un profil enfant ne voit pas les mêmes chaînes, et rouvrir celle
 * de quelqu'un d'autre serait un souvenir qui ment.
 */
export function oublierSouvenirWeb(): void {
  souvenir = { ...VIERGE };
}
