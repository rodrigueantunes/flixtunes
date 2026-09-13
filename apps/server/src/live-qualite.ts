import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { adressePrivee, hoteAutorise, recupererSansSortirDuPublic } from "./live-relais.js";
import { db } from "./database.js";

/**
 * Laquelle des adresses d'une chaîne est la meilleure — et pourquoi c'est le serveur qui le dit.
 *
 * Le repli sait quand une adresse **ne répond pas**. Il ne sait rien de celle qui répond en 480p
 * quand sa voisine donne la même chaîne en 1080p : les deux marchent, et la course ne mesure que la
 * vitesse de réponse. Or 16,7 % des chaînes ont plusieurs adresses, et c'est exactement là que le
 * choix se pose.
 *
 * La réponse est dans le manifeste : un maître HLS déclare ses variantes avec `RESOLUTION` et
 * `BANDWIDTH`. Il suffit de le lire — mais **un navigateur ne le peut pas** : sans en-tête CORS, il
 * n'a le droit ni au corps ni au code de la réponse, c'est tout le mur que le relais existe pour
 * contourner. Le serveur, lui, n'a pas ce mur.
 *
 * **Ce que cela coûte, et quand.** Rien tant qu'on ne regarde pas : sonder les 118 335 adresses du
 * corpus serait absurde. La mesure se fait à l'ouverture d'une chaîne, **après** avoir répondu au
 * client — deux à quatre requêtes de quelques kilo-octets, jamais sur le chemin de la lecture —, et
 * seulement pour les chaînes à plusieurs adresses dont la mesure manque ou a une semaine. La première
 * ouverture n'en profite donc pas ; toutes les suivantes, oui. C'est le même principe que le reste du
 * direct : on mesure à l'usage plutôt que de sonder le monde entier au cas où.
 */

/** Une semaine : un hébergeur change de définition, mais pas toutes les heures. */
const FRAICHEUR_MS = 7 * 24 * 60 * 60 * 1000;

/** Au-delà, l'hébergeur est trop lent pour qu'on l'attende : la mesure est de fond, pas urgente. */
const DELAI_MS = 5_000;

/** Un manifeste maître fait quelques kilo-octets. Au-delà, on ne lit pas : ce n'en est pas un. */
const TAILLE_MAX = 256 * 1024;

/**
 * Combien d'adresses on mesure à chaque ouverture.
 *
 * Quatre laissaient une chaîne à douze adresses inachevée pendant trois visites, et le menu proposait
 * donc des sources sans qualité connue là où le classement en avait le plus besoin. Huit requêtes de
 * quelques kilo-octets, lancées **après** la réponse au client, restent invisibles pour lui.
 */
const SONDES_PAR_OUVERTURE = 8;

export interface QualiteSource {
  /** La hauteur de la meilleure variante déclarée, en pixels. `null` si le manifeste n'en déclare pas. */
  hauteur: number | null;
  /** Le débit de cette variante, en bits par seconde. */
  debit: number | null;
}

/**
 * Ce qu'un manifeste maître déclare de mieux.
 *
 * On retient la variante de plus haute définition, et à définition égale le plus haut débit — c'est
 * ce que le lecteur choisira de toute façon quand le réseau le permet, donc c'est ce qui décrit
 * honnêtement la source.
 *
 * Une liste de segments — un manifeste de variante, sans `#EXT-X-STREAM-INF` — ne déclare rien de
 * tout cela : elle rend `null`, ce qui n'est pas un échec mais une absence, et se range après les
 * sources qui ont su se décrire.
 */
