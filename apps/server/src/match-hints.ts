import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedMedia } from "./media-parser.js";

export interface MatchHints {
  title?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumbers?: number[];
  externalIds: NonNullable<ParsedMedia["externalIds"]>;
  evidence: string[];
}

function episodeNumbers(value: string): { season?: number; episodes: number[] } | null {
  const normalized = value.trim().toUpperCase();
  const special = normalized.match(/^SP(\d{1,3})$/);
  if (special) return { season: 0, episodes: [Number(special[1])] };
  const explicit = normalized.match(/^S(\d{1,3})E(\d{1,4})(?:-(?:S\d{1,3})?E?(\d{1,4}))?$/);
  const currentSeason = normalized.match(/^E?(\d{1,4})(?:-E?(\d{1,4}))?$/);
  const first = explicit?.[2] ?? currentSeason?.[1];
  const last = explicit?.[3] ?? currentSeason?.[2];
  if (!first) return null;
  const start = Number(first); const end = last ? Number(last) : start;
  if (start < 0 || end < start || end - start > 20) return null;
  return { season: explicit?.[1] ? Number(explicit[1]) : undefined,
    episodes: Array.from({ length: end - start + 1 }, (_, index) => start + index) };
}

/** Lit le format public `.plexmatch`; les directives inconnues restent sans effet. */
export function parseMatchHints(text: string, mediaFileName?: string): MatchHints {
  const hints: MatchHints = { externalIds: {}, evidence: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;
    if (key === "title" || key === "show") hints.title = value;
    else if (key === "year" && /^(?:19|20)\d{2}$/.test(value)) hints.year = Number(value);
    else if (key === "season" && /^\d{1,3}$/.test(value)) hints.seasonNumber = Number(value);
    else if (["tmdbid", "tvdbid", "imdbid"].includes(key)) {
      const provider = key.slice(0, -2) as keyof MatchHints["externalIds"];
      const id = value.replace(new RegExp(`^${provider}-`, "i"), "").trim();
      if ((provider === "imdb" ? /^tt\d+$/i : /^\d+$/).test(id)) hints.externalIds[provider] = id;
    } else if (key === "guid") {
      const guid = value.match(/^(tmdb|tvdb|imdb):\/\/(?:.*\/)?(tt\d+|\d+)$/i);
      if (guid) hints.externalIds[guid[1]!.toLowerCase() as keyof MatchHints["externalIds"]] = guid[2]!;
    } else if ((key === "episode" || key === "ep") && mediaFileName) {
      const mappingSeparator = value.indexOf(":");
      if (mappingSeparator < 0) continue;
      const numbering = value.slice(0, mappingSeparator).trim();
      const mappedFile = value.slice(mappingSeparator + 1).trim();
      if (mappedFile.localeCompare(mediaFileName, undefined, { sensitivity: "accent" }) !== 0) continue;
      const parsed = episodeNumbers(numbering);
      if (parsed) {
        hints.episodeNumbers = parsed.episodes;
        if (parsed.season != null) hints.seasonNumber = parsed.season;
      }
    }
  }
  if (hints.title) hints.evidence.push(`titre imposé par fichier de correspondance : ${hints.title}`);
  if (hints.year) hints.evidence.push(`année imposée par fichier de correspondance : ${hints.year}`);
  for (const [provider, id] of Object.entries(hints.externalIds)) hints.evidence.push(`identifiant ${provider.toUpperCase()} imposé : ${id}`);
  if (hints.episodeNumbers?.length) hints.evidence.push(`épisode imposé : ${hints.episodeNumbers.join("–")}`);
  return hints;
}

function mergeHints(base: MatchHints, override: MatchHints): MatchHints {
  return {
    ...base, ...override,
    externalIds: { ...base.externalIds, ...override.externalIds },
    evidence: [...base.evidence, ...override.evidence],
  };
}

/**
 * Charge les indications du dossier de série vers le dossier de saison. `.flixtunesmatch` utilise le
 * même format et prend priorité sur `.plexmatch`, ce qui permet de réutiliser une médiathèque Plex
 * sans l'enfermer dans cette convention.
 */
export async function readMatchHints(filePath: string, libraryRoot: string): Promise<MatchHints | null> {
  const root = path.resolve(libraryRoot); let current = path.resolve(path.dirname(filePath));
  const inside = current === root || current.startsWith(`${root}${path.sep}`);
  if (!inside) return null;
  const directories: string[] = [];
  while (true) {
    directories.push(current);
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  let merged: MatchHints = { externalIds: {}, evidence: [] }; let found = false;
  for (const directory of directories.reverse()) {
    for (const name of [".plexmatch", ".flixtunesmatch"]) {
      try {
        merged = mergeHints(merged, parseMatchHints(await readFile(path.join(directory, name), "utf8"), path.basename(filePath)));
        found = true;
      } catch { /* indication absente ou illisible : le scanner normal continue */ }
    }
  }
  return found ? merged : null;
}

export function applyMatchHints(parsed: ParsedMedia, hints: MatchHints | null): ParsedMedia {
  if (!hints) return parsed;
  const explicit = hints.evidence.length > 0 || hints.seasonNumber != null;
  const kind = hints.episodeNumbers?.length ? "episode" : parsed.kind;
  return {
    ...parsed,
    kind,
    title: kind === "movie" ? hints.title ?? parsed.title : parsed.title,
    showTitle: kind === "episode" ? hints.title ?? parsed.showTitle : parsed.showTitle,
    year: hints.year ?? parsed.year,
    seasonNumber: hints.seasonNumber ?? parsed.seasonNumber,
    episodeNumber: hints.episodeNumbers?.[0] ?? parsed.episodeNumber,
    episodeNumbers: hints.episodeNumbers ?? parsed.episodeNumbers,
    externalIds: { ...(parsed.externalIds ?? {}), ...hints.externalIds },
    detection: explicit ? {
      confidence: 1,
      pattern: parsed.detection?.pattern ?? (kind === "episode" ? "sxe" : "movie-year"),
      warnings: [], rule: parsed.detection?.rule, decision: "auto",
      evidence: [...(parsed.detection?.evidence ?? []), ...hints.evidence],
      alternatives: parsed.detection?.alternatives,
    } : parsed.detection,
  };
}
