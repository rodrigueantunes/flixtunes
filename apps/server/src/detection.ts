import path from "node:path";
import type { MovieContentType } from "./media-parser.js";

/**
 * Détection de fichiers v2 — étape 51.
 *
 * Le nom est d'abord découpé en jetons Unicode, puis plusieurs règles typées proposent chacune un
 * candidat accompagné de son score et des indices qui l'ont produit. Le meilleur candidat l'emporte, mais
 * tous restent disponibles : c'est ce qui permet d'expliquer une détection et d'alimenter une file
 * d'ambiguïtés au lieu d'imposer un choix opaque.
 */

export type DetectionRule =
  | "identifiant" | "saison-episode" | "saison-episode-court" | "date-diffusion"
  | "numerotation-absolue" | "marqueur-episode" | "special" | "serie-repli"
  | "film-annee" | "film-dossier" | "film-partie" | "film-nom";

export type DetectionDecision = "auto" | "revue" | "rejet";

/** Au-dessus, la détection est appliquée seule ; en dessous du seuil de revue, elle est refusée. */
export const AUTO_THRESHOLD = 0.9;
export const REVIEW_THRESHOLD = 0.55;

export interface DetectionToken {
  value: string;
  kind: "mot" | "nombre" | "annee" | "groupe" | "separateur";
}

export interface DetectionCandidate {
  rule: DetectionRule;
  kind: "movie" | "episode";
  title: string;
  year: number | null;
  showTitle: string | null;
  seasonNumber: number | null;
  episodeNumbers: number[];
  airDate: string | null;
  contentType: MovieContentType;
  edition: string | null;
  /** Numéro de partie d'un film découpé en plusieurs fichiers (CD1, Part 2…). */
  part: number | null;
  externalIds: { tmdb?: string; imdb?: string; tvdb?: string };
  score: number;
  /** Indices ayant produit ce candidat, affichables tels quels dans l'administration. */
  evidence: string[];
}

export interface DetectionResult {
  best: DetectionCandidate;
  candidates: DetectionCandidate[];
  decision: DetectionDecision;
  /** Raison lisible du besoin de revue ou du rejet. */
  reason: string | null;
}

const releaseNoise = /\b(4320p|2160p|1080p|720p|480p|uhd|bluray|blu-ray|web[- .]?dl|webrip|hdtv|hdr10\+?|hdr|dovi|dv|x26[45]|h26[45]|hevc|av1|remux|multi|truefrench|vostfr|vf|vo|aac|ac3|eac3|dts(?:-hd)?|truehd|atmos|repack|proper)\b/i;
const editionPattern = /\b(director'?s cut|extended(?: edition| cut)?|theatrical(?: cut)?|ultimate(?: edition| cut)?|final cut|unrated|remastered|imax|criterion|collector'?s edition|version longue)\b/i;
const idPattern = /[\[{(](tmdb|imdb|tvdb)(?:id)?[-:= ](tt\d+|\d+)[\]})]/gi;
const partPattern = /\b(?:cd|disc|disque|part(?:ie)?|pt)[ ._-]*(\d{1,2})\b/i;
const specialPattern = /\b(?:specials?|hors[ ._-]s[ée]rie|ova|oav|bonus|making[ ._-]of)\b/i;
/**
 * Dossiers d'une série qui ne sont pas une saison mais lui appartiennent quand même.
 *
 * `Kaamelott/Bonus`, `Kaamelott/Pilote`, `My Hero Academia/Autres` : sans cette liste, leur contenu
 * ne trouvait aucune règle d'épisode et retombait sur l'interprétation « film » — soixante-trois
 * bonus et pilotes présentés comme des longs métrages dans l'accueil des films.
 */
