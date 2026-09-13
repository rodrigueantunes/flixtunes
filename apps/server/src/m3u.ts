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
 * Ce n'est pas un avis, c'est une mesure : chaque adresse de chaque liste est sondée avant que la
 * liste n'entre dans `m3u.json`. En version 1 du fichier, le résultat voyage dans une pastille posée en
 * tête du nom, avec ces seuils :
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
 * Les quatre pastilles descendent du meilleur au pire. Ce n'était pas le cas des premiers fichiers, qui posaient
 * `⚠️` sous 25 % et `❌` de 25 à 49 %, si bien que la pire des listes portait le symbole le moins
 * alarmant et que ce filtre les rangeait à l'envers. C'est le fichier qui a été corrigé, pas la
 * lecture — **une liste étiquetée avant la correction garde donc l'ancien sens jusqu'à ce que le
 * fichier soit refait.**
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
 * Ce qui décore le nom d'une chaîne sans rien changer à ce qu'elle diffuse : la définition, le
 * codage, la cadence, et les quelques mots par lesquels une liste signale une adresse de secours.
 */
const DECORATION = String.raw`(?:u?hd|fhd|qhd|sd|4k|8k|hevc|h\.?26[45]|x26[45]|hdr|sdr|\d{3,4}[pi]|\d{2,3}\s?fps|fps\s?\d{2,3}|backup|raw|vip|multi)`;

/** Ce qu'une balise entre parenthèses ou crochets peut contenir sans rien dire de la chaîne. */
const MOT_TECHNIQUE = String.raw`(?:${DECORATION}|not\s*24\s*/\s*7|geo[\s-]*blocked|opt[.\s-]*\d+|opc[.\s-]*\d+|option\s*\d+|source\s*\d+|[\w-]+(?:\.[\w-]+)+)`;

const BALISE = /[([{]([^)\]}]*)[)\]}]/g;
const BALISE_TECHNIQUE = new RegExp(String.raw`^\s*(?:${MOT_TECHNIQUE}[\s,;:/|-]*)+$`, "i");
const JETON_DECORATION = new RegExp(`^${DECORATION}$`, "i");

/**
 * Au-delà, une balise n'est plus une mention technique.
 *
 * C'est aussi une garde : les listes viennent d'Internet, et une expression à alternatives répétées
 * ne doit jamais pouvoir s'emballer sur un nom écrit pour la faire échouer.
 */
const BALISE_MAX = 48;

/**
 * Le nom sans ses symboles ni ses balises techniques. Les autres balises restent : « (FR) »,
 * « [Montréal] » ou « (2024) » disent de quelle chaîne il s'agit.
 */
function nomSansDecoration(nom: string): string {
  return nom.normalize("NFKC")
    .replace(/(?!\+)\p{S}/gu, "")
    .replace(BALISE, (balise, contenu: string) =>
      contenu.length <= BALISE_MAX && BALISE_TECHNIQUE.test(contenu) ? " " : balise);
}

/**
 * La clé de fusion d'une chaîne : son nom, normalisé, sans ce qui ne fait que le décorer.
 *
 * C'est elle qui réunit les doublons du corpus en une entrée unique portant plusieurs adresses — la
 * réserve qui sert de repli quand la première refuse. Le nom normalisé seul laissait « TF1 »,
 * « TF1 (1080p) », « TF1 FHD » et « TF1 ᵁᴴᴰ » en quatre chaînes, chacune avec son petit repli.
 *
 * **Seules les décorations reconnues partent.** La définition, le codage et la cadence, où qu'ils
 * soient ; une balise qui ne contient que cela, `[Not 24/7]`, `[Geo-blocked]`, `(Opt-3)` ou un nom de
 * domaine ; les symboles et les exposants, que NFKC ramène à des lettres. Une balise qui dit autre
 * chose reste, et avec elle la déclinaison : « NHK World TV (FR) » n'est pas « NHK World TV (ESP) ».
 *
 * Un mot de décoration en **tête** ne part que s'il reste au moins deux mots derrière lui :
 * « VIP FR: TF1 » rejoint « FR: TF1 », mais « VIP TV » ne devient pas « TV ».
 *
 * **Le compromis reste assumé** : deux chaînes différentes qui porteraient le même nom seraient
 * fusionnées. Le cas des homonymes de pays différents est traité à l'écriture, par l'identifiant de
 * la liste — voir `paysDeLIdentifiant`.
 */
export function cleDeChaine(nom: string): string {
  const mots = normaliseForSearch(nomSansDecoration(nom)).split(" ").filter(Boolean);
  while (mots.length > 1 && JETON_DECORATION.test(mots[mots.length - 1]!)) mots.pop();
  while (mots.length > 2 && JETON_DECORATION.test(mots[0]!)) mots.shift();
  return mots.join(" ") || normaliseForSearch(nom);
}

/** Un identifiant de la forme publiée par iptv-org : `CanalPlusFamily.fr`, `TF1.fr@SD`. */
const IDENTIFIANT_PUBLIE = /^([A-Za-z0-9][A-Za-z0-9-]*)\.([a-z]{2})(?:@([A-Za-z0-9]+))?$/;

/** Le flux qu'un identifiant désigne après son `@` : `PlutoTVComedie.de@FR` est la version française. */
const FLUX_FRANCAIS = new Set(["fr", "france", "french", "francais"]);

function empreinteDeMarque(texte: string): string {
  return texte.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\+/g, "plus").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/**
 * Le pays qu'un identifiant attache à une chaîne, **quand il désigne bien la même chaîne que le nom**.
 *
 * « Canal+ Family » existe en France et en Pologne, « Arte » en France et en Allemagne : la clé les
 * réunit, et le repli de l'une jouerait l'autre sans prévenir. L'identifiant tranche, mais seulement
 * s'il ressemble au nom — `CanalplusFamily.pl` pour « CANAL+ FAMILY ». Le corpus porte aussi des
 * identifiants recopiés d'une autre chaîne ou d'un autre bouquet, et un arbitre qui se trompe ferait
 * plus de dégâts que pas d'arbitre du tout.
 */
export function paysDeLIdentifiant(nom: string, tvgId: string | null | undefined): string | null {
  const trouve = IDENTIFIANT_PUBLIE.exec(tvgId?.trim() ?? "");
  if (!trouve) return null;
  const base = empreinteDeMarque(trouve[1]!);
  const libelle = empreinteDeMarque(nomSansDecoration(nom).replace(BALISE, " ").split(/\s+/)
    .filter((mot) => !JETON_DECORATION.test(mot)).join(" "));
  if (base.length < 2 || libelle.length < 2) return null;
  const [court, long] = base.length <= libelle.length ? [base, libelle] : [libelle, base];
  if (base !== libelle && !(court.length >= 4 && long.startsWith(court))) return null;
  const flux = trouve[3]?.toLowerCase();
  return flux && FLUX_FRANCAIS.has(flux) ? "fr" : trouve[2]!;
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
 * La version 2 du fichier : ce qui a été mesuré, dit franchement.
 *
 * La version 1 était un dictionnaire « nom » : « adresse », et le classement voyageait **dans le
 * nom**, sous forme d'emoji — c'était le seul canal disponible. On rétro-analysait donc une pastille
 * pour retrouver un chiffre mesuré puis jeté, et quatre paliers pour un
 * pourcentage. La version 2 le porte tel quel.
 *
 * Les deux formes restent lues, et ce n'est pas de la complaisance : le fichier posé sur le NAS reste
 * en version 1 jusqu'à ce qu'il soit refait, et un serveur neuf devant un ancien fichier ne
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
