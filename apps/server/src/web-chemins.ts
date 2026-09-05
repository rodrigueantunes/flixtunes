import { normaliseForSearch } from "./search-normalise.js";

/**
 * Lire l'arborescence d'une bibliothèque web.
 *
 * Le rangement est **positionnel**, et c'est tout l'intérêt : `Web / Plateforme / Chaîne / …dossiers
 * libres… / vidéo`. Le premier niveau nomme la provenance, le deuxième la chaîne, tout ce qui suit
 * appartient à la personne — playlists le plus souvent, mais pas seulement — et la feuille est la
 * vidéo. Rien n'est deviné : chaque information est à une place connue d'avance.
 *
 * **Pourquoi ce module existe au lieu d'un branchement dans le parseur commun.** `folderContext`
 * prend le dossier parent pour la série et ne remonte au grand-parent que devant un `Saison N` : sur
 * `Chaîne/Playlist/vidéo.mp4`, il ferait de chaque playlist une série distincte. Et `cleanTitle`
 * ampute un titre à partir du premier mot de release — sa règle est `/\b(…|hdr|…)\b.*$/`, qui mange
 * la **fin de la chaîne**. Une vidéo légitimement intitulée « Comparatif HDR10 contre Dolby Vision »
 * s'y réduirait à « Comparatif ». Ce qui est du bruit dans un nom de fichier de film est du sens dans
 * un titre de vidéo ; les deux lectures ne peuvent pas partager de code sans que l'une abîme l'autre.
 *
 * Ce module ne touche donc à rien de ce qui sert aux films et aux séries. Il ne lit ni le disque ni la
 * base : il reçoit deux chaînes de caractères et rend ce qu'elles disent.
 */

/** Le nom sous lequel le serveur désigne une plateforme, indépendamment de l'orthographe du dossier. */
export type Plateforme = string;

/**
 * Les plateformes reconnues, et les orthographes qui y mènent.
 *
 * Reconnaître une plateforme ne sert qu'à savoir **qui interroger** ensuite, et à afficher un badge.
 * Ne pas la reconnaître n'est donc pas une erreur : le dossier garde son nom, la vidéo garde ses
 * métadonnées locales, et seule l'interrogation d'une API dédiée devient impossible. C'est pourquoi
 * une plateforme inconnue rend `null` sans rien invalider.
 */
const ALIAS_PLATEFORMES = new Map<string, Plateforme>([
  ["youtube", "youtube"],
  ["you tube", "youtube"],
  ["yt", "youtube"],
  ["dailymotion", "dailymotion"],
  ["daily motion", "dailymotion"],
  ["vimeo", "vimeo"],
  ["twitch", "twitch"],
  ["peertube", "peertube"],
  ["peer tube", "peertube"],
  ["tiktok", "tiktok"],
  ["tik tok", "tiktok"],
  ["odysee", "odysee"],
  ["rumble", "rumble"],
  ["facebook", "facebook"],
  ["instagram", "instagram"],
]);

/**
 * Ce qu'un groupe entre crochets peut contenir sans être un identifiant.
 *
 * La forme `Titre [identifiant]` est la sortie par défaut des téléchargeurs, mais d'autres outils
 * écrivent `Titre [1080p]` ou `Titre [2024]` au même endroit. Prendre l'un pour l'autre attribuerait
 * une vidéo à une autre, avec l'assurance que donne un identifiant exact — c'est-à-dire la pire
 * erreur possible, celle qu'aucun score ne viendra relire.
 */
const BRUIT_TECHNIQUE =
  /^(?:\d{3,4}p|[248]k|hd|fhd|uhd|sd|sdr|hdr\d*\+?|dv|x26[45]|h\.?26[45]|hevc|av1|vp9|opus|aac|mp3|flac|webm|mp4|mkv|vf|vo|vost(?:fr)?|multi|(?:19|20)\d{2})$/i;

/** Un identifiant YouTube fait onze caractères, toujours. C'est une vérification gratuite. */
const IDENTIFIANT_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

