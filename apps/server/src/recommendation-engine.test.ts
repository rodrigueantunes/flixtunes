import { describe, expect, it } from "vitest";
import type { MediaItem } from "@flixtunes/contracts";
import { recommendLocal } from "./recommendation-engine.js";

const item = (id: string, title: string, year: number, kind: "movie" | "show" = "movie", extras: Partial<MediaItem> = {}): MediaItem => ({
  id, catalogId: id, playableMediaId: id, kind, title, sortTitle: title.toLowerCase(), year, addedAt: "2020-01-01",
  overview: null, posterUrl: null, backdropUrl: null, showTitle: null, seasonNumber: null, episodeNumber: null,
  runtimeSeconds: 100, progressPercent: 0, completed: false, ...extras,
});

describe("recommandations locales", () => {
  it("favorise la liste et explique son choix", () => {
    const recommendations = recommendLocal([item("a", "Space Journey", 2021, "movie", { inWatchlist: true }), item("b", "Drama", 1980)],
      [item("seen", "Space Odyssey", 2020, "movie", { completed: true })]);
    expect(recommendations[0]).toMatchObject({ item: { id: "a" } });
    expect(recommendations[0]?.reason).toContain("liste");
  });
  it("exclut ce qui est déjà vu", () => {
    const watched = item("seen", "Film", 2020, "movie", { completed: true });
    expect(recommendLocal([watched], [watched])).toHaveLength(0);
  });
});
