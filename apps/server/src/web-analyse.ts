import type { LibraryFolder } from "@flixtunes/contracts";
import { db } from "./database.js";
import type { ParsedMedia } from "./media-parser.js";
import { cleDuPalier, episodeDepuisLeWeb, libelleDuPalier } from "./web-catalogue.js";
import { lireCheminWeb, type CheminWeb, type RefusChemin } from "./web-chemins.js";
import { fusionnerIdentites, lireAnnexeDuDisque, lireBalisesWeb, type IdentiteWeb } from "./web-identite.js";
import { avatarDeChaineYoutube, chercherYoutube, resoudreParOEmbed, resoudreYoutube } from "./web-fournisseurs.js";
import { cacheRemoteArtwork } from "./artwork.js";

/**
 * L'analyse d'un fichier d'une bibliothèque web, du chemin jusqu'à la fiche.
 *
 * C'est le seul point de ce chantier qui interroge la base, et il ne fait que deux choses qu'un module
 * pur ne pouvait pas faire : retrouver le numéro déjà attribué à un dossier, et savoir si une place est
 * prise. Tout le raisonnement vit ailleurs, dans des fonctions éprouvées sans base.
 *
 * **Aucun fournisseur de films ou de séries n'est interrogé ici.** Une vidéo intitulée « Star Wars —
 * analyse » trouverait sur TMDB ou Wikidata une correspondance à score élevé, et la cascade
 * l'appliquerait comme une certitude que rien ne viendrait relire. La règle est donc une exclusion, pas
 * un réordonnancement : pour une bibliothèque web, ces bases ne sont pas consultées du tout.
 */

/** Ce qu'on dit à la personne quand un fichier n'est pas rangé comme l'arborescence l'exige. */
const MESSAGES: Record<RefusChemin, string> = {
  "hors-bibliotheque": "Le fichier n'est pas sous la racine de la bibliothèque.",
  "sans-plateforme": "Le fichier doit être rangé sous une plateforme puis une chaîne, par exemple « YouTube/Ma chaîne/ ».",
  "sans-chaine": "Le fichier est posé dans un dossier de plateforme, sans dossier de chaîne.",
};

export function messageDeRefus(raison: RefusChemin): string {
  return MESSAGES[raison];
}

/**
 * Le numéro de palier attribué à un dossier de cette chaîne.
 *
 * La correspondance entre un nom de dossier et l'entier que le catalogue emploie ne se calcule pas :
 * elle se **retient**, et elle se retient là où vivent déjà les fiches plutôt que dans une table de
 * plus. Un dossier connu garde son numéro — c'est ce qui rend l'attribution stable d'une analyse à
 * l'autre —, un dossier nouveau prend le suivant.
 *
 * Tant que la chaîne n'a pas de fiche, il n'y a rien à retenir : le premier fichier ouvre le premier
 * palier, et les suivants trouveront la fiche créée entre-temps, puisque l'analyse traite les fichiers
 * l'un après l'autre.
 */
function numeroDePalier(library: LibraryFolder, chemin: CheminWeb, cle: string): number {
  const chaine = db.prepare(
    "SELECT id FROM catalog_items WHERE library_id = ? AND kind = 'show' AND source_folder = ?",
  ).get(library.id, chemin.chaineDossier) as { id: string } | undefined;
  if (!chaine) return 1;

  const libelle = libelleDuPalier(cle, library.language);
  const connu = db.prepare(
    "SELECT season_number FROM catalog_items WHERE parent_id = ? AND kind = 'season' AND title = ?",
  ).get(chaine.id, libelle) as { season_number: number | null } | undefined;
  if (connu?.season_number != null) return connu.season_number;

  const suivant = db.prepare(
    "SELECT COALESCE(MAX(season_number), 0) + 1 AS suivant FROM catalog_items WHERE parent_id = ? AND kind = 'season'",
  ).get(chaine.id) as { suivant: number } | undefined;
  return suivant?.suivant ?? 1;
}

/**
 * Cette place est-elle déjà tenue par un **autre** fichier ?
 *
 * Deux vidéos publiées le même jour visent le même rang. La question ne se tranche qu'en base, puisque
 * la réponse dépend de ce qui a déjà été analysé. Le fichier courant est exclu de la recherche : sans
 * cela, une seconde analyse du même fichier le verrait occuper sa propre place et le décalerait à
 * chaque passage.
 */
function placeOccupee(library: LibraryFolder, chemin: CheminWeb, cheminFichier: string): (palier: number, rang: number) => boolean {
  const requete = db.prepare(`SELECT 1 AS pris FROM media_items
    WHERE library_id = ? AND show_title = ? AND season_number = ? AND episode_number = ? AND file_path <> ? LIMIT 1`);
  return (palier, rang) =>
    Boolean(requete.get(library.id, chemin.chaine, palier, rang, cheminFichier) as { pris: number } | undefined);
}

export type LectureWeb =
  | { valide: true; parsed: ParsedMedia; chemin: CheminWeb; identite: IdentiteWeb }
  | { valide: false; message: string };