/** Ailleurs, on se contente d'une forme plausible : ni espace, ni ponctuation, ni longueur absurde. */
const IDENTIFIANT_PLAUSIBLE = /^[A-Za-z0-9_-]{4,24}$/;

/** Le dernier groupe entre crochets ou parenthèses du nom, s'il y en a un. */
const GROUPE_FINAL = /\s*[[(]([^[\]()]{2,32})[\])]\s*$/;

/** Ce que le chemin d'une vidéo web apprend, une fois décomposé. */
export interface CheminWeb {
  /** Identifiant normalisé de la plateforme, ou `null` si son nom ne correspond à aucune connue. */
  plateforme: Plateforme | null;
  /** Le nom du dossier de plateforme tel qu'il est écrit sur le disque. */
  plateformeLibelle: string;
  /** Le nom de la chaîne, tel qu'il est écrit. C'est un choix de la personne, on ne le corrige pas. */
  chaine: string;
  /**
   * Chemin du dossier de la chaîne, séparateurs normalisés.
   *
   * C'est l'identité stable de la chaîne — la même clé que `source_folder` pour une série. Deux
   * chaînes homonymes sur deux plateformes ne se confondent pas, puisque leurs chemins diffèrent.
   */
  chaineDossier: string;
  /**
   * Les dossiers traversés entre la chaîne et la vidéo, dans l'ordre, éventuellement vide.
   *
   * Ils sont conservés entiers parce que l'écran doit les rendre tels qu'ils sont sur le disque. Le
   * stockage, lui, n'en retiendra qu'un palier — mais ce n'est pas à ce module d'en décider.
   */
  dossiers: string[];
  /** Le premier dossier sous la chaîne, ou `null` si la vidéo est posée à sa racine. */
  palier: string | null;
  /** Le titre lisible tiré du nom de fichier. Il ne vaut que tant qu'une source mieux informée manque. */
  titre: string;
  /** L'identifiant de la vidéo sur sa plateforme, si le nom de fichier le porte. */
  identifiant: string | null;
}

/** Pourquoi un chemin n'a pas pu être lu. Chaque cas est une erreur de rangement, pas un incident. */
export type RefusChemin = "hors-bibliotheque" | "sans-plateforme" | "sans-chaine";

export type LectureChemin = { valide: true; chemin: CheminWeb } | { valide: false; raison: RefusChemin };

/**
 * Découper un chemin, quel que soit le séparateur qui l'a produit.
 *
 * Un même dossier ne doit pas donner deux clés selon qu'il vienne d'un partage Windows ou du NAS —
 * c'est la précaution que prend déjà `folderContext`, pour la même raison.
 */
function segments(valeur: string): string[] {
  return valeur.split(/[\\/]+/).filter(Boolean);
}

/**
 * Ce qui reste du chemin une fois la racine de la bibliothèque retirée, ou `null` s'il est ailleurs.
 *
 * La comparaison ignore la casse : Windows la ignore aussi, et une racine saisie `N:\Web` doit
 * reconnaître un fichier remonté en `N:\web\…`.
 */
function sousChemin(racine: string, fichier: string): string[] | null {
  const base = segments(racine);
  const complet = segments(fichier);
  if (complet.length <= base.length) return null;
  for (const [rang, attendu] of base.entries()) {
    const present = complet[rang];
    if (present === undefined || present.toLowerCase() !== attendu.toLowerCase()) return null;
  }
  return complet.slice(base.length);
}

/** Le nom d'un dossier de plateforme ramené à l'identifiant que le serveur emploie. */
export function reconnaitPlateforme(libelle: string): Plateforme | null {
  return ALIAS_PLATEFORMES.get(normaliseForSearch(libelle)) ?? null;
}

