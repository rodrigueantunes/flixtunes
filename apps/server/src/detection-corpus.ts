import { detectMedia, type DetectionRule } from "./detection.js";

/**
 * Corpus de noms de fichiers pour mesurer la détection — étape 51.
 *
 * Tous les titres sont inventés ou génériques : aucun nom réel de la médiathèque d'un utilisateur n'y
 * figure. Le tirage est déterministe, si bien que deux exécutions produisent exactement le même corpus et
 * qu'un échec est reproductible à l'identique.
 */

export type NameCategory =
  | "film-annee" | "film-sans-annee" | "film-identifiant" | "film-edition" | "film-multi-parties"
  | "documentaire" | "concert" | "court-metrage"
  | "serie-sxe" | "serie-court" | "serie-datee" | "serie-double" | "anime-absolu" | "special";

export interface NameSample {
  path: string;
  libraryKind: "movie" | "tv";
  category: NameCategory;
  expectedRule: DetectionRule;
  truth: {
    kind: "movie" | "episode";
    title?: string;
    year?: number | null;
    showTitle?: string;
    seasonNumber?: number | null;
    episodeNumbers?: number[];
  };
}

/** Générateur déterministe : le corpus doit être identique d'une exécution à l'autre. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const plainMovieTitles = [
  "Voyage Azur", "Amélie", "L'Élève", "Le Dernier Rivage", "Nuit Blanche", "Ciel de Fer",
  "千と千尋", "Übermorgen", "Coração Valente", "Ana y el Mar", "Les Trois Rivières",
];
/**
 * Titres contenant un nombre à quatre chiffres, piège classique du détecteur d'année.
 * Ils ne servent qu'aux catégories portant une année explicite : sans année dans le nom, « Station 1999 »
 * est indécidable pour un humain comme pour la machine, et le corpus n'a pas à trancher à sa place.
 */
const numericMovieTitles = ["Blade Runner 2049", "Station 1999", "Projet 2077"];
const movieTitles = [...plainMovieTitles, ...numericMovieTitles];
const showTitles = [
  "Severance", "Les Veilleurs", "Kaamelott", "Dark Matter", "L'Écho des Cimes",
  "Nordlys", "La Casa del Río", "One Piece", "Astro Fighter",
];
const episodeTitles = ["Le Signal", "Point de Rupture", "Récidive", "Cold Open", "L'Aube", "Fracture", "Éclipse"];
const noise = [
  "1080p.BluRay.x264", "2160p.WEB-DL.HDR.HEVC", "720p.HDTV.x264", "1080p.MULTi.VFF.AC3",
  "2160p.UHD.BluRay.REMUX.DTS-HD.MA", "1080p.WEBRip.AAC5.1", "",
];
const editions = ["Director's Cut", "Extended Edition", "Remastered", "IMAX", "Unrated", "Version Longue"];
const separators = [".", " ", "_"];

