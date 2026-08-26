import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedMedia } from "./media-parser.js";

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function value(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : null;
}

export function parseNfo(xml: string): Partial<ParsedMedia> {
  const root = xml.match(/<\s*(movie|tvshow|episodedetails|season)\b/i)?.[1]?.toLowerCase();
  const uniqueIds = [...xml.matchAll(/<uniqueid[^>]*type=["'](tmdb|imdb|tvdb)["'][^>]*>([^<]+)<\/uniqueid>/gi)];
  const externalIds: NonNullable<ParsedMedia["externalIds"]> = {};
  for (const match of uniqueIds) externalIds[match[1]!.toLowerCase() as keyof typeof externalIds] = match[2]!.trim();
  const imdb = value(xml, "imdbid"); if (imdb) externalIds.imdb = imdb;
  const tmdb = value(xml, "tmdbid"); if (tmdb) externalIds.tmdb = tmdb;
  const tvdb = value(xml, "tvdbid"); if (tvdb) externalIds.tvdb = tvdb;
  const episodeNumber = Number(value(xml, "episode"));
  const title = value(xml, "title");
  const premiered = value(xml, "premiered") ?? value(xml, "aired");
  const year = Number(value(xml, "year") ?? premiered?.slice(0, 4));
  return {
    // `<title>` désigne la série dans tvshow.nfo, pas l'épisode. L'ancien lecteur remplaçait le titre
    // de chaque épisode par celui de la série dès qu'il rencontrait ce fichier.
    title: root === "tvshow" || root === "season" ? undefined : title ?? undefined,
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    showTitle: value(xml, "showtitle") ?? (root === "tvshow" ? title : null) ?? undefined,
    seasonNumber: Number(value(xml, "season")) || (value(xml, "season") === "0" ? 0 : undefined),
    episodeNumber: Number.isFinite(episodeNumber) && episodeNumber >= 0 ? episodeNumber : undefined,
    episodeNumbers: Number.isFinite(episodeNumber) && episodeNumber >= 0 ? [episodeNumber] : undefined,
    overview: value(xml, "plot") ?? value(xml, "outline") ?? undefined,
    edition: value(xml, "edition") ?? undefined,
    externalIds,
  };
}

function mergeNfo(base: Partial<ParsedMedia>, override: Partial<ParsedMedia>): Partial<ParsedMedia> {
  const defined = Object.fromEntries(Object.entries(override)
    .filter(([key, entry]) => key !== "externalIds" && entry !== undefined)) as Partial<ParsedMedia>;
  return {
    ...base,
    ...defined,
    externalIds: { ...(base.externalIds ?? {}), ...(override.externalIds ?? {}) },
  };
}

export async function readSidecarNfo(filePath: string, kind: ParsedMedia["kind"] = "movie"): Promise<Partial<ParsedMedia> | null> {
  const directory = path.dirname(filePath);
  const parentName = path.basename(directory);
  const seasonDirectory = /^(?:season|saison|series|s)[ ._-]*\d{1,3}$/i.test(parentName)
    || /^(?:specials?|hors[ ._-]s[ée]rie)$/i.test(parentName);
  const showDirectory = seasonDirectory ? path.dirname(directory) : directory;
  // Du général au spécifique : l'épisode peut compléter ou corriger la série, jamais l'inverse.
  const candidates = kind === "episode" ? [
    path.join(showDirectory, "tvshow.nfo"),
    path.join(directory, "season.nfo"),
    path.join(directory, `${path.basename(filePath, path.extname(filePath))}.nfo`),
  ] : [
    path.join(directory, "movie.nfo"),
    path.join(directory, `${path.basename(filePath, path.extname(filePath))}.nfo`),
  ];
  let merged: Partial<ParsedMedia> = {};
  let found = false;
  for (const candidate of candidates) {
    try { merged = mergeNfo(merged, parseNfo(await readFile(candidate, "utf8"))); found = true; } catch { /* fichier suivant */ }
  }
  return found ? merged : null;
}