const specialFolderPattern = /^(?:specials?|sp[ée]ciaux?|hors[ ._-]s[ée]rie|bonus|extras?|suppl[ée]ments?|pilotes?|autres|divers|making[ ._-]of|ova|oav|saison[ ._-]*0|season[ ._-]*0)$/i;
/**
 * Marqueur d'épisode employé seul, sans nom de série ni numéro de saison.
 *
 * `E001.mkv`, `EP001.mkv`, `Ep001.mkv`, `E01.mkv` : le nom ne porte que le rang de l'épisode parce que
 * le dossier porte déjà la série et la saison. Neuf cent dix fichiers de la médiathèque réelle —
 * Dragon Ball Z, Naruto, Dragon Ball, Dragon Ball Super, Dragon Ball GT, FullMetal Alchemist —
 * n'étaient reconnus par aucune règle et devenaient des films.
 *
 * Le marqueur doit commencer un mot et être suivi immédiatement de chiffres : c'est ce qui distingue
 * `E11` de `E.T.`, de `Escape` ou de `Empire of Dreams`.
 *
 * La frontière est exprimée par une anti-recherche Unicode et non par `\b` : `\b` ne connaît que
 * `[A-Za-z0-9_]`, si bien qu'il refusait « Épisode 1 » — la lettre accentuée n'étant pas un caractère
 * de mot à ses yeux, il ne voyait aucune frontière à ouvrir.
 */
const episodeMarkerPattern = /^(?:(.*?)[ ._-]*)??(?<![\p{L}\p{N}])(?:[ée]pisode|episode|[ée]p|ep|e)[ ._-]*(\d{1,4})(?:[ ._-]*(?:-[ ._-]*)?(?:ep|e)[ ._-]*(\d{1,4}))?(?:[ ._-]*(.*))?$/iu;
/** Marqueurs de nature du contenu : ils servent au classement, donc ils ne font pas partie du titre. */
const contentTypePattern = /\b(?:documentar(?:y|ies)|documentaires?|docu|concerts?|live[ ._-]+(?:at|in)[ ._-]+\S+|unplugged|en[ ._-]concert|short[ ._-]*film|courts?[ ._-]*m[ée]trages?)\b/gi;

/**
 * Année de sortie plausible. Un nombre à quatre chiffres situé dans le futur appartient au titre,
 * comme dans « Blade Runner 2049 », et ne doit jamais être pris pour une année de sortie.
 */
export function isPlausibleYear(value: number): boolean {
  return value >= 1900 && value <= new Date().getFullYear() + 2;
}

/** Retire une année entre parenthèses en fin de titre. */
function stripYearGroup(value: string): string {
  return value.replace(/[\s._-]*[[(](?:19|20)\d{2}[\])]\s*$/, "");
}

/**
 * Découpage Unicode : les accents et alphabets non latins sont conservés tels quels.
 *
 * Les crochets ouvrants sont exclus de la classe des séparateurs, sans quoi un séparateur glouton
 * absorberait la parenthèse ouvrante et l'année d'un « Film (2021) » ne serait plus reconnue comme un
 * groupe. La dernière alternative rattrape tout caractère isolé pour que le découpage reste sans perte.
 */
