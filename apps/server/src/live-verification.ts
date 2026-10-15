import { randomUUID } from "node:crypto";
import type { ChaineDirect } from "@flixtunes/contracts";
import { recupererPublic } from "./live-http-public.js";
import { recupererSansSortirDuPublic } from "./live-relais.js";
import { jugerLHote } from "./live-qualite.js";
import { chaineDetaillee, listerChaines, type RequeteChaines } from "./television-direct.js";

/**
 * « Ne garder que les chaînes qui marchent » (r12) : le bouton qu'offre une recherche de chaîne.
 *
 * Les filtres existants se fondent sur les relevés passés — la sonde du matin, les lectures d'hier.
 * Celui-ci répond à la question de l'instant : parmi les chaînes que je viens de trouver, lesquelles
 * jouent **maintenant** ? Il ne suffit pas qu'une playlist réponde : un hébergeur peut servir une
 * liste figée dont les segments ont disparu. On lit donc la playlist, on descend jusqu'à une variante,
 * et l'on va chercher le début d'un vrai segment vidéo.
 *
 * Pour que ce soit rapide : seize chaînes à la fois, trois sources au plus par chaîne — les mieux
 * classées d'abord, on s'arrête à la première qui joue —, quatre secondes par requête, et chaque source
 * retenue une minute, le temps qu'un second essai ou une recherche voisine en profitent.
 *
 * **r13 : les sources mortes des chaînes qui restent.** Une chaîne qui joue peut garder des sources
 * mortes, que le lecteur proposait encore et vers lesquelles il basculait. Une fois le verdict de la
 * chaîne rendu, ses autres sources sont donc vérifiées à leur tour, en fond : la grille filtrée arrive
 * aussi vite qu'avant, et les lecteurs qui ouvrent une chaîne en citant la vérification ne reçoivent
 * plus les sources qui n'ont pas répondu (`sourcesMortesDe`). Le filtrage vaut jusqu'à la recherche
 * suivante : la vérification vit douze heures depuis sa dernière consultation, remplacée dès que le
 * profil en lance une autre.
 */

/** Au plus deux cents chaînes par vérification : la page la plus longue que rend une recherche. */
export const CHAINES_MAX = 200;
const SOURCES_PAR_CHAINE = 3;
const SIMULTANEES = 16;
const DELAI_MS = 4_000;
const MEMOIRE_SOURCE_MS = 60_000;
/** Une vérification vit tant qu'on s'en sert : on regarde une chaîne bien plus de cinq minutes. */
const VIE_VERIFICATION_MS = 12 * 3_600_000;
/** Les sources vérifiées en fond, au plus : deux cents chaînes à quarante-cinq sources ne passent pas. */
const SOURCES_DIFFEREES_MAX = 1_500;

type Recuperation = (url: string, init: RequestInit) => Promise<Response>;
export interface OutilsVerification { recuperer?: Recuperation; autorise?: (hote: string) => Promise<boolean> }

const memoire = new Map<string, { ok: boolean; le: number }>();

/** Lit le début d'une réponse, sous les gardes du relais. `null` : rien n'a répondu. */
async function lireDebut(url: string, limite: number, outils: OutilsVerification, plage = false) {
  const suivie = await recupererSansSortirDuPublic(url, {
    signal: AbortSignal.timeout(DELAI_MS),
    headers: { "User-Agent": "FlixTunes", Accept: "*/*", ...(plage ? { Range: `bytes=0-${limite - 1}` } : {}) },
  }, outils.recuperer ?? recupererPublic, outils.autorise ?? (async (hote) => (await jugerLHote(hote)) === "public"));
  if (!suivie) return null;
  const { reponse } = suivie;
  if (reponse.status >= 400 || !reponse.body) { await reponse.body?.cancel().catch(() => undefined); return { statut: reponse.status, url: suivie.url, octets: Buffer.alloc(0) }; }
  const lecteur = reponse.body.getReader();
  const morceaux: Uint8Array[] = []; let taille = 0;
  try {
    while (taille < limite) { const lu = await lecteur.read(); if (lu.done) break; morceaux.push(lu.value); taille += lu.value.byteLength; }
  } finally { await lecteur.cancel().catch(() => undefined); }
  return { statut: reponse.status, url: suivie.url, octets: Buffer.concat(morceaux).subarray(0, limite) };
}

