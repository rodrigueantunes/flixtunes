import { db } from "./database.js";
import { getProviderConfiguration } from "./provider-settings.js";
import { CircuitBreaker, fetchWithTimeout } from "./resilience.js";
import type { Plateforme } from "./web-chemins.js";
import { normaliseDate, type IdentiteWeb } from "./web-identite.js";

/**
 * Interroger les plateformes, et seulement elles.
 *
 * **Aucune base de films ou de séries n'est consultée ici, jamais.** Une vidéo intitulée « Star Wars —
 * analyse » trouverait sur TMDB ou Wikidata une correspondance à score élevé, que la cascade
 * appliquerait comme une certitude que rien ne viendrait relire. C'est une exclusion, pas un
 * réordonnancement : ce module ne connaît pas ces fournisseurs.
 *
 * Deux voies, et elles n'ont pas le même prix :
 *
 * - **par identifiant** — le nom du fichier le porte, ou son annexe. C'est exact, et c'est bon marché ;
 * - **par titre** — il faut chercher. C'est approximatif, et sur YouTube c'est **cent fois** plus cher.
 *
 * Toute la prudence de ce module tient dans cet écart.
 */

/** Ce que YouTube facture, en unités de quota, pour chaque appel. Publié par Google. */
const COUT = { videos: 1, search: 100, channels: 1 } as const;

/**
 * Ce qu'on s'autorise à dépenser par jour.
 *
 * Le quota gratuit est de 10 000 unités. On s'arrête avant, pour deux raisons : l'épuiser rend la clé
 * inutilisable jusqu'au lendemain — y compris pour les résolutions à une unité, qui sont pourtant ce
 * qui marche le mieux —, et il vaut mieux qu'une analyse s'arrête en le disant qu'elle échoue en
 * silence sur ses dernières centaines de fichiers.
 *
 * L'ordre de grandeur mérite d'être connu : **une résolution par identifiant coûte 1, une recherche
 * par titre coûte 100.** Avec ce plafond, cela fait environ 9 000 vidéos par jour dans le premier cas,
 * et 90 dans le second. C'est pourquoi l'identifiant, quand il est là, ne se discute pas.
 */
const PLAFOND_QUOTIDIEN = 9_000;

const disjoncteur = new CircuitBreaker(4, 60_000);

/** Une lecture d'API, injectable : les cas de test n'ont pas à atteindre le réseau. */
export type Recuperateur = (url: string) => Promise<Response>;

const parDefaut: Recuperateur = (url) => fetchWithTimeout(url, {}, 12_000);

