import { db } from "./database.js";
import { getProviderConfiguration } from "./provider-settings.js";
import { CircuitBreaker, fetchWithTimeout } from "./resilience.js";
import type { Plateforme } from "./web-chemins.js";
import { decoderEntitesHtml, normaliseDate, type IdentiteWeb } from "./web-identite.js";

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
 * - **par titre** — il faut chercher. Le budget de recherches est séparé et bien plus limité.
 *
 * Toute la prudence de ce module tient dans cet écart.
 */

/** Budgets distincts depuis septembre 2026 : 100 recherches, 10 000 unités de lecture.
 * On garde une marge sur les lectures ; les limites réelles du projet restent celles de Google. */
const COUT = { videos: 1, search: 1, channels: 1 } as const;
const PLAFOND_QUOTIDIEN = 9_000;
const PLAFOND_RECHERCHES = 100;
type CategorieQuota = "lecture" | "recherche";

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

export function jourQuotaYoutube(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const champ = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${champ("year")}-${champ("month")}-${champ("day")}`;
}

export function quotaDuJour(): { date: string; depense: number; plafond: number; recherches: number } {
  const ligne = db.prepare("SELECT value FROM server_settings WHERE key = ?").get(CLE_QUOTA) as
    { value: string } | undefined;
  const date = jourQuotaYoutube();
  const vide = { date, depense: 0, plafond: PLAFOND_QUOTIDIEN, recherches: 0 };
  if (!ligne) return vide;
  try {
    const lu = JSON.parse(ligne.value) as { version?: number; date?: string; depense?: number; recherches?: number };
    // L'ancien compteur était en UTC et mélangeait les appels. Le jour de migration seulement,
    // conserver une estimation prudente évite d'offrir artificiellement une seconde journée.
    if (lu.date !== date && !(lu.version !== 2 && lu.date === new Date().toISOString().slice(0, 10))) return vide;
    const nombre = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    const depense = nombre(lu.depense);
    return { ...vide, depense, recherches: lu.version === 2 ? nombre(lu.recherches) : Math.min(100, Math.ceil(depense / 100)) };
  } catch { return vide; }
}

function depenser(unites: number, categorie: CategorieQuota): void {
  const etat = quotaDuJour();
  db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(CLE_QUOTA, JSON.stringify({ version: 2, date: etat.date,
      depense: etat.depense + (categorie === "lecture" ? unites : 0),
      recherches: etat.recherches + (categorie === "recherche" ? unites : 0) }));
}

export function empechementYoutube(cout: number, cleExplicite?: string | null,
  categorie: CategorieQuota = "lecture"): string | null {
  const cle = cleExplicite !== undefined ? cleExplicite : getProviderConfiguration().youtubeApiKey;
  if (!cle) return "Aucune clé YouTube n'est enregistrée : ajoutez-la dans l'écran des fournisseurs.";
  if (!quotaDisponible(cout, categorie)) {
    return `Budget YouTube épuisé pour ${categorie === "recherche" ? "les recherches" : "les lectures de métadonnées"}.`
      + " Nouvelle disponibilité à minuit, heure du Pacifique (Los Angeles).";
  }
  return null;
}

export function budgetYoutube() {
  const etat = quotaDuJour();
  return { depense: etat.depense, plafond: etat.plafond, reste: Math.max(0, etat.plafond - etat.depense),
    recherches: { depense: etat.recherches, plafond: PLAFOND_RECHERCHES,
      reste: Math.max(0, PLAFOND_RECHERCHES - etat.recherches) }, fuseau: "America/Los_Angeles" };
}

export function quotaDisponible(cout: number, categorie: CategorieQuota = "lecture"): boolean {
  const etat = quotaDuJour();
  return categorie === "recherche" ? etat.recherches + cout <= PLAFOND_RECHERCHES : etat.depense + cout <= etat.plafond;
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
    if (options.comptabiliser !== false && new URL(url).hostname === "www.googleapis.com") {
      const categorie = new URL(url).pathname.endsWith("/search") ? "recherche" : "lecture";
      if (!quotaDisponible(1, categorie)) throw new Error("Budget YouTube épuisé");
      // Réserver avant le réseau : les appels simultanés et les réponses en erreur comptent aussi.
      depenser(1, categorie);
    }
    const reponse = await recuperer(url);
    if (!reponse.ok) throw new Error(`Réponse ${reponse.status}`);
    const charge = await reponse.json() as unknown;
    return charge && typeof charge === "object" ? charge as Record<string, unknown> : null;
  });
}

/**
 * Une chaîne lue dans une réponse de plateforme, prête à être affichée.
 *
 * **Tout** ce que ce module extrait passe par ici — titre, nom de chaîne, description, identifiant,
 * adresse de vignette —, et c'est pourquoi le décodage des entités y est fait plutôt qu'à chaque
 * champ : l'API de YouTube rend `Greg &amp; Greg` et `L&#39;amour propre`, et un seul champ oublié
 * aurait suffi à laisser l'échappement remonter jusqu'à l'écran. Sur un identifiant ou une durée, le
 * décodage ne trouve rien à faire.
 */
function texte(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const propre = decoderEntitesHtml(valeur).trim();
  return propre ? propre : null;
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
 * Chercher une vidéo par son titre — une requête du budget de recherches.
 *
 * C'est la voie que vous avez demandée quand l'identifiant manque, et elle fonctionne. Mais son prix
 * impose une règle : **on ne cherche que ce qu'on ne peut pas résoudre**, et on s'arrête net dès que
 * le plafond du jour est atteint.
 *
 * La recherche est **restreinte à la chaîne**, par son identifiant de plateforme. Joindre son nom à
 * la requête ne suffisait pas : la recherche restait mondiale, et une « Rétrospective 2024 » publiée
 * par n'importe qui pouvait être retenue. Sans chaîne identifiée, on ne cherche pas du tout —
 * c'est aussi ce qui évite de dépenser une recherche pour une réponse dont on ne pourrait rien faire.
 */
export async function chercherYoutube(
  chaineId: string,
  titre: string,
  options: OptionsFournisseur = {},
): Promise<IdentiteWeb | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  // Sans chaine identifiee, on ne cherche pas : une recherche non restreinte trouverait la video
  // d'une autre chaine au titre voisin, et la donnerait pour certaine.
  if (!chaineId) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.search, "recherche")) return null;

  const url = "https://www.googleapis.com/youtube/v3/search"
    + `?part=snippet&type=video&maxResults=1&channelId=${encodeURIComponent(chaineId)}`
    + `&q=${encodeURIComponent(titre)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);

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
 * Identifier une chaîne : son identifiant sur la plateforme, et son avatar.
 *
 * C'est la première marche de la résolution, et elle commande tout le reste. Tant qu'on ne sait pas
 * **de quelle chaîne** il s'agit, chercher le titre d'une vidéo revient à le chercher dans le monde
 * entier : deux chaînes publient couramment une « Rétrospective 2024 », et rien ne les départage.
 *
 * Elle consomme une requête du budget de recherches — mais **une seule fois par chaîne**, son résultat
 * étant retenu sur la fiche. Les vidéos, elles, s'y appuient ensuite gratuitement.
 */
export async function identifierChaineYoutube(
  nom: string,
  options: OptionsFournisseur = {},
): Promise<{ identifiant: string; avatar: string | null } | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.search, "recherche")) return null;

  const url = "https://www.googleapis.com/youtube/v3/search"
    + `?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(nom)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);

  const premier = Array.isArray(charge?.["items"]) ? (charge["items"] as unknown[])[0] : null;
  if (!premier || typeof premier !== "object") return null;
  const entree = premier as Record<string, unknown>;
  const identifiant = texte((entree["id"] as Record<string, unknown> | undefined)?.["channelId"])
    ?? texte((entree["snippet"] as Record<string, unknown> | undefined)?.["channelId"]);
  if (!identifiant) return null;
  const extrait = (entree["snippet"] ?? {}) as Record<string, unknown>;
  return { identifiant, avatar: meilleureVignette(extrait["thumbnails"]) };
}

