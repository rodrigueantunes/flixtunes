import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plateforme } from "./web-chemins.js";

/**
 * Ce qu'une vidéo dit d'elle-même, sans rien demander à personne.
 *
 * Un fichier récupéré d'une plateforme porte presque toujours son identité avec lui : le téléchargeur
 * dépose un `.info.json` à côté, et l'encodeur recopie titre, auteur, date et adresse dans les balises
 * du conteneur. Les lire coûte une lecture de fichier — **aucun appel réseau, aucune clé, aucun
 * quota** — et rend déjà une fiche complète.
 *
 * C'est pourquoi ce module vient avant les fournisseurs distants et non après : une API ne sert qu'à
 * rattraper ce que le fichier ne dit pas. Sur une médiathèque constituée avec un téléchargeur, ce sera
 * l'exception.
 *
 * Rien ici ne touche aux films ni aux séries. En particulier, la lecture des balises prend le JSON
 * brut de FFprobe en entrée plutôt que d'étendre `parseProbeOutput`, qui est partagé.
 */

/** L'identité d'une vidéo, telle qu'une source locale peut la renseigner. Tout y est facultatif. */
export interface IdentiteWeb {
  titre: string | null;
  /** Le nom de la chaîne tel que la plateforme l'écrit — il peut différer du nom du dossier. */
  chaine: string | null;
  plateforme: Plateforme | null;
  /** L'identifiant de la vidéo sur sa plateforme : la clé d'un appariement exact. */
  identifiant: string | null;
  url: string | null;
  /** Date de publication complète, `AAAA-MM-JJ`. Une année seule ne suffit pas à la former. */
  publieeLe: string | null;
  annee: number | null;
  description: string | null;
  dureeSecondes: number | null;
  vignette: string | null;
  /** Le nom de la playlist d'origine, quand le téléchargeur l'a consigné. */
  playlist: string | null;
}

const VIDE: IdentiteWeb = {
  titre: null, chaine: null, plateforme: null, identifiant: null, url: null,
  publieeLe: null, annee: null, description: null, dureeSecondes: null, vignette: null, playlist: null,
};

/**
 * Les domaines qui nomment une plateforme.
 *
 * L'adresse d'origine est le renseignement le plus sûr de tout le lot : elle est écrite par l'outil
 * qui a téléchargé, pas déduite d'un nom de dossier que quelqu'un a pu mal orthographier.
 */
const DOMAINES = new Map<string, Plateforme>([
  ["youtube.com", "youtube"], ["youtu.be", "youtube"], ["m.youtube.com", "youtube"], ["music.youtube.com", "youtube"],
  ["dailymotion.com", "dailymotion"], ["dai.ly", "dailymotion"],
  ["vimeo.com", "vimeo"],
  ["twitch.tv", "twitch"], ["clips.twitch.tv", "twitch"],
  ["tiktok.com", "tiktok"],
  ["facebook.com", "facebook"], ["fb.watch", "facebook"],
  ["instagram.com", "instagram"],
  ["odysee.com", "odysee"],
  ["rumble.com", "rumble"],
]);

/** Le nom que le téléchargeur donne à son extracteur, quand l'adresse manque. */
const DOMAINES_PAR_EXTRACTEUR = new Map<string, Plateforme>([
  ["youtube", "youtube"], ["youtube:tab", "youtube"],
  ["dailymotion", "dailymotion"],
  ["vimeo", "vimeo"],
  ["twitch", "twitch"], ["twitch:vod", "twitch"],
  ["tiktok", "tiktok"],
  ["facebook", "facebook"],
  ["instagram", "instagram"],
  ["odysee", "odysee"],
  ["rumble", "rumble"],
  ["peertube", "peertube"],
]);

