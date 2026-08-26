import path from "node:path";
import { detectMedia, folderContext, type DetectionDecision, type DetectionRule } from "./detection.js";

export type MovieContentType = "movie" | "documentary" | "concert" | "short";

export interface ParsedMedia {
  kind: "movie" | "episode";
  title: string;
  /** Autres titres explicitement lus dans le conteneur, utilisés comme preuves sans écraser le nom. */
  titleAliases?: string[];
  year: number | null;
  showTitle: string | null;
  /**
   * Chemin du dossier racine de la série. Identité stable d'une série, indépendante du fournisseur
   * qui a répondu et de la traduction de son titre. Voir `folderContext`.
   */
  showFolder?: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeNumbers?: number[];
  airDate?: string | null;
  contentType?: MovieContentType;
  edition?: string | null;
  externalIds?: { tmdb?: string; imdb?: string; tvdb?: string };
  overview?: string | null;
  /**
   * Nombre de dossiers de saisons trouvés à côté du fichier. Observation directe du disque, servant
   * à départager deux séries homonymes lorsque leurs titres ne suffisent pas.
   */
  seasonsOnDisk?: number;
  detection?: {
    confidence: number;
    pattern: "movie-year" | "movie-name" | "sxe" | "absolute" | "air-date";
    warnings: string[];
    /** Règle du moteur v2 ayant produit le résultat, conservée pour l'explication en administration. */
    rule?: DetectionRule;
    /** Suite à donner : appliquer seul, passer en revue humaine ou refuser. */
    decision?: DetectionDecision;
    /** Indices lisibles ayant conduit à ce choix. */
    evidence?: string[];
    /** Interprétations concurrentes, pour alimenter la file d'ambiguïtés. */
    alternatives?: Array<{ rule: DetectionRule; score: number; title: string }>;
  };
}

/** Correspondance vers les motifs historiques, pour ne pas casser les consommateurs existants. */
const legacyPattern: Record<DetectionRule, NonNullable<ParsedMedia["detection"]>["pattern"]> = {
  "saison-episode": "sxe", "saison-episode-court": "sxe", "date-diffusion": "air-date",
  "numerotation-absolue": "absolute", "marqueur-episode": "sxe", special: "sxe", "serie-repli": "absolute",
  "film-annee": "movie-year", "film-dossier": "movie-year", "film-partie": "movie-year", "film-nom": "movie-name", identifiant: "movie-year",
};

const releaseNoise = /\b(4320p|2160p|1080p|720p|480p|uhd|bluray|blu-ray|web[- .]?dl|webrip|hdtv|hdr10\+?|hdr|dovi|dv|x26[45]|h26[45]|hevc|av1|remux|multi|truefrench|vostfr|aac|ac3|eac3|dts(?:-hd)?|truehd|atmos)\b.*$/i;
const editionPattern = /\b(director'?s cut|extended(?: edition| cut)?|theatrical(?: cut)?|ultimate(?: edition| cut)?|final cut|unrated|remastered|imax|criterion|collector'?s edition)\b/i;
const idPattern = /[\[{(](tmdb|imdb|tvdb)(?:id)?[-:= ](tt\d+|\d+)[\]})]/gi;

function decodeSeparatorText(value: string): string {
  return value.replace(/[._]+/g, " ").replace(/\s+/g, " ").replace(/^[-\s]+|[-\s]+$/g, "").trim();
}

export function cleanTitle(value: string): string {
  const sansIdentifiants = value.replace(idPattern, "");
  const nettoyer = (texte: string) => decodeSeparatorText(texte.replace(releaseNoise, "")
    .replace(/[[(](?=[^\])]*(?:\d{3,4}p|web[- .]?dl|bluray|x26[45]|hevc|av1|multi|vostfr|truefrench|french|eng|aac|dts|atmos))[^\])]*[\])]/gi, "")
    .replace(/[[(]\s*$/, ""));

  // La mention d'édition n'est retirée que s'il reste un titre derrière.
  //
  // « Final Cut » est à la fois un marqueur d'édition et le titre d'un film de 2004. Le retirer
  // sans condition ne laissait rien, et la fiche s'appelait « Média inconnu » — relevé sur la
  // médiathèque réelle. Le même piège guette « Unrated », « Remastered » ou « Extended » : quand le
  // marqueur *est* tout le titre, c'est qu'il n'en est pas un.
  const sansÉdition = nettoyer(sansIdentifiants.replace(editionPattern, ""));
  return sansÉdition || nettoyer(sansIdentifiants);
}

