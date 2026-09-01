import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Le relais du navigateur — et **seulement** du navigateur.
 *
 * Android et le client de bureau lisent les chaînes en direct : c'est le chemin normal, et il ne
 * coûte rien au NAS. Un navigateur, lui, bute sur deux murs que rien côté client ne peut lever :
 *
 * 1. **CORS.** `hls.js` va chercher les segments en XHR, ce qui exige un en-tête
 *    `Access-Control-Allow-Origin` de l'hébergeur. Neuf sur dix l'envoient — mesuré sur 220 chaînes
 *    joignables —, et le dixième est bloqué par le navigateur avant même d'arriver au décodeur. Vu à
 *    l'écran : `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`, sur une chaîne parfaitement vivante.
 * 2. **Le contenu mixte.** Une page servie en HTTPS — c'est le cas de l'accès distant — refuse toute
 *    ressource en `http` nu. Un quart des chaînes de l'échantillon sont dans ce cas, et aucun réglage
 *    du navigateur ne le contourne.
 *
 * Le relais n'est donc **pas** le chemin par défaut : il est le rattrapage de ces deux cas, essayé
 * après un échec direct. Il recopie des octets, ne décode rien, et ne coûte au Celeron que le
 * transfert.
 *
 * **Rien n'est relayé qui n'ait été signé.** Sans cette règle, la route deviendrait un relais ouvert :
 * n'importe qui sur le réseau ferait sortir le NAS vers n'importe quelle adresse, et surtout vers
 * l'intérieur — un scanner de ports déguisé. Le serveur ne signe que ce qu'il connaît : les adresses
 * de ses propres chaînes, et celles qu'un manifeste qu'il vient lui-même de relire désigne.
 */

/**
 * La clé de signature, tirée au démarrage et gardée en mémoire.
 *
 * Elle n'a pas à survivre à un redémarrage : une adresse signée ne vaut que le temps d'une lecture,
 * et le lecteur en redemande de toute façon. Ne pas l'écrire sur le disque, c'est une clé de moins à
 * protéger.
 */
const cle = randomBytes(32);

export function signer(url: string): string {
  return createHmac("sha256", cle).update(url).digest("base64url");
}

export function signatureValide(url: string, signature: string): boolean {
  const attendue = Buffer.from(signer(url));
  const fournie = Buffer.from(signature);
  // Comparaison à temps constant : une comparaison ordinaire fuite la signature octet par octet.
  return attendue.length === fournie.length && timingSafeEqual(attendue, fournie);
}

/** L'adresse relayée, telle qu'un client doit la demander. */
export function adresseRelayee(url: string, prefixe = "/api/live/relais"): string {
  return `${prefixe}?u=${encodeURIComponent(Buffer.from(url, "utf8").toString("base64url"))}&s=${signer(url)}`;
}

