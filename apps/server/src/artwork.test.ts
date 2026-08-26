import { describe, expect, it } from "vitest";
import { canGenerateArtwork, generatedArtworkFilter, generatedArtworkIsBlack } from "./artwork.js";

describe("generatedArtworkFilter", () => {
  it("n'utilise jamais une capture vidéo comme jaquette", () => {
    expect(canGenerateArtwork("poster")).toBe(false);
    expect(canGenerateArtwork("backdrop")).toBe(true);
  });

  it("produit une jaquette verticale 2:3", () => {
    expect(generatedArtworkFilter("poster")).toContain("scale=600:900");
    expect(generatedArtworkFilter("poster")).toContain("crop=600:900");
  });

  it("produit un fond horizontal 16:9", () => {
    expect(generatedArtworkFilter("backdrop")).toContain("scale=1280:720");
    expect(generatedArtworkFilter("backdrop")).toContain("crop=1280:720");
  });

  it("refuse une miniature presque entièrement noire", () => {
    expect(generatedArtworkIsBlack("frame:0 pblack:100 pts:0")).toBe(true);
    expect(generatedArtworkIsBlack("frame:0 pblack:97.5 pts:0")).toBe(true);
    expect(generatedArtworkIsBlack("frame:0 pblack:42 pts:0")).toBe(false);
  });
});
