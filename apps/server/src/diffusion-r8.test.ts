import { describe, expect, it } from "vitest";
import { didlDiffusion, dlnaLitLeConteneur, dlnaLitLeHls } from "./diffusion-dlna.js";
import { metadonneesCast } from "./diffusion-cast.js";
import { fonctionnalitesDlna, mimeDuFichier, nomDuFichier } from "./diffusion-medias.js";

/** Formats réellement déclarés par le Philips 58PUS7304 (DLNA), relevés le 2 octobre 2026. */
const philips = ["audio/mpeg", "audio/mp4", "video/mpeg", "video/vnd.dlna.mpeg-tts", "video/mp4", "video/x-matroska",
  "video/MP2T", "video/x-mkv", "audio/x-mpegurl"].map((type) => `http-get:*:${type}:*`);

describe("formats déclarés par un téléviseur DLNA", () => {
  it("ne prend pas une liste audio pour du HLS", () => {
    // La r7 y voyait du HLS, et ce téléviseur refusait tout sans rien demander au NAS.
    expect(dlnaLitLeHls(philips)).toBe(false);
    expect(dlnaLitLeHls([...philips, "http-get:*:application/vnd.apple.mpegurl:*"])).toBe(true);
    expect(dlnaLitLeHls(["http-get:*:application/x-mpegURL:*"])).toBe(true);
  });
  it("reconnaît le conteneur du fichier, sous ses différents noms", () => {
    expect(dlnaLitLeConteneur(philips, "video/x-matroska")).toBe(true);
    expect(dlnaLitLeConteneur(["http-get:*:video/x-mkv:*"], "video/x-matroska")).toBe(true);
    expect(dlnaLitLeConteneur(philips, "video/webm")).toBe(false);
    expect(dlnaLitLeConteneur(null, "video/mp4")).toBe(false);
  });
});

describe("fichier servi tel quel", () => {
  it("garde seulement l'extension du chemin, et annonce le bon type", () => {
    expect(nomDuFichier("/volume2/Multimédia/Film/Star Wars/The Mandalorian and Grogu (2026).mkv")).toBe("media.mkv");
    expect(mimeDuFichier("/films/x.MKV")).toBe("video/x-matroska");
    expect(mimeDuFichier("/films/x.m2ts")).toBe("video/mp2t");
    expect(nomDuFichier("/films/sans-extension")).toBe("media.mp4");
  });
  it("annonce un fichier navigable, et une conversion continue lue d'un trait", () => {
    expect(fonctionnalitesDlna(true)).toMatch(/^DLNA\.ORG_OP=01;DLNA\.ORG_CI=0;DLNA\.ORG_FLAGS=017/);
    expect(fonctionnalitesDlna(false)).toMatch(/^DLNA\.ORG_OP=00;DLNA\.ORG_CI=1;/);
  });
});

describe("ce que le téléviseur affiche", () => {
  it("décrit un film avec son affiche, un épisode avec sa série, une chaîne avec son logo", () => {
    expect(metadonneesCast({ genre: "film", titre: "The Mandalorian and Grogu", annee: 2026, image: "http://10.20.30.254:4000/api/artwork/a" }))
      .toEqual({ metadataType: 1, title: "The Mandalorian and Grogu", releaseDate: "2026-01-01", images: [{ url: "http://10.20.30.254:4000/api/artwork/a" }] });
    expect(metadonneesCast({ genre: "episode", titre: "Le pilote", serie: "Dr House", saison: 1, episode: 1 }))
      .toMatchObject({ metadataType: 2, seriesTitle: "Dr House", season: 1, episode: 1 });
    expect(metadonneesCast({ genre: "direct", titre: "CNEWS", sousTitre: "En direct", image: "https://logo/cnews.png" }))
      .toMatchObject({ metadataType: 0, title: "CNEWS", subtitle: "En direct" });
  });
  it("pose l'affiche et les drapeaux dans le DIDL-Lite, sans casser le XML", () => {
    const didl = didlDiffusion("http://nas/flux/cle/media.mkv", "video/x-matroska",
      { genre: "episode", titre: "Tom & Jerry <1>", serie: "Cartoons", saison: 2, episode: 3, image: "http://nas/api/artwork/x" }, true);
    expect(didl).toContain("<dc:title>Cartoons — Tom &amp; Jerry &lt;1&gt;</dc:title>");
    expect(didl).toContain("<dc:description>Saison 2, épisode 3</dc:description>");
    expect(didl).toContain("<upnp:albumArtURI>http://nas/api/artwork/x</upnp:albumArtURI>");
    expect(didl).toContain('protocolInfo="http-get:*:video/x-matroska:DLNA.ORG_OP=01;');
  });
});
