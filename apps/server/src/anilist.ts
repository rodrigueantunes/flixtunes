import type { MetadataSearchCandidate } from "@flixtunes/contracts";
import { fetchWithTimeout } from "./resilience.js";
import { titleMatchScore } from "./tmdb.js";

/**
 * AniList — métadonnées d'animation japonaise, sans clé d'API.
 *
 * TMDB couvre mal ce catalogue : ses fiches japonaises portent souvent le titre natif en kanji, et la
 * recherche depuis un nom de fichier romanisé n'y arrive pas. Relevé sur la médiathèque réelle,
 * « Kaiju No 8 Hoshina's Day Off » ressortait sous « 怪獣8号 保科の休日 », illisible dans le catalogue,
 * et « Ghost in the Shell S A C » ne trouvait rien du tout.
 *
 * AniList publie les trois formes — romaji, anglais, natif — ce qui permet de rapprocher un nom de
 * fichier de la fiche quelle que soit la convention de nommage. Il ne demande aucune inscription,
 * contrairement à TVDB, Fanart, IMDb et AlloCiné qui restent en attente d'une clé.
 *
 * Il n'a pas vocation à remplacer TMDB : il n'est consulté qu'en complément, et le départage entre
 * fournisseurs le place après lui à score égal.
 */

const RACINE = "https://graphql.anilist.co";

/** La requête, réduite à ce qui sert à l'appariement et à l'affichage. */
const REQUETE = `
query ($recherche: String, $format: MediaFormat) {
  Page(perPage: 6) {
    media(search: $recherche, type: ANIME, format: $format, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      startDate { year }
      description(asHtml: false)
      coverImage { large }
    }
  }
}`;

interface MediaAniList {
  id: number;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  startDate?: { year?: number | null };
  description?: string | null;
  coverImage?: { large?: string | null };
}

/**
 * Cherche une œuvre d'animation.
 *
 * [kind] choisit entre le format long — un film — et les séries. AniList distingue les deux, ce qui
 * évite de proposer une série de cinquante épisodes pour un fichier unique.
 */
export async function searchAnilist(
  kind: "movie" | "tv",
  query: string,
  year?: number,
): Promise<MetadataSearchCandidate[]> {
  const recherche = query.trim();
  if (recherche.length < 2) return [];
  let charge: { data?: { Page?: { media?: MediaAniList[] } } };
  try {
    const reponse = await fetchWithTimeout(RACINE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: REQUETE, variables: { recherche, format: kind === "movie" ? "MOVIE" : "TV" } }),
    });
    if (!reponse.ok) return [];
    charge = await reponse.json() as typeof charge;
  } catch {
    // Un fournisseur d'appoint injoignable ne doit jamais empêcher les autres de répondre.
    return [];
  }

  const resultats = charge.data?.Page?.media ?? [];
  return resultats.map((media) => {
    const titres = [media.title?.romaji, media.title?.english, media.title?.native].filter(Boolean) as string[];
    // Le meilleur des trois formes : un fichier peut porter le titre romanisé, l'anglais ou le natif,
    // et rien ne dit lequel. Les comparer tous est le seul moyen de ne pas dépendre de la convention.
    const score = Math.max(0, ...titres.map((titre) => titleMatchScore(recherche, titre, year, media.startDate?.year ?? null)));
    return {
      provider: "anilist" as const,
      externalId: String(media.id),
      kind,
      // Le titre anglais d'abord : c'est celui qu'un catalogue francophone affiche le plus lisiblement,
      // le romaji ensuite, le natif en dernier recours plutôt que rien.
      title: media.title?.english || media.title?.romaji || media.title?.native || "Sans titre",
      originalTitle: media.title?.native || media.title?.romaji || null,
      year: media.startDate?.year ?? null,
      overview: media.description?.replace(/<[^>]+>/g, "").trim() || null,
      posterUrl: media.coverImage?.large ?? null,
      score: Math.round(score * 1000) / 1000,
    };
  }).filter((candidate) => candidate.score > 0)
    .sort((gauche, droite) => droite.score - gauche.score);
}
