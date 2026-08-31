/**
 * D'où vient une chaîne — et pourquoi il a fallu le déduire.
 *
 * Le corpus est mondial : 76 899 chaînes, dont une poignée de françaises. Chercher « canal » y rend
 * 1 141 résultats parce que *canal* est le mot espagnol et portugais pour « chaîne » — aucun
 * classement par pertinence ne peut réparer cela, puisque tous ces résultats sont **justes**. Ce qui
 * manque n'est pas un meilleur tri, c'est une dimension : le pays.
 *
 * Aucune liste M3U ne le déclare franchement. Trois indices existent, et ils sont pris dans cet ordre
 * de fiabilité décroissante — chacun mesuré sur le corpus réel avant d'être retenu :
 *
 * | | Indice | Couverture mesurée |
 * | --- | --- | --- |
 * | 1 | le suffixe de `tvg-id` — `TF1.fr`, `CanalPlusSport360.fr@SD` | **15 005 chaînes** |
 * | 2 | un drapeau dans le groupe ou le nom — « Brazil 🇧🇷 » | +2 321 |
 * | 3 | un nom de pays dans le groupe — « FRANCE », « Italy » | +8 953 |
 * | 4 | un nom de chaîne qu'on ne porte qu'en France — « TF1 », « Canal+ Sport » | les françaises restantes |
 *
 * Le quatrième est venu après, quand le pays a cessé d'être un simple filtre pour devenir **l'ordre
 * de la grille** : une chaîne sans pays y tombe en fin de liste, ce qui est la dernière place où l'on
 * veut trouver M6. Il ne conclut que sur des noms qui n'existent nulle part ailleurs.
 *
 * Le reste n'a aucun indice, et c'est assumé : une chaîne sans pays reste visible partout, elle est
 * simplement absente des filtres par pays. Inventer un pays serait pire que ne rien dire.
 */

/**
 * Le suffixe d'un `tvg-id`, quand c'en est un.
 *
 * La convention XMLTV met le code pays en fin d'identifiant. Le corpus y ajoute des suffixes de
 * qualité — `@SD`, `@HD` — qu'il faut retirer d'abord, faute de quoi `CanalPlusSport360.fr@SD` ne
 * ressemble plus à rien.
 */
export function paysDuTvgId(tvgId: string | null | undefined): string | null {
  if (!tvgId) return null;
  const propre = tvgId.split("@")[0]!.trim().toLowerCase();
  const trouve = /\.([a-z]{2})$/.exec(propre);
  return trouve ? trouve[1]! : null;
}

/**
 * Le drapeau, s'il y en a un.
 *
 * Un drapeau Unicode est fait de deux « indicateurs régionaux », qui sont exactement les lettres A à
 * Z décalées : 🇫🇷 **est** la paire « F R ». La conversion est donc directe et vaut pour tous les
 * pays à la fois — aucune table à tenir, ce qui est sa qualité principale.
 */
export function paysDuDrapeau(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const trouve = /[\u{1F1E6}-\u{1F1FF}]{2}/u.exec(texte);
  if (!trouve) return null;
  return [...trouve[0]].map((caractere) => String.fromCharCode(caractere.codePointAt(0)! - 0x1F1E6 + 97)).join("");
}

/**
 * Les pays qu'on sait reconnaître dans un intitulé de groupe.
 *
 * La table n'est pas un atlas : elle couvre les pays réellement présents dans le corpus, avec les
 * formes qu'on y rencontre — l'anglais, le français, et la langue du pays quand elle diffère. Le nom
 * français sert à l'affichage ; c'est la langue de l'application.
 *
 * Elle est délibérément ordonnée par effectif décroissant mesuré, pour que la lecture du fichier
 * dise aussi ce que le corpus contient.
 */