function externalIds(value: string): NonNullable<ParsedMedia["externalIds"]> {
  const ids: NonNullable<ParsedMedia["externalIds"]> = {};
  for (const match of value.matchAll(new RegExp(idPattern.source, "gi"))) {
    const provider = match[1]?.toLowerCase() as keyof NonNullable<ParsedMedia["externalIds"]>;
    if (provider && match[2]) ids[provider] = match[2];
  }
  return ids;
}

function movieContentType(value: string): MovieContentType {
  if (/\b(documentar(?:y|ies)|documentaires?|docu)\b/i.test(value)) return "documentary";
  if (/\b(concerts?|live[ ._-]+at|live[ ._-]+in)\b/i.test(value)) return "concert";
  if (/\b(short[ ._-]*film|court[ ._-]*m[ée]trage)\b/i.test(value)) return "short";
  return "movie";
}

function baseResult(overrides: Partial<ParsedMedia>): ParsedMedia {
  return {
    kind: "movie", title: "Média inconnu", year: null, showTitle: null, seasonNumber: null,
    episodeNumber: null, episodeNumbers: [], airDate: null, contentType: "movie", edition: null,
    externalIds: {}, overview: null, ...overrides,
  };
}

function showIdentity(value: string): { title: string; year: number | null } {
  const match = value.trim().match(/^(.*?)[\s._-]*[\[(]((?:19|20)\d{2})[\])]\s*$/);
  return { title: cleanTitle(match?.[1] ?? value), year: match?.[2] ? Number(match[2]) : null };
}

function folderShowTitle(filePath: string): { title: string; year: number | null; season: number | null } {
  const parts = path.dirname(filePath).split(/[\\/]+/);
  const parent = parts.at(-1) ?? "";
  const season = parent.match(/^(?:season|saison|series|s)\s*(\d+)$/i);
  const specials = /^(?:specials?|hors[- ]s[ée]rie)$/i.test(parent);
  const identity = showIdentity((season || specials ? parts.at(-2) : parent) ?? "Série inconnue");
  return {
    ...identity,
    season: specials ? 0 : season ? Number(season[1]) : null,
  };
}

/**
 * Détection v2 : le moteur à candidats produit le résultat, cette fonction ne fait que le traduire dans
 * la forme attendue par le scanner. Aucun fichier n'est déplacé ni fusionné : seule la fiche est remplie.
 */
export function parseMediaPath(filePath: string, libraryKind: "movie" | "tv" | "other" = "other"): ParsedMedia {
  const detected = detectMedia(filePath, libraryKind);
  const best = detected.best;
  const warnings = detected.reason ? [detected.reason] : [];
  return {
    kind: best.kind,
    title: best.title || "Média inconnu",
    year: best.year,
    showTitle: best.showTitle,
    // Le dossier n'a de sens que pour un épisode : un film partage son dossier de genre avec des
    // centaines d'autres, et ce dossier ne l'identifie donc pas.
    showFolder: best.kind === "episode" ? folderContext(filePath).showFolderPath : null,
    seasonNumber: best.seasonNumber,
    episodeNumber: best.episodeNumbers[0] ?? null,
    episodeNumbers: best.episodeNumbers,
    airDate: best.airDate,
    contentType: best.contentType,
    edition: best.edition,
    externalIds: best.externalIds,
    overview: null,
    detection: {
      confidence: best.score, pattern: legacyPattern[best.rule], warnings,
      rule: best.rule, decision: detected.decision, evidence: best.evidence,
      alternatives: detected.candidates.slice(1, 4)
        .map((candidate) => ({ rule: candidate.rule, score: candidate.score, title: candidate.title })),
    },
  };
}

