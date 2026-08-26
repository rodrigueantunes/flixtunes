import { describe, expect, it } from "vitest";
import { displayResolution } from "./video-resolution.js";

describe("libellé de définition vidéo", () => {
  it.each([
    [1920, 1080, "1080p"],
    [1920, 804, "1080p"],
    [1916, 800, "1080p"],
    [1280, 720, "720p"],
    [1280, 536, "720p"],
    [3840, 2160, "4K"],
    [3840, 1606, "4K"],
    [804, 1920, "1080p"],
  ])("classe %d×%d dans sa famille nominale", (width, height, expected) => {
    expect(displayResolution(width, height)).toBe(expected);
  });

  it("conserve une définition atypique au lieu de la rabaisser", () => {
    expect(displayResolution(1600, 900)).toBe("900p");
  });

  it("n'invente rien sans deux dimensions valides", () => {
    expect(displayResolution(1920, 0)).toBeNull();
    expect(displayResolution(null, null)).toBeNull();
  });
});
