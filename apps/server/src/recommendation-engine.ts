import type { MediaItem } from "@flixtunes/contracts";

export interface Recommendation { item: MediaItem & { seasonCount?: number }; score: number; reason: string }

function tokens(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4));
}

export function recommendLocal(candidates: Array<MediaItem & { seasonCount?: number }>, watched: MediaItem[], limit = 20,
  feedback: Map<string, "like" | "dislike" | "dismissed"> = new Map()): Recommendation[] {
  const watchedCatalog = new Set(watched.map((item) => item.catalogId).filter(Boolean));
  const watchedYears = watched.map((item) => item.year).filter((year): year is number => year != null);
  const watchedWords = new Set(watched.flatMap((item) => [...tokens(`${item.title} ${item.showTitle ?? ""}`)]));
  const scored = candidates.filter((item) => !item.completed && !watchedCatalog.has(item.catalogId)
    && !["dislike", "dismissed"].includes(feedback.get(item.catalogId ?? item.id) ?? "")).map((item) => {
    let score = 0.3; const reasons: string[] = [];
    if (item.inWatchlist) { score += 0.35; reasons.push("dans votre liste"); }
    if (feedback.get(item.catalogId ?? item.id) === "like") { score += .2; reasons.push("vous l'avez apprécié"); }
    const closeYear = item.year != null && watchedYears.some((year) => Math.abs(year - item.year!) <= 4);
    if (closeYear) { score += 0.18; reasons.push("proche de vos époques favorites"); }
    const sharedWords = [...tokens(`${item.title} ${item.showTitle ?? ""}`)].filter((word) => watchedWords.has(word));
    if (sharedWords.length) { score += Math.min(.22, sharedWords.length * .08); reasons.push("lié à vos lectures récentes"); }
    if (item.addedAt && Date.now() - Date.parse(item.addedAt) < 45 * 86400000) { score += .1; reasons.push("ajout récent"); }
    return { item, score: Math.round(Math.min(1, score) * 1000) / 1000,
      reason: reasons.length ? reasons.slice(0, 2).join(" et ") : "à découvrir dans votre médiathèque" };
  }).sort((left, right) => right.score - left.score || left.item.sortTitle.localeCompare(right.item.sortTitle));
  const result: Recommendation[] = []; const kinds = new Map<string, number>();
  for (const recommendation of scored) {
    const kind = recommendation.item.kind === "show" ? "show" : "movie";
    if ((kinds.get(kind) ?? 0) >= Math.ceil(limit * .7)) continue;
    result.push(recommendation); kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (result.length >= limit) break;
  }
  return result;
}
