import type { MediaChapter } from "@flixtunes/contracts";

/**
 * Où commencent les génériques, quand le fichier le dit.
 *
 * Rien ne les « détecte » au sens de l'analyse d'image : ce serait coûteux et incertain. Ce qui existe
 * déjà, ce sont les **chapitres** que porte une bonne partie des fichiers, et dont certains sont
 * explicitement nommés. Mesuré sur la médiathèque de référence, 9 761 médias analysés :
 *
 * Mesuré sur 8 190 épisodes, dont **4 258 (52 %) portent des chapitres** — c'est le plafond de ce que
 * cette approche peut atteindre :
 *
 * | | épisodes | part de ceux qui ont des chapitres |
 * | --- | --- | --- |
 * | générique de fin **nommé** | 1 577 | 37 % |
 * | générique de fin **déduit de la position** | 1 994 | 47 % |
 * | **total** | **3 571 (44 %)** | **84 %** |
 * | introduction nommée | 1 538 | 36 % |
 *
 * Le générique de fin commence en médiane à 97,1 % du film et dure 56 s ; l'introduction dure 79 s.
 *
 * Le calcul vit ici plutôt que dans chaque client : le Web et Android le liraient sinon chacun à sa
 * façon, et la première divergence ne se verrait que sur un fichier particulier, chez une personne.
 */

/**
 * Les intitulés d'un générique de fin, en anglais comme en français.
 *
 * Le préfixe numéroté est toléré : la médiathèque porte 45 chapitres « 8. End Credits », que la
 * première version rejetait sur son seul point d'ancrage. « Ending » est la convention de l'animation.
 */
const FIN = /^\s*(\d+\s*[.)\-]\s*)?(end\s*)?(credits?|ending|closing(\s*credits?)?|outro|g[ée]n[ée]rique\s*(de\s*)?fin)\s*$/i;

/** Ceux d'une introduction, même tolérance de numérotation. */
const DEBUT = /^\s*(\d+\s*[.)\-]\s*)?(intro(duction)?|opening(\s*credits?)?|op|main\s*titles?|g[ée]n[ée]rique\s*(de\s*)?d[ée]but)\s*$/i;

/**
 * « Générique », tout court, ne dit pas lequel.
 *
 * Le mot désigne les deux en français, et la médiathèque de référence en porte des deux sortes sous
 * ce seul intitulé. Seule sa position tranche : dans le dernier cinquième c'est la fin, dans la
 * première moitié c'est le début. Entre les deux, on ne conclut pas.
 */
const AMBIGU = /^\s*(\d+\s*[.)\-]\s*)?g[ée]n[ée]rique\s*$/i;

/** Un générique de fin commence dans le dernier cinquième du film, jamais au milieu. */
const PART_FIN = 0.8;

/**
 * Le dernier chapitre d'un épisode, quand il en dit long par sa seule place.
 *
 * S'en tenir aux intitulés ne couvrait que 37 % des épisodes chapitrés : la plupart numérotent leurs
 * chapitres sans les nommer — « Chapter 6 », « Chapitre 06 », « Scene 8 ». Or un **dernier** chapitre
 * qui s'ouvre après 88 % du film et dure entre vingt secondes et deux minutes et demie n'est
 * pratiquement jamais une scène : mesurés sur 1 994 épisodes, ces segments durent 42 s en médiane,
 * exactement le profil d'un générique nommé.
 *
 * C'est une déduction, et elle est assumée comme telle. Se tromper coûte une carte qui s'ouvre un peu
 * tôt sur la dernière scène — la lecture, elle, n'est pas touchée, et « Annuler » la referme. La
 * fenêtre est donc plus étroite que celle des chapitres nommés, des deux côtés.
 */
const PART_FIN_DEDUITE = 0.88;
const DEDUITE_PLANCHER = 20;
const DEDUITE_PLAFOND = 150;

/** En deçà, le « dernier chapitre » ne veut rien dire : un fichier coupé en deux n'est pas chapitré. */
const CHAPITRES_MINIMUM = 3;

/** Une introduction se tient dans la première moitié. */
const PART_DEBUT = 0.5;

/**
 * Bornes de bon sens, tirées de la mesure.
 *
 * Sous le plancher, l'annonce arriverait trop tard pour servir. Au-dessus du plafond, l'étiquette est
 * fausse : la mesure a relevé un « Credits » de 7 445 secondes et une « Intro » de 2 336 — des
 * chapitres mal nommés couvrant tout le film. Mieux vaut alors ne rien proposer que proposer à tort.
 */
const FIN_PLANCHER = 12;
const FIN_PLAFOND = 600;
const DEBUT_PLANCHER = 8;
const DEBUT_PLAFOND = 300;

/** Le segment d'introduction, en secondes de film. */
export interface Introduction { startSeconds: number; endSeconds: number }

export interface MarqueursGenerique {
  /** Début du générique de fin, ou `null` : le moment d'annoncer l'épisode suivant. */
  creditsStartSeconds: number | null;
  /** Introduction repérée, ou `null` : de quoi proposer de la passer. */
  intro: Introduction | null;
}

function nombreFini(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

export function marqueursGenerique(chapters: MediaChapter[] | undefined | null,
  durationSeconds: number | null | undefined): MarqueursGenerique {
  const duree = nombreFini(durationSeconds);
  if (!chapters?.length || !duree || duree <= 0) return { creditsStartSeconds: null, intro: null };

  let creditsStartSeconds: number | null = null;
  let intro: Introduction | null = null;

  for (const chapitre of chapters) {
    const titre = chapitre.title ?? "";
    const debut = nombreFini(chapitre.startSeconds);
    if (debut == null || debut < 0 || debut >= duree) continue;
    const part = debut / duree;
    const ambigu = AMBIGU.test(titre);

    if (creditsStartSeconds == null && (FIN.test(titre) || (ambigu && part >= PART_FIN))) {
      const restant = duree - debut;
      if (debut > 0 && part >= PART_FIN && restant >= FIN_PLANCHER && restant <= FIN_PLAFOND) {
        creditsStartSeconds = debut;
        continue;
      }
    }

    if (intro == null && (DEBUT.test(titre) || (ambigu && part <= PART_DEBUT))) {
      const fin = nombreFini(chapitre.endSeconds);
      if (fin == null || fin <= debut || fin >= duree) continue;
      const longueur = fin - debut;
      if (part <= PART_DEBUT && longueur >= DEBUT_PLANCHER && longueur <= DEBUT_PLAFOND) {
        intro = { startSeconds: debut, endSeconds: fin };
      }
    }
  }

  if (creditsStartSeconds == null && chapters.length >= CHAPITRES_MINIMUM) {
    const dernier = chapters[chapters.length - 1];
    const debut = dernier ? nombreFini(dernier.startSeconds) : null;
    if (debut != null && debut > 0 && debut < duree && debut / duree >= PART_FIN_DEDUITE) {
      const restant = duree - debut;
      if (restant >= DEDUITE_PLANCHER && restant <= DEDUITE_PLAFOND) creditsStartSeconds = debut;
    }
  }
  return { creditsStartSeconds, intro };
}
