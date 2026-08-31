import type { CatalogSort } from "@flixtunes/contracts";

/**
 * Ce que le catalogue retrouve en revenant d'un film.
 *
 * C'est le même défaut que celui du direct, au même endroit du code : ouvrir une fiche remplace tout
 * l'écran par le lecteur, le catalogue est démonté, et avec lui ses `useState` — tri, filtre,
 * recherche, décennie, genres cochés, lettre de l'index, pages déjà parcourues, position de
 * défilement. On revenait donc en haut d'une liste sans filtre après avoir mis vingt secondes à
 * arriver là où on en était.
 *
 * **Pourquoi une mémoire à part et non `server-cache`.** Celui-ci périme au bout de cinq minutes, ce
 * qui est juste pour des données du serveur — au-delà, mieux vaut redemander. Mais un film dure une
 * heure et demie : les critères seraient perdus précisément dans le cas normal. Ici rien ne périme,
 * parce qu'il ne s'agit pas de données mais **d'un choix de la personne**, et un choix ne se démode
 * pas pendant qu'on regarde un film.
 *
 * Une mémoire par sorte : les films et les séries ne se parcourent pas avec les mêmes filtres, et
 * revenir de l'un ne doit rien changer à l'autre. Comme le cache du catalogue, elle ne survit pas au
 * rechargement de la page.
 */
export interface SouvenirCatalogue {
  sort: CatalogSort;
  filter: "all" | "progress" | "watched" | "unwatched";
  query: string;
  decade: "all" | number;
  genres: string[];
  /** Point de départ absolu de la fenêtre reçue, non nul après un saut par l'index A–Z. */
  initialOffset: number;
  selectedLetter: string | null;
  /** Position de défilement de la page, en pixels. */
  defilement: number;
}

const VIERGE: SouvenirCatalogue = {
  sort: "title", filter: "all", query: "", decade: "all", genres: [],
  initialOffset: 0, selectedLetter: null, defilement: 0,
};

const souvenirs = new Map<string, SouvenirCatalogue>();

export function lireSouvenirCatalogue(sorte: string): SouvenirCatalogue {
  return souvenirs.get(sorte) ?? VIERGE;
}

export function retenirSouvenirCatalogue(sorte: string, part: Partial<SouvenirCatalogue>): void {
  souvenirs.set(sorte, { ...lireSouvenirCatalogue(sorte), ...part });
}

/**
 * Oublier ce qui a été retenu.
 *
 * À appeler quand le profil change : la progression et les envies sont les siennes, et rouvrir une
 * liste filtrée sur « en cours » avec les films de quelqu'un d'autre serait un souvenir qui ment.
 */
export function oublierSouvenirsCatalogue(): void {
  souvenirs.clear();
}
