/**
 * Retrouver le segment que deux épisodes ont en commun, par le son.
 *
 * Le thème d'ouverture d'une série est **le même fichier audio** d'un épisode à l'autre : même
 * musique, même mixage, souvent le même encodage. Deux épisodes mis côte à côte partagent donc une
 * portion strictement identique, et c'est elle, l'introduction. Le carton de fin obéit à la même
 * règle. Aucune analyse d'image n'est nécessaire, et rien de tout cela ne tourne pendant qu'on
 * regarde : la comparaison se fait une fois, au scan, et ne laisse qu'un nombre en base.
 *
 * Ce module ne lit aucun fichier. Il travaille sur des **enveloppes** — l'énergie du son résumée à
 * une valeur toutes les cent millisecondes — ce qui suffit largement à reconnaître un thème et rend
 * le raisonnement vérifiable sur des signaux fabriqués, sans médiathèque.
 *
 * ## Pourquoi une enveloppe plutôt qu'une vraie empreinte acoustique
 *
 * Une empreinte à la Chromaprint sert à reconnaître un morceau **malgré** un réencodage, un bruit de
 * fond, un enregistrement au micro. Ici le problème est bien plus facile : les deux extraits sortent
 * du même master. Une enveloppe d'énergie, dix valeurs par seconde, les fait coïncider sans les
 * milliers de lignes qu'une empreinte spectrale demanderait.
 */

/** Durée d'une case d'enveloppe, en millisecondes. Dix par seconde : assez fin pour un thème. */
export const PAS_MS = 100;

/**
 * Corrélation minimale pour tenir deux cases pour identiques.
 *
 * Haute à dessein. Le coût d'un faux positif est une introduction inventée, qu'on proposerait de
 * passer au milieu d'une scène ; celui d'un faux négatif est simplement de ne rien proposer.
 */
export const SEUIL_CORRELATION = 0.82;

/** En deçà, ce n'est pas un générique mais une coïncidence — un silence partagé, un bruitage. */
export const LONGUEUR_MINIMALE_MS = 12_000;

/** Au-delà, ce n'est plus un générique : deux épisodes ne partagent pas cinq minutes de son. */
export const LONGUEUR_MAXIMALE_MS = 300_000;

/**
 * Fenêtre glissante sur laquelle la ressemblance locale est jugée.
 *
 * Deux secondes pour trouver le segment : assez large pour qu'un passage calme du thème ne le coupe
 * pas en deux. Mais une fenêtre large **floue les bords** — à cheval sur la frontière, treize cases de
 * thème sur vingt suffisent à tenir le seuil, et le segment déborde de près d'une seconde. D'où un
 * second passage, plus court, qui resserre les deux extrémités une fois la région connue.
 */
const FENETRE_LOCALE = 20; // 2 secondes

/**
 * Écart maximal, en écarts-types, entre deux cases tenues pour identiques.
 *
 * Le second passage ne mesure plus une corrélation mais une **différence**. La raison est un défaut
 * constaté : sur six cases de bruit, une corrélation de Pearson dépasse 0,82 par pur hasard assez
 * souvent pour placer la frontière n'importe où. Or dans la zone commune les deux enveloppes ne se
 * ressemblent pas, elles **coïncident** — à un gain près, que la normalisation efface. Comparer les
 * valeurs une à une est donc à la fois plus simple et bien plus net.
 */
const ECART_MAXIMAL = 0.5;

/**
 * Trous tolérés à l'intérieur d'un passage commun, en cases.
 *
 * Un thème n'est pas un bloc lisse : il respire, et une mesure calme fait passer une fenêtre sous le
 * seuil sans que le passage s'arrête pour autant. Constaté sur *Bleach*, où le générique ressortait
 * en trois morceaux — 0→44,2 s, 45,4→89,6 s, 87,8→110,9 s — coupés par des trous d'une seconde. Sans
 * ce raccommodage, seul le premier morceau était retenu et l'introduction paraissait deux fois plus
 * courte qu'elle n'est.
 */
