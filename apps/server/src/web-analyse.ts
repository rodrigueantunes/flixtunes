import type { LibraryFolder } from "@flixtunes/contracts";
import { db } from "./database.js";
import type { ParsedMedia } from "./media-parser.js";
import { cleDuPalier, episodeDepuisLeWeb, libelleDuPalier } from "./web-catalogue.js";
import { lireCheminWeb, type CheminWeb, type RefusChemin } from "./web-chemins.js";
import { fusionnerIdentites, lireAnnexeDuDisque, lireBalisesWeb, type IdentiteWeb } from "./web-identite.js";
import { chercherYoutube, identifierChaineYoutube, resoudreParOEmbed, resoudreYoutube } from "./web-fournisseurs.js";
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

/**
 * Une ligne de journal par décision de correspondance web.
 *
 * Même forme que celle du scanner — une ligne JSON, exploitable dans le journal ASUSTOR, sans jeton
 * ni adresse d'API. Elle existe parce qu'un échec avalé en silence a coûté une journée : l'écran
 * annonçait « rien trouvé » sans que rien nulle part ne dise pourquoi.
 */
function journalWeb(event: string, details: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ scope: "web", event, ...details }));
}

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
 * L'identité d'une chaîne sur sa plateforme, résolue une seule fois.
 *
 * C'est la première marche, et elle commande le reste : tant qu'on ignore **de quelle chaîne** il
 * s'agit, chercher le titre d'une vidéo revient à le chercher dans le monde entier. Deux chaînes
 * publient couramment une « Rétrospective 2024 », et rien ne les départagerait.
 *
 * Elle coûte cent unités de quota, donc elle se retient à deux niveaux. Sur la fiche de la chaîne
 * d'abord — `external_id`, qui survit aux redémarrages. Et en mémoire le temps d'une analyse, parce
 * que la fiche n'existe pas encore quand on traite le **premier** fichier d'une chaîne neuve : sans
 * ce second niveau, ce fichier-là paierait une recherche que le suivant paierait à nouveau.
 */
const chainesConnues = new Map<string, { identifiant: string; avatar: string | null }>();

async function identiteDeLaChaine(
  library: LibraryFolder,
  chemin: CheminWeb,
): Promise<{ identifiant: string; avatar: string | null } | null> {
  if (chemin.plateforme !== "youtube") return null;
  const cle = chemin.chaineDossier;

  const enregistree = db.prepare(
    `SELECT external_id FROM catalog_items
     WHERE library_id = ? AND kind = 'show' AND source_folder = ? AND external_provider = 'youtube'`,
  ).get(library.id, cle) as { external_id: string | null } | undefined;
  if (enregistree?.external_id) return { identifiant: enregistree.external_id, avatar: null };

  const deja = chainesConnues.get(cle);
  if (deja) return deja;

  /*
   * **Seule une réussite est mise en cache.**
   *
   * La version précédente retenait aussi les échecs, pour toute la vie du processus. Conséquence
   * constatée sur une installation réelle : une première analyse lancée avant la saisie de la clé
   * enregistrait « chaîne introuvable » pour chaque chaîne, et **plus aucun fichier ne réessayait**
   * ensuite — pas même après avoir saisi la clé et relancé l'actualisation des métadonnées. Le quota
   * consommé de la journée le disait sans ambiguïté : une unité, là où une seule recherche de chaîne
   * en coûte cent.
   *
   * Ne pas mettre l'échec en cache coûte une tentative par fichier dans le pire cas. C'est le prix à
   * payer pour qu'une panne passagère — ou une clé saisie entre-temps — ne condamne pas la
   * bibliothèque jusqu'au prochain redémarrage.
   */
  try {
    const trouvee = await identifierChaineYoutube(chemin.chaine);
    if (trouvee) chainesConnues.set(cle, trouvee);
    else journalWeb("chaine-introuvable", { chaine: chemin.chaine, dossier: cle });
    return trouvee;
  } catch (erreur) {
    // Un échec avalé sans un mot laisse devant un « ça ne trouve rien » qu'on ne peut pas expliquer.
    journalWeb("chaine-echec", {
      chaine: chemin.chaine,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    });
    return null;
  }
}

/** Oublier les chaînes retenues. À appeler quand les clés changent : la précédente n'a plus cours. */
export function oublierLesChainesConnues(): void {
  chainesConnues.clear();
}

