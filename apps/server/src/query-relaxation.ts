/**
 * Élargissement progressif d'une requête de métadonnées.
 *
 * Une seule requête était envoyée au fournisseur, avec le titre tiré du nom de fichier et l'année en
 * filtre strict. Quand ce titre porte un mot parasite ou une faute de frappe, la recherche ne renvoie
 * **rien** — et la fiche reste sans correspondance, alors que le calcul de score l'aurait acceptée si
 * on lui avait présenté la bonne candidate.
 *
 * Mesuré sur une médiathèque réelle de 1 449 films, contre le vrai TMDB :
 *
 * | requête envoyée                        | résultat |
 * | -------------------------------------- | -------- |
 * | `Destination Finale I` + 2000          | aucun    |
 * | `Destination Finale` + 2000            | « Destination finale » (2000), score 1,000 |
 * | `Asterix et Cleoptre` + 1968           | aucun    |
 * | `Asterix` + 1968                       | « Astérix et Cléopâtre » (1968), score 0,959 |
 * | `L'Empire du Soleil Steven Spielberg`  | aucun    |
 * | `L'Empire du Soleil` + 1987            | « Empire du soleil » (1987), score 0,959 |
 *
 * **L'année est conservée à chaque tentative, et c'est ce qui rend la manœuvre sûre.** Sans elle,
 * `Destination Finale I` ramène « Destination finale 4 » (2009) avec un score de 0,947 — le mauvais
 * film, accepté en automatique. Le filtre d'année réduit tellement le champ qu'un seul mot suffit à
 * retrouver le bon titre, tandis que retirer l'année ouvre la porte aux suites et aux homonymes.
 *
 * Le score, lui, est toujours calculé contre le titre **entier** d'origine : élargir la recherche ne
 * relâche donc pas l'exigence. On cherche large, on juge strictement.
 */

/** Mots qui n'apportent rien à une recherche et qu'on retire d'emblée. */
const MOTS_PARASITES = new Set([
  "multi", "french", "truefrench", "vostfr", "vff", "vfq", "vo", "subfrench",
  "bluray", "brrip", "bdrip", "webrip", "web", "dl", "hdlight", "hdtv", "dvdrip", "remux",
  "1080p", "720p", "2160p", "4k", "uhd", "hdr", "sdr", "x264", "x265", "h264", "h265", "hevc",
  "aac", "ac3", "dts", "atmos", "integrale", "complete", "remastered", "remasterise",
]);

/** Chiffres romains isolés, fréquents en fin de titre là où le fournisseur n'en met pas. */
const CHIFFRE_ROMAIN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/i;

/**
 * Découpe un titre en mots, en retenant où chacun commence.
 *
 * Les positions comptent : reconstruire le titre en recollant les mots avec des espaces abîmerait la
 * ponctuation — « Ant-Man » deviendrait « Ant Man ». On coupe donc toujours dans la chaîne d'origine.
 */
function motsAvecPositions(titre: string): Array<{ mot: string; debut: number }> {
  const trouves: Array<{ mot: string; debut: number }> = [];
  const motif = /[^\s._-]+/g;
  let trouve: RegExpExecArray | null;
  while ((trouve = motif.exec(titre)) !== null) trouves.push({ mot: trouve[0], debut: trouve.index });
  return trouves;
}

/**
 * Les requêtes à tenter, de la plus fidèle à la plus large.
 *
 * L'ordre compte : la première tentative est le titre tel quel, pour ne rien changer aux fiches qui
 * fonctionnent déjà. Les suivantes retirent d'abord ce qui est identifiable comme parasite, puis
 * raccourcissent par la droite — c'est là que se trouvent les noms de réalisateur ajoutés, les
 * mentions « Making Of » et les chiffres romains.
 *
 * Descendre jusqu'à un seul mot est délibéré : c'est ce qui rattrape une faute de frappe en fin de
 * titre, qu'aucune troncature partielle ne peut corriger. Le filtre d'année empêche que cela ramène
 * n'importe quoi.
 */