const PAYS: Array<{ code: string; nom: string; formes: string[] }> = [
  { code: "fr", nom: "France", formes: ["france", "french", "francais", "français", "francophone"] },
  { code: "gb", nom: "Royaume-Uni", formes: ["united kingdom", "british", "royaume-uni", "angleterre", "england"] },
  { code: "us", nom: "États-Unis", formes: ["usa", "united states", "american", "etats-unis", "états-unis"] },
  { code: "it", nom: "Italie", formes: ["italy", "italia", "italian", "italie"] },
  { code: "in", nom: "Inde", formes: ["india", "inde", "indian"] },
  { code: "es", nom: "Espagne", formes: ["spain", "espana", "españa", "spanish", "espagne"] },
  { code: "ca", nom: "Canada", formes: ["canada", "canadian", "quebec", "québec"] },
  { code: "br", nom: "Brésil", formes: ["brazil", "brasil", "brazilian", "bresil", "brésil"] },
  { code: "ar", nom: "Argentine", formes: ["argentina", "argentine"] },
  { code: "ru", nom: "Russie", formes: ["russia", "russie", "russian"] },
  { code: "pt", nom: "Portugal", formes: ["portugal", "portuguese", "portugais"] },
  { code: "de", nom: "Allemagne", formes: ["germany", "deutschland", "german", "allemagne"] },
  { code: "kr", nom: "Corée du Sud", formes: ["korea", "coree", "corée"] },
  { code: "pe", nom: "Pérou", formes: ["peru", "perou", "pérou"] },
  { code: "ch", nom: "Suisse", formes: ["switzerland", "suisse", "schweiz"] },
  { code: "mx", nom: "Mexique", formes: ["mexico", "méxico", "mexique"] },
  { code: "cl", nom: "Chili", formes: ["chile", "chili"] },
  { code: "tr", nom: "Turquie", formes: ["turkey", "turkiye", "türkiye", "turquie"] },
  { code: "co", nom: "Colombie", formes: ["colombia", "colombie"] },
  { code: "gr", nom: "Grèce", formes: ["greece", "grece", "grèce"] },
  { code: "cn", nom: "Chine", formes: ["china", "chine", "chinese"] },
  { code: "be", nom: "Belgique", formes: ["belgium", "belgique", "belgie", "belgië"] },
  { code: "nl", nom: "Pays-Bas", formes: ["netherlands", "nederland", "pays-bas", "dutch"] },
  { code: "ro", nom: "Roumanie", formes: ["romania", "roumanie"] },
  { code: "dk", nom: "Danemark", formes: ["denmark", "danemark", "danmark"] },
  { code: "no", nom: "Norvège", formes: ["norway", "norvege", "norvège", "norge"] },
  { code: "fi", nom: "Finlande", formes: ["finland", "finlande", "suomi"] },
  { code: "se", nom: "Suède", formes: ["sweden", "suede", "suède", "sverige"] },
  { code: "pl", nom: "Pologne", formes: ["poland", "pologne", "polska"] },
  { code: "ma", nom: "Maroc", formes: ["morocco", "maroc"] },
  { code: "dz", nom: "Algérie", formes: ["algeria", "algerie", "algérie"] },
  { code: "tn", nom: "Tunisie", formes: ["tunisia", "tunisie"] },
  { code: "jp", nom: "Japon", formes: ["japan", "japon", "japanese"] },
];

const NOMS = new Map(PAYS.map((pays) => [pays.code, pays.nom]));

/** Le nom français d'un code, ou le code lui-même s'il vient d'un `tvg-id` qu'on ne sait pas nommer. */
export function nomDuPays(code: string): string {
  return NOMS.get(code) ?? code.toUpperCase();
}

/**
 * Un pays nommé dans un intitulé de groupe.
 *
 * La recherche porte sur des mots entiers : sans cela, « India » se trouverait dans « Indiana » et
 * « Chile » dans « Chilean Movies » — le second est correct, le premier ne l'est pas. Les frontières
 * de mot règlent les deux cas d'un coup.
 */
export function paysDuLibelle(libelle: string | null | undefined): string | null {
  if (!libelle) return null;
  const texte = libelle.toLowerCase();
  for (const pays of PAYS) {
    for (const forme of pays.formes) {
      if (motPresent(texte, forme)) return pays.code;
    }
  }
  return null;
}

/** Les lettres, accents compris : le raccourci `\w` ne connaît pas le ç et couperait « français » en deux. */
const LETTRE = /[\p{Letter}\p{Number}]/u;

/**
 * La forme apparaît-elle comme un mot entier, accordé ou non ?
 *
 * Deux exigences qui tirent en sens contraire, et il faut les deux. **Un mot entier**, sinon
 * « India » se trouve dans « Indiana » et le filtre se remplit de chaînes qui n'y ont rien à faire.
 * **Mais accordé** : « Chaînes françaises » est un intitulé courant, et exiger le mot nu le
 * laissait passer. D'où le suffixe français optionnel, et lui seul — « franchise » ne contient
 * de toute façon pas « français ».
 */
