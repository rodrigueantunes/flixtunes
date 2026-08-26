import type { MetadataFieldProvenance } from "@flixtunes/contracts";

/**
 * Fédération de métadonnées — étape 52.
 *
 * Ce module ne parle à aucun réseau : il arbitre. Les adaptateurs fournisseurs lui remettent des
 * candidats, il décide champ par champ lequel gagne et pourquoi. Cette séparation rend l'arbitrage
 * entièrement testable hors ligne et permet d'afficher la provenance de chaque champ.
 */

export type FieldSource = MetadataFieldProvenance["source"];
export type MetadataField = MetadataFieldProvenance["field"];

/**
 * Priorité de principe des sources, avant toute considération de langue ou de confiance.
 * Une correction manuelle et un NFO local l'emportent toujours sur un fournisseur distant : c'est ce
 * qui garantit qu'un ré-enrichissement n'écrase jamais le travail de l'utilisateur.
 */
export const SOURCE_PRIORITY: Record<FieldSource, number> = {
  manual: 100, nfo: 90, local: 80, embedded: 70, filename: 10,
  tmdb: 60, tvdb: 58, tvmaze: 56, anilist: 55, wikidata: 54, imdb: 52, fanart: 50, allocine: 48,
};

export interface FieldCandidate {
  field: MetadataField;
  value: string | number | null;
  source: FieldSource;
  sourceId?: string | null;
  /** Langue BCP-47 du contenu, ou null si la valeur n'est pas linguistique. */
  language?: string | null;
  confidence?: number;
  locked?: boolean;
}

export interface MergedField {
  field: MetadataField;
  value: string | number | null;
  source: FieldSource;
  sourceId: string | null;
  language: string | null;
  confidence: number;
  locked: boolean;
  /** Raison lisible du choix, affichable à côté du champ dans l'administration. */
  reason: string;
  /** Candidats écartés, conservés pour expliquer et permettre une correction ciblée. */
  rejected: Array<{ source: FieldSource; language: string | null; reason: string }>;
}

function primaryLanguage(value: string | null | undefined): string | null {
  const code = value?.trim().toLowerCase().replace("_", "-").split("-")[0];
  return code ? code : null;
}

/**
 * Ordre de repli linguistique : langue de la bibliothèque, puis anglais, puis toute autre langue.
 * Une valeur sans langue déclarée n'est pas pénalisée : un runtime ou une année n'a pas de langue.
 */
export function languageRank(candidateLanguage: string | null | undefined, libraryLanguage: string): number {
  const candidate = primaryLanguage(candidateLanguage);
  if (!candidate) return 1;
  const library = primaryLanguage(libraryLanguage) ?? "fr";
  if (candidate === library) return 0;
  if (candidate === "en") return 2;
  return 3;
}

/**
 * Élit la valeur d'un champ.
 *
 * Un champ verrouillé gèle la décision : aucun fournisseur ne peut le remplacer, quelle que soit sa
 * confiance. Sinon l'ordre est source, puis langue, puis confiance — une traduction française d'un
 * fournisseur secondaire l'emporte ainsi sur un titre anglais d'un fournisseur mieux classé, ce qui est
 * bien le comportement attendu pour une bibliothèque francophone.
 */
export function mergeField(candidates: FieldCandidate[], libraryLanguage = "fr-FR"): MergedField | null {
  const usable = candidates.filter((candidate) => candidate.value !== null && candidate.value !== undefined && candidate.value !== "");
  if (!usable.length) return null;

  const locked = usable.find((candidate) => candidate.locked);
  const ordered = [...usable].sort((left, right) => {
    if (Boolean(left.locked) !== Boolean(right.locked)) return left.locked ? -1 : 1;
    const priority = (SOURCE_PRIORITY[right.source] ?? 0) - (SOURCE_PRIORITY[left.source] ?? 0);
    if (priority !== 0) return priority;
    const language = languageRank(left.language, libraryLanguage) - languageRank(right.language, libraryLanguage);
    if (language !== 0) return language;
    return (right.confidence ?? 0) - (left.confidence ?? 0);
  });

  const winner = ordered[0]!;
  const reason = locked ? "Champ verrouillé par une correction manuelle"
    : winner.source === "nfo" || winner.source === "local" ? "Métadonnée locale prioritaire sur les fournisseurs"
      : languageRank(winner.language, libraryLanguage) === 0 ? `Valeur dans la langue de la bibliothèque (${winner.language})`
        : languageRank(winner.language, libraryLanguage) === 2 ? "Repli sur l'anglais faute de traduction disponible"
          : `Fournisseur ${winner.source} retenu`;

  return {
    field: winner.field, value: winner.value, source: winner.source, sourceId: winner.sourceId ?? null,
    language: winner.language ?? null, confidence: winner.confidence ?? 0.5, locked: Boolean(winner.locked), reason,
    rejected: ordered.slice(1).map((candidate) => ({
      source: candidate.source, language: candidate.language ?? null,
      reason: locked ? "Champ verrouillé"
        : (SOURCE_PRIORITY[candidate.source] ?? 0) < (SOURCE_PRIORITY[winner.source] ?? 0) ? "Source moins prioritaire"
          : languageRank(candidate.language, libraryLanguage) > languageRank(winner.language, libraryLanguage) ? "Langue moins adaptée"
            : "Confiance inférieure",
    })),
  };
}