/**
 * Lettres qui s'élident en français, et que la convention des points fait disparaître.
 *
 * `C'est arrivé près de chez vous` arrive sur le disque en `C.est.arrive.pres.de.chez.vous`, donc
 * dans le catalogue en « C est arrive pres de chez vous ». L'apostrophe n'est pas un détail
 * d'orthographe : elle sépare deux mots là où l'espace en invente un. Le fournisseur cherche alors un
 * titre commençant par le mot « C », qui n'existe pas — et rend le premier film approchant, souvent
 * sans rapport.
 *
 * L'élision touche une grande part du cinéma français : *L'auberge espagnole*, *Qu'est-ce qu'on a
 * fait au bon Dieu ?*, *L'arnacœur*, *J'ai perdu mon corps*.
 */
const ELISIONS = new Set(["c", "d", "j", "l", "m", "n", "s", "t", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu"]);

/**
 * Recolle les élisions qu'un nom de fichier a transformées en mots isolés.
 *
 * « C est arrive pres de chez vous » redevient « C'est arrive pres de chez vous ». Les accents
 * manquants, eux, ne sont pas inventés : les fournisseurs les tolèrent, l'apostrophe non — elle
 * change le découpage en mots.
 *
 * **La règle exige que le mot suivant commence par une minuscule.** Mesuré sur les 1 567 films d'une
 * médiathèque réelle, c'est ce seul détail qui sépare l'élision de l'initiale : une élision précède un
 * mot ordinaire — *l'auberge*, *c'est*, *j'ai*, *qu'on* — tandis qu'une initiale précède un nom
 * propre : *J. Edgar*, *M. Butterfly*, *E.T.*, *R.A.I.D.*. Sans cette condition, la règle produisait
 * « J'Edgar », « M'Popper » et « Ocean's'Twelve » — treize titres abîmés, zéro réparé.
 *
 * Une lettre déjà suivie d'une apostrophe est également écartée : dans *Ocean's Twelve*, le « s »
 * appartient au possessif anglais, il n'attend pas de seconde apostrophe.
 *
 * Rendue **en plus** du titre d'origine, jamais à sa place : si la variante ne trouve rien, la
 * tentative d'origine reste disponible.
 */
export function elisionsRestaurees(titre: string): string | null {
  // Trois conditions, chacune imposée par un cas réel :
  //   `(?<=^|[\s([-])`  début de mot, en **assertion** : consommer l'espace ferait manquer la seconde
  //                     élision de « Qu est ce qu on a fait au bon Dieu ».
  //   `(?<!\b[A-Za-zÀ-ÿ]\s)`  pas précédé d'une lettre isolée : dans « E T l Extraterrestre », le
  //                     « T » appartient à une suite d'initiales, pas à une élision.
  //   `(?=[a-zà-ÿ])`    suivi d'une minuscule : c'est ce qui sépare *l'auberge* de *J. Edgar*.
  const recolle = titre.replace(/(?<=^|[\s([-])(?<!\b[A-Za-zÀ-ÿ]\s)([A-Za-zÀ-ÿ]{1,6})\s+(?=[a-zà-ÿ])/g,
    (entier, mot: string) => (ELISIONS.has(mot.toLowerCase()) ? `${mot}'` : entier));
  return recolle === titre ? null : recolle;
}

/**
 * Recolle un sigle que la convention des points a éparpillé en lettres isolées.
 *
 * « R.A.I.D. Special Unit » arrive sur le disque avec des points partout ; l'analyse les remplace par
 * des espaces — ce qu'elle doit faire, puisque le point sert aussi de séparateur de mots — et le titre
 * devient « R A I D Special Unit ». Le fournisseur n'y voit plus un sigle mais six mots, dont cinq
 * d'une seule lettre, et rend le premier titre approchant : dans la médiathèque réelle, ce film s'est
 * retrouvé apparié à un film intitulé **« R »**.
 *
 * Deux lettres isolées consécutives suffisent à reconnaître un sigle : aucun titre ordinaire n'écrit
 * deux mots d'une lettre à la suite. *S.W.A.T.*, *E.T.*, *W.E.*, *R.A.I.D.* rentrent tous dans ce cas.
 *
 * Seules les **majuscules** sont recollées. Dans « E T l Extraterrestre », le « l » minuscule est
 * l'élision de *E.T. l'extra-terrestre*, pas la troisième lettre du sigle : l'inclure produisait
 * « E.T.l. Extraterrestre », un titre qui n'existe nulle part.
 */
export function sigleRestaure(titre: string): string | null {
  const recolle = titre.replace(/\b([A-ZÀ-Þ])(?:\s+([A-ZÀ-Þ])\b)+/g,
    (entier) => `${entier.split(/\s+/).join(".")}.`);
  return recolle === titre ? null : recolle;
}

/**
 * Retire un article initial uniquement comme variante de recherche.
 *
 * TMDB ne rend aucun résultat pour `The Avengers EndGame` en 2019, mais rend immédiatement
 * `Avengers : Endgame` pour `Avengers EndGame`. Le score normalise déjà les articles : cette variante
 * ne relâche donc pas la décision, elle permet seulement au fournisseur de présenter la candidate.
 */
export function sansArticleInitial(titre: string): string | null {
  const retire = titre.replace(/^(?:the|a|an|le|la|les|un|une|des)\s+/i, "").trim();
  return retire && retire !== titre ? retire : null;
}

export function relaxationQueries(titre: string, maxTentatives = 5): string[] {
  const brut = titre.trim();
  if (!brut) return [];
  const tentatives: string[] = [brut];

  // Juste après le titre brut : c'est la variante la plus probable sur un catalogue francophone, et
  // elle doit être essayée avant les troncatures, qui perdent de l'information.
  const élidé = elisionsRestaurees(brut);
  if (élidé) tentatives.push(élidé);
  const sigle = sigleRestaure(brut);
  if (sigle) tentatives.push(sigle);
  const sansArticle = sansArticleInitial(brut);
  if (sansArticle) tentatives.push(sansArticle);

  const tous = motsAvecPositions(brut);
  const parasite = ({ mot }: { mot: string }) => MOTS_PARASITES.has(mot.toLowerCase()) || CHIFFRE_ROMAIN.test(mot);

  // Les mentions techniques et les chiffres romains sont presque toujours en fin de titre : on coupe
  // à la première d'entre elles plutôt que de les retirer une à une, ce qui préserve la ponctuation.
  const premierParasite = tous.findIndex(parasite);
  const utiles = premierParasite > 0 ? tous.slice(0, premierParasite) : tous.filter((entree) => !parasite(entree));
  /** Le titre d'origine, coupé après le `n`-ième mot. */
  const jusquA = (n: number) => brut.slice(0, utiles[n - 1]!.debut + utiles[n - 1]!.mot.length).trim();

  if (utiles.length && utiles.length < tous.length) tentatives.push(jusquA(utiles.length));
  for (let taille = utiles.length - 1; taille >= 1; taille -= 1) tentatives.push(jusquA(taille));

  // Dédoublonnage en conservant l'ordre : deux tentatives identiques coûteraient un appel pour rien.
  const vues = new Set<string>();
  const uniques = tentatives.filter((essai) => {
    const cle = essai.toLowerCase();
    if (!essai || vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });
  return uniques.slice(0, Math.max(1, maxTentatives));
}

/**
 * Cherche en élargissant, et s'arrête dès qu'une tentative donne quelque chose d'exploitable.
 *
 * `chercher` reçoit la requête à envoyer ; `retenir` décide si le résultat suffit. Cette séparation
 * garde la décision d'acceptation là où elle appartient — auprès du calcul de score — et laisse cette
 * aide ignorer tout du fournisseur interrogé.
 */
export async function searchWithRelaxation<T>(
  titre: string,
  chercher: (query: string) => Promise<T[]>,
  retenir: (resultats: T[]) => boolean | Promise<boolean>,
  maxTentatives = 4,
): Promise<{ resultats: T[]; query: string; tentatives: number }> {
  const queries = relaxationQueries(titre, maxTentatives);
  let dernier: T[] = [];
  let derniereQuery = queries[0] ?? titre;
  for (const [index, query] of queries.entries()) {
    const resultats = await chercher(query);
    if (resultats.length > dernier.length) { dernier = resultats; derniereQuery = query; }
    if (await retenir(resultats)) return { resultats, query, tentatives: index + 1 };
  }
  // Aucune tentative n'a convaincu : on rend la plus fournie, pour que le score tranche plutôt que
  // de renvoyer les mains vides. Une fiche « à revoir » vaut mieux qu'une fiche sans correspondance.
  return { resultats: dernier, query: derniereQuery, tentatives: queries.length };
}