/** Retenir sur la fiche de la chaîne son identifiant de plateforme, pour ne plus le chercher. */
function retenirIdentiteDeChaine(chaineId: string, identifiant: string): void {
  db.prepare(`UPDATE catalog_items SET external_provider = 'youtube', external_id = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND metadata_locked = 0`).run(identifiant, chaineId);
}

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
async function completerParLaPlateforme(
  library: LibraryFolder,
  chemin: CheminWeb,
  locale: IdentiteWeb,
): Promise<IdentiteWeb | null> {
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
    if (plateforme === "youtube") {
      // La chaîne d'abord, la vidéo ensuite, et **dans cette chaîne-là**. Sans chaîne identifiée on
      // ne cherche pas : une recherche mondiale rendrait la vidéo d'un autre au titre voisin.
      const chaine = await identiteDeLaChaine(library, chemin);
      if (!chaine) return null;
      return await chercherYoutube(chaine.identifiant, locale.titre ?? chemin.titre);
    }
    // Ailleurs, sans adresse d'origine, les métadonnées locales font seules — et le dire vaut mieux
    // que d'inventer une correspondance.
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
  const identite = fusionnerIdentites(locale, await completerParLaPlateforme(library, lecture.chemin, locale));
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
 * Retenir l'adresse d'une image sur la fiche.
 *
 * `cacheRemoteArtwork` enregistre le fichier et rend son adresse locale, mais n'ecrit rien sur la
 * fiche : c'est a l'appelant de le faire, et le chemin des films passe par `applyEntityArtwork` pour
 * cela. Sans cette ecriture, deux choses cassent d'un coup — aucune vignette ne s'affiche, et
 * `dejaIllustree` reste faux, donc l'avatar de la chaine est **redemande a chaque analyse**, cent
 * unites de quota a chaque passage. C'est exactement ce que « figer une fois trouve » devait eviter.
 */
function retenirIllustration(catalogId: string, adresse: string | null): void {
  if (!adresse) return;
  db.prepare("UPDATE catalog_items SET poster_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(adresse, catalogId);
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
  library: LibraryFolder;
  catalogId: string;
  chaineId: string;
  chemin: CheminWeb;
  identite: IdentiteWeb;
  langue: string;
}): Promise<void> {
  try {
    if (args.identite.vignette && !dejaIllustree(args.catalogId)) {
      retenirIllustration(args.catalogId,
        await cacheRemoteArtwork(args.catalogId, "poster", args.identite.vignette, args.langue, "youtube"));
    }
  } catch { /* une fiche sans vignette reste une fiche */ }

  try {
    if (args.chemin.plateforme === "youtube" && !dejaIllustree(args.chaineId)) {
      // La même résolution sert l'avatar et l'identifiant : une recherche, deux réponses. Retenir
      // l'identifiant sur la fiche évite de la refaire au prochain fichier de cette chaîne.
      const chaine = await identiteDeLaChaine(args.library, args.chemin);
      if (chaine) {
        retenirIdentiteDeChaine(args.chaineId, chaine.identifiant);
        if (chaine.avatar) {
          retenirIllustration(args.chaineId,
            await cacheRemoteArtwork(args.chaineId, "poster", chaine.avatar, args.langue, "youtube"));
        }
      }
    }
  } catch { /* idem pour la chaine */ }
}

/**
 * Dire si une fiche web est résolue, ou si elle attend une correction.
 *
 * `match_status` vaut `unmatched` par défaut. Sans cette écriture, **toutes** les vidéos web se
 * déclareraient douteuses — sur une médiathèque réelle, les 6 589 correctement identifiées comme les
 * 1 555 qui ne le sont pas — et l'écran de correction n'apprendrait plus rien à personne.
 *
 * Le critère est le seul qui compte : sait-on **de quelle vidéo** il s'agit sur sa plateforme ? Un
 * identifiant répond oui sans ambiguïté. Un titre lu dans un nom de fichier, non — c'est précisément
 * ce qu'une correction manuelle vient trancher.
 *
 * Une fiche verrouillée n'est jamais retouchée : le verrou est une intention exprimée.
 */
export function noterCorrespondanceWeb(catalogId: string, identite: IdentiteWeb): void {
  const resolue = Boolean(identite.identifiant);
  db.prepare(`UPDATE catalog_items
    SET match_status = ?, match_confidence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND metadata_locked = 0 AND match_status <> 'manual'`)
    .run(resolue ? "automatic" : "unmatched", resolue ? 1 : 0, catalogId);
}
