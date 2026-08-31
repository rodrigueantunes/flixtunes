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
 * Le pays d'une chaîne, ou `null` quand aucun indice ne le dit.
 *
 * L'ordre est celui de la fiabilité : un `tvg-id` est une déclaration, un drapeau une convention, un
 * mot dans un intitulé une déduction. Les deux premiers se contredisent une fois sur quatre quand ils
 * sont tous deux présents — c'est le `tvg-id` qu'on croit.
 */
export function paysDeLaChaine(entree: { tvgId?: string | null; groupe?: string | null; nom?: string | null }): string | null {
  return paysDuTvgId(entree.tvgId)
    ?? paysDuDrapeau(entree.groupe) ?? paysDuDrapeau(entree.nom)
    ?? paysDuLibelle(entree.groupe);
}
