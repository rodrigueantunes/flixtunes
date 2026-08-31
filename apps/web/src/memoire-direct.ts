import type { ChaineDirect } from "@flixtunes/contracts";

/**
 * Ce que l'écran des chaînes retrouve en revenant d'une chaîne.
 *
 * Ouvrir une chaîne remplace tout l'écran par le lecteur : la grille est démontée, et avec elle ses
 * `useState` — recherche, pays cochés, listes retenues, pages déjà parcourues, position de
 * défilement. Au retour, on repartait donc du haut d'une grille de 79 321 chaînes sans aucun filtre,
 * après avoir mis vingt secondes à trouver la sienne. C'est le défaut que le cache de catalogue
 * décrit déjà pour les pages de films, et il vaut ici plus qu'ailleurs.
 *
 * **Pourquoi une mémoire à part et non `server-cache`.** Celui-ci périme ses valeurs au bout de cinq
 * minutes, ce qui est juste pour des données du serveur — au-delà, mieux vaut redemander. Mais on
 * regarde une chaîne bien plus de cinq minutes : ses filtres seraient perdus précisément dans le cas
 * normal. Ici rien ne périme, parce qu'il ne s'agit pas de données mais **d'un choix de la personne**,
 * et un choix ne se démode pas pendant qu'on regarde la télévision.
 *
 * Comme le cache du catalogue, elle ne survit pas au rechargement de la page : elle accélère la
 * navigation d'une session, elle ne décide pas de ce qui reste vrai d'une session à l'autre.
 */
export interface SouvenirDirect {
  recherche: string;
  listes: string[];
  pays: string[];
  fiabilites: string[];
  favorisSeuls: boolean;
  /** Les chaînes déjà reçues, pages parcourues comprises : revenir ne doit pas tout redemander. */
  chaines: ChaineDirect[];
  total: number;
  /** Position de défilement de la page, en pixels. */
  defilement: number;
}

const VIERGE: SouvenirDirect = {
  recherche: "", listes: [], pays: [], fiabilites: [], favorisSeuls: false,
  chaines: [], total: 0, defilement: 0,
};

let souvenir: SouvenirDirect = { ...VIERGE };

export function lireSouvenirDirect(): SouvenirDirect {
  return souvenir;
}

export function retenirSouvenirDirect(part: Partial<SouvenirDirect>): void {
  souvenir = { ...souvenir, ...part };
}

/**
 * Oublier ce qui a été retenu.
 *
 * À appeler quand le profil change : les favorites sont à lui, et une grille filtrée sur les chaînes
 * de quelqu'un d'autre serait un souvenir qui ment.
 */
export function oublierSouvenirDirect(): void {
  souvenir = { ...VIERGE };
}
