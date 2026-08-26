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
/** Ce qu'on sait déjà du générique qu'on cherche, quand on le sait. */
export interface Attente {
  /**
   * Durée visée, en secondes.
   *
   * Décisive, et c'est *Silo* qui l'a montré : à défaut, on retient le plus long passage commun, et
   * sur cette série-là ce n'est pas le générique mais un bloc récurrent de 90 s situé juste avant.
   * Or les épisodes chapitrés de la même série disent que l'introduction dure **exactement 77,0 s** —
   * c'est une propriété de la saison. Quand cette valeur est connue, on choisit le candidat qui s'en
   * approche plutôt que le plus long.
   */
  dureeSecondes: number;
  /** Écart toléré autour de cette durée. */
  toleranceSecondes: number;
}

/** Le meilleur candidat d'un alignement donné : où il commence et combien de cases il couvre. */
interface Candidat { debut: number; longueur: number }

/**
 * Parcourt un alignement et en retient le meilleur passage commun.
 *
 * Séparé de la recherche d'alignement pour être appelé deux fois : une première sur des enveloppes
 * dégrossies, pour trouver *où* chercher, une seconde à pleine résolution, pour trouver *quoi*.
 *
 * Les sommes glissent d'une position à l'autre au lieu d'être recalculées : chaque fenêtre coûte
 * alors deux additions et deux soustractions, quelle que soit sa largeur.
 */
function candidatDeLAlignement(a: Float64Array, b: Float64Array, decalage: number, fenetre: number,
  trou: number, meilleurQue: (candidat: Candidat, reference: Candidat | null) => boolean,
  seuil = SEUIL_CORRELATION): { candidat: Candidat | null; tenues: number; pic: number } {
  const departA = Math.max(0, decalage);
  const departB = Math.max(0, -decalage);
  const commun = Math.min(a.length - departA, b.length - departB);
  if (commun < fenetre) return { candidat: null, tenues: 0, pic: 0 };

  let sommeA = 0; let sommeB = 0; let carreA = 0; let carreB = 0; let produits = 0;
  const glisser = (index: number, signe: number) => {
    const va = a[departA + index] ?? 0;
    const vb = b[departB + index] ?? 0;
    sommeA += signe * va; sommeB += signe * vb;
    carreA += signe * va * va; carreB += signe * vb * vb;
    produits += signe * va * vb;
  };
  for (let index = 0; index < fenetre; index += 1) glisser(index, 1);

  let candidat: Candidat | null = null;
  let courantDebut = -1;
  let dernierTenu = -1;
  let tenues = 0;
  let pic = 0;
  const cloturer = () => {
    if (courantDebut < 0) return;
    const propose = { debut: courantDebut, longueur: dernierTenu - courantDebut + fenetre };
    if (meilleurQue(propose, candidat)) candidat = propose;
    courantDebut = -1;
  };
  /*
   * Les sommes se refont périodiquement, et cette précaution n'est pas décorative.
   *
   * Faire glisser une somme sur des milliers de positions accumule l'erreur d'arrondi, et la variance
   * — calculée par différence de deux grands nombres presque égaux — l'amplifie. Sans ce
   * rafraîchissement, deux séries sur cinq changeaient de résultat : le vrai passage commun perdait
   * de justesse contre un candidat plus long mais faux, la dérive ayant suffi à inverser le
   * classement. Le coût est négligeable, un recalcul toutes les mille positions.
   */
  const RAFRAICHIR = 1024;
  for (let position = 0; position + fenetre <= commun; position += 1) {
    if (position > 0 && position % RAFRAICHIR === 0) {
      sommeA = 0; sommeB = 0; carreA = 0; carreB = 0; produits = 0;
      for (let index = position; index < position + fenetre; index += 1) glisser(index, 1);
    } else if (position > 0) { glisser(position - 1, -1); glisser(position + fenetre - 1, 1); }
    const covariance = produits - (sommeA * sommeB) / fenetre;
    const varianceA = carreA - (sommeA * sommeA) / fenetre;
    const varianceB = carreB - (sommeB * sommeB) / fenetre;
    const denominateur = Math.sqrt(varianceA * varianceB);
    const score = denominateur < 1e-9 ? 0 : covariance / denominateur;
    if (score > pic) pic = score;
    if (score >= seuil) {
      if (courantDebut < 0) courantDebut = position;
      dernierTenu = position;
      tenues += 1;
    } else if (courantDebut >= 0 && position - dernierTenu > trou) {
      cloturer();
    }
  }
  cloturer();
  return { candidat, tenues, pic };
}