export function mergeFields(candidates: FieldCandidate[], libraryLanguage = "fr-FR"): MergedField[] {
  const byField = new Map<MetadataField, FieldCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byField.get(candidate.field) ?? [];
    bucket.push(candidate);
    byField.set(candidate.field, bucket);
  }
  return [...byField.values()].flatMap((bucket) => mergeField(bucket, libraryLanguage) ?? []);
}

export type ArtworkKind = "poster" | "backdrop" | "logo";

export interface ArtworkCandidate {
  kind: ArtworkKind;
  url: string;
  source: FieldSource;
  width: number;
  height: number;
  contentType?: string | null;
  language?: string | null;
  /** Image tirée de la vidéo elle-même : dernier repli, jamais préférée à une affiche véritable. */
  extracted?: boolean;
}

export interface ArtworkRejection { url: string; reason: string }

/** Proportions attendues, avec une tolérance qui accepte les variantes courantes des fournisseurs. */
const ASPECT_RULES: Record<ArtworkKind, { ratio: number; tolerance: number; minWidth: number }> = {
  poster: { ratio: 2 / 3, tolerance: 0.12, minWidth: 300 },
  backdrop: { ratio: 16 / 9, tolerance: 0.15, minWidth: 780 },
  logo: { ratio: 3, tolerance: 2.5, minWidth: 200 },
};

/**
 * Contrôle format, dimensions et proportions avant d'accepter une image.
 * Une réponse non image, une vignette minuscule ou une affiche aux mauvaises proportions sont refusées :
 * elles produisent sinon des fiches visuellement incohérentes que l'utilisateur devra corriger à la main.
 */
export function validateArtwork(candidate: ArtworkCandidate): { ok: boolean; reason: string } {
  const rule = ASPECT_RULES[candidate.kind];
  if (candidate.contentType && !/^image\/(jpeg|png|webp|avif)$/i.test(candidate.contentType)) {
    return { ok: false, reason: `Type de contenu inattendu : ${candidate.contentType}` };
  }
  if (!Number.isFinite(candidate.width) || !Number.isFinite(candidate.height) || candidate.width <= 0 || candidate.height <= 0) {
    return { ok: false, reason: "Dimensions inconnues ou nulles" };
  }
  if (candidate.width < rule.minWidth) {
    return { ok: false, reason: `Largeur ${candidate.width} px inférieure au minimum de ${rule.minWidth} px` };
  }
  const ratio = candidate.width / candidate.height;
  if (Math.abs(ratio - rule.ratio) > rule.tolerance * rule.ratio) {
    return { ok: false, reason: `Proportions ${ratio.toFixed(2)} éloignées du format attendu ${rule.ratio.toFixed(2)}` };
  }
  return { ok: true, reason: "" };
}

export interface ArtworkSelection {
  chosen: ArtworkCandidate | null;
  reason: string;
  rejected: ArtworkRejection[];
}

/**
 * Choisit une image : d'abord la langue de la bibliothèque, puis l'anglais, puis une image sans langue,
 * et en tout dernier recours l'image extraite de la vidéo. À qualité linguistique égale, la définition
 * la plus grande gagne.
 */