export function tokenize(name: string): DetectionToken[] {
  const tokens: DetectionToken[] = [];
  const pattern = /[[({][^\])}]*[\])}]|[\p{L}\p{M}\p{N}'’]+|[^\p{L}\p{M}\p{N}'’[({]+|[\s\S]/gu;
  for (const match of name.match(pattern) ?? []) {
    if (/^[[({].*[\])}]$/s.test(match)) { tokens.push({ value: match, kind: "groupe" }); continue; }
    if (/^(?:19|20)\d{2}$/.test(match)) { tokens.push({ value: match, kind: "annee" }); continue; }
    if (/^\d+$/.test(match)) { tokens.push({ value: match, kind: "nombre" }); continue; }
    if (/^[\p{L}\p{M}\p{N}'’]+$/u.test(match)) { tokens.push({ value: match, kind: "mot" }); continue; }
    tokens.push({ value: match, kind: "separateur" });
  }
  return tokens;
}

function normalizeText(value: string): string {
  return value.replace(/[._]+/g, " ").replace(/\s{2,}/g, " ").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
}

/** Retire le bruit de release sans amputer un titre qui contiendrait un de ces mots au début. */
export function cleanTitle(value: string): string {
  const tokens = tokenize(value);
  const kept: string[] = [];
  for (const token of tokens) {
    // Aucun groupe entre crochets ou parenthèses n'appartient au titre : année, identifiant, équipe,
    // langue et source sont tous extraits par des règles dédiées avant ce nettoyage.
    if (token.kind === "groupe") continue;
    if (token.kind === "mot" && releaseNoise.test(token.value) && kept.some((entry) => /\p{L}/u.test(entry))) break;
    kept.push(token.value);
  }
  // Les séparateurs sont normalisés avant les motifs : `_` est un caractère de mot, donc `\b` ne
  // reconnaîtrait ni « _Documentaire » ni « _Live_at_ » sur un nom séparé par des tirets bas.
  const normalized = normalizeText(kept.join(""));
  const retirerMentions = (texte: string) => normalizeText(texte
    .replace(partPattern, "").replace(contentTypePattern, "")
    // Suffixe d'équipe de publication, « … -GROUPE ». L'espace avant le tiret est exigé afin de ne jamais
    // amputer un titre réellement composé, du type « Spider-Man » ou « X-MEN ».
    .replace(/\s+[-–]\s*[\p{Lu}\p{N}]{2,}$/u, ""));

  // La mention d'édition n'est retirée que s'il reste un titre derrière.
  //
  // « Final Cut » est à la fois un marqueur d'édition et le titre d'un film de 2004. Le retirer sans
  // condition ne laissait rien, et la fiche s'appelait « Média inconnu » — relevé sur la médiathèque
  // réelle, où le film restait sans correspondance. Le même piège guette « Unrated », « Remastered »
  // ou « Extended » : quand le marqueur *est* tout le titre, c'est qu'il n'en est pas un.
  const sansÉdition = retirerMentions(normalized.replace(editionPattern, ""));
  return sansÉdition || retirerMentions(normalized);
}

function externalIds(value: string): DetectionCandidate["externalIds"] {
  const ids: DetectionCandidate["externalIds"] = {};
  for (const match of value.matchAll(new RegExp(idPattern.source, "gi"))) {
    const provider = match[1]?.toLowerCase() as keyof DetectionCandidate["externalIds"];
    if (provider && match[2]) ids[provider] = match[2];
  }
  return ids;
}

export function detectContentType(value: string): MovieContentType {
  if (/\b(documentar(?:y|ies)|documentaires?|docu)\b/i.test(value)) return "documentary";
  if (/\b(concerts?|live[ ._-]+at|live[ ._-]+in|unplugged|en[ ._-]concert)\b/i.test(value)) return "concert";
  if (/\b(short[ ._-]*film|court[ ._-]*m[ée]trage)\b/i.test(value)) return "short";
  return "movie";
}

interface FolderContext {
  showTitle: string | null;
  year: number | null;
  season: number | null;
  isSpecials: boolean;
  looksLikeShow: boolean;
  /**
   * Chemin du dossier racine de la série, dossier de saison exclu.
   *
   * C'est l'identité stable d'une série : elle ne dépend ni du fournisseur qui a répondu, ni de la
   * traduction du titre. Deux séries homonymes rangées dans deux dossiers restent deux séries —
   * `Dr Who` et `Dr Who (2023)` lisent le même titre et doivent pourtant rester distinctes.
   */
  showFolderPath: string | null;
}

/** Contexte tiré de l'arborescence : c'est lui qui autorise, ou non, une numérotation sans préfixe. */
export function folderContext(filePath: string): FolderContext {
  const parts = path.dirname(filePath).split(/[\\/]+/).filter(Boolean);
  const parent = parts.at(-1) ?? "";
  const seasonMatch = parent.match(/^(?:season|saison|series|s)[ ._-]*(\d{1,2})$/i);
  const isSpecials = specialFolderPattern.test(parent.trim());
  const showFolder = (seasonMatch || isSpecials ? parts.at(-2) : parent) ?? "";
  const identity = showFolder.match(/^(.*?)[\s._-]*[[(]((?:19|20)\d{2})[\])]\s*$/);
  // Le dossier de saison est retiré du chemin, jamais le dossier de la série elle-même. Le séparateur
  // est normalisé en barre oblique afin qu'un même dossier ne produise pas deux clés selon que le
  // chemin vienne d'un partage Windows ou du NAS.
  const showFolderParts = seasonMatch || isSpecials ? parts.slice(0, -1) : parts;
  return {
    showTitle: cleanTitle(identity?.[1] ?? showFolder) || null,
    year: identity?.[2] ? Number(identity[2]) : null,
    season: isSpecials ? 0 : seasonMatch ? Number(seasonMatch[1]) : null,
    isSpecials,
    looksLikeShow: Boolean(seasonMatch || isSpecials),
    showFolderPath: showFolderParts.length ? showFolderParts.join("/") : null,
  };
}

function candidate(base: Partial<DetectionCandidate> & Pick<DetectionCandidate, "rule" | "kind" | "score">): DetectionCandidate {
  return {
    title: "", year: null, showTitle: null, seasonNumber: null, episodeNumbers: [], airDate: null,
    contentType: "movie", edition: null, part: null, externalIds: {}, evidence: [], ...base,
  };
}

function episodeRange(first: number, last: number | null): number[] {
  if (last == null || last < first || last - first > 20) return [first];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/**
 * Produit tous les candidats plausibles pour un chemin.
 * Aucune règle n'est exclusive : c'est le score qui départage, et l'écart entre les deux meilleurs
 * candidats détermine si une revue humaine est nécessaire.
 */
export function generateCandidates(filePath: string, libraryKind: "movie" | "tv" | "other" = "other"): DetectionCandidate[] {
  const base = path.basename(filePath, path.extname(filePath));
  const folder = folderContext(filePath);
  const ids = externalIds(`${filePath} ${base}`);
  const edition = base.match(editionPattern)?.[1] ?? null;
  const part = base.match(partPattern)?.[1] ?? null;
  const contentType = detectContentType(`${filePath} ${base}`);
  const shared = {
    contentType, edition: edition ? normalizeText(edition) : null,
    part: part ? Number(part) : null, externalIds: ids,
  };
  const candidates: DetectionCandidate[] = [];
  const allowEpisodes = libraryKind !== "movie";

  // Plex recommande un dossier par film parce que ce dossier constitue une seconde lecture fiable
  // de l'identité. FlixTunes ne l'exploitait pas : `BAC Nord (2021)/video.mkv` devenait « video ».
  // Le dossier ne prend la main que s'il porte une année explicite ; un simple dossier `Films` ou
  // `Downloads` ne doit évidemment jamais devenir le titre de tout ce qu'il contient.
  if (libraryKind !== "tv") {
    const movieFolder = path.basename(path.dirname(filePath));
    const folderIdentity = movieFolder.match(/^(.*?)[\s._-]*[[(]((?:19|20)\d{2})[\])]/);
    if (folderIdentity && isPlausibleYear(Number(folderIdentity[2]))) {
      candidates.push(candidate({
        rule: "film-dossier", kind: "movie", ...shared,
        title: cleanTitle(folderIdentity[1] ?? ""), year: Number(folderIdentity[2]),
        score: 0.95, evidence: [`Identité lue dans le dossier du film : ${movieFolder}`],
      }));
    }
  }

  if (allowEpisodes) {
    // SxxExx, avec double épisode SxxExxExx ou SxxExx-Exx.
    // Les séparateurs sont acceptés en nombre quelconque et la partie finale peut être collée au code,
    // comme dans « S08E04E05[VOSTFR] » produit par les outils de partage.
    // Le nom de série qui précède le code est facultatif : un fichier nommé « S02E03 - Titre.mkv »
    // — courant lorsque le dossier parent porte déjà le nom de la série — n'était pas reconnu et
    // retombait sur l'interprétation « film », donc sans saison ni numéro d'épisode.
    const sxe = base.match(/^(?:(.*?)[. _-]+)?s(\d{1,2})[. _-]*e(\d{1,3})(?:[. _-]*(?:e|-[. _-]*e?)(\d{1,3}))?(?:[. _-]*(.*))?$/i);
    if (sxe) {
      const first = Number(sxe[3]);
      const numbers = episodeRange(first, sxe[4] ? Number(sxe[4]) : null);
      const fromName = cleanTitle(sxe[1] ?? "");
      candidates.push(candidate({
        rule: "saison-episode", kind: "episode", ...shared,
        title: cleanTitle(sxe[5] ?? "") || (numbers.length > 1 ? `Épisodes ${numbers[0]}-${numbers.at(-1)}` : `Épisode ${first}`),
        showTitle: fromName || folder.showTitle, year: folder.year,
        seasonNumber: Number(sxe[2]), episodeNumbers: numbers,
        score: 0.98, evidence: [`Motif SxxExx explicite : S${sxe[2]}E${sxe[3]}`,
          ...(numbers.length > 1 ? [`Double épisode ${numbers[0]}–${numbers.at(-1)}`] : []),
          ...(fromName ? [`Série lue depuis le nom de fichier : ${fromName}`] : ["Série lue depuis le dossier parent"])],
      }));
    }

    // Forme courte 1x02, plus ambiguë car un nombre isolé peut ressembler à une résolution.
    const short = base.match(/^(?:(.*?)[. _-]+)?(\d{1,2})x(\d{1,3})(?:[. _-]*-[. _-]*(\d{1,3}))?(?:[. _-]*(.*))?$/i);
    if (short) {
      const first = Number(short[3]);
      const numbers = episodeRange(first, short[4] ? Number(short[4]) : null);
      const fromName = cleanTitle(short[1] ?? "");
      candidates.push(candidate({
        rule: "saison-episode-court", kind: "episode", ...shared,
        title: cleanTitle(short[5] ?? "") || `Épisode ${first}`,
        showTitle: fromName || folder.showTitle, year: folder.year,
        seasonNumber: Number(short[2]), episodeNumbers: numbers,
        score: 0.93, evidence: [`Motif ${short[2]}x${short[3]} reconnu`],
      }));
    }

    // Épisode daté : les émissions quotidiennes n'ont pas de numérotation.
    const dated = base.match(/^(.*?)[. _-]+((?:19|20)\d{2})[. _-]+(\d{2})[. _-]+(\d{2})(?:[. _-]*(.*))?$/);
    if (dated) {
      const airDate = `${dated[2]}-${dated[3]}-${dated[4]}`;
      const month = Number(dated[3]); const day = Number(dated[4]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        candidates.push(candidate({
          rule: "date-diffusion", kind: "episode", ...shared,
          title: cleanTitle(dated[5] ?? "") || airDate,
          showTitle: cleanTitle(dated[1] ?? "") || folder.showTitle, year: Number(dated[2]),
          seasonNumber: Number(dated[2]), episodeNumbers: [Number(`${dated[3]}${dated[4]}`)], airDate,
          score: 0.95, evidence: [`Date de diffusion ${airDate}`],
        }));
      }
    }

    // Spécial : hors numérotation de saison, rangé en saison 0.
    if (folder.isSpecials || specialPattern.test(base)) {
      const number = base.match(/\b(?:ova|oav|special)[ ._-]*(\d{1,3})\b/i)?.[1];
      candidates.push(candidate({
        rule: "special", kind: "episode", ...shared,
        title: cleanTitle(base) || "Spécial", showTitle: folder.showTitle, year: folder.year,
        seasonNumber: 0, episodeNumbers: number ? [Number(number)] : [],
        score: folder.isSpecials ? 0.9 : 0.72,
        evidence: [folder.isSpecials ? "Dossier de spéciaux" : "Mot-clé de spécial dans le nom",
          "Rangé en saison 0 sans écraser la numérotation normale"],
      }));
    }

    // Marqueur d'épisode seul : « E001 », « EP12 », « Épisode 7 », éventuellement précédé du nom de
    // la série. Il n'est proposé que si aucune forme saison+épisode n'a été reconnue — sans quoi il
    // rejouerait `S01E03` sous un autre nom et créerait une fausse concurrence entre deux lectures
    // pourtant identiques.
    const marker = sxe || short ? null : base.match(episodeMarkerPattern);
    if (marker) {
      const first = Number(marker[2]);
      const numbers = episodeRange(first, marker[3] ? Number(marker[3]) : null);
      const fromName = cleanTitle(marker[1] ?? "");
      // Un fichier posé directement dans le dossier de la série, sans dossier de saison, appartient à
      // la première saison : c'est la convention de Plex et de Jellyfin, et `FullMetal Alchemist/E01`
      // n'a pas d'autre lecture raisonnable. Un dossier de spéciaux garde évidemment sa saison 0.
      const season = folder.season ?? (folder.isSpecials ? 0 : 1);
      // Ce qui suit le numéro est le titre de l'épisode — sauf quand ce n'est qu'un suffixe d'équipe
      // de publication, « E001-GROUPE », qui ne nomme rien.
      // Un jeton unique tout en capitales — « GROUPE », « VF », « QTZ » — est une signature d'équipe
      // ou une balise de langue, jamais le nom d'un épisode. Un nombre seul, lui, est conservé : il
      // peut réellement titrer un épisode.
      const cleaned = cleanTitle(marker[4] ?? "");
      const episodeName = /^(?=.*\p{Lu})[\p{Lu}\p{N}]{2,}$/u.test(cleaned) ? "" : cleaned;
      if (Number.isFinite(first) && first > 0) {
        candidates.push(candidate({
          rule: "marqueur-episode", kind: "episode", ...shared,
          title: episodeName
            || (numbers.length > 1 ? `Épisodes ${numbers[0]}-${numbers.at(-1)}` : `Épisode ${first}`),
          showTitle: fromName || folder.showTitle, year: folder.year,
          seasonNumber: season, episodeNumbers: numbers,
          score: folder.looksLikeShow ? 0.96 : libraryKind === "tv" ? 0.92 : 0.7,
          evidence: [`Marqueur d'épisode reconnu : ${marker[0].trim()}`,
            ...(numbers.length > 1 ? [`Double épisode ${numbers[0]}–${numbers.at(-1)}`] : []),
            folder.looksLikeShow ? `Saison ${season} lue depuis le dossier parent`
              : folder.isSpecials ? "Dossier de spéciaux, rangé en saison 0"
                : `Aucun dossier de saison : rangé en saison ${season}, comme le font Plex et Jellyfin`,
            ...(fromName ? [`Série lue depuis le nom de fichier : ${fromName}`] : ["Série lue depuis le dossier"])],
        }));
      }
    }

    // Numérotation absolue : uniquement quand l'arborescence désigne déjà une série.
    // Un nombre isolé ne suffit jamais à décider seul, conformément au plan.
    const absolute = base.match(/^(.*?)[ ._-]+-[ ._-]+(\d{1,4})(?:[ ._-]*(.*))?$/)
      ?? base.match(/^(\d{1,4})[ ._-]+(.*)$/);
    if (absolute && (libraryKind === "tv" || folder.looksLikeShow)) {
      const number = Number(absolute[2] && /^\d+$/.test(absolute[2]) ? absolute[2] : absolute[1]);
      const showFromName = cleanTitle(absolute[1] && !/^\d+$/.test(absolute[1]) ? absolute[1] : "");
      if (Number.isFinite(number) && number > 0 && number < 2000) {
        candidates.push(candidate({
          rule: "numerotation-absolue", kind: "episode", ...shared,
          title: cleanTitle(absolute[3] ?? absolute[2] ?? "") || `Épisode ${number}`,
          showTitle: showFromName || folder.showTitle, year: folder.year,
          seasonNumber: folder.season, episodeNumbers: [number],
          score: folder.looksLikeShow ? 0.8 : 0.68,
          evidence: [`Numérotation absolue ${number}`,
            folder.looksLikeShow ? "Arborescence de série confirmée" : "Bibliothèque déclarée série"],
        }));
      }
    }
  }

  // Film avec année entre parenthèses : la forme la plus fiable, donc la mieux notée.
  const parenthesised = base.match(/^(.*?)[\s._-]*[[(]((?:19|20)\d{2})[\])]/);
  if (parenthesised) {
    candidates.push(candidate({
      rule: "film-annee", kind: "movie", ...shared,
      title: cleanTitle(parenthesised[1] ?? ""), year: Number(parenthesised[2]),
      score: 0.96, evidence: [`Année entre parenthèses : ${parenthesised[2]}`],
    }));
  } else {
    const bare = base.match(/(?:^|[. _-])((?:19|20)\d{2})(?:[. _-]|$)/);
    if (bare && isPlausibleYear(Number(bare[1]))) {
      candidates.push(candidate({
        rule: "film-annee", kind: "movie", ...shared,
        title: cleanTitle(base.slice(0, bare.index)), year: Number(bare[1]),
        score: 0.86, evidence: [`Année détectée sans parenthèses : ${bare[1]}`,
          "Une année nue est moins fiable qu'une année entre parenthèses"],
      }));
    }
  }

  if (part) {
    candidates.push(candidate({
      rule: "film-partie", kind: "movie", ...shared,
      title: cleanTitle(base.replace(partPattern, "")),
      year: base.match(/[[(]((?:19|20)\d{2})[\])]/)?.[1] ? Number(base.match(/[[(]((?:19|20)\d{2})[\])]/)![1]) : null,
      score: 0.88, evidence: [`Film en plusieurs parties : partie ${part}`,
        "Les parties sont regroupées sans déplacer les fichiers"],
    }));
  }

  if (Object.keys(ids).length) {
    const provider = Object.keys(ids)[0]!;
    const groupedYear = base.match(/[[(]((?:19|20)\d{2})[\])]/)?.[1];
    candidates.push(candidate({
      // Dans une bibliothèque déclarée série, un identifiant désigne forcément une série : sans cela,
      // un fichier étiqueté au milieu d'une saison redevenait un film et sortait du catalogue.
      rule: "identifiant", kind: allowEpisodes && (folder.looksLikeShow || libraryKind === "tv") ? "episode" : "movie", ...shared,
      title: stripYearGroup(cleanTitle(base)),
      showTitle: folder.looksLikeShow || libraryKind === "tv" ? folder.showTitle : null,
      year: groupedYear ? Number(groupedYear) : folder.year,
      seasonNumber: folder.looksLikeShow ? folder.season : libraryKind === "tv" && folder.isSpecials ? 0 : null,
      score: 0.99, evidence: [`Identifiant ${provider} présent dans le nom : ${ids[provider as keyof typeof ids]}`],
    }));
  }

  // Repli : un titre sans aucun indice reste proposé, mais avec un score qui impose une revue.
  candidates.push(candidate({
    rule: "film-nom", kind: "movie", ...shared,
    title: cleanTitle(base) || normalizeText(base) || "Média inconnu", year: null,
    score: 0.45, evidence: ["Aucune année, aucun identifiant et aucun motif d'épisode reconnu"],
  }));

  /**
   * Dans une bibliothèque déclarée série, aucun fichier ne devient un film.
   *
   * L'ancien analyseur portait ce filet : sous `libraryKind === "tv"`, un nom non reconnu restait un
   * épisode du dossier. Le moteur à candidats l'avait perdu, et une bibliothèque de séries produisait
   * des films — 973 fichiers sur la médiathèque réelle, dont six séries entières, affichés dans
   * l'accueil des films.
   *
   * La personne a rangé ce dossier dans « Séries TV » : c'est une déclaration, pas une supposition, et
   * elle vaut mieux que l'incapacité d'une expression régulière à lire un nom de fichier.
   */
  if (libraryKind === "tv") {
    if (!candidates.some((entry) => entry.kind === "episode")) {
      candidates.push(candidate({
        rule: "serie-repli", kind: "episode", ...shared,
        title: cleanTitle(base) || normalizeText(base) || "Épisode inconnu",
        showTitle: folder.showTitle, year: folder.year,
        seasonNumber: folder.isSpecials ? 0 : folder.season, episodeNumbers: [],
        score: folder.showTitle ? 0.6 : 0.45,
        evidence: ["Aucun motif d'épisode reconnu dans le nom",
          folder.showTitle ? `Rattaché à la série du dossier : ${folder.showTitle}`
            : "Aucune série lisible dans l'arborescence",
          "Bibliothèque déclarée série : le fichier ne peut pas être un film"],
      }));
    }
    // Les lectures « film » ne sont pas supprimées mais rétrogradées : elles restent lisibles dans
    // l'explication de la détection et dans la file d'ambiguïtés, sans pouvoir l'emporter. Les
    // effacer aurait privé l'administration des interprétations concurrentes.
    return candidates
      .map((entry) => entry.kind === "movie"
        ? { ...entry, score: Math.min(entry.score, 0.3),
          evidence: [...entry.evidence, "Lecture « film » écartée : la bibliothèque est déclarée série"] }
        : entry)
      .sort((left, right) => right.score - left.score);
  }

  return candidates.sort((left, right) => right.score - left.score);
}

export function detectMedia(filePath: string, libraryKind: "movie" | "tv" | "other" = "other"): DetectionResult {
  const candidates = generateCandidates(filePath, libraryKind);
  const best = candidates[0]!;
  const identity = (entry: DetectionCandidate) => entry.title.normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const sameInterpretation = (left: DetectionCandidate, right: DetectionCandidate) => left.kind === right.kind
    && identity(left) === identity(right)
    && (left.year == null || right.year == null || left.year === right.year);
  const runnerUp = candidates.find((entry) => entry !== best && !sameInterpretation(best, entry)) ?? null;
  // Deux lectures réellement différentes au coude à coude sont ambiguës, même si toutes deux sont
  // des films. C'est notamment le conflit fichier/dossier que Plex tranche parfois silencieusement.
  const ambiguous = Boolean(runnerUp && best.score - runnerUp.score < 0.08);
  let decision: DetectionDecision = "rejet";
  let reason: string | null = null;
  if (best.score < REVIEW_THRESHOLD) {
    reason = "Aucun indice suffisant pour rattacher ce fichier à un titre.";
  } else if (ambiguous) {
    decision = "revue";
    reason = `Deux interprétations proches : ${best.rule} et ${runnerUp!.rule}.`;
  } else if (best.score < AUTO_THRESHOLD) {
    decision = "revue";
    reason = `Confiance insuffisante pour valider seul (${Math.round(best.score * 100)} %).`;
  } else {
    decision = "auto";
  }
  return { best, candidates, decision, reason };
}
