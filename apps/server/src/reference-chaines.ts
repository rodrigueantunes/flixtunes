import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * Qui sont les chaînes — une table de référence, plutôt qu'une devinette de plus.
 *
 * Le pays d'une chaîne est déduit de quatre indices : le suffixe d'un `tvg-id`, un drapeau, un nom de
 * pays dans le groupe, et une table de noms français écrite à la main. Ensemble ils couvrent **26 %**
 * du corpus. Les trois quarts restants n'ont aucun pays, donc aucun rang dans la grille, et sont
 * absents de tous les filtres par pays.
 *
 * Or ce travail a déjà été fait, publiquement et proprement : le projet iptv-org publie un index de
 * **40 890 chaînes identifiées** — nom, autres noms, pays, catégories, caractère adulte, date de
 * fermeture. Chercher encore des listes n'apportait rien ; ce qui manquait, c'était de savoir **ce
 * qu'on a déjà**.
 *
 * **Un nom ambigu n'identifie rien.** Deux chaînes de pays différents portent parfois le même nom —
 * « News », « Sport TV », « Canal 5 ». Les rapprocher au hasard remplirait la grille d'attributions
 * fausses, et une erreur silencieuse vaut moins que l'aveu d'ignorance qu'on avait déjà. Seuls les
 * noms qui ne désignent **qu'une seule** chaîne de la table sont retenus.
 */

/** Ce que la table sait d'une chaîne, une fois réduit à ce dont on se sert. */
export interface IdentiteChaine {
  /** Le code ISO en minuscules, pour coïncider avec le reste du serveur. */
  pays: string;
  categories: string[];
  adulte: boolean;
}

/**
 * Ce qui décore un nom sans rien en dire, à retirer avant de le comparer.
 *
 * Les noms de la table sont propres — « TF1 », « France 2 ». Ceux du corpus ne le sont pas :
 * « TF1 FHD [1080p-canalplus.com] », « |FR| M6 HD ». Comparer les deux tels quels ne rapproche
 * presque rien, et la mesure le dit — **2 775 chaînes identifiées sans dépouillement, 4 236 avec**,
 * soit la moitié en plus pour une liste de mots.
 *
 * On essaie à chaque étape du dépouillement, comme pour le catalogue français : « France 2 » doit
 * trouver sa réponse avant qu'on ne lui retire son « France ».
 */
const DECOR_TETE = new Set(["fr", "fra", "france", "tnt", "hd", "fhd", "uhd", "sd", "4k", "vip", "hevc", "h265"]);
const DECOR_QUEUE = new Set([
  "hd", "fhd", "uhd", "sd", "qhd", "4k", "8k", "1080p", "1080", "720p", "720", "576p", "540p", "480p",
  "h264", "h265", "hevc", "raw", "vip", "backup", "alt", "multi", "tnt", "tv", "fps50", "50fps",
]);

/** Les écritures successives d'un nom, de la plus décorée à la plus nue. */
export function appellationsPossibles(nomRecherche: string): string[] {
  let jetons = nomRecherche.split(" ").filter(Boolean);
  const essais: string[] = [];
  for (;;) {
    if (!jetons.length) break;
    essais.push(jetons.join(" "));
    if (jetons.length > 1 && DECOR_QUEUE.has(jetons[jetons.length - 1]!)) { jetons = jetons.slice(0, -1); continue; }
    if (jetons.length > 1 && DECOR_TETE.has(jetons[0]!)) { jetons = jetons.slice(1); continue; }
    break;
  }
  return essais;
}

/** Une entrée du fichier publié, telle qu'elle arrive. */
interface EntreeReference {
  id?: unknown;
  name?: unknown;
  alt_names?: unknown;
  country?: unknown;
  categories?: unknown;
  is_nsfw?: unknown;
  closed?: unknown;
}

/**
 * Ranger la table par nom normalisé, en écartant tout ce qui prêterait à confusion.
 *
 * Trois écarts, et chacun a sa raison. Une chaîne **fermée** ne doit pas prêter son identité à une
 * homonyme encore diffusée. Un nom porté par **plusieurs** chaînes de pays différents n'identifie
 * rien. Et une chaîne sans pays n'apporte pas ce qu'on est venu chercher.
 *
 * Les `alt_names` comptent autant que le nom principal : c'est là que se trouvent les écritures qu'on
 * rencontre dans les listes — « France 2 HD », « TF1 Séries et Films ».
 */