function motPresent(texte: string, forme: string): boolean {
  let depart = 0;
  for (;;) {
    const index = texte.indexOf(forme, depart);
    if (index < 0) return false;
    depart = index + 1;
    if (index > 0 && LETTRE.test(texte[index - 1]!)) continue;
    let fin = index + forme.length;
    for (const suffixe of ["es", "e", "s"]) {
      if (texte.startsWith(suffixe, fin)) { fin += suffixe.length; break; }
    }
    if (fin >= texte.length || !LETTRE.test(texte[fin]!)) return true;
  }
}

/**
 * Les chaînes qu'on reconnaît à leur seul nom, parce qu'elles n'existent qu'en France.
 *
 * Les trois indices précédents laissent les deux tiers du corpus sans pays, et parmi eux des « TF1 »,
 * des « M6 HD » et des « Canal+ Sport » qui ne peuvent être de nulle part ailleurs. Une chaîne sans
 * pays n'est pas seulement absente du filtre France : elle tombe désormais **en fin de grille**, ce
 * qui est exactement l'inverse de ce qu'on veut pour celles-là.
 *
 * Le critère d'entrée dans cette table est strict : **le nom seul doit identifier la France.** C'est
 * pourquoi on n'y trouve ni Eurosport ni beIN Sports, qui portent le même nom dans quinze pays —
 * leurs déclinaisons françaises se reconnaissent à leur `tvg-id`, et se passent très bien de nous.
 * Arte y figure malgré son versant allemand : la demande est de donner la priorité au français.
 */
const CHAINES_FR = new Set([
  "tf1", "france 2", "france 3", "france 4", "france 5", "m6", "arte", "c8", "w9", "tmc", "tfx",
  "nrj 12", "nrj12", "6ter", "gulli", "cstar", "cnews", "bfmtv", "lci", "lcp", "public senat",
  "franceinfo", "cherie 25", "cherie25", "l equipe", "la chaine l equipe", "equipe 21",
  "paris premiere", "teva", "ushuaia tv", "histoire tv", "planete plus", "science et vie tv",
  "seasons", "chasse et peche", "automoto la chaine", "trek", "toute l histoire", "crime district",
  "mangas", "game one", "j one", "ab1", "rtl9", "tiji", "piwi plus", "teletoon plus", "canal j",
  "melody", "novelas tv", "polar plus", "comedie plus", "infosport plus", "golf plus", "foot plus",
  "olympia tv", "tv5monde", "tv5 monde", "la chaine meteo", "tebeo", "tebesud", "via stella",
]);

/**
 * Les familles, reconnues à leur début.
 *
 * Une chaîne se décline : Canal+ a douze déclinaisons, BFM une par métropole, France 3 une par
 * région. Les énumérer une à une serait une table à tenir à jour pour rien — et elle serait fausse
 * le jour d'après, le corpus inventant des variantes plus vite qu'on ne les lit.
 */
const FAMILLES_FR = [
  "canal plus", "france 2", "france 3", "france 4", "france 5", "france 24", "franceinfo",
  "france info", "bfm", "rmc", "ocs", "cine plus", "tf1", "m6", "nrj", "tv5monde", "tv5 monde",
  "gulli", "cnews", "cstar",
];

/** Ce qui décore un nom sans rien en dire : à retirer en tête, mais seulement après avoir essayé sans. */
const DECOR_TETE = new Set(["fr", "fra", "france", "tnt", "hd", "fhd", "uhd", "sd", "4k", "vip"]);
/** Ce qui décore un nom par la fin — définition, langue, redondance, secours. */
const DECOR_QUEUE = new Set([
  "hd", "fhd", "uhd", "sd", "qhd", "4k", "8k", "1080p", "1080", "720p", "720", "576p", "540p",
  "480p", "h264", "h265", "hevc", "raw", "vip", "backup", "alt", "multi", "fr", "fra", "france",
  "tnt", "tv",
]);

/**
 * Le nom réduit à sa marque.
 *
 * Le `+` devient le mot « plus » au lieu de disparaître : sans cela « Canal+ » se confondrait avec
 * les mille « Canal 8 » hispanophones, qui sont précisément ce qu'on cherche à ne pas ramasser.
 */