export function lireAdresseRelayee(u: string): string | null {
  try {
    const url = Buffer.from(u, "base64url").toString("utf8");
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Les plages qu'on ne relaie jamais.
 *
 * Une liste M3U est un fichier écrit par quelqu'un d'autre. Si l'une d'elles portait
 * `http://192.168.1.1/…` ou `http://127.0.0.1:4000/api/…`, le relais irait la chercher **depuis le
 * NAS**, c'est-à-dire depuis l'intérieur du réseau — avec les droits du serveur. La signature empêche
 * d'inventer une adresse ; elle n'empêche pas qu'une liste en contienne une. D'où ce second verrou.
 */
export function adressePrivee(adresse: string): boolean {
  if (isIP(adresse) === 6) {
    const reduite = adresse.toLowerCase();
    return reduite === "::1" || reduite.startsWith("fe80:") || reduite.startsWith("fc") || reduite.startsWith("fd")
      // IPv4 encapsulée : ::ffff:127.0.0.1 doit être jugée sur sa partie IPv4.
      || (reduite.startsWith("::ffff:") && adressePrivee(reduite.slice("::ffff:".length)));
  }
  if (isIP(adresse) !== 4) return false;
  const [a = 0, b = 0] = adresse.split(".").map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

/** Décisions déjà prises, pour ne pas résoudre le même hôte à chaque segment. */
const hotesJuges = new Map<string, boolean>();

/**
 * L'hôte est-il joignable sans danger ?
 *
 * Un nom de domaine peut pointer vers une adresse privée : le vérifier demande de le résoudre, et la
 * réponse est retenue — un flux en direct demande un segment toutes les quelques secondes, et
 * résoudre à chaque fois serait payer un aller-retour DNS pour rien.
 */
export async function hoteAutorise(hote: string): Promise<boolean> {
  const connu = hotesJuges.get(hote);
  if (connu !== undefined) return connu;
  let autorise: boolean;
  if (isIP(hote)) autorise = !adressePrivee(hote);
  else {
    try {
      const resolus = await lookup(hote, { all: true });
      autorise = resolus.length > 0 && resolus.every((entree) => !adressePrivee(entree.address));
    } catch {
      autorise = false;
    }
  }
  hotesJuges.set(hote, autorise);
  return autorise;
}

/**
 * Ce qui distingue deux adresses **pour l'œil** : l'hôte et le chemin, sans la requête.
 *
 * Mesuré sur le corpus : 7 559 adresses de 1 976 chaînes ne diffèrent de leur voisine que par un
 * jeton dans la requête. Le menu des sources en listait donc quatre qui étaient visiblement la même,
 * et l'on choisissait à l'aveugle entre des lignes identiques.
 *
 * **C'est une empreinte d'affichage, pas d'équivalence.** Deux jetons ne se valent pas — l'un peut
 * être périmé quand l'autre fonctionne —, et c'est pourquoi le regroupement s'arrête à ce que l'on
 * montre : le repli automatique continue de parcourir chaque adresse, une par une. Regrouper pour
 * lire, jamais pour jeter.
 */
export function empreinteDAffichage(url: string): string {
  try {
    const analysee = new URL(url);
    const chemin = analysee.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
    const port = analysee.port && !["80", "443"].includes(analysee.port) ? `:${analysee.port}` : "";
    return `${analysee.hostname.toLowerCase()}${port}${chemin}`;
  } catch {
    return url;
  }
}

/** Ce qu'une récupération surveillée rend : la réponse, et l'adresse **finale** qui l'a donnée. */
export interface ReponseSuivie { reponse: Response; url: string }

/** Au-delà, ce n'est plus une redirection, c'est une boucle. */
const SAUTS_MAX = 5;

/**
 * Aller chercher une adresse **en vérifiant chaque saut**, et non seulement le premier.
 *
 * C'est le trou que cette fonction bouche. `hoteAutorise` juge l'hôte qu'on lui donne ; `fetch`, lui,
 * suit les redirections tout seul, sans rien demander à personne. Une entrée de liste sur un hébergeur
 * public parfaitement légitime qui répond `302 → http://192.168.1.1/` faisait donc chercher cette
 * page **par le NAS**, avec son accès au réseau local, et en renvoyait le corps au client. Le fichier
 * de listes vient d'Internet et compte quatre-vingt-dix mille adresses écrites par cinq cents auteurs :
 * c'est exactement la situation qui fabrique une faille de ce genre.
 *
 * Interdire les redirections n'était pas une option — les CDN en font à chaque segment. On les suit
 * donc à la main, en rejugeant l'hôte à chaque fois, et l'on rend **l'adresse d'arrivée** : un
 * manifeste redirigé résout ses segments relatifs à partir d'elle, pas de celle qu'on avait demandée.
 * Le relais utilisait l'adresse de départ, ce qui cassait discrètement les listes redirigées.
 *
 * `autorise` et `recuperer` sont injectables pour les tests : sonder de vraies redirections
 * demanderait un hôte public, et une suite de tests qui dépend d'Internet ment un jour sur deux.
 */
export async function recupererSansSortirDuPublic(
  url: string,
  init: RequestInit,
  recuperer: (url: string, init: RequestInit) => Promise<Response>,
  autorise: (hote: string) => Promise<boolean> = hoteAutorise,
): Promise<ReponseSuivie | null> {
  let courante = url;
  for (let saut = 0; saut <= SAUTS_MAX; saut += 1) {
    let hote: string;
    try { hote = new URL(courante).hostname; } catch { return null; }
    if (!(await autorise(hote))) return null;

    // `manual` est le cœur de l'affaire : sans lui, `fetch` suivrait sans nous consulter.
    const reponse = await recuperer(courante, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(reponse.status)) return { reponse, url: courante };

    const destination = reponse.headers.get("location");
    if (!destination) return { reponse, url: courante };
    try { courante = new URL(destination, courante).href; } catch { return null; }
  }
  return null;
}

/** Pour les tests : oublier ce qui a été jugé. */
export function oublierLesHotes(): void {
  hotesJuges.clear();
}

/** Un manifeste HLS se reconnaît à son type déclaré ou, à défaut, à sa première ligne. */
export function estUnManifeste(contentType: string | null, corps: string): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("mpegurl")) return true;
  return corps.slice(0, 512).trimStart().startsWith("#EXTM3U");
}

/**
 * Réécrit un manifeste pour que tout ce qu'il désigne repasse par le relais.
 *
 * Sans cette réécriture, le manifeste arriverait bien au lecteur mais ses segments repartiraient en
 * direct vers l'hébergeur — c'est-à-dire vers le mur qu'on vient de contourner. Trois sortes de
 * renvois y figurent, et les trois comptent : les lignes d'adresse, la clé de déchiffrement
 * (`EXT-X-KEY`) et l'en-tête d'initialisation (`EXT-X-MAP`), ces deux dernières en attribut `URI`.
 *
 * Les adresses relatives sont d'abord résolues contre celle du manifeste : c'est la forme la plus
 * courante, et la seule qui n'a aucun sens une fois sortie de son contexte.
 */
export function reecrireManifeste(corps: string, base: string, relayer = adresseRelayee): string {
  const absolue = (reference: string): string => {
    try { return new URL(reference, base).toString(); } catch { return reference; }
  };
  return corps.split(/\r?\n/).map((ligne) => {
    const nue = ligne.trim();
    if (!nue) return ligne;
    if (nue.startsWith("#")) {
      // `URI="…"` n'apparaît que dans les balises qui désignent une ressource à charger.
      return ligne.replace(/URI="([^"]+)"/g, (_entier, reference: string) => `URI="${relayer(absolue(reference))}"`);
    }
    return relayer(absolue(nue));
  }).join("\n");
}