function pick<T>(random: () => number, values: T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function join(value: string, separator: string): string {
  return value.replace(/ /g, separator);
}

function withNoise(random: () => number, stem: string, separator: string): string {
  const suffix = pick(random, noise);
  return suffix ? `${stem}${separator}${join(suffix, separator)}` : stem;
}

/**
 * Produit un corpus équilibré entre les catégories décrites par le dossier de l'étape.
 * Chaque échantillon porte sa vérité terrain, ce qui rend la mesure vérifiable sans annotation manuelle.
 */
export function generateNameCorpus(count = 10_000, seed = 20260814): NameSample[] {
  const random = mulberry32(seed);
  const samples: NameSample[] = [];
  const categories: NameCategory[] = [
    "film-annee", "film-annee", "film-annee", "film-sans-annee", "film-identifiant", "film-edition",
    "film-multi-parties", "documentaire", "concert", "court-metrage",
    "serie-sxe", "serie-sxe", "serie-sxe", "serie-court", "serie-datee", "serie-double",
    "anime-absolu", "special",
  ];

  while (samples.length < count) {
    const category = categories[samples.length % categories.length]!;
    const separator = pick(random, separators);
    const year = 1960 + Math.floor(random() * 66);

    if (category.startsWith("film") || ["documentaire", "concert", "court-metrage"].includes(category)) {
      const title = pick(random, category === "film-sans-annee" ? plainMovieTitles : movieTitles);
      const stem = join(title, separator);
      const folder = `D:/Films/${title}${category === "film-sans-annee" ? "" : ` (${year})`}`;
      if (category === "film-annee" || category === "documentaire" || category === "concert" || category === "court-metrage") {
        const marker = category === "documentaire" ? `${separator}Documentaire`
          : category === "concert" ? `${separator}Live${separator}at${separator}Wembley`
            : category === "court-metrage" ? `${separator}Court-metrage` : "";
        samples.push({
          path: `${folder}/${withNoise(random, `${stem}${marker}${separator}(${year})`, separator)}.mkv`,
          libraryKind: "movie", category, expectedRule: "film-annee",
          truth: { kind: "movie", title, year },
        });
      } else if (category === "film-sans-annee") {
        samples.push({
          path: `${folder}/${withNoise(random, stem, separator)}.mkv`,
          libraryKind: "movie", category, expectedRule: "film-nom",
          truth: { kind: "movie", title },
        });
      } else if (category === "film-identifiant") {
        const identifier = 10_000 + Math.floor(random() * 900_000);
        samples.push({
          path: `${folder}/${stem}${separator}(${year})${separator}[tmdb-${identifier}].mkv`,
          libraryKind: "movie", category, expectedRule: "identifiant",
          truth: { kind: "movie", title, year },
        });
      } else if (category === "film-edition") {
        samples.push({
          path: `${folder}/${withNoise(random, `${stem}${separator}(${year})${separator}${join(pick(random, editions), separator)}`, separator)}.mkv`,
          libraryKind: "movie", category, expectedRule: "film-annee",
          truth: { kind: "movie", title, year },
        });
      } else {
        const part = 1 + Math.floor(random() * 2);
        samples.push({
          path: `${folder}/${stem}${separator}(${year})${separator}CD${part}.mkv`,
          libraryKind: "movie", category, expectedRule: "film-annee",
          truth: { kind: "movie", title, year },
        });
      }
      continue;
    }

    const show = pick(random, showTitles);
    const season = 1 + Math.floor(random() * 9);
    const episode = 1 + Math.floor(random() * 24);
    const episodeTitle = pick(random, episodeTitles);
    const showFolder = `D:/TV/${show} (${year})`;

    if (category === "serie-sxe") {
      const stem = `${join(show, separator)}${separator}S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}${separator}${join(episodeTitle, separator)}`;
      samples.push({
        path: `${showFolder}/Season ${String(season).padStart(2, "0")}/${withNoise(random, stem, separator)}.mkv`,
        libraryKind: "tv", category, expectedRule: "saison-episode",
        truth: { kind: "episode", showTitle: show, seasonNumber: season, episodeNumbers: [episode] },
      });
    } else if (category === "serie-court") {
      samples.push({
        path: `${showFolder}/Season ${String(season).padStart(2, "0")}/${join(show, separator)}${separator}${season}x${String(episode).padStart(2, "0")}${separator}${join(episodeTitle, separator)}.mkv`,
        libraryKind: "tv", category, expectedRule: "saison-episode-court",
        truth: { kind: "episode", showTitle: show, seasonNumber: season, episodeNumbers: [episode] },
      });
    } else if (category === "serie-datee") {
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const stamp = `${year}${separator}${String(month).padStart(2, "0")}${separator}${String(day).padStart(2, "0")}`;
      samples.push({
        path: `${showFolder}/${join(show, separator)}${separator}${stamp}${separator}${join(episodeTitle, separator)}.mkv`,
        libraryKind: "tv", category, expectedRule: "date-diffusion",
        truth: { kind: "episode", showTitle: show },
      });
    } else if (category === "serie-double") {
      const second = episode + 1;
      samples.push({
        path: `${showFolder}/Season ${String(season).padStart(2, "0")}/${join(show, separator)}${separator}S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}E${String(second).padStart(2, "0")}.mkv`,
        libraryKind: "tv", category, expectedRule: "saison-episode",
        truth: { kind: "episode", showTitle: show, seasonNumber: season, episodeNumbers: [episode, second] },
      });
    } else if (category === "anime-absolu") {
      const absolute = 1 + Math.floor(random() * 1100);
      samples.push({
        path: `${showFolder}/Season ${String(season).padStart(2, "0")}/${show} - ${absolute}.mkv`,
        libraryKind: "tv", category, expectedRule: "numerotation-absolue",
        truth: { kind: "episode", showTitle: show, episodeNumbers: [absolute] },
      });
    } else {
      samples.push({
        path: `${showFolder}/Specials/${join(show, separator)}${separator}${join(episodeTitle, separator)}.mkv`,
        libraryKind: "tv", category, expectedRule: "special",
        truth: { kind: "episode", showTitle: show, seasonNumber: 0 },
      });
    }
  }
  return samples;
}

/**
 * Mutations qui n'altèrent pas la vérité terrain.
 *
 * Un corpus produit par gabarits est plus régulier que la réalité : ces déformations reproduisent ce
 * qu'ajoutent réellement les outils de partage — suffixe d'équipe, balises entre crochets, séparateurs
 * doublés, préfixe de groupe — sans changer ce que le fichier désigne. Le changement de casse est
 * volontairement exclu : il modifierait le titre attendu, donc la vérité elle-même.
 */
export const mutations = [
  { name: "suffixe-equipe", apply: (name: string) => `${name}-GROUPE` },
  { name: "balise-langue", apply: (name: string) => `${name}[VOSTFR]` },
  { name: "prefixe-equipe", apply: (name: string) => `[Team] ${name}` },
  { name: "separateurs-doubles", apply: (name: string) => name.replace(/([._ ])/g, "$1$1") },
  { name: "balise-source", apply: (name: string) => `${name}.[WEB]` },
] as const;

export function mutateSample(sample: NameSample, mutation: (typeof mutations)[number]): NameSample {
  const directory = sample.path.slice(0, sample.path.lastIndexOf("/"));
  const file = sample.path.slice(sample.path.lastIndexOf("/") + 1);
  const extension = file.slice(file.lastIndexOf("."));
  const stem = file.slice(0, file.lastIndexOf("."));
  return { ...sample, path: `${directory}/${mutation.apply(stem)}${extension}` };
}

export interface CategoryMetrics {
  category: NameCategory;
  total: number;
  correct: number;
  auto: number;
  revue: number;
  rejet: number;
  recall: number;
}

export interface RuleMetrics { rule: DetectionRule; predicted: number; correct: number; precision: number }

export interface CorpusEvaluation {
  total: number;
  correct: number;
  accuracy: number;
  byCategory: CategoryMetrics[];
  byRule: RuleMetrics[];
  failures: Array<{ path: string; category: NameCategory; expectedRule: DetectionRule; actualRule: DetectionRule; reason: string }>;
}

function sameNumbers(left: number[] | undefined, right: number[] | undefined): boolean {
  if (!left) return true;
  return left.length === (right ?? []).length && left.every((value, index) => value === right?.[index]);
}

/** Un échantillon est correct si le type et tous les champs vérifiables de la vérité terrain concordent. */
export function isCorrect(sample: NameSample, detected: ReturnType<typeof detectMedia>["best"]): { ok: boolean; reason: string } {
  if (detected.kind !== sample.truth.kind) return { ok: false, reason: `type ${detected.kind} au lieu de ${sample.truth.kind}` };
  if (sample.truth.title != null && detected.title !== sample.truth.title) {
    return { ok: false, reason: `titre « ${detected.title} » au lieu de « ${sample.truth.title} »` };
  }
  if (sample.truth.year != null && detected.year !== sample.truth.year) {
    return { ok: false, reason: `année ${detected.year} au lieu de ${sample.truth.year}` };
  }
  if (sample.truth.showTitle != null && detected.showTitle !== sample.truth.showTitle) {
    return { ok: false, reason: `série « ${detected.showTitle} » au lieu de « ${sample.truth.showTitle} »` };
  }
  if (sample.truth.seasonNumber != null && detected.seasonNumber !== sample.truth.seasonNumber) {
    return { ok: false, reason: `saison ${detected.seasonNumber} au lieu de ${sample.truth.seasonNumber}` };
  }
  if (!sameNumbers(sample.truth.episodeNumbers, detected.episodeNumbers)) {
    return { ok: false, reason: `épisodes ${detected.episodeNumbers.join(",")} au lieu de ${sample.truth.episodeNumbers?.join(",")}` };
  }
  return { ok: true, reason: "" };
}

export function evaluateCorpus(samples: NameSample[]): CorpusEvaluation {
  const categories = new Map<NameCategory, CategoryMetrics>();
  const rules = new Map<DetectionRule, RuleMetrics>();
  const failures: CorpusEvaluation["failures"] = [];
  let correct = 0;

  for (const sample of samples) {
    const result = detectMedia(sample.path, sample.libraryKind);
    const verdict = isCorrect(sample, result.best);
    const category = categories.get(sample.category)
      ?? { category: sample.category, total: 0, correct: 0, auto: 0, revue: 0, rejet: 0, recall: 0 };
    category.total += 1;
    category[result.decision] += 1;
    const rule = rules.get(result.best.rule) ?? { rule: result.best.rule, predicted: 0, correct: 0, precision: 0 };
    rule.predicted += 1;
    if (verdict.ok) {
      correct += 1; category.correct += 1; rule.correct += 1;
    } else if (failures.length < 200) {
      failures.push({ path: sample.path, category: sample.category, expectedRule: sample.expectedRule,
        actualRule: result.best.rule, reason: verdict.reason });
    }
    categories.set(sample.category, category);
    rules.set(result.best.rule, rule);
  }

  for (const metrics of categories.values()) metrics.recall = metrics.total ? metrics.correct / metrics.total : 0;
  for (const metrics of rules.values()) metrics.precision = metrics.predicted ? metrics.correct / metrics.predicted : 0;
  return {
    total: samples.length, correct, accuracy: samples.length ? correct / samples.length : 0,
    byCategory: [...categories.values()].sort((left, right) => left.category.localeCompare(right.category)),
    byRule: [...rules.values()].sort((left, right) => left.rule.localeCompare(right.rule)),
    failures,
  };
}