const TROU_TOLERE = 30;

/**
 * Nombre de cases consécutives qui doivent coïncider pour qu'on se déclare à l'intérieur du thème.
 *
 * Une seule ne prouve rien : deux enveloppes indépendantes, une fois normalisées, tombent à moins
 * d'un demi écart-type l'une de l'autre **une fois sur quatre**. Dix d'affilée ramènent ce hasard à
 * deux chances sur un million, tandis qu'à l'intérieur du thème elles coïncident toutes.
 */
const CASES_CONSECUTIVES = 10;

/** Le segment commun, exprimé en secondes depuis le début de chaque extrait. */
export interface SegmentCommun {
  /** Début dans le premier extrait. */
  debutA: number;
  /** Début dans le second. */
  debutB: number;
  /** Durée commune. */
  dureeSecondes: number;
  /** Ressemblance moyenne sur le segment, entre 0 et 1. */
  score: number;
}

/**
 * L'énergie du son, une valeur par pas.
 *
 * Le logarithme est là pour une raison précise : l'oreille et les encodeurs travaillent en décibels,
 * et une comparaison linéaire serait dominée par les seuls passages forts. Un thème d'ouverture a
 * une **forme** — des attaques, des respirations — et c'est cette forme qu'on veut reconnaître.
 */
export function enveloppe(echantillons: Int16Array, frequence: number, pasMs = PAS_MS): Float64Array {
  const parCase = Math.max(1, Math.round((frequence * pasMs) / 1000));
  const cases = Math.floor(echantillons.length / parCase);
  const sortie = new Float64Array(cases);
  for (let index = 0; index < cases; index += 1) {
    let somme = 0;
    const debut = index * parCase;
    for (let position = debut; position < debut + parCase; position += 1) {
      const valeur = (echantillons[position] ?? 0) / 32768;
      somme += valeur * valeur;
    }
    sortie[index] = Math.log10(Math.sqrt(somme / parCase) + 1e-6);
  }
  return sortie;
}

/** Corrélation de Pearson entre deux tranches alignées. Renvoie 0 quand l'une est plate. */
function correlation(a: Float64Array, b: Float64Array, decalageA: number, decalageB: number, longueur: number): number {
  if (longueur < 2) return 0;
  let sommeA = 0; let sommeB = 0;
  for (let index = 0; index < longueur; index += 1) {
    sommeA += a[decalageA + index] ?? 0;
    sommeB += b[decalageB + index] ?? 0;
  }
  const moyenneA = sommeA / longueur; const moyenneB = sommeB / longueur;
  let covariance = 0; let varianceA = 0; let varianceB = 0;
  for (let index = 0; index < longueur; index += 1) {
    const ecartA = (a[decalageA + index] ?? 0) - moyenneA;
    const ecartB = (b[decalageB + index] ?? 0) - moyenneB;
    covariance += ecartA * ecartB;
    varianceA += ecartA * ecartA;
    varianceB += ecartB * ecartB;
  }
  const denominateur = Math.sqrt(varianceA * varianceB);
  return denominateur < 1e-9 ? 0 : covariance / denominateur;
}

/**
 * Le plus long segment que deux enveloppes ont en commun.
 *
 * Deux temps. D'abord le **décalage** : les deux épisodes ne placent pas leur thème au même instant —
 * l'un ouvre sur un résumé, l'autre sur une scène froide — et il faut donc essayer tous les
 * alignements plausibles et retenir celui qui ressemble le plus. Ensuite l'**étendue** : autour du
 * meilleur alignement, on avance des deux côtés tant que la ressemblance locale tient, ce qui donne
 * les bornes du thème sans supposer sa durée.
 *
 * Renvoie `null` dès que le résultat n'est pas franc : trop court, trop long, ou trop tiède.
 */
