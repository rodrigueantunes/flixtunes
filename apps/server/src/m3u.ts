import { normaliseForSearch } from "./search-normalise.js";

/**
 * Lecture des listes M3U, et rien d'autre.
 *
 * Ce fichier ne touche ni au réseau ni à la base : il reçoit du texte et rend des entrées. C'est ce
 * qui permet de l'éprouver sur les cas tordus relevés dans le corpus réel — 527 listes, 181 126
 * entrées — sans télécharger quoi que ce soit.
 */

/** Une entrée de liste, telle qu'elle est écrite dans le fichier. */
export interface EntreeM3U {
  nom: string;
  url: string;
  logo: string | null;
  groupe: string | null;
  /** `tvg-id`, la clé qui reliera un guide XMLTV le jour venu. Posée dès maintenant pour cela. */
  tvgId: string | null;
  /** `tvg-chno`, le numéro de chaîne — présent sur 12,7 % des entrées du corpus mesuré. */
  numero: number | null;
}

/**
 * La fiabilité d'une liste : **la part de ses chaînes qui répondent**.
 *
 * Ce n'est pas un avis, c'est une mesure. Le script qui produit `m3u.json` —
 * `tools/tv_playlist_checker.py` — sonde chaque adresse de chaque liste, puis range le résultat dans
 * une pastille posée en tête du nom. Les seuils sont les siens, lus dans son `determine_icon` :
 *
 * | Pastille | Chaînes joignables | Ce que la liste vaut |
 * | --- | --- | --- |
 * | ✅ | **75 % et plus** | `bonne` |
 * | 〰️ | 50 à 74 % | `moyenne` |
 * | ⚠️ | 25 à 49 % | `douteuse` |
 * | ❌ | moins de 25 % | `faible` — beaucoup de chaînes mortes, mais la liste est **gardée** |
 * | *(aucune)* | rien ne répond | la liste n'est pas écrite dans le fichier |
 *
 * **Le ❌ ne veut pas dire « morte »**, et c'est l'erreur que ce commentaire existe pour éviter : une
 * liste ❌ garde des chaînes qui répondent, parfois celles qu'on cherchait. On la garde, on la
 * classe, et on laisse choisir.
 *
 * Les quatre pastilles descendent du meilleur au pire. Ce n'était pas le cas avant : le script posait
 * `⚠️` sous 25 % et `❌` de 25 à 49 %, si bien que la pire des listes portait le symbole le moins
 * alarmant et que ce filtre les rangeait à l'envers. C'est le script qui a été corrigé, pas la
 * lecture — **une liste étiquetée par l'ancienne version garde donc l'ancien sens jusqu'à la
 * prochaine passe.**
 *
 * Le pourcentage porte sur les **chaînes fusionnées**, comme la grille : une liste qui donne deux
 * adresses par chaîne, l'une morte et l'autre vivante, est joignable à 100 % puisque le lecteur
 * essaie les deux.
 *
 * La pastille est retirée du nom à l'import : conservée, elle remonterait dans les recherches et dans
 * les titres affichés.
 */
export type ClassementListe = "bonne" | "moyenne" | "douteuse" | "faible" | "inconnue";

/**
 * Un bit par classement, pour réunir en un entier les fiabilités qu'une chaîne traverse.
 *
 * Les valeurs sont figées : elles sont écrites en base, et les renuméroter d'une version à l'autre
 * relirait les anciennes à l'envers.
 */
export const MASQUES_CLASSEMENT: Record<ClassementListe, number> = {
  bonne: 1, moyenne: 2, douteuse: 4, faible: 8, inconnue: 16,
};

/** Le masque d'un ensemble de classements demandés, ou 0 si aucun n'est reconnu. */
export function masqueDesClassements(classements: readonly string[]): number {
  return classements.reduce((masque, nom) => masque | (MASQUES_CLASSEMENT[nom as ClassementListe] ?? 0), 0);
}

const PREFIXES: Array<[string, ClassementListe]> = [
  ["✅", "bonne"],      // 75 % et plus
  ["〰", "moyenne"],    // 50 à 74 %
  ["⚠", "douteuse"],   // 25 à 49 %
  ["❌", "faible"],     // moins de 25 %
];