export function meilleureVariante(corps: string): QualiteSource {
  let hauteur: number | null = null;
  let debit: number | null = null;
  for (const ligne of corps.split(/\r?\n/)) {
    if (!ligne.startsWith("#EXT-X-STREAM-INF")) continue;
    const resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(ligne);
    const bande = /BANDWIDTH=(\d+)/i.exec(ligne);
    const h = resolution ? Number(resolution[2]) : null;
    const d = bande ? Number(bande[1]) : null;
    if (h != null && (hauteur == null || h > hauteur)) { hauteur = h; debit = d; continue; }
    if (h != null && h === hauteur && d != null && (debit == null || d > debit)) debit = d;
    if (hauteur == null && d != null && (debit == null || d > debit)) debit = d;
  }
  return { hauteur, debit };
}

/**
 * Lire le manifeste d'une adresse, sous les mêmes gardes que le relais.
 *
 * Le serveur va chercher une adresse venue d'un fichier que quelqu'un d'autre a écrit : c'est
 * exactement la situation qui fabrique une faille SSRF. Les gardes du relais s'appliquent donc telles
 * quelles — pas d'adresse privée, pas d'hôte non résolu — et ce n'est pas une précaution de trop :
 * une liste M3U peut parfaitement contenir `http://192.168.1.1/`.
 */
export async function sonderUneSource(url: string): Promise<QualiteSource | null> {
  try {
    const analysee = new URL(url);
    if (analysee.protocol !== "http:" && analysee.protocol !== "https:") return null;
    if (adressePrivee(analysee.hostname) || !(await hoteAutorise(analysee.hostname))) return null;
  } catch { return null; }

  try {
    /*
     * Les redirections sont suivies **à la main**, hôte rejugé à chaque saut.
     *
     * Laisser `fetch` les suivre seul rouvrirait la porte que le relais vient de fermer : une adresse
     * publique qui redirige vers le réseau local ferait chercher cette page par le NAS. Le manifeste
     * n'en sort pas d'ici, mais la requête, elle, partirait bel et bien.
     */
    const suivie = await recupererSansSortirDuPublic(
      url,
      { signal: AbortSignal.timeout(DELAI_MS), headers: { "User-Agent": "FlixTunes/0.5.7", Accept: "*/*" } },
      (cible, init) => fetch(cible, init),
    );
    if (!suivie) return null;
    const reponse = suivie.reponse;
    if (!reponse.ok) return null;
    const octets = await reponse.arrayBuffer();
    if (octets.byteLength > TAILLE_MAX) return null;
    const corps = new TextDecoder().decode(octets);
    if (!corps.includes("#EXTM3U")) return null;
    return meilleureVariante(corps);
  } catch {
    return null;
  }
}

/**
 * Mesurer les adresses d'une chaîne, et ranger le résultat.
 *
 * Appelée après avoir répondu au client : elle ne doit jamais retarder l'ouverture d'une chaîne.
 * L'échec d'une sonde n'écrit rien de négatif — on note seulement la date, pour ne pas la refaire à
 * chaque ouverture. Une adresse muette est déjà punie par le classement des échecs, qui, lui, mesure
 * ce qui compte vraiment : est-ce que ça a marché quand on a regardé.
 */
export async function sonderLesSources(channelId: string): Promise<number> {
  const limite = new Date(Date.now() - FRAICHEUR_MS).toISOString();
  const aSonder = db.prepare(`SELECT url FROM live_channel_urls
    WHERE channel_id = ? AND (sonde_le IS NULL OR sonde_le < ?) LIMIT ${SONDES_PAR_OUVERTURE}`)
    .all(channelId, limite) as unknown as Array<{ url: string }>;
  if (!aSonder.length) return 0;

  const ecrire = db.prepare(`UPDATE live_channel_urls SET hauteur = ?, debit = ?, sonde_le = ?
    WHERE channel_id = ? AND url = ?`);
  const mesures = await Promise.all(aSonder.map(async (source) => ({
    url: source.url, qualite: await sonderUneSource(source.url),
  })));
  const maintenant = new Date().toISOString();
  for (const mesure of mesures) {
    ecrire.run(mesure.qualite?.hauteur ?? null, mesure.qualite?.debit ?? null, maintenant, channelId, mesure.url);
  }
  return mesures.filter((mesure) => mesure.qualite?.hauteur != null).length;
}