export function selectArtwork(candidates: ArtworkCandidate[], kind: ArtworkKind, libraryLanguage = "fr-FR"): ArtworkSelection {
  const rejected: ArtworkRejection[] = [];
  const valid = candidates.filter((candidate) => {
    if (candidate.kind !== kind) return false;
    const verdict = validateArtwork(candidate);
    if (!verdict.ok) rejected.push({ url: candidate.url, reason: verdict.reason });
    return verdict.ok;
  });
  if (!valid.length) return { chosen: null, reason: "Aucune image exploitable", rejected };

  const ordered = [...valid].sort((left, right) => {
    if (Boolean(left.extracted) !== Boolean(right.extracted)) return left.extracted ? 1 : -1;
    const language = languageRank(left.language, libraryLanguage) - languageRank(right.language, libraryLanguage);
    if (language !== 0) return language;
    const priority = (SOURCE_PRIORITY[right.source] ?? 0) - (SOURCE_PRIORITY[left.source] ?? 0);
    if (priority !== 0) return priority;
    return right.width - left.width;
  });
  const chosen = ordered[0]!;
  const reason = chosen.extracted ? "Aucune affiche de fournisseur : image extraite de la vidéo"
    : languageRank(chosen.language, libraryLanguage) === 0 ? "Image dans la langue de la bibliothèque"
      : languageRank(chosen.language, libraryLanguage) === 2 ? "Repli sur l'image anglaise"
        : "Image sans langue déclarée retenue";
  return { chosen, reason, rejected };
}

export interface ProviderQuota {
  provider: string;
  /** Requêtes autorisées sur la fenêtre glissante. */
  limit: number;
  windowMs: number;
  used: number;
  resetAt: number;
}

/**
 * Compteur de quota par fournisseur sur fenêtre glissante.
 * Le respect des quotas est une obligation de licence autant qu'une politesse : dépasser fait bannir.
 */
export class QuotaLedger {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limits: Record<string, { limit: number; windowMs: number }>) {}

  /** Indique si une requête est permise maintenant, sans la consommer. */
  allows(provider: string, now = Date.now()): boolean {
    const limit = this.limits[provider];
    if (!limit) return true;
    return this.recent(provider, now).length < limit.limit;
  }

  consume(provider: string, now = Date.now()): boolean {
    if (!this.allows(provider, now)) return false;
    const recent = this.recent(provider, now);
    recent.push(now);
    this.hits.set(provider, recent);
    return true;
  }

  snapshot(now = Date.now()): ProviderQuota[] {
    return Object.entries(this.limits).map(([provider, limit]) => {
      const recent = this.recent(provider, now);
      return { provider, limit: limit.limit, windowMs: limit.windowMs, used: recent.length,
        resetAt: recent.length ? recent[0]! + limit.windowMs : now };
    });
  }

  private recent(provider: string, now: number): number[] {
    const limit = this.limits[provider];
    if (!limit) return [];
    const kept = (this.hits.get(provider) ?? []).filter((stamp) => now - stamp < limit.windowMs);
    this.hits.set(provider, kept);
    return kept;
  }
}

export interface ConditionalCacheEntry {
  payload: unknown;
  etag: string | null;
  lastModified: string | null;
  storedAt: number;
}

/** En-têtes de requête conditionnelle à envoyer pour une entrée déjà connue. */
export function conditionalHeaders(entry: ConditionalCacheEntry | null | undefined): Record<string, string> {
  if (!entry) return {};
  const headers: Record<string, string> = {};
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;
  return headers;
}

export type ConditionalOutcome =
  | { status: "revalidated"; entry: ConditionalCacheEntry }
  | { status: "updated"; entry: ConditionalCacheEntry }
  | { status: "offline"; entry: ConditionalCacheEntry }
  | { status: "unavailable"; reason: string };

/**
 * Applique une réponse HTTP à une entrée de cache.
 *
 * Un 304 confirme l'entrée sans retélécharger la charge utile : c'est ce qui économise le quota.
 * Une panne réseau ne doit jamais effacer une entrée connue : le serveur continue de fonctionner hors
 * ligne avec ce qu'il a déjà appris, ce qu'exige explicitement le plan.
 */
export function applyConditionalResponse(
  previous: ConditionalCacheEntry | null,
  response: { status: number; etag?: string | null; lastModified?: string | null; payload?: unknown } | null,
  now = Date.now(),
): ConditionalOutcome {
  if (!response) {
    return previous ? { status: "offline", entry: previous }
      : { status: "unavailable", reason: "Fournisseur injoignable et aucune donnée en cache" };
  }
  if (response.status === 304) {
    return previous ? { status: "revalidated", entry: { ...previous, storedAt: now } }
      : { status: "unavailable", reason: "Réponse 304 sans entrée de cache correspondante" };
  }
  if (response.status >= 200 && response.status < 300) {
    return { status: "updated", entry: { payload: response.payload ?? null, etag: response.etag ?? null,
      lastModified: response.lastModified ?? null, storedAt: now } };
  }
  return previous ? { status: "offline", entry: previous }
    : { status: "unavailable", reason: `Réponse ${response.status} du fournisseur` };
}