/**
 * L'avatar d'une chaîne.
 *
 * Il n'est dans aucun fichier : c'est la seule information de cet écran qui ne puisse venir que de la
 * plateforme. Une recherche de chaîne consomme le budget de recherches — mais elle n'a lieu
 * qu'**une fois par chaîne**, et l'image est ensuite mise en cache localement, donc figée.
 */
export async function avatarChaineYoutubeParId(id: string, options: OptionsFournisseur = {}): Promise<string | null> {
  const cle = cleYoutube(options);
  if (!cle || !id || (options.comptabiliser !== false && !quotaDisponible(COUT.channels))) return null;
  const charge = await lireJson("https://www.googleapis.com/youtube/v3/channels"
    + `?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(cle)}`, options);
  const premier = Array.isArray(charge?.["items"]) ? (charge["items"] as unknown[])[0] : null;
  if (!premier || typeof premier !== "object") return null;
  return meilleureVignette(((premier as Record<string, unknown>)["snippet"] as Record<string, unknown> | undefined)?.["thumbnails"]);
}

export async function avatarDeChaineYoutube(nom: string, options: OptionsFournisseur = {}): Promise<string | null> {
  const cle = cleYoutube(options);
  if (!cle) return null;
  if (options.comptabiliser !== false && !quotaDisponible(COUT.search, "recherche")) return null;

  const url = "https://www.googleapis.com/youtube/v3/search"
    + `?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(nom)}&key=${encodeURIComponent(cle)}`;
  const charge = await lireJson(url, options);

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