/* ------------------------------------------------------------------------ */
/* Les sources qui répondent encore, une fois qu'une autre joue              */
/* ------------------------------------------------------------------------ */

/** Un résultat vaut cinq minutes : zapper d'une chaîne à l'autre ne relance pas tout. */
const JOIGNABILITE_MS = 5 * 60 * 1000;
/** Quatre secondes : au-delà, une adresse ne vaut pas mieux qu'une muette pour servir de secours. */
const DELAI_JOIGNABLE_MS = 4_000;
/** Douze à la fois : les 81 sources de la chaîne la mieux fournie tiennent en une demi-minute. */
const SONDES_SIMULTANEES = 12;
/** Au-delà, on répond avec ce qu'on sait, et les sondes restantes finissent en arrière-plan. */
const ATTENTE_MAX_MS = 20_000;
/** La mémoire des sondes oublie les plus anciennes au-delà. */
const MEMOIRE_MAX = 5_000;

export type VerdictHote = "public" | "prive" | "introuvable";

/** Ce qu'une sonde peut se faire prêter, pour qu'une suite de tests n'aille pas sur Internet. */
export interface OutilsDeSonde {
  recuperer?: (url: string, init: RequestInit) => Promise<Response>;
  juger?: (hote: string) => Promise<VerdictHote>;
  maintenant?: () => number;
  attenteMaxMs?: number;
}

const joignabilites = new Map<string, { repond: boolean; le: number }>();
const sondesEnCours = new Map<string, Promise<string[]>>();

function retenir(url: string, repond: boolean, le: number): void {
  joignabilites.delete(url);
  joignabilites.set(url, { repond, le });
  if (joignabilites.size > MEMOIRE_MAX) joignabilites.delete(joignabilites.keys().next().value!);
}

/** Pour les tests : oublier ce qui a été sondé. */
export function oublierLesJoignabilites(): void {
  joignabilites.clear();
  sondesEnCours.clear();
}

/**
 * L'hôte d'une adresse, jugé en trois issues plutôt qu'en deux.
 *
 * `hoteAutorise` répond « non » aussi bien pour une adresse du réseau local que pour un nom qui ne se
 * résout plus : pour le relais, c'est la même chose, on n'y va pas. Pour la sonde, c'est l'inverse.
 * Un nom introuvable est la panne la plus courante du corpus — la source est morte —, tandis qu'une
 * adresse locale peut très bien jouer dans le salon sans que le NAS ait le droit d'aller la voir.
 */
export async function jugerLHote(hote: string): Promise<VerdictHote> {
  const nu = hote.replace(/^\[|\]$/g, "");
  if (isIP(nu)) return adressePrivee(nu) ? "prive" : "public";
  try {
    const resolus = await lookup(nu, { all: true });
    if (!resolus.length) return "introuvable";
    return resolus.some((entree) => adressePrivee(entree.address)) ? "prive" : "public";
  } catch {
    return "introuvable";
  }
}

/**
 * Cette adresse répond-elle, vue du NAS ? `null` quand on ne peut pas le savoir d'ici.
 *
 * Le corps n'est pas lu : la réponse suffit, et un flux en direct n'a pas de fin. Les gardes du relais
 * s'appliquent à chaque saut — une redirection vers le réseau local ne se suit pas, et ne condamne pas
 * la source pour autant.
 */
