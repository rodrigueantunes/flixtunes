/**
 * La géométrie des planches de vignettes, partagée par le serveur et l'interface.
 *
 * Chaque survol de la barre de progression déclenchait son propre FFmpeg, sur une tranche de dix
 * secondes. Balayer un film de deux heures, c'est jusqu'à sept cent vingt processus — chacun avec une
 * recherche dans un fichier lourd — précisément au moment où le NAS convertit déjà.
 *
 * Une planche regroupe cent vignettes produites en un seul passage. Le survol d'un film entier coûte
 * alors huit processus au lieu de sept cent vingt, et le second survol ne coûte rien.
 *
 * Les deux côtés doivent s'accorder au pixel près : le serveur pose les vignettes, l'interface les
 * découpe. Une constante recopiée d'un côté seulement décalerait toutes les images sans qu'aucune
 * erreur ne se produise — c'est pourquoi elles vivent dans le contrat plutôt que dans chaque module.
 */

/** Une vignette toutes les dix secondes : assez fin pour viser une scène, assez large pour tenir. */
export const VIGNETTE_INTERVALLE_S = 10;
/** Dix colonnes sur dix lignes : cent vignettes, soit mille secondes de film par planche. */
export const VIGNETTE_COLONNES = 10;
export const VIGNETTE_LIGNES = 10;
/**
 * Taille fixe, et non proportionnelle à la source.
 *
 * Une hauteur calculée depuis le rapport d'image rendrait la découpe dépendante du film : l'interface
 * devrait connaître les dimensions avant de placer quoi que ce soit. Les vignettes sont donc mises à
 * l'échelle puis complétées de bandes noires, de sorte qu'une case fasse toujours 320 × 180.
 */
export const VIGNETTE_LARGEUR = 320;
export const VIGNETTE_HAUTEUR = 180;

/** Nombre de secondes couvertes par une planche. */
export const VIGNETTE_SECONDES_PAR_PLANCHE = VIGNETTE_INTERVALLE_S * VIGNETTE_COLONNES * VIGNETTE_LIGNES;

/** Où trouver la vignette d'un instant : quelle planche, et où dans cette planche. */
export interface PlacementVignette {
  /** Rang de la planche, à partir de zéro. */
  planche: number;
  /** Décalage en pixels à appliquer à l'image de fond, négatif par convention CSS. */
  decalageX: number;
  decalageY: number;
}

/**
 * Situe un instant du film dans la planche qui le contient.
 *
 * Un instant négatif ou non fini est ramené au début : le survol produit parfois des valeurs aberrantes
 * en bord de barre, et il vaut mieux montrer la première image qu'aucune.
 */
export function placerVignette(secondes: number): PlacementVignette {
  const sain = Number.isFinite(secondes) && secondes > 0 ? secondes : 0;
  const rang = Math.floor(sain / VIGNETTE_INTERVALLE_S);
  const parPlanche = VIGNETTE_COLONNES * VIGNETTE_LIGNES;
  const planche = Math.floor(rang / parPlanche);
  const dans = rang % parPlanche;
  // `|| 0` ramène le zéro négatif à zéro. `-(0) * 320` vaut `-0` en JavaScript : sans effet en CSS,
  // mais distinct de `0` pour toute comparaison stricte, et déroutant dans un journal ou un test.
  return {
    planche,
    decalageX: -(dans % VIGNETTE_COLONNES) * VIGNETTE_LARGEUR || 0,
    decalageY: -Math.floor(dans / VIGNETTE_COLONNES) * VIGNETTE_HAUTEUR || 0,
  };
}

/** L'instant du film où commence une planche. */
export function debutDePlanche(planche: number): number {
  return Math.max(0, Math.floor(planche)) * VIGNETTE_SECONDES_PAR_PLANCHE;
}