/** Ancien analyseur conservé le temps de comparer les deux moteurs sur un corpus réel. */
export function parseMediaPathLegacy(filePath: string, libraryKind: "movie" | "tv" | "other" = "other"): ParsedMedia {
  const base = path.basename(filePath, path.extname(filePath));
  const ids = externalIds(`${filePath} ${base}`);
  const edition = base.match(editionPattern)?.[1] ?? null;
  const folder = folderShowTitle(filePath);

  if (libraryKind !== "movie") {
    const standard = base.match(/^(.*?)[. _-]+s(\d{1,2})[. _-]*e(\d{1,3})(?:(?:[. _-]*e|[. _-]*-[. _-]*e?)(\d{1,3}))?(?:[. _-]+(.*))?$/i)
      ?? base.match(/^(.*?)[. _-]+(\d{1,2})x(\d{1,3})(?:[. _-]*-[. _-]*(\d{1,3}))?(?:[. _-]+(.*))?$/i);
    if (standard) {
      const first = Number(standard[3]);
      const second = standard[4] ? Number(standard[4]) : null;
      const episodeNumbers = second && second >= first ? Array.from({ length: second - first + 1 }, (_, index) => first + index) : [first];
      const filenameShow = showIdentity(standard[1] ?? "");
      const episodeName = cleanTitle(standard[5] ?? "");
      return baseResult({
        kind: "episode", title: episodeName || (episodeNumbers.length > 1 ? `Épisodes ${first}-${second}` : `Épisode ${first}`),
        showTitle: filenameShow.title || folder.title, year: filenameShow.year ?? folder.year,
        seasonNumber: Number(standard[2]), episodeNumber: first,
        episodeNumbers, externalIds: ids, detection: { confidence: 0.98, pattern: "sxe", warnings: [] },
      });
    }

    const dated = base.match(/^(.*?)[. _-]+((?:19|20)\d{2})[. _-](\d{2})[. _-](\d{2})(?:[. _-]+(.*))?$/);
    if (dated) {
      const airDate = `${dated[2]}-${dated[3]}-${dated[4]}`;
      return baseResult({ kind: "episode", title: cleanTitle(dated[5] ?? "") || airDate,
        showTitle: cleanTitle(dated[1] ?? "") || folder.title, year: folder.year, seasonNumber: Number(dated[2]),
        episodeNumber: Number(`${dated[3]}${dated[4]}`), episodeNumbers: [Number(`${dated[3]}${dated[4]}`)], airDate, externalIds: ids,
        detection: { confidence: 0.96, pattern: "air-date", warnings: [] } });
    }

    if (libraryKind === "tv") {
      const leading = base.match(/^(\d{1,4})[. _-]+(.*)$/) ?? base.match(/^.*?[. _-]+-[. _-]+(\d{1,4})(?:[. _-]+(.*))?$/);
      const number = leading ? Number(leading[1]) : null;
      return baseResult({ kind: "episode", title: cleanTitle(leading?.[2] ?? base), showTitle: folder.title, year: folder.year,
        seasonNumber: folder.season, episodeNumber: number, episodeNumbers: number === null ? [] : [number], externalIds: ids,
        detection: { confidence: number == null ? 0.45 : 0.78, pattern: "absolute", warnings: number == null ? ["Numéro d'épisode absent"] : [] } });
    }
  }

  const yearMatch = base.match(/(?:^|[. _(-])((?:19|20)\d{2})(?:[. _)\]-]|$)/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const titlePart = yearMatch ? base.slice(0, yearMatch.index) : base;
  return baseResult({ kind: "movie", title: cleanTitle(titlePart) || cleanTitle(base), year,
    contentType: movieContentType(`${filePath} ${base}`), edition: edition ? decodeSeparatorText(edition) : null, externalIds: ids,
    detection: { confidence: year ? 0.94 : Object.keys(ids).length ? 0.99 : 0.62, pattern: year ? "movie-year" : "movie-name",
      warnings: year || Object.keys(ids).length ? [] : ["Année absente du nom de fichier"] } });
}

export function mergeSidecarMetadata(parsed: ParsedMedia, metadata: Partial<ParsedMedia> | null): ParsedMedia {
  if (!metadata) return parsed;
  return {
    ...parsed, ...metadata,
    title: metadata.title || parsed.title,
    year: metadata.year ?? parsed.year,
    showTitle: metadata.showTitle || parsed.showTitle,
    seasonNumber: metadata.seasonNumber ?? parsed.seasonNumber,
    episodeNumber: metadata.episodeNumber ?? parsed.episodeNumber,
    episodeNumbers: metadata.episodeNumbers?.length ? metadata.episodeNumbers : parsed.episodeNumbers,
    externalIds: { ...(parsed.externalIds ?? {}), ...(metadata.externalIds ?? {}) },
  };
}