/**
 * Sépare le classement du nom.
 *
 * Le sélecteur de variante emoji (U+FE0F) suit trois de ces quatre symboles ; il est retiré avec le
 * reste. Un nom sans préfixe connu ressort intact, classé « inconnue » — ce qui est le cas de toute
 * liste qui ne vient pas de votre fichier.
 */
export function decouperClassement(libelle: string): { nom: string; classement: ClassementListe } {
  const texte = libelle.trim();
  for (const [prefixe, classement] of PREFIXES) {
    if (texte.startsWith(prefixe)) {
      // U+FE0F, le sélecteur de variante emoji, suit trois de ces quatre symboles.
      return { nom: texte.slice(prefixe.length).replace(/^️/, "").trim(), classement };
    }
  }
  return { nom: texte, classement: "inconnue" };
}

/**
 * La clé de fusion d'une chaîne : son nom, normalisé.
 *
 * C'est elle qui réunit les 44,7 % de doublons du corpus en une entrée unique portant plusieurs
 * adresses — la réserve qui sert de repli quand la première refuse.
 *
 * **Le compromis est assumé et vaut d'être écrit** : deux chaînes réellement différentes qui
 * porteraient exactement le même nom seraient fusionnées, et leurs adresses se retrouveraient dans le
 * même repli. Le cas existe (« Cinema », « News »), il est rare, et il coûte moins cher que
 * l'inverse — quatre-vingts entrées « TF1 » dans la grille, dont soixante mortes.
 */
export function cleDeChaine(nom: string): string {
  return normaliseForSearch(nom);
}

/**
 * Les transports qu'aucun de nos trois lecteurs ne sait ouvrir.
 *
 * 1 347 entrées du corpus mesuré sont en `rtp`, `rtsp`, `rtmp` ou `plugin` : ni le navigateur, ni
 * Media3 ne les lisent, et les relayer serait un chantier à part pour 0,7 % du corpus. Elles sont
 * donc écartées à l'entrée — mais **comptées**, parce qu'une chaîne qu'on retire en silence est une
 * chaîne qu'on cherchera.
 */
export function lisibleParNosLecteurs(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Le numéro qu'une liste range dans le nom : « 21. LA CHAÎNE L'ÉQUIPE ».
 *
 * Constaté à l'écran sur le corpus réel, et c'est deux gains d'un coup. **Un numéro** d'abord :
 * `tvg-chno` n'est présent que sur 12,7 % des entrées, mais beaucoup de listes le mettent là. **Une
 * fusion** ensuite : sans ce retrait, « 21. LA CHAÎNE L'ÉQUIPE » et « LA CHAÎNE L'ÉQUIPE » sont deux
 * chaînes distinctes, et la grille les affiche côte à côte au lieu de les réunir en un repli.
 *
 * La forme reconnue exige un **séparateur** — point, parenthèse ou tiret — puis une espace. C'est ce
 * qui distingue une numérotation d'un nom qui commence par un chiffre : « 24 Horas », « 13 Kids »,
 * « 2x2 » et « 24H » sont des noms de chaînes et sortent intacts.
 */
export function decouperNumeroDuNom(nom: string): { nom: string; numero: number | null } {
  const trouve = /^(\d{1,4})\s*[.)\-]\s+(.+)$/.exec(nom.trim());
  if (!trouve) return { nom: nom.trim(), numero: null };
  const numero = Number.parseInt(trouve[1]!, 10);
  const reste = trouve[2]!.trim();
  // Un reste vide voudrait dire que le nom entier était le numéro : on garde le nom d'origine.
  if (!reste || numero < 1 || numero > 9999) return { nom: nom.trim(), numero: null };
  return { nom: reste, numero };
}

/** Les attributs `cle="valeur"` de la ligne `#EXTINF`, clés abaissées — le corpus mêle `tvg-id` et `tvg-ID`. */
function attributs(source: string): Map<string, string> {
  const trouves = new Map<string, string>();
  for (const [, cle, valeur] of source.matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g)) {
    trouves.set(cle!.toLowerCase(), valeur!);
  }
  return trouves;
}