/**
 * Nettoyer un nom de fichier sans le mutiler.
 *
 * Deux différences volontaires avec le nettoyage des films :
 *
 * - **les points ne sont pas des séparateurs.** Dans un nom de release ils le sont ; dans un titre de
 *   vidéo ils appartiennent au texte. « Node.js » ne doit pas devenir « Node js » ;
 * - **les tirets bas ne le sont que par indice.** Certains outils remplacent les espaces par des
 *   tirets bas, mais seulement quand il n'en reste aucun. Un nom qui contient déjà des espaces garde
 *   donc ses tirets bas — ils font partie du titre.
 *
 * Le reste est de la mise au propre : espaces multiples, tirets et blancs en bordure.
 */
function nettoyerNom(valeur: string): string {
  const sansTiretsBas = valeur.includes(" ") ? valeur : valeur.replace(/_+/g, " ");
  return sansTiretsBas.replace(/\s+/g, " ").replace(/^[\s.\-–—]+|[\s.\-–—]+$/g, "").trim();
}

/**
 * Isoler l'identifiant de plateforme que le nom de fichier porte, s'il en porte un.
 *
 * L'intérêt est considérable : un identifiant exact rend la recherche par titre inutile, et avec elle
 * tout le mécanisme de score, de seuil et de départage — donc toute possibilité de faux appariement.
 * Mais il n'a cette valeur que s'il est sûr, d'où la double vérification : le contenu ne doit pas être
 * du bruit technique connu, et sur YouTube il doit avoir la longueur exacte d'un identifiant YouTube.
 */
function extraireIdentifiant(base: string, plateforme: Plateforme | null): { titre: string; identifiant: string | null } {
  const groupe = base.match(GROUPE_FINAL);
  const contenu = groupe?.[1]?.trim();
  if (!groupe || !contenu) return { titre: base, identifiant: null };

  const sansGroupe = base.slice(0, groupe.index ?? base.length);
  if (BRUIT_TECHNIQUE.test(contenu)) {
    // Du bruit reconnu : on le retire du titre, mais il ne devient pas un identifiant pour autant.
    return { titre: sansGroupe || base, identifiant: null };
  }
  const attendu = plateforme === "youtube" ? IDENTIFIANT_YOUTUBE : IDENTIFIANT_PLAUSIBLE;
  if (!attendu.test(contenu)) {
    // Ni bruit ni identifiant : c'est probablement du texte — « (partie 2) », « (live) ». On le garde.
    return { titre: base, identifiant: null };
  }
  return { titre: sansGroupe || base, identifiant: contenu };
}

/**
 * Lire le chemin d'une vidéo d'une bibliothèque web.
 *
 * Les trois refus possibles sont des défauts de rangement — un fichier posé à la racine, ou dans un
 * dossier de plateforme sans chaîne. Ils sont nommés plutôt que corrigés : deviner à quelle chaîne
 * appartient un fichier mal rangé reviendrait à inventer une provenance, et c'est précisément ce que
 * cette arborescence sert à éviter.
 */
export function lireCheminWeb(racineBibliotheque: string, cheminFichier: string): LectureChemin {
  const relatif = sousChemin(racineBibliotheque, cheminFichier);
  if (!relatif) return { valide: false, raison: "hors-bibliotheque" };
  if (relatif.length < 2) return { valide: false, raison: "sans-plateforme" };
  if (relatif.length < 3) return { valide: false, raison: "sans-chaine" };

  const plateformeLibelle = relatif[0] ?? "";
  const chaineLibelle = relatif[1] ?? "";
  const fichier = relatif.at(-1) ?? "";
  const dossiers = relatif.slice(2, -1);
  const plateforme = reconnaitPlateforme(plateformeLibelle);

  const base = fichier.replace(/\.[^.]+$/, "");
  const { titre, identifiant } = extraireIdentifiant(base, plateforme);
  const racineSegments = segments(racineBibliotheque).length;

  return {
    valide: true,
    chemin: {
      plateforme,
      plateformeLibelle,
      chaine: nettoyerNom(chaineLibelle),
      chaineDossier: segments(cheminFichier).slice(0, racineSegments + 2).join("/"),
      dossiers,
      palier: dossiers[0] ?? null,
      titre: nettoyerNom(titre) || base,
      identifiant,
    },
  };
}