export function segmentCommun(a: Float64Array, b: Float64Array, attente?: Attente | null,
  pasMs = PAS_MS): SegmentCommun | null {
  if (a.length < FENETRE_LOCALE || b.length < FENETRE_LOCALE) return null;

  const visee = attente ? (attente.dureeSecondes * 1000) / pasMs : null;
  const tolerance = attente ? (attente.toleranceSecondes * 1000) / pasMs : 0;

  /*
   * Un candidat vaut mieux qu'un autre s'il colle à la durée visée ; à défaut, s'il est plus long.
   *
   * L'alignement et le candidat se choisissent **ensemble**, et deux versions ont échoué avant celle-ci.
   * La première corrélait les deux extraits sur toute leur longueur : un générique de vingt secondes
   * noyé dans trois cents ne déplace pas une corrélation d'ensemble, et aucun cas réel ne ressortait.
   * La deuxième choisissait l'alignement au nombre de fenêtres concordantes puis cherchait le candidat
   * dedans : sur *Silo*, le meilleur alignement porte un bloc récurrent de 90 s qui n'est pas le
   * générique, et la durée attendue arrivait trop tard pour peser.
   */
  const meilleurQue = (candidat: Candidat, reference: Candidat | null, echelle = 1): boolean => {
    if (!reference) return true;
    if (visee == null) return candidat.longueur > reference.longueur;
    const vise = visee / echelle;
    const marge = Math.max(1, tolerance / echelle);
    const dansCandidat = Math.abs(candidat.longueur - vise) <= marge;
    const dansReference = Math.abs(reference.longueur - vise) <= marge;
    if (dansCandidat !== dansReference) return dansCandidat;
    if (dansCandidat) return Math.abs(candidat.longueur - vise) < Math.abs(reference.longueur - vise);
    return candidat.longueur > reference.longueur;
  };

  /*
   * Tous les décalages, et pas d'approximation.
   *
   * Quatre raccourcis ont été essayés et mesurés, tous perdants : enveloppe résumée à une valeur par
   * seconde, classement de ces alignements par nombre de fenêtres concordantes puis par pic, et
   * enfin une corrélation croisée par transformée de Fourier. Les trois premiers effacent la
   * structure fine dont la ressemblance dépend ; le quatrième propose de bons décalages quand le
   * thème est long, et rate ceux qui durent vingt secondes — celui de *The Office*, le plus court
   * rencontré. Aucun ne descendait sous quatre séries justes sur cinq.
   *
   * La vitesse vient donc d'ailleurs, sans rien sacrifier : les sommes de chaque fenêtre **glissent**
   * d'une position à la suivante au lieu d'être recalculées, et la fenêtre d'analyse ne s'élargit que
   * si la courte n'a rien donné (voir `marqueurs-son`). Le coût reste quadratique, mais avec une
   * constante bien plus faible et sur une longueur bien plus courte dans la grande majorité des cas.
   */
  let retenu: { decalage: number; debut: number; longueur: number } | null = null;
  for (let decalage = -(b.length - FENETRE_LOCALE); decalage <= a.length - FENETRE_LOCALE; decalage += 1) {
    const { candidat } = candidatDeLAlignement(a, b, decalage, FENETRE_LOCALE, TROU_TOLERE, meilleurQue);
    if (candidat && meilleurQue(candidat, retenu)) {
      retenu = { decalage, debut: candidat.debut, longueur: candidat.longueur };
    }
  }
  if (!retenu) return null;

  const debutA = Math.max(0, retenu.decalage);
  const debutB = Math.max(0, -retenu.decalage);
  const commun = Math.min(a.length - debutA, b.length - debutB);
  let meilleurDebut = retenu.debut;
  let meilleureLongueur = retenu.longueur;

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