/**
 * La virgule qui sépare les attributs du nom — celle qui n'est pas entre guillemets.
 *
 * TvPourTous prenait `ligne.Split(',').Last()`, ce qui coupe au **dernier** séparateur : un nom
 * contenant une virgule y perdait tout ce qui précède, et « Paris Première, la chaîne » devenait
 * « la chaîne ». Couper à la première virgule marcherait mieux, mais pas toujours : `group-title`
 * en contient — « Films, Séries » —, et la coupe tomberait alors au milieu des attributs.
 *
 * D'où ce parcours qui compte les guillemets. Il est la seule façon correcte de lire cette ligne.
 */
function separateur(ligne: string): number {
  let entreGuillemets = false;
  for (let index = 0; index < ligne.length; index += 1) {
    const caractere = ligne[index];
    if (caractere === "\"") entreGuillemets = !entreGuillemets;
    else if (caractere === "," && !entreGuillemets) return index;
  }
  return -1;
}

function nombre(valeur: string | undefined): number | null {
  if (!valeur) return null;
  const lu = Number.parseInt(valeur.trim(), 10);
  return Number.isInteger(lu) && lu > 0 && lu <= 99_999 ? lu : null;
}

/**
 * Analyse une liste M3U.
 *
 * Les particularités du corpus réel, toutes rencontrées et toutes traitées ici :
 *
 * - la marque d'ordre des octets en tête de fichier, que `#EXTM3U` ne reconnaît pas sans cela ;
 * - les fins de ligne Windows, présentes dans une liste sur trois ;
 * - les directives glissées **entre** l'entrée et son adresse — `#EXTVLCOPT`, `#KODIPROP`,
 *   `#EXTHTTP` —, que la lecture naïve « la ligne suivante est l'adresse » prend pour l'adresse ;
 * - `#EXTGRP`, qui pose un groupe pour les entrées qui suivent, là où d'autres listes l'écrivent en
 *   attribut `group-title` ;
 * - les entrées sans adresse en fin de fichier, tout simplement ignorées.
 */
export function analyserM3U(contenu: string): EntreeM3U[] {
  const lignes = contenu.replace(/^﻿/, "").split(/\r?\n/);
  const entrees: EntreeM3U[] = [];
  let groupeCourant: string | null = null;

  for (let index = 0; index < lignes.length; index += 1) {
    const ligne = lignes[index]!.trim();
    if (!ligne) continue;

    if (ligne.toUpperCase().startsWith("#EXTGRP:")) {
      groupeCourant = ligne.slice("#EXTGRP:".length).trim() || null;
      continue;
    }
    if (!ligne.toUpperCase().startsWith("#EXTINF:")) continue;

    const corps = ligne.slice("#EXTINF:".length);
    const coupe = separateur(corps);
    if (coupe < 0) continue;
    const nom = corps.slice(coupe + 1).trim();
    const lus = attributs(corps.slice(0, coupe));

    // L'adresse est la première ligne qui n'est ni vide ni une directive.
    let suivante = index + 1;
    while (suivante < lignes.length) {
      const candidate = lignes[suivante]!.trim();
      if (candidate && !candidate.startsWith("#")) break;
      // Une nouvelle entrée avant toute adresse : la précédente n'en a pas, on l'abandonne.
      if (candidate.toUpperCase().startsWith("#EXTINF:")) { suivante = lignes.length; break; }
      suivante += 1;
    }
    if (suivante >= lignes.length) continue;

    const url = lignes[suivante]!.trim();
    index = suivante;
    if (!nom || !url) continue;

    // Le numéro rangé dans le nom sert de second recours, jamais de premier : `tvg-chno` est une
    // déclaration, un préfixe n'est qu'une convention d'affichage. Le nom, lui, est nettoyé dans les
    // deux cas — c'est ce qui réunit « 21. LA CHAÎNE L'ÉQUIPE » et « LA CHAÎNE L'ÉQUIPE ».
    const { nom: intitule, numero: numeroDuNom } = decouperNumeroDuNom(nom);
    entrees.push({
      nom: intitule,
      url,
      logo: lus.get("tvg-logo")?.trim() || null,
      groupe: lus.get("group-title")?.trim() || groupeCourant,
      tvgId: lus.get("tvg-id")?.trim() || null,
      numero: nombre(lus.get("tvg-chno") ?? lus.get("channel-number")) ?? numeroDuNom,
    });
  }
  return entrees;
}