/**
 * Une source joue-t-elle maintenant ? Playlist lisible, variante lisible, et un segment qui livre au
 * moins un paquet MPEG-TS. Un flux servi tel quel (MPEG-TS, MP4, DASH) se juge à ses premiers octets.
 */
export async function sourceJoue(url: string, outils: OutilsVerification = {}, profondeur = 0): Promise<boolean> {
  try {
    const premiere = await lireDebut(url, 256 * 1024, outils);
    if (!premiere || premiere.statut >= 400 || !premiere.octets.length) return false;
    const texte = premiere.octets.toString("utf8");
    if (!texte.trimStart().startsWith("#EXTM3U")) {
      const o = premiere.octets;
      return o[0] === 0x47 || o.subarray(4, 8).toString("latin1") === "ftyp" || /<(?:[\w-]+:)?MPD\b/.test(texte.slice(0, 4096));
    }
    const adresses = texte.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (/#EXT-X-STREAM-INF/i.test(texte)) {
      if (profondeur >= 2 || !adresses[0]) return false;
      return await sourceJoue(new URL(adresses[0], premiere.url).href, outils, profondeur + 1);
    }
    // Le dernier segment publié : c'est lui que le lecteur demandera en arrivant au direct.
    const segment = adresses.at(-1);
    if (!segment) return false;
    const debut = await lireDebut(new URL(segment, premiere.url).href, 4096, outils, true);
    return !!debut && debut.statut < 400 && debutDeVideo(debut.octets);
  } catch { return false; }
}

/**
 * Le début d'un vrai segment : MPEG-TS, fMP4, ou son seul (ADTS, ID3). Un hébergeur qui a coupé la
 * chaîne répond souvent `200` avec une page d'erreur HTML : elle ne passe pas.
 */
export function debutDeVideo(o: Buffer): boolean {
  if (o.length >= 188 && o[0] === 0x47) return true;
  const boite = o.length >= 8 ? o.subarray(4, 8).toString("latin1") : "";
  if (["ftyp", "styp", "moof", "sidx", "moov"].includes(boite)) return true;
  if (o.length >= 3 && o.subarray(0, 3).toString("latin1") === "ID3") return true;
  return o.length >= 2 && o[0] === 0xff && (o[1]! & 0xf6) === 0xf0;
}

async function sourceJoueRetenue(url: string, outils: OutilsVerification): Promise<boolean> {
  const connue = memoire.get(url);
  if (connue && Date.now() - connue.le < MEMOIRE_SOURCE_MS) return connue.ok;
  const ok = await sourceJoue(url, outils);
  memoire.set(url, { ok, le: Date.now() });
  if (memoire.size > 4_000) memoire.delete(memoire.keys().next().value!);
  return ok;
}

interface Verification {
  profil: string; chaines: ChaineDirect[]; faites: number; joignables: Set<string>; mortes: Set<string>;
  /** Par chaîne, les adresses qui n'ont pas répondu. */
  sourcesMortes: Map<string, Set<string>>;
  /** Le verdict de toutes les chaînes est rendu : la grille peut se filtrer. */
  fini: boolean;
  /** Les autres sources des chaînes qui jouent ont été vérifiées à leur tour. */
  sourcesFinies: boolean;
  annulee: boolean; vue: number;
}
const verifications = new Map<string, Verification>();

function noterMorte(v: Verification, chaine: string, url: string) {
  const deLaChaine = v.sourcesMortes.get(chaine) ?? new Set<string>();
  deLaChaine.add(url);
  v.sourcesMortes.set(chaine, deLaChaine);
}

/**
 * Une chaîne joue si l'une de ses meilleures sources joue. Celles qui se taisent sont notées ; celles
 * qui suivent la première qui joue restent à vérifier, en fond.
 */
async function chaineJoue(v: Verification, id: string, outils: OutilsVerification,
  differees: Array<{ chaine: string; url: string }>): Promise<boolean> {
  const sources = chaineDetaillee(id)?.sources ?? [];
  for (const [rang, source] of sources.slice(0, SOURCES_PAR_CHAINE).entries()) {
    if (await sourceJoueRetenue(source.url, outils)) {
      for (const suivante of sources.slice(rang + 1)) differees.push({ chaine: id, url: suivante.url });
      return true;
    }
    noterMorte(v, id, source.url);
  }
  return false;
}

function purger() {
  for (const [id, v] of verifications) if (Date.now() - v.vue > VIE_VERIFICATION_MS) { v.annulee = true; verifications.delete(id); }
}