export async function adresseRepond(url: string, outils: OutilsDeSonde = {}): Promise<boolean | null> {
  let analysee: URL;
  try { analysee = new URL(url); } catch { return null; }
  if (analysee.protocol !== "http:" && analysee.protocol !== "https:") return null;
  const juger = outils.juger ?? jugerLHote;
  const verdict = await juger(analysee.hostname);
  if (verdict === "introuvable") return false;
  if (verdict === "prive") return null;
  try {
    const suivie = await recupererSansSortirDuPublic(
      url,
      { signal: AbortSignal.timeout(DELAI_JOIGNABLE_MS), headers: { "User-Agent": "FlixTunes", Accept: "*/*" } },
      outils.recuperer ?? ((cible, init) => fetch(cible, init)),
      async (hote) => (await juger(hote)) === "public",
    );
    if (!suivie) return null;
    void suivie.reponse.body?.cancel().catch(() => undefined);
    return suivie.reponse.status < 400;
  } catch {
    return false;
  }
}

/**
 * Sonder toutes les adresses sauf celle qui joue, et rendre celles qui se taisent.
 *
 * Décidé le 13 septembre 2026 : on cherche d'abord **une** source qui joue ; ensuite seulement, on
 * regarde toutes les autres. Pour que ce soit léger : douze sondes à la fois, quatre secondes chacune,
 * un résultat retenu cinq minutes, une seule passe par chaîne à la fois, et une réponse au plus tard
 * après vingt secondes — les sondes restantes finissent derrière et servent à la fois suivante.
 */
export async function sonderCesAdresses(
  cle: string, adresses: readonly string[], enCours: string | null, outils: OutilsDeSonde = {},
): Promise<string[]> {
  const enAttente = sondesEnCours.get(cle);
  if (enAttente) return enAttente;
  const maintenant = outils.maintenant ?? Date.now;
  // La source qui joue répond, par définition : elle ne se sonde pas, et une muette d'hier est absoute.
  if (enCours) retenir(enCours, true, maintenant());
  const autres = [...new Set(adresses)].filter((url) => url !== enCours);
  const aSonder = autres.filter((url) => {
    const connue = joignabilites.get(url);
    return !connue || maintenant() - connue.le > JOIGNABILITE_MS;
  });

  // Quatre-vingts adresses tiennent souvent sur trois hébergeurs : chaque nom n'est résolu qu'une fois.
  const hotes = new Map<string, Promise<VerdictHote>>();
  const juger = (hote: string): Promise<VerdictHote> => {
    const connu = hotes.get(hote);
    if (connu) return connu;
    const verdict = (outils.juger ?? jugerLHote)(hote);
    hotes.set(hote, verdict);
    return verdict;
  };
  let prochaine = 0;
  const travail = Promise.all(Array.from({ length: Math.min(SONDES_SIMULTANEES, aSonder.length) }, async () => {
    while (prochaine < aSonder.length) {
      const url = aSonder[prochaine]!;
      prochaine += 1;
      const repond = await adresseRepond(url, { ...outils, juger });
      if (repond !== null) retenir(url, repond, maintenant());
    }
  }));

  const promesse = (async () => {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<void>((resoudre) => { minuteur = setTimeout(resoudre, outils.attenteMaxMs ?? ATTENTE_MAX_MS); });
    await Promise.race([travail, delai]);
    clearTimeout(minuteur);
    return autres.filter((url) => joignabilites.get(url)?.repond === false);
  })();
  sondesEnCours.set(cle, promesse);
  const liberer = () => { if (sondesEnCours.get(cle) === promesse) sondesEnCours.delete(cle); };
  void travail.then(liberer, liberer);
  return promesse;
}

/** Les sources muettes d'une chaîne, vues du NAS, pendant que `enCours` joue. */
export function sonderLesAutres(channelId: string, enCours: string | null): Promise<string[]> {
  const adresses = (db.prepare("SELECT url FROM live_channel_urls WHERE channel_id = ?")
    .all(channelId) as unknown as Array<{ url: string }>).map((ligne) => ligne.url);
  // Une adresse étrangère à la chaîne ne s'absout pas : elle n'a rien à faire dans la mémoire des sondes.
  return sonderCesAdresses(channelId, adresses, enCours && adresses.includes(enCours) ? enCours : null);
}