/**
 * Lit un `m3u.json` : un objet « nom de liste » → « adresse ».
 *
 * C'est le format de TvPourTous, donc celui de votre fichier, donc celui qu'on accepte tel quel
 * plutôt que d'en imposer un autre. Une valeur qui n'est pas une adresse `http(s)` est écartée sans
 * faire échouer le reste : sur 535 entrées, une faute de frappe ne doit pas coûter les 534 autres.
 */
/** Une liste du catalogue, telle qu'on la range ensuite. */
export interface ListeCatalogue {
  nom: string;
  url: string;
  classement: ClassementListe;
  /** La part exacte de chaînes joignables, quand le fichier la donne. `null` en version 1. */
  pourcentage: number | null;
}

/**
 * La version 2 du fichier : ce que le script a mesuré, dit franchement.
 *
 * La version 1 était un dictionnaire « nom » : « adresse », et le classement voyageait **dans le
 * nom**, sous forme d'emoji — c'était le seul canal disponible. On rétro-analysait donc une pastille
 * pour retrouver un chiffre que le script avait mesuré puis jeté, et quatre paliers pour un
 * pourcentage. La version 2 le porte tel quel.
 *
 * Les deux formes restent lues, et ce n'est pas de la complaisance : le fichier posé sur le NAS reste
 * en version 1 jusqu'à la prochaine passe du script, et un serveur neuf devant un ancien fichier ne
 * doit pas tomber en panne — pas plus qu'un ancien serveur devant un fichier neuf, qui n'y verra
 * aucune adresse plutôt que de s'arrêter.
 */
interface CatalogueV2 {
  version: number;
  listes?: Array<{ nom?: unknown; url?: unknown; classement?: unknown; pourcentage?: unknown }>;
}

function lireVersion2(lu: CatalogueV2): ListeCatalogue[] {
  const listes: ListeCatalogue[] = [];
  const vues = new Set<string>();
  for (const entree of lu.listes ?? []) {
    if (typeof entree?.url !== "string" || !/^https?:\/\//i.test(entree.url.trim())) continue;
    const url = entree.url.trim();
    if (vues.has(url)) continue;
    vues.add(url);
    const pourcentage = typeof entree.pourcentage === "number" && Number.isFinite(entree.pourcentage)
      ? Math.min(100, Math.max(0, entree.pourcentage))
      : null;
    /*
     * Le classement est **recalculé** depuis le pourcentage, et non repris du fichier.
     *
     * Le script en propose un, mais les seuils sont une décision d'affichage : les garder ici est ce
     * qui empêche les deux de diverger le jour où l'un des deux bouge. Ce qui vient du fichier, c'est
     * la mesure ; ce qui vient d'ici, c'est ce qu'on en fait.
     */
    listes.push({
      nom: typeof entree.nom === "string" && entree.nom.trim() ? entree.nom.trim() : url,
      url,
      classement: pourcentage == null ? "inconnue" : classementDuPourcentage(pourcentage),
      pourcentage,
    });
  }
  return listes;
}

/** Les quatre bandes, à partir du chiffre. Les mêmes seuils que ceux que le script annonce. */
export function classementDuPourcentage(pourcentage: number): ClassementListe {
  if (pourcentage >= 75) return "bonne";
  if (pourcentage >= 50) return "moyenne";
  if (pourcentage >= 25) return "douteuse";
  return "faible";
}

export function lireCatalogueM3U(json: string): ListeCatalogue[] {
  const lu: unknown = JSON.parse(json);
  if (!lu || typeof lu !== "object" || Array.isArray(lu)) {
    throw new Error("Le fichier doit contenir un objet « nom de liste » : « adresse ».");
  }
  if ((lu as CatalogueV2).version === 2) return lireVersion2(lu as CatalogueV2);

  const listes: ListeCatalogue[] = [];
  const vues = new Set<string>();
  for (const [libelle, adresse] of Object.entries(lu as Record<string, unknown>)) {
    if (typeof adresse !== "string" || !/^https?:\/\//i.test(adresse.trim())) continue;
    const url = adresse.trim();
    if (vues.has(url)) continue;
    vues.add(url);
    const { nom, classement } = decouperClassement(libelle);
    // La version 1 ne connaît que la pastille : le pourcentage exact n'a jamais été transmis.
    listes.push({ nom: nom || url, url, classement, pourcentage: null });
  }
  return listes;
}