export interface OptionsFournisseur {
  recuperer?: Recuperateur;
  /** Clé YouTube explicite, pour les cas de test. Sinon celle des réglages. */
  cleYoutube?: string | null;
  /** Comptabiliser le quota, ou non — les cas de test l'évitent pour rester indépendants. */
  comptabiliser?: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Quota
 * ---------------------------------------------------------------------------------------------- */

const CLE_QUOTA = "web_quota_youtube";

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ce qui a déjà été dépensé aujourd'hui. Le compteur se réinitialise en changeant de date. */
export function quotaDuJour(): { date: string; depense: number; plafond: number } {
  const ligne = db.prepare("SELECT value FROM server_settings WHERE key = ?").get(CLE_QUOTA) as
    { value: string } | undefined;
  const date = aujourdhui();
  if (!ligne) return { date, depense: 0, plafond: PLAFOND_QUOTIDIEN };
  try {
    const lu = JSON.parse(ligne.value) as { date?: string; depense?: number };
    if (lu.date !== date) return { date, depense: 0, plafond: PLAFOND_QUOTIDIEN };
    return { date, depense: Math.max(0, lu.depense ?? 0), plafond: PLAFOND_QUOTIDIEN };
  } catch {
    return { date, depense: 0, plafond: PLAFOND_QUOTIDIEN };
  }
}

function depenser(unites: number): void {
  const etat = quotaDuJour();
  db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(CLE_QUOTA, JSON.stringify({ date: etat.date, depense: etat.depense + unites }));
}

/** Reste-t-il de quoi payer cet appel ? */
export function quotaDisponible(cout: number): boolean {
  const etat = quotaDuJour();
  return etat.depense + cout <= etat.plafond;
}

/* ------------------------------------------------------------------------------------------------
 * YouTube
 * ---------------------------------------------------------------------------------------------- */

function cleYoutube(options: OptionsFournisseur): string | null {
  if (options.cleYoutube !== undefined) return options.cleYoutube;
  const reglages = getProviderConfiguration();
  return reglages.youtubeApiKey ?? null;
}

async function lireJson(url: string, options: OptionsFournisseur): Promise<Record<string, unknown> | null> {
  const recuperer = options.recuperer ?? parDefaut;
  return disjoncteur.run(async () => {
    const reponse = await recuperer(url);
    if (!reponse.ok) throw new Error(`Réponse ${reponse.status}`);
    const charge = await reponse.json() as unknown;
    return charge && typeof charge === "object" ? charge as Record<string, unknown> : null;
  });
}

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

/**
 * La plus grande vignette proposée.
 *
 * YouTube en publie plusieurs tailles. On prend la plus grande disponible : elle est téléchargée une
 * fois puis servie localement, donc son poids ne se paie qu'au premier passage — et une vignette
 * trop petite, elle, se paie à chaque affichage.
 */
function meilleureVignette(vignettes: unknown): string | null {
  if (!vignettes || typeof vignettes !== "object") return null;
  const table = vignettes as Record<string, { url?: unknown; width?: unknown }>;
  const ordre = ["maxres", "standard", "high", "medium", "default"];
  for (const nom of ordre) {
    const trouvee = texte(table[nom]?.url);
    if (trouvee) return trouvee;
  }
  return null;
}

/** La durée ISO 8601 que YouTube rend — `PT12M34S` — en secondes. */
export function dureeIso(valeur: unknown): number | null {
  const brut = texte(valeur);
  const trouve = brut?.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!trouve) return null;
  const [, jours, heures, minutes, secondes] = trouve;
  const total = Number(jours ?? 0) * 86_400 + Number(heures ?? 0) * 3_600
    + Number(minutes ?? 0) * 60 + Number(secondes ?? 0);
  return total > 0 ? total : null;
}

function identiteVide(): IdentiteWeb {
  return {
    titre: null, chaine: null, plateforme: null, identifiant: null, url: null,
    publieeLe: null, annee: null, description: null, dureeSecondes: null, vignette: null, playlist: null,
  };
}

/**
 * Résoudre une vidéo par son identifiant — une unité de quota.
 *
 * C'est la voie de loin préférable : exacte, et assez bon marché pour traiter une médiathèque entière
 * dans la journée. Elle n'est possible que si le nom du fichier ou son annexe porte l'identifiant.
 */
export async function resoudreYoutube(identifiant: string, options: OptionsFournisseur = {}): Promise<IdentiteWeb | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.videos)) return null;

  const url = "https://www.googleapis.com/youtube/v3/videos"
    + `?part=snippet,contentDetails&id=${encodeURIComponent(identifiant)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);
  if (options.comptabiliser !== false) depenser(COUT.videos);

  const premier = Array.isArray(charge?.["items"]) ? (charge["items"] as unknown[])[0] : null;
  if (!premier || typeof premier !== "object") return null;
  const entree = premier as Record<string, unknown>;
  const extrait = (entree["snippet"] ?? {}) as Record<string, unknown>;
  const details = (entree["contentDetails"] ?? {}) as Record<string, unknown>;
  const date = normaliseDate(extrait["publishedAt"]);

  return {
    ...identiteVide(),
    titre: texte(extrait["title"]),
    chaine: texte(extrait["channelTitle"]),
    plateforme: "youtube",
    identifiant: texte(entree["id"]) ?? identifiant,
    url: `https://www.youtube.com/watch?v=${texte(entree["id"]) ?? identifiant}`,
    publieeLe: date.publieeLe,
    annee: date.annee,
    description: texte(extrait["description"]),
    dureeSecondes: dureeIso(details["duration"]),
    vignette: meilleureVignette(extrait["thumbnails"]),
  };
}