function nomDeMarque(nom: string): string[] {
  return nom.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/**
 * Cette chaîne est-elle française à son seul nom ?
 *
 * La décoration se retire **une couche à la fois, en essayant à chaque étape** : « France 2 » doit
 * trouver sa réponse avant qu'on ne lui enlève son « France », alors que « FRANCE TF1 HD » ne la
 * trouve qu'après. Un seul ordre de dépouillement servirait l'un et trahirait l'autre.
 */
export function estChaineFrancaise(nom: string | null | undefined): boolean {
  if (!nom) return false;
  const tokens = nomDeMarque(nom);
  for (;;) {
    if (!tokens.length) return false;
    const cle = tokens.join(" ");
    if (CHAINES_FR.has(cle)) return true;
    if (FAMILLES_FR.some((famille) => cle === famille || cle.startsWith(`${famille} `))) return true;
    // Les treize « la 1ère » de l'outre-mer : Guadeloupe, Réunion, Polynésie…
    if (cle.includes("la 1ere")) return true;
    if (tokens.length > 1 && DECOR_QUEUE.has(tokens[tokens.length - 1]!)) { tokens.pop(); continue; }
    if (tokens.length > 1 && DECOR_TETE.has(tokens[0]!)) { tokens.shift(); continue; }
    return false;
  }
}

/**
 * La numérotation de la TNT française, telle qu'elle est sur toutes les télécommandes du pays.
 *
 * Ranger la France en tête ne suffisait pas : les numéros y tombaient dans l'ordre alphabétique, et
 * la chaîne 1 s'appelait « 20 Minutes TV ». Or **personne ne compose un numéro au hasard** — on tape
 * 1 pour TF1 et 6 pour M6, c'est un réflexe de trente ans, et c'est précisément le geste que la
 * saisie à la télécommande existe pour servir.
 *
 * **La table est celle d'aujourd'hui, pas celle d'avant.** Le plan a été refait par la délibération
 * Arcom n° 2025-06 : Canal+, C8 et NRJ 12 ont quitté la TNT, T18 et Novo 19 y sont entrées, et tout
 * ce qui suit s'est décalé. France 4 a pris le 4, LCP le 8, Gulli le 12. Une numérotation nationale
 * fausse serait pire que pas de table du tout — elle a l'air d'une autorité —, donc celle-ci a été
 * relevée sur la liste publiée plutôt que reconstituée de mémoire.
 *
 * Les clés sont des noms **compacts** au sens de `compacterNom` : sans accents, sans espaces,
 * **ponctuation gardée**. Une première écriture comparait des noms normalisés, où la ponctuation
 * disparaît, et le 4 — alors attribué à Canal+ — est allé se poser sur une chaîne du corpus
 * littéralement nommée « Canal ?? », *canal* étant le mot espagnol pour « chaîne ». Les espaces
 * retirés réunissent au passage « BFM TV » et « BFMTV », « France Info » et « franceinfo ».
 *
 * La table s'arrête à la TNT gratuite. Au-delà commence l'opinion, et l'ordre alphabétique reprend
 * ses droits sans que personne ait à trancher.
 */
const TNT_FRANCAISE: Array<[string, number]> = [
  ["tf1", 1], ["france2", 2], ["france3", 3], ["france4", 4], ["france5", 5], ["m6", 6],
  ["arte", 7], ["lcp", 8], ["w9", 9], ["tmc", 10], ["tfx", 11], ["gulli", 12], ["bfmtv", 13],
  ["cnews", 14], ["lci", 15], ["franceinfo", 16], ["cstar", 17], ["t18", 18], ["novo19", 19],
  ["tf1seriesfilms", 20], ["lachainel'equipe", 21], ["l'equipe", 21], ["lequipe", 21], ["6ter", 22],
  ["rmcstory", 23], ["rmcdecouverte", 24], ["rmclife", 25], ["parispremiere", 26],
];

/** Le numéro de TNT d'un nom compact, ou `null` si ce n'en est pas une. */
export function numeroTnt(nomCompact: string): number | null {
  return TNT_FRANCAISE.find(([nom]) => nom === nomCompact)?.[1] ?? null;
}

/** Les entrées de la table, pour qui doit les chercher en base plutôt qu'une par une. */
export function numerosTnt(): ReadonlyArray<readonly [string, number]> {
  return TNT_FRANCAISE;
}

/**
 * L'ordre des pays dans la grille : la France, puis l'alphabet, puis ce qu'on ne sait pas nommer.
 *
 * Le rang est un **entier rangé dans la table**, et non une expression calculée au moment du tri.
 * C'est toute la différence entre parcourir un index et trier 76 899 lignes à chaque page : la grille
 * tient en 0,4 ms parce que son `ORDER BY` suit exactement un index, et un `CASE` sur le code pays
 * l'aurait perdu.
 *
 * Trois zones : la France en 0 ; les pays de la table en 1 et au-delà, dans l'ordre alphabétique de
 * leur nom français, qui est celui qu'on lit à l'écran ; puis 900 pour un code venu d'un `tvg-id`
 * qu'on ne sait pas nommer — ils se départagent entre eux par le code — et 999 pour l'absence de
 * pays, qui ferme la marche.
 */
const RANGS = new Map<string, number>([["fr", 0], ...PAYS
  .filter((pays) => pays.code !== "fr")
  .sort((a, b) => a.nom.localeCompare(b.nom, "fr"))
  .map((pays, index): [string, number] => [pays.code, index + 1])]);

/** Les rangs, pour qui doit les écrire ailleurs — en base, par exemple. */
export function rangsDesPays(): ReadonlyMap<string, number> {
  return RANGS;
}

export const RANG_INCONNU = 900;
export const RANG_SANS_PAYS = 999;

export function rangDuPays(code: string | null | undefined): number {
  if (!code) return RANG_SANS_PAYS;
  return RANGS.get(code) ?? RANG_INCONNU;
}

/**
 * L'état de la table des rangs, pour savoir si ceux qui sont en base sont encore les bons.
 *
 * Ajouter un pays à la table décale tous ceux qui le suivent : les rangs déjà rangés deviendraient
 * faux, et la grille afficherait l'Italie au milieu des Grecs jusqu'au prochain rafraîchissement
 * complet — plusieurs minutes plus tard, et seulement si on en demande un. Cette empreinte permet au
 * démarrage de s'en apercevoir et de recalculer la colonne en une passe.
 */
export function empreinteDesRangs(): string {
  return [...RANGS].map(([code, rang]) => `${code}:${rang}`).join(",");
}

/**
 * Le code pays collé en fin de nom : « Canal+ Sport 2 HD **PL** », « Canal+ Foot France-**FR** ».
 *
 * Deux codes sont écartés volontairement. `ar` et `in` servent bien plus souvent de marque de langue
 * — arabe, anglais indien — que de pays, et les prendre pour l'Argentine ou l'Inde ferait plus de mal
 * que de bien. Le reste n'est retenu que s'il figure dans la table : deux lettres au hasard ne
 * fabriquent pas un pays.
 */
export function paysDuSuffixe(nom: string | null | undefined): string | null {
  if (!nom) return null;
  const trouve = /[-–\s|[(]([a-zA-Z]{2})[\])]?\s*$/.exec(nom.trim());
  const code = trouve?.[1]?.toLowerCase();
  if (!code || code === "ar" || code === "in") return null;
  return PAYS.some((pays) => pays.code === code) ? code : null;
}

/**
 * Le pays d'une chaîne, ou `null` quand aucun indice ne le dit.
 *
 * L'ordre est celui de la fiabilité : un `tvg-id` est une déclaration, un drapeau une convention, un
 * mot dans un intitulé une déduction. Les deux premiers se contredisent une fois sur quatre quand ils
 * sont tous deux présents — c'est le `tvg-id` qu'on croit.
 */
export function paysDeLaChaine(entree: { tvgId?: string | null; groupe?: string | null; nom?: string | null }): string | null {
  return paysDuTvgId(entree.tvgId)
    ?? paysDuDrapeau(entree.groupe) ?? paysDuDrapeau(entree.nom)
    ?? paysDuLibelle(entree.groupe)
    /*
     * Ce que le **nom** dit d'un autre pays passe avant ce qu'on croit reconnaître.
     *
     * « Canal+ Family Poland-PL » et « Canal+ Sport 2 HD PL » se retrouvaient françaises : la famille
     * « canal plus » suffisait à conclure, et le mot *Poland* juste à côté n'était lu par personne.
     * Elles remontaient alors dans le bloc français de la grille, ce qui est le contraire du service
     * rendu. On regarde donc le nom pour un pays **avant** de se fier à la marque.
     */
    ?? paysDuLibelle(entree.nom)
    ?? paysDuSuffixe(entree.nom)
    /*
     * En dernier ressort seulement : le nom reconnu ne vaut jamais contre une déclaration. Une
     * « Canal+ Sport » qui annonce `.pl` est polonaise, et le restera.
     */
    ?? (estChaineFrancaise(entree.nom) ? "fr" : null);
}
