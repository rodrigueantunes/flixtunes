import { describe, expect, it } from "vitest";
import { meilleureVariante } from "./live-qualite.js";

/**
 * Ce qui distingue deux adresses vivantes de la même chaîne.
 *
 * Le repli sait écarter ce qui ne répond pas ; il ne voit pas qu'une source donne du 480p quand sa
 * voisine donne du 1080p. La réponse est écrite dans le manifeste, et les cas ci-dessous viennent des
 * formes qu'on y rencontre réellement.
 */

describe("la meilleure variante d'un manifeste", () => {
  it("retient la plus haute définition, et son débit", () => {
    const maitre = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360',
      "360.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080',
      "1080.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1280x720',
      "720.m3u8",
    ].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 1080, debit: 5_200_000 });
  });

  it("départage deux variantes de même hauteur par le débit", () => {
    // Le cas existe : une même définition proposée en deux qualités d'encodage.
    const maitre = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080',
      "a.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
      "b.m3u8",
    ].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 1080, debit: 6_000_000 });
  });

  it("garde le débit quand aucune résolution n'est déclarée", () => {
    // Beaucoup de listes du corpus annoncent une bande passante et rien d'autre.
    const maitre = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000", "seule.m3u8"].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: null, debit: 800_000 });
  });

  it("ne conclut rien d'une liste de segments", () => {
    /*
     * Un manifeste de variante ne déclare ni définition ni débit : il n'y a rien à en tirer, et ce
     * n'est pas un échec. La source se rangera après celles qui ont su se décrire — on préfère ce
     * qu'on sait à ce qu'on ignore, sans pour autant jeter ce qu'on ignore.
     */
    const variante = [
      "#EXTM3U", "#EXT-X-TARGETDURATION:8", "#EXT-X-MEDIA-SEQUENCE:1204",
      "#EXTINF:8.0,", "seg1204.ts", "#EXTINF:8.0,", "seg1205.ts",
    ].join("\n");
    expect(meilleureVariante(variante)).toEqual({ hauteur: null, debit: null });
  });

  it("lit les attributs quel que soit leur ordre et leur casse", () => {
    const maitre = ["#EXTM3U", "#EXT-X-STREAM-INF:resolution=1280x720,bandwidth=2500000,CODECS=\"avc1\"", "x.m3u8"].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 720, debit: 2_500_000 });
  });
});