/**
 * Chercher une vidéo par son titre — cent unités de quota.
 *
 * C'est la voie que vous avez demandée quand l'identifiant manque, et elle fonctionne. Mais son prix
 * impose une règle : **on ne cherche que ce qu'on ne peut pas résoudre**, et on s'arrête net dès que
 * le plafond du jour est atteint. Le nom de la chaîne est joint à la requête : deux vidéos peuvent
 * porter le même titre, la chaîne les départage.
 */
export async function chercherYoutube(
  chaine: string,
  titre: string,
  options: OptionsFournisseur = {},
): Promise<IdentiteWeb | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.search)) return null;

  const requete = `${chaine} ${titre}`.trim();
  const url = "https://www.googleapis.com/youtube/v3/search"
    + `?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(requete)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);
  if (options.comptabiliser !== false) depenser(COUT.search);

  const premier = Array.isArray(charge?.["items"]) ? (charge["items"] as unknown[])[0] : null;
  if (!premier || typeof premier !== "object") return null;
  const entree = premier as Record<string, unknown>;
  const identifiant = texte((entree["id"] as Record<string, unknown> | undefined)?.["videoId"]);
  if (!identifiant) return null;
  const extrait = (entree["snippet"] ?? {}) as Record<string, unknown>;
  const date = normaliseDate(extrait["publishedAt"]);

  return {
    ...identiteVide(),
    titre: texte(extrait["title"]),
    chaine: texte(extrait["channelTitle"]),
    plateforme: "youtube",
    identifiant,
    url: `https://www.youtube.com/watch?v=${identifiant}`,
    publieeLe: date.publieeLe,
    annee: date.annee,
    description: texte(extrait["description"]),
    vignette: meilleureVignette(extrait["thumbnails"]),
  };
}

/**
 * L'avatar d'une chaîne.
 *
 * Il n'est dans aucun fichier : c'est la seule information de cet écran qui ne puisse venir que de la
 * plateforme. Une recherche de chaîne coûte cent unités, comme toute recherche — mais elle n'a lieu
 * qu'**une fois par chaîne**, et l'image est ensuite mise en cache localement, donc figée.
 */
export async function avatarDeChaineYoutube(nom: string, options: OptionsFournisseur = {}): Promise<string | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.search)) return null;

  const url = "https://www.googleapis.com/youtube/v3/search"
    + `?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(nom)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);
  if (options.comptabiliser !== false) depenser(COUT.search);

  const premier = Array.isArray(charge?.["items"]) ? (charge["items"] as unknown[])[0] : null;
  if (!premier || typeof premier !== "object") return null;
  const extrait = ((premier as Record<string, unknown>)["snippet"] ?? {}) as Record<string, unknown>;
  return meilleureVignette(extrait["thumbnails"]);
}

/* ------------------------------------------------------------------------------------------------
 * oEmbed — le filet universel
 * ---------------------------------------------------------------------------------------------- */

/**
 * Les points d'entrée oEmbed publics, sans clé.
 *
 * C'est un standard, et il rend « toute plateforme connue » tenable au lieu d'être un vœu. Il est
 * mince — titre, auteur, vignette, rien de plus : ni description, ni durée, ni date de publication.
 * Et il **résout** une adresse qu'on possède déjà ; il ne cherche pas. C'est le filet, pas la règle.
 */
const OEMBED: Partial<Record<Plateforme, string>> = {
  youtube: "https://www.youtube.com/oembed?format=json&url=",
  dailymotion: "https://www.dailymotion.com/services/oembed?format=json&url=",
  vimeo: "https://vimeo.com/api/oembed.json?url=",
  tiktok: "https://www.tiktok.com/oembed?url=",
};

/** Résoudre une adresse connue par oEmbed. Aucune clé, aucun quota. */
export async function resoudreParOEmbed(
  plateforme: Plateforme,
  adresse: string,
  options: OptionsFournisseur = {},
): Promise<IdentiteWeb | null> {
  const base = OEMBED[plateforme];
  if (!base) return null;
  const charge = await lireJson(`${base}${encodeURIComponent(adresse)}`, options);
  if (!charge) return null;
  return {
    ...identiteVide(),
    titre: texte(charge["title"]),
    chaine: texte(charge["author_name"]),
    plateforme,
    url: adresse,
    vignette: texte(charge["thumbnail_url"]),
  };
}