/**
 * Demander à la plateforme ce que le fichier n'a pas dit.
 *
 * Trois principes, dans cet ordre.
 *
 * **On ne demande rien quand on sait déjà.** Si le fichier porte titre, date et vignette, l'appel
 * n'apporterait rien et coûterait du quota — une ressource quotidienne dont l'épuisement rend la clé
 * inutilisable jusqu'au lendemain.
 *
 * **La provenance décide de l'interlocuteur.** Elle est écrite dans le chemin : le dossier de premier
 * niveau nomme la plateforme. On ne cherche donc jamais une vidéo Dailymotion sur YouTube — on
 * trouverait une autre vidéo, au titre voisin, et on l'appliquerait comme une certitude.
 *
 * **L'identifiant prime sur le titre.** Il donne une correspondance exacte, sans score ni seuil, et
 * coûte cent fois moins cher. Le titre reste la clé quand il n'y a pas d'identifiant, comme demandé.
 *
 * Un échec de fournisseur ne fait pas échouer l'analyse : le fichier entre avec ce qu'il portait.
 */
async function completerParLaPlateforme(chemin: CheminWeb, locale: IdentiteWeb): Promise<IdentiteWeb | null> {
  if (locale.titre && locale.publieeLe && locale.vignette) return null;

  const plateforme = chemin.plateforme ?? locale.plateforme;
  if (!plateforme) return null;
  const identifiant = chemin.identifiant ?? locale.identifiant;

  try {
    if (plateforme === "youtube" && identifiant) return await resoudreYoutube(identifiant);
    if (locale.url) {
      const parOEmbed = await resoudreParOEmbed(plateforme, locale.url);
      if (parOEmbed) return parOEmbed;
    }
    // Seul YouTube offre une recherche exploitable ici. Ailleurs, sans adresse d'origine, les
    // métadonnées locales font seules — et le dire vaut mieux que d'inventer une correspondance.
    if (plateforme === "youtube") return await chercherYoutube(chemin.chaine, locale.titre ?? chemin.titre);
    return null;
  } catch {
    return null;
  }
}

/**
 * Lire une vidéo web : son rangement, ce qu'elle dit d'elle-même, et la place qui lui revient.
 *
 * `payloadFfprobe` est le JSON brut du sondage, que l'analyse a de toute façon produit pour ce fichier.
 * Les balises du conteneur sont donc lues sans qu'un seul octet soit relu.
 */
export async function analyserVideoWeb(
  library: LibraryFolder,
  cheminFichier: string,
  payloadFfprobe: unknown,
): Promise<LectureWeb> {
  const lecture = lireCheminWeb(library.path, cheminFichier);
  if (!lecture.valide) return { valide: false, message: messageDeRefus(lecture.raison) };

  const locale = fusionnerIdentites(await lireAnnexeDuDisque(cheminFichier), lireBalisesWeb(payloadFfprobe));
  // Le fichier d'abord, la plateforme en rattrapage : c'est l'ordre le moins cher et le plus sûr.
  const identite = fusionnerIdentites(locale, await completerParLaPlateforme(lecture.chemin, locale));
  const cle = cleDuPalier(lecture.chemin);
  const palier = numeroDePalier(library, lecture.chemin, cle);
  const parsed = episodeDepuisLeWeb(
    lecture.chemin,
    identite,
    () => palier,
    placeOccupee(library, lecture.chemin, cheminFichier),
  );
  return { valide: true, parsed, chemin: lecture.chemin, identite };
}

/** Le libellé du palier d'un fichier, pour la fiche de saison. */
export function libelleDuPalierDuFichier(library: LibraryFolder, cheminFichier: string): string {
  const lecture = lireCheminWeb(library.path, cheminFichier);
  return lecture.valide ? libelleDuPalier(cleDuPalier(lecture.chemin), library.language) : "";
}

/** Une fiche porte-t-elle deja une image que le serveur heberge ? */
function dejaIllustree(catalogId: string): boolean {
  const ligne = db.prepare("SELECT poster_url FROM catalog_items WHERE id = ?").get(catalogId) as
    { poster_url: string | null } | undefined;
  return Boolean(ligne?.poster_url?.startsWith("/api/artwork/"));
}

/**
 * Illustrer une video et sa chaine, une fois pour toutes.
 *
 * « La vignette de l'instant T, et ca conservera celle-ci ensuite » : l'image est telechargee au
 * premier passage puis servie localement, et **plus jamais redemandee**. Une fiche deja illustree est
 * donc laissee telle quelle — y compris si la plateforme a change sa vignette depuis. C'est le
 * comportement demande, et c'est aussi celui qui protege du jour ou l'adresse d'origine expire.
 *
 * L'avatar de chaine coute une recherche, soit cent unites de quota. Il n'est donc demande qu'une
 * seule fois par chaine, quand elle n'a encore aucune image.
 *
 * Un echec d'illustration n'interrompt rien : une fiche sans image reste une fiche.
 */
export async function illustrerVideoWeb(args: {
  catalogId: string;
  chaineId: string;
  chemin: CheminWeb;
  identite: IdentiteWeb;
  langue: string;
}): Promise<void> {
  try {
    if (args.identite.vignette && !dejaIllustree(args.catalogId)) {
      await cacheRemoteArtwork(args.catalogId, "poster", args.identite.vignette, args.langue, "youtube");
    }
  } catch { /* une fiche sans vignette reste une fiche */ }

  try {
    if (args.chemin.plateforme === "youtube" && !dejaIllustree(args.chaineId)) {
      const avatar = await avatarDeChaineYoutube(args.chemin.chaine);
      if (avatar) await cacheRemoteArtwork(args.chaineId, "poster", avatar, args.langue, "youtube");
    }
  } catch { /* idem pour la chaine */ }
}