export function indexerLaReference(json: string): Map<string, IdentiteChaine> {
  const lu: unknown = JSON.parse(json);
  if (!Array.isArray(lu)) throw new Error("La référence doit être un tableau de chaînes.");

  const candidats = new Map<string, { identite: IdentiteChaine; noms: number }>();
  const ambigus = new Set<string>();

  for (const brut of lu as EntreeReference[]) {
    if (brut?.closed) continue;
    const pays = typeof brut.country === "string" ? brut.country.trim().toLowerCase() : "";
    if (!pays) continue;
    const identite: IdentiteChaine = {
      pays,
      categories: Array.isArray(brut.categories) ? brut.categories.filter((c): c is string => typeof c === "string") : [],
      adulte: brut.is_nsfw === true,
    };

    const appellations = [brut.name, ...(Array.isArray(brut.alt_names) ? brut.alt_names : [])]
      .filter((nom): nom is string => typeof nom === "string" && nom.trim().length > 0);
    for (const appellation of appellations) {
      const cle = normaliseForSearch(appellation);
      if (!cle || ambigus.has(cle)) continue;
      const connu = candidats.get(cle);
      if (!connu) { candidats.set(cle, { identite, noms: 1 }); continue; }
      /*
       * Deux chaînes du **même** pays qui partagent un nom ne posent pas de problème : ce qu'on en
       * retire — le pays — est le même. C'est le désaccord qui disqualifie.
       */
      if (connu.identite.pays !== identite.pays) { ambigus.add(cle); candidats.delete(cle); }
    }
  }

  return new Map([...candidats].map(([cle, valeur]) => [cle, valeur.identite]));
}


/** L'index publié par iptv-org. Une adresse publique, lue une fois par semaine. */
const ADRESSE = "https://iptv-org.github.io/api/channels.json";

/** Une semaine : une chaîne change de pays à peu près jamais, et de nom rarement. */
const FRAICHEUR_MS = 7 * 24 * 60 * 60 * 1000;

/** Dix mégaoctets suffisent largement ; au-delà, ce n'est plus le fichier qu'on croit lire. */
const TAILLE_MAX = 24 * 1024 * 1024;

const DELAI_MS = 30_000;

function cheminDuCache(): string {
  return path.join(config.dataDir, "reference-chaines.json");
}

/**
 * La table, depuis le disque si elle y est fraîche, sinon depuis Internet.
 *
 * Le cache n'est pas une optimisation de confort : sans lui, chaque démarrage du serveur irait
 * rechercher dix mégaoctets pour une information qui bouge une fois par an. Un échec de
 * téléchargement rend la copie périmée plutôt que rien — une identification d'il y a huit jours vaut
 * mieux que pas d'identification du tout.
 */
export async function chargerLaReference(recuperer: typeof fetch = fetch): Promise<Map<string, IdentiteChaine>> {
  const chemin = cheminDuCache();
  let cache: string | null = null;
  let fraiche = false;
  try {
    const brut = readFileSync(chemin, "utf8");
    const enveloppe = JSON.parse(brut) as { lu_le?: string; contenu?: string };
    if (enveloppe?.contenu) {
      cache = enveloppe.contenu;
      fraiche = Date.now() - Date.parse(enveloppe.lu_le ?? "") < FRAICHEUR_MS;
    }
  } catch { /* pas de cache, ou illisible : on téléchargera */ }

  if (cache && fraiche) return indexerLaReference(cache);

  try {
    const reponse = await recuperer(ADRESSE, {
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { "User-Agent": "FlixTunes", Accept: "application/json" },
    });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const octets = await reponse.arrayBuffer();
    if (octets.byteLength > TAILLE_MAX) throw new Error("réponse trop grosse");
    const contenu = new TextDecoder().decode(octets);
    const index = indexerLaReference(contenu);
    writeFileSync(chemin, JSON.stringify({ lu_le: new Date().toISOString(), contenu }), "utf8");
    return index;
  } catch (cause) {
    if (cache) return indexerLaReference(cache);
    throw cause;
  }
}