export function segmentCommun(a: Float64Array, b: Float64Array, pasMs = PAS_MS): SegmentCommun | null {
  if (a.length < FENETRE_LOCALE || b.length < FENETRE_LOCALE) return null;

  /*
   * Choisir l'alignement sur la **concordance locale**, jamais sur la globale.
   *
   * Première version, et faute de conception : le décalage était choisi en corrélant les deux
   * extraits sur toute leur longueur commune. Cela marchait sur des signaux d'essai où le thème
   * occupait la moitié du signal — et sur rien d'autre. Dans un vrai épisode le générique fait vingt
   * secondes sur trois cents : noyé dans deux cent quatre-vingts secondes de contenu sans rapport, il
   * ne déplace pas une corrélation d'ensemble d'un pouce. Aucun des trois cas réels ne ressortait.
   *
   * On compte donc, pour chaque décalage, **le nombre de fenêtres de deux secondes qui s'accordent**.
   * C'est exactement ce qu'on cherche — la longueur du passage commun — et un thème de vingt secondes
   * y produit un pic net là où le reste ne produit rien.
   *
   * Le coût reste tenable grâce aux sommes cumulées : chaque fenêtre se calcule en temps constant,
   * soit environ neuf millions d'opérations pour deux extraits de cinq minutes — quelques dizaines de
   * millisecondes, une fois, au scan.
   */
  const cumul = (source: Float64Array): { somme: Float64Array; carre: Float64Array } => {
    const somme = new Float64Array(source.length + 1);
    const carre = new Float64Array(source.length + 1);
    for (let index = 0; index < source.length; index += 1) {
      const valeur = source[index] ?? 0;
      somme[index + 1] = (somme[index] ?? 0) + valeur;
      carre[index + 1] = (carre[index] ?? 0) + valeur * valeur;
    }
    return { somme, carre };
  };
  const cumulA = cumul(a);
  const cumulB = cumul(b);
  const tranche = (cumule: Float64Array, debut: number, longueur: number): number =>
    (cumule[debut + longueur] ?? 0) - (cumule[debut] ?? 0);

  let meilleurDecalage = 0;
  let meilleurCompte = 0;
  let meilleurPic = 0;
  for (let decalage = -(b.length - FENETRE_LOCALE); decalage <= a.length - FENETRE_LOCALE; decalage += 1) {
    const departA = Math.max(0, decalage);
    const departB = Math.max(0, -decalage);
    const commun = Math.min(a.length - departA, b.length - departB);
    if (commun < FENETRE_LOCALE) continue;

    // Somme cumulée des produits, propre à ce décalage.
    const produits = new Float64Array(commun + 1);
    for (let index = 0; index < commun; index += 1) {
      produits[index + 1] = (produits[index] ?? 0) + (a[departA + index] ?? 0) * (b[departB + index] ?? 0);
    }
    let compte = 0;
    let pic = 0;
    for (let position = 0; position + FENETRE_LOCALE <= commun; position += 1) {
      const sA = tranche(cumulA.somme, departA + position, FENETRE_LOCALE);
      const sB = tranche(cumulB.somme, departB + position, FENETRE_LOCALE);
      const cA = tranche(cumulA.carre, departA + position, FENETRE_LOCALE);
      const cB = tranche(cumulB.carre, departB + position, FENETRE_LOCALE);
      const sAB = (produits[position + FENETRE_LOCALE] ?? 0) - (produits[position] ?? 0);
      const covariance = sAB - (sA * sB) / FENETRE_LOCALE;
      const varianceA = cA - (sA * sA) / FENETRE_LOCALE;
      const varianceB = cB - (sB * sB) / FENETRE_LOCALE;
      const denominateur = Math.sqrt(varianceA * varianceB);
      const score = denominateur < 1e-9 ? 0 : covariance / denominateur;
      if (score >= SEUIL_CORRELATION) compte += 1;
      if (score > pic) pic = score;
    }
    if (compte > meilleurCompte || (compte === meilleurCompte && pic > meilleurPic)) {
      meilleurCompte = compte; meilleurPic = pic; meilleurDecalage = decalage;
    }
  }
  if (meilleurCompte === 0) return null;

  const debutA = Math.max(0, meilleurDecalage);
  const debutB = Math.max(0, -meilleurDecalage);
  const commun = Math.min(a.length - debutA, b.length - debutB);
  const locales = new Float64Array(Math.max(0, commun - FENETRE_LOCALE + 1));
  for (let index = 0; index < locales.length; index += 1) {
    locales[index] = correlation(a, b, debutA + index, debutB + index, FENETRE_LOCALE);
  }

  // La plus longue suite de fenêtres qui tiennent le seuil, les petits trous recousus.
  let meilleurDebut = -1;
  let meilleureLongueur = 0;
  let courantDebut = -1;
  let dernierTenu = -1;
  const cloturer = () => {
    if (courantDebut < 0) return;
    const longueur = dernierTenu - courantDebut + FENETRE_LOCALE;
    if (longueur > meilleureLongueur) { meilleureLongueur = longueur; meilleurDebut = courantDebut; }
    courantDebut = -1;
  };
  for (let index = 0; index < locales.length; index += 1) {
    if ((locales[index] ?? 0) >= SEUIL_CORRELATION) {
      if (courantDebut < 0) courantDebut = index;
      dernierTenu = index;
    } else if (courantDebut >= 0 && index - dernierTenu > TROU_TOLERE) {
      cloturer();
    }
  }
  cloturer();
  if (meilleurDebut < 0) return null;

  const normaliser = (source: Float64Array, decalage: number): { centre: number; echelle: number } => {
    let somme = 0;
    for (let index = 0; index < meilleureLongueur; index += 1) somme += source[decalage + meilleurDebut + index] ?? 0;
    const centre = somme / meilleureLongueur;
    let variance = 0;
    for (let index = 0; index < meilleureLongueur; index += 1) {
      variance += ((source[decalage + meilleurDebut + index] ?? 0) - centre) ** 2;
    }
    return { centre, echelle: Math.sqrt(variance / meilleureLongueur) || 1 };
  };
  const normA = normaliser(a, debutA);
  const normB = normaliser(b, debutB);
  const coincide = (position: number): boolean => {
    if (position < 0 || position >= commun) return false;
    const zA = ((a[debutA + position] ?? 0) - normA.centre) / normA.echelle;
    const zB = ((b[debutB + position] ?? 0) - normB.centre) / normB.echelle;
    return Math.abs(zA - zB) <= ECART_MAXIMAL;
  };

  /*
   * La fenêtre large ne peut qu'avoir débordé, jamais tronqué : posée exactement sur le début du
   * thème, elle est entièrement à l'intérieur et tient le seuil. On resserre donc, sans jamais
   * élargir — élargir reviendrait à courir après des coïncidences.
   */
  const interieur = (position: number, sens: 1 | -1): boolean => {
    for (let pas = 0; pas < CASES_CONSECUTIVES; pas += 1) {
      if (!coincide(position + sens * pas)) return false;
    }
    return true;
  };
  let debutFin = meilleurDebut;
  const finCoarse = meilleurDebut + meilleureLongueur - 1;
  let finFin = finCoarse;
  while (debutFin <= finFin - CASES_CONSECUTIVES && !interieur(debutFin, 1)) debutFin += 1;
  while (finFin >= debutFin + CASES_CONSECUTIVES && !interieur(finFin, -1)) finFin -= 1;
  if (finFin <= debutFin) return null;
  meilleurDebut = debutFin;
  meilleureLongueur = finFin - debutFin + 1;

  const dureeMs = meilleureLongueur * pasMs;
  if (dureeMs < LONGUEUR_MINIMALE_MS || dureeMs > LONGUEUR_MAXIMALE_MS) return null;
  const score = correlation(a, b, debutA + meilleurDebut, debutB + meilleurDebut, meilleureLongueur);
  if (score < SEUIL_CORRELATION) return null;

  return {
    debutA: ((debutA + meilleurDebut) * pasMs) / 1000,
    debutB: ((debutB + meilleurDebut) * pasMs) / 1000,
    dureeSecondes: dureeMs / 1000,
    score,
  };
}
