/**
 * Reconnaître un décodage qui ne suit pas, à partir de ce que le navigateur compte.
 *
 * Le serveur peut désormais servir un fichier tel quel malgré un désaccord annoncé — voir
 * `essai-direct.ts` côté serveur. Ce pari n'est tenable que si son échec se voit : c'est ici qu'on le
 * voit.
 *
 * Trois formes d'échec, trois détections distinctes :
 *
 * 1. **Le navigateur refuse le fichier.** Une erreur média est levée avant la première image ; le
 *    lecteur la traite déjà et signale le codec au serveur.
 * 2. **Le réseau ne suit pas.** Ce sont des coupures, comptées ailleurs — voir `debit-reseau.ts`.
 * 3. **Le décodeur accepte mais ne tient pas la cadence.** Aucune erreur, aucune coupure : des images
 *    sont décodées puis jetées faute de temps. L'image saccade, et rien dans le lecteur ne le
 *    remarque. C'est le seul cas que ce module traite, et c'est précisément celui que l'essai direct
 *    peut provoquer en relevant le plafond de définition.
 *
 * ## Pourquoi une fenêtre glissante plutôt qu'un cumul
 *
 * Le rapport cumulé depuis le début dilue : cent images perdues au démarrage disparaissent au bout de
 * dix minutes de lecture parfaite, et à l'inverse elles suffisent à faire basculer une lecture qui
 * vient de commencer. On compare donc chaque relevé au précédent, et l'on ne conclut que sur
 * plusieurs fenêtres consécutives — un décodeur perd quelques images à l'ouverture d'un fichier sans
 * que cela dise quoi que ce soit de la suite.
 *
 * ## Le seuil
 *
 * Cinq pour cent, tenus trois fenêtres d'affilée. À vingt-quatre images par seconde et un relevé par
 * seconde, cela fait plus d'une image perdue par seconde pendant trois secondes : une saccade que
 * l'œil voit. En dessous, la perte est réelle mais imperceptible, et basculer coûterait plus cher que
 * de la laisser passer — l'objectif n'est pas la perfection théorique mais l'absence de gêne.
 */

/** Un relevé de `HTMLVideoElement.getVideoPlaybackQuality()`, tel quel. */
export interface EchantillonDecodage {
  /** `totalVideoFrames` : images créées pour la lecture, perdues comprises. Cumulé depuis le début. */
  total: number;
  /** `droppedVideoFrames` : images créées mais jamais affichées. Cumulé depuis le début. */
  perdues: number;
}

/** Part d'images perdues au-delà de laquelle la saccade devient visible. */
export const SEUIL_IMAGES_PERDUES = 0.05;

/** Nombre de fenêtres consécutives au-dessus du seuil avant de conclure. */
export const FENETRES_AVANT_REPLI = 3;

/**
 * En dessous de ce nombre d'images, une fenêtre ne prouve rien.
 *
 * Un onglet masqué, une lecture en pause ou un relevé arrivé trop tôt produisent des fenêtres quasi
 * vides où deux images perdues sur trois font soixante-six pour cent. Ces fenêtres ne sont pas
 * comptées comme bonnes : elles interrompent la série, ce qui repousse la conclusion au lieu de la
 * précipiter.
 */
export const IMAGES_MINIMUM_PAR_FENETRE = 10;

/** La part d'images perdues entre deux relevés, ou `null` si la fenêtre ne prouve rien. */
export function pertesDeLaFenetre(avant: EchantillonDecodage, apres: EchantillonDecodage): number | null {
  const total = apres.total - avant.total;
  const perdues = apres.perdues - avant.perdues;
  // Un compteur qui recule signale un nouvel élément vidéo, donc de nouveaux compteurs repartis de
  // zéro. Comparer les deux relevés n'aurait aucun sens.
  if (total < 0 || perdues < 0) return null;
  if (total < IMAGES_MINIMUM_PAR_FENETRE) return null;
  return perdues / total;
}

/**
 * Le décodage a-t-il décroché au point de justifier une session convertie ?
 *
 * Fonction pure : elle s'éprouve sans navigateur et sans lecture.
 */
export function decodageDegrade(echantillons: EchantillonDecodage[]): boolean {
  if (echantillons.length < FENETRES_AVANT_REPLI + 1) return false;
  const derniers = echantillons.slice(-(FENETRES_AVANT_REPLI + 1));
  for (let rang = 1; rang < derniers.length; rang += 1) {
    const part = pertesDeLaFenetre(derniers[rang - 1]!, derniers[rang]!);
    if (part == null || part < SEUIL_IMAGES_PERDUES) return false;
  }
  return true;
}