/**
 * Lance la vérification des chaînes que rend une recherche. Une nouvelle vérification du même profil
 * remplace la précédente : c'est qu'une autre recherche a été faite.
 */
export function lancerVerification(profil: string, requete: RequeteChaines, outils: OutilsVerification = {}): { id: string; total: number } {
  purger();
  for (const [id, v] of verifications) if (v.profil === profil) { v.annulee = true; verifications.delete(id); }
  const chaines = listerChaines({ ...requete, profileId: profil, offset: 0, limit: CHAINES_MAX }).items;
  const id = randomUUID();
  const v: Verification = { profil, chaines, faites: 0, joignables: new Set(), mortes: new Set(), sourcesMortes: new Map(),
    fini: chaines.length === 0, sourcesFinies: chaines.length === 0, annulee: false, vue: Date.now() };
  verifications.set(id, v);
  /*
   * Les mêmes seize fils servent les deux passes : d'abord une chaîne après l'autre, puis, quand il
   * n'en reste plus à juger, les sources mises de côté. Un fil sans travail attend tant que d'autres
   * jugent encore une chaîne : ils peuvent en remettre.
   */
  const differees: Array<{ chaine: string; url: string }> = [];
  let prochaine = 0, prochaineSource = 0, enCours = 0;
  void Promise.all(Array.from({ length: Math.min(SIMULTANEES, chaines.length) }, async () => {
    while (!v.annulee) {
      if (prochaine < chaines.length) {
        const chaine = chaines[prochaine++]!;
        enCours += 1;
        const ok = await chaineJoue(v, chaine.id, outils, differees).catch(() => false);
        enCours -= 1;
        if (v.annulee) return;
        (ok ? v.joignables : v.mortes).add(chaine.id);
        v.faites += 1;
        if (v.faites === chaines.length) v.fini = true;
      } else if (prochaineSource < Math.min(differees.length, SOURCES_DIFFEREES_MAX)) {
        const source = differees[prochaineSource++]!;
        const ok = await sourceJoueRetenue(source.url, outils).catch(() => false);
        if (v.annulee) return;
        if (!ok) noterMorte(v, source.chaine, source.url);
      } else if (enCours > 0) {
        await new Promise((resoudre) => setTimeout(resoudre, 50));
      } else return;
    }
  })).finally(() => { v.fini = true; v.sourcesFinies = true; });
  return { id, total: chaines.length };
}

function consulter(id: string, profil: string): Verification | null {
  purger();
  const v = verifications.get(id);
  if (!v || v.profil !== profil) return null;
  v.vue = Date.now();
  return v;
}

/**
 * Où en est la vérification ; une fois finie, les chaînes qui jouent, dans l'ordre de la recherche.
 * Leur nombre d'adresses ne compte plus celles qui n'ont pas répondu.
 */
export function etatVerification(id: string, profil: string) {
  const v = consulter(id, profil);
  if (!v) return null;
  return { total: v.chaines.length, faites: v.faites, fini: v.fini, sourcesFinies: v.sourcesFinies, mortes: [...v.mortes],
    ...(v.fini ? { chaines: v.chaines.filter((c) => v.joignables.has(c.id))
      .map((c) => ({ ...c, adresses: Math.max(1, c.adresses - (v.sourcesMortes.get(c.id)?.size ?? 0)) })) } : {}) };
}

/**
 * Les adresses d'une chaîne qui n'ont pas répondu à la vérification citée par le lecteur. `null` quand
 * la vérification n'existe plus (serveur redémarré, autre profil) : la chaîne s'ouvre alors entière.
 */
export function sourcesMortesDe(id: string, profil: string, chaine: string): ReadonlySet<string> | null {
  return consulter(id, profil)?.sourcesMortes.get(chaine) ?? null;
}

/**
 * Retire d'une chaîne les sources mortes à la vérification. Jamais toutes : une chaîne dont il ne
 * resterait rien s'ouvre entière, plutôt que vide.
 */
export function sansLesSourcesMortes<T extends { url: string }>(sources: T[], mortes: ReadonlySet<string> | null): T[] {
  if (!mortes?.size) return sources;
  const vivantes = sources.filter((source) => !mortes.has(source.url));
  return vivantes.length ? vivantes : sources;
}

/** Pour les tests : repartir d'une mémoire vide. */
export function oublierVerifications() { memoire.clear(); for (const v of verifications.values()) v.annulee = true; verifications.clear(); }