function texte(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

function nombre(valeur: unknown): number | null {
  const brut = typeof valeur === "number" ? valeur : typeof valeur === "string" ? Number(valeur) : Number.NaN;
  return Number.isFinite(brut) && brut > 0 ? brut : null;
}

/** La première valeur qui s'analyse comme une adresse http(s). */
function premiereAdresse(...candidats: unknown[]): string | null {
  for (const candidat of candidats) {
    const brut = texte(candidat);
    if (!brut) continue;
    try {
      const adresse = new URL(brut);
      if (adresse.protocol === "http:" || adresse.protocol === "https:") return brut;
    } catch {
      // Ce n'était pas une adresse : le candidat suivant, s'il y en a un.
    }
  }
  return null;
}

/** Le premier des noms présents dans un objet, en ignorant la casse des clés. */
function champ(source: Record<string, unknown>, ...noms: string[]): unknown {
  const entrees = Object.entries(source);
  for (const nom of noms) {
    const trouve = entrees.find(([cle]) => cle.toLowerCase() === nom);
    if (trouve && trouve[1] !== null && trouve[1] !== undefined && trouve[1] !== "") return trouve[1];
  }
  return undefined;
}

/**
 * Normaliser une date de publication.
 *
 * Les téléchargeurs écrivent `20240115`, les conteneurs parfois `2024-01-15`, parfois un horodatage
 * complet, parfois l'année seule. Une année seule ne devient **pas** un 1er janvier : inventer un
 * jour donnerait à une approximation l'apparence d'un fait, et cette date sert à ordonner les vidéos.
 */
export function normaliseDate(valeur: unknown): { publieeLe: string | null; annee: number | null } {
  const brut = texte(valeur);
  if (!brut) return { publieeLe: null, annee: null };
  const compact = brut.match(/^((?:19|20)\d{2})(\d{2})(\d{2})$/);
  if (compact) return { publieeLe: `${compact[1]}-${compact[2]}-${compact[3]}`, annee: Number(compact[1]) };
  const iso = brut.match(/^((?:19|20)\d{2})-(\d{2})-(\d{2})/);
  if (iso) return { publieeLe: `${iso[1]}-${iso[2]}-${iso[3]}`, annee: Number(iso[1]) };
  const annee = brut.match(/^((?:19|20)\d{2})$/);
  if (annee) return { publieeLe: null, annee: Number(annee[1]) };
  return { publieeLe: null, annee: null };
}

/** La plateforme que désigne une adresse, `null` si le domaine n'est pas connu. */
export function plateformeDepuisUrl(valeur: unknown): Plateforme | null {
  const brut = texte(valeur);
  if (!brut) return null;
  try {
    const hote = new URL(brut).hostname.toLowerCase().replace(/^www\./, "");
    return DOMAINES.get(hote) ?? null;
  } catch {
    return null;
  }
}

/**
 * L'identifiant que porte une adresse de vidéo.
 *
 * Utile quand le conteneur ne conserve que l'adresse — le cas le plus fréquent des balises embarquées,
 * qui n'ont pas de champ prévu pour un identifiant de plateforme.
 */
export function identifiantDepuisUrl(valeur: unknown): string | null {
  const brut = texte(valeur);
  if (!brut) return null;
  let adresse: URL;
  try {
    adresse = new URL(brut);
  } catch {
    return null;
  }
  const hote = adresse.hostname.toLowerCase().replace(/^www\./, "");
  const segments = adresse.pathname.split("/").filter(Boolean);
  if (DOMAINES.get(hote) === "youtube") {
    const parametre = adresse.searchParams.get("v");
    if (parametre) return parametre;
    // `youtu.be/<id>`, `youtube.com/shorts/<id>`, `youtube.com/embed/<id>`.
    const dernier = segments.at(-1);
    return dernier ?? null;
  }
  return segments.at(-1) ?? null;
}

/**
 * Lire l'annexe `.info.json` déposée par un téléchargeur.
 *
 * C'est la source la mieux renseignée du lot — elle contient ce que la plateforme elle-même a rendu.
 * Un contenu illisible ne lève pas : une annexe corrompue ne doit pas interrompre l'analyse d'une
 * médiathèque, elle doit simplement ne rien apporter.
 */
export function lireAnnexeWeb(contenu: string): IdentiteWeb | null {
  let brut: unknown;
  try {
    brut = JSON.parse(contenu);
  } catch {
    return null;
  }
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const source = brut as Record<string, unknown>;

  const url = texte(champ(source, "webpage_url", "original_url", "url"));
  const extracteur = texte(champ(source, "extractor_key", "extractor"))?.toLowerCase() ?? null;
  const date = normaliseDate(champ(source, "upload_date", "release_date", "date"));

  // `thumbnails` est ordonné du plus petit au plus grand : la dernière entrée est la meilleure.
  const vignettes = champ(source, "thumbnails");
  const derniereVignette = Array.isArray(vignettes)
    ? texte((vignettes.at(-1) as Record<string, unknown> | undefined)?.["url"])
    : null;

  return {
    titre: texte(champ(source, "title", "fulltitle")),
    chaine: texte(champ(source, "channel", "uploader", "creator", "artist")),
    plateforme: plateformeDepuisUrl(url) ?? (extracteur ? DOMAINES_PAR_EXTRACTEUR.get(extracteur) ?? null : null),
    identifiant: texte(champ(source, "id")) ?? identifiantDepuisUrl(url),
    url,
    publieeLe: date.publieeLe,
    annee: date.annee,
    description: texte(champ(source, "description")),
    dureeSecondes: nombre(champ(source, "duration")),
    vignette: texte(champ(source, "thumbnail")) ?? derniereVignette,
    playlist: texte(champ(source, "playlist_title", "playlist")),
  };
}

/**
 * Lire les balises du conteneur, à partir du JSON brut que FFprobe a déjà produit.
 *
 * Le scanner sonde chaque fichier de toute façon, et conserve sa réponse : ces renseignements sont
 * donc **gratuits**, aucun octet n'étant relu. `purl` est la balise que FFmpeg emploie pour l'adresse
 * d'origine ; c'est elle qui rattache un fichier à sa plateforme quand l'annexe a disparu.
 */
export function lireBalisesWeb(payload: unknown): IdentiteWeb {
  const donnees = payload as { format?: { tags?: Record<string, unknown>; duration?: unknown } } | null | undefined;
  const balises = donnees?.format?.tags;
  if (!balises || typeof balises !== "object") return { ...VIDE };

  // `comment` sert de dernier recours parce que plusieurs encodeurs y rangent l'adresse, mais il
  // contient aussi bien du texte libre : seul un candidat qui s'analyse comme une adresse est retenu.
  const url = premiereAdresse(champ(balises, "purl", "url", "webpage_url"), champ(balises, "comment"));
  const date = normaliseDate(champ(balises, "date", "year", "creation_time"));
  return {
    titre: texte(champ(balises, "title")),
    chaine: texte(champ(balises, "artist", "album_artist", "uploader", "channel", "author")),
    plateforme: plateformeDepuisUrl(url),
    identifiant: identifiantDepuisUrl(url),
    url,
    publieeLe: date.publieeLe,
    annee: date.annee,
    description: texte(champ(balises, "description", "synopsis")),
    dureeSecondes: nombre(donnees?.format?.duration),
    vignette: null,
    playlist: texte(champ(balises, "album")),
  };
}

/**
 * Superposer plusieurs identités, la première renseignée l'emportant champ par champ.
 *
 * L'ordre d'appel porte la règle de préséance : l'annexe d'abord — c'est la plateforme qui parle —,
 * les balises ensuite, le chemin en dernier. Le mélange est fait par champ et non par source, pour
 * qu'une annexe amputée n'efface pas ce que les balises savaient encore.
 */
export function fusionnerIdentites(...sources: Array<IdentiteWeb | null>): IdentiteWeb {
  const presentes = sources.filter((source): source is IdentiteWeb => source !== null);
  // Le choix est ecrit champ par champ plutot que parcouru par cle : c'est plus long, et c'est le
  // seul moyen pour que le compilateur verifie chaque type au lieu de nous croire sur parole.
  return {
    titre: presentes.find((source) => source.titre !== null)?.titre ?? null,
    chaine: presentes.find((source) => source.chaine !== null)?.chaine ?? null,
    plateforme: presentes.find((source) => source.plateforme !== null)?.plateforme ?? null,
    identifiant: presentes.find((source) => source.identifiant !== null)?.identifiant ?? null,
    url: presentes.find((source) => source.url !== null)?.url ?? null,
    publieeLe: presentes.find((source) => source.publieeLe !== null)?.publieeLe ?? null,
    annee: presentes.find((source) => source.annee !== null)?.annee ?? null,
    description: presentes.find((source) => source.description !== null)?.description ?? null,
    dureeSecondes: presentes.find((source) => source.dureeSecondes !== null)?.dureeSecondes ?? null,
    vignette: presentes.find((source) => source.vignette !== null)?.vignette ?? null,
    playlist: presentes.find((source) => source.playlist !== null)?.playlist ?? null,
  };
}

/**
 * Les noms sous lesquels chercher l'annexe d'une vidéo.
 *
 * Trois conventions coexistent selon l'outil et ses options ; les essayer toutes coûte trois tentatives
 * d'ouverture sur un fichier qui n'existe pas, et évite de rater une médiathèque entière rangée par un
 * outil qu'on n'avait pas prévu.
 */
export function cheminsAnnexe(cheminFichier: string): string[] {
  const dossier = path.dirname(cheminFichier);
  const base = path.basename(cheminFichier, path.extname(cheminFichier));
  return [
    path.join(dossier, `${base}.info.json`),
    path.join(dossier, `${path.basename(cheminFichier)}.info.json`),
    path.join(dossier, `${base}.json`),
  ];
}

/** Lire la première annexe présente à côté d'une vidéo. Une absence n'est pas une erreur. */
export async function lireAnnexeDuDisque(cheminFichier: string): Promise<IdentiteWeb | null> {
  for (const candidat of cheminsAnnexe(cheminFichier)) {
    try {
      const identite = lireAnnexeWeb(await readFile(candidat, "utf8"));
      if (identite) return identite;
    } catch {
      // Fichier absent, illisible, ou droits refusés : on essaie le suivant.
    }
  }
  return null;
}
