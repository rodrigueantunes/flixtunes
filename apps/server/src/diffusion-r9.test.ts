import { describe, expect, it } from "vitest";
import { argumentsConversionLive, composerListe, segmentsDeLaListe } from "./live-compat.js";
import {
  argumentsVideoLive, choisirTraitementLive, lireAnalyse, lireListeMaitresse, listeReduite, retirerAttribut, type AnalyseLive,
} from "./live-diffusion.js";

/** Les variantes vidéo de CNews telles que `ffprobe` les décrit, relevées le 2 octobre 2026 (extrait). */
function sondeCnews() {
  const variantes = [
    { index: 6, width: 480, height: 270, rate: "25/1", audio: 0, debit: 1164137 },
    { index: 7, width: 480, height: 270, rate: "25/1", audio: 2, debit: 992155 },
    { index: 16, width: 1280, height: 720, rate: "25/1", audio: 0, debit: 4254038 },
    { index: 17, width: 1280, height: 720, rate: "25/1", audio: 2, debit: 4082055 },
    { index: 18, width: 1920, height: 1080, rate: "50/1", audio: 0, debit: 5536638 },
    { index: 19, width: 1920, height: 1080, rate: "50/1", audio: 2, debit: 5364655 },
  ];
  return {
    programs: variantes.map((v) => ({ streams: [{ index: v.audio, codec_type: "audio" }, { index: 4, codec_type: "subtitle" }, { index: v.index, codec_type: "video" }] })),
    streams: [
      { index: 0, codec_type: "audio", codec_name: "eac3" }, { index: 2, codec_type: "audio", codec_name: "aac" },
      { index: 4, codec_type: "subtitle", codec_name: "webvtt" },
      ...variantes.map((v) => ({ index: v.index, codec_type: "video", codec_name: "h264", width: v.width, height: v.height,
        field_order: "unknown", avg_frame_rate: v.rate, tags: { variant_bitrate: String(v.debit) } })),
    ],
  };
}

/** TF1 : un seul flux, H.264 1080 entrelacé, déclaré à 50 trames par seconde. */
const sondeTf1 = { streams: [{ index: 0, codec_type: "audio", codec_name: "eac3" },
  { index: 2, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, field_order: "tt", avg_frame_rate: "50/1" }] };

const tv = { hauteurMax: 1080, hevc: true };
const tablette = { hauteurMax: 720, hevc: false };

describe("analyse d'une source du direct", () => {
  it("garde chaque variante avec le son de son programme", () => {
    const analyse = lireAnalyse(sondeCnews())!;
    expect(analyse.variantes).toHaveLength(6);
    // La première variante est celle que `-map 0:v:0` diffusait : un 480×270.
    expect(analyse).toMatchObject({ flux: 6, hauteur: 270 });
    expect(analyse.variantes.find((v) => v.flux === 19)).toMatchObject({ fluxAudio: 2, imagesParSeconde: 50, debit: 5364655 });
  });
  it("ramène un 1080i à sa vraie cadence d'images", () => {
    expect(lireAnalyse(sondeTf1)).toMatchObject({ entrelace: true, imagesParSeconde: 25, flux: 2 });
  });
  it("ne conclut rien d'une source sans vidéo", () => {
    expect(lireAnalyse({ streams: [{ index: 0, codec_type: "audio", codec_name: "aac" }] })).toBeNull();
  });
});

describe("variante et traitement pour un récepteur", () => {
  const cnews = lireAnalyse(sondeCnews())!;
  it("copie la plus belle variante que le récepteur lit", () => {
    expect(choisirTraitementLive(cnews, tv, true)).toMatchObject({ copie: true, flux: 18, fluxAudio: 0, hauteur: 1080 });
    expect(choisirTraitementLive(cnews, tablette, true)).toMatchObject({ copie: true, flux: 16, hauteur: 720 });
  });
  it("convertit pour un téléviseur DLNA, sans repartir d'une petite variante", () => {
    expect(choisirTraitementLive(cnews, { ...tv, conversionSeule: true }, true))
      .toMatchObject({ copie: false, flux: 18, encodeur: "vaapi", hauteur: 1080, imagesParSeconde: 50 });
    // Sans circuit vidéo, la conversion logicielle part de la variante 720p et reste à 25 images.
    expect(choisirTraitementLive(cnews, { ...tv, conversionSeule: true }, false))
      .toMatchObject({ copie: false, flux: 16, encodeur: "logiciel", hauteur: 720, imagesParSeconde: 25 });
  });
  it("désentrelace TF1 trame par trame avec le circuit vidéo, à 25 images sans lui", () => {
    const tf1 = lireAnalyse(sondeTf1);
    expect(choisirTraitementLive(tf1, tv, true)).toMatchObject({ copie: false, entrelace: true, hauteur: 1080, imagesParSeconde: 50,
      libelle: "Conversion 1080p50 · désentrelacée" });
    expect(choisirTraitementLive(tf1, tv, false)).toMatchObject({ encodeur: "logiciel", hauteur: 720, imagesParSeconde: 25 });
  });
  it("convertit en logiciel sans analyse, sur le premier flux", () => {
    expect(choisirTraitementLive(null, tv, true)).toMatchObject({ copie: false, flux: null, encodeur: "logiciel", hauteur: 720 });
  });
  it("fixe la cadence d'une conversion logicielle", () => {
    const t = choisirTraitementLive(cnews, { ...tv, conversionSeule: true }, false);
    const sortie = argumentsVideoLive(t).sortie;
    expect(sortie[sortie.indexOf("-r") + 1]).toBe("25");
    expect(argumentsVideoLive(choisirTraitementLive(lireAnalyse(sondeTf1), tv, true)).sortie.join(" ")).toContain("deinterlace_vaapi=rate=field");
  });
});

const maitre = `#EXTM3U
#EXT-X-VERSION:8
#EXT-X-MEDIA:TYPE=AUDIO,URI="http://127.0.0.1:1/s/o/fra.m3u8",GROUP-ID="ec3",LANGUAGE="fra",NAME="vf",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=AUDIO,URI="http://127.0.0.1:1/s/o/qad.m3u8",GROUP-ID="ec3",LANGUAGE="qad",NAME="qad",AUTOSELECT=YES,CHARACTERISTICS="public.accessibility.describes-video"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="http://127.0.0.1:1/s/o/st.m3u8",GROUP-ID="text",LANGUAGE="fra",NAME="st",DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1164137,CODECS="avc1.4d401e,ec-3",RESOLUTION=480x270,FRAME-RATE=25.000,AUDIO="ec3",SUBTITLES="text"
http://127.0.0.1:1/s/o/270.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4254038,CODECS="avc1.64001f,ec-3",RESOLUTION=1280x720,FRAME-RATE=25.000,AUDIO="ec3",SUBTITLES="text"
http://127.0.0.1:1/s/o/720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5536638,CODECS="avc1.64002a,ec-3",RESOLUTION=1920x1080,FRAME-RATE=50.000,AUDIO="ec3",SUBTITLES="text"
http://127.0.0.1:1/s/o/1080.m3u8
`;

describe("liste maîtresse réduite", () => {
  it("lit les variantes déclarées", () => {
    const lue = lireListeMaitresse(maitre)!;
    expect(lue.variantes.map((v) => [v.hauteur, v.imagesParSeconde, v.codec, v.groupeAudio])).toEqual([
      [270, 25, "h264", "ec3"], [720, 25, "h264", "ec3"], [1080, 50, "h264", "ec3"]]);
  });
  it("renonce si une variante ne déclare pas sa définition", () => {
    expect(lireListeMaitresse("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n")).toBeNull();
    expect(lireListeMaitresse("#EXTM3U\n#EXTINF:6,\ns.ts\n")).toBeNull();
  });
  it("ne garde qu'une variante, le son par défaut hors audiodescription, et aucun sous-titre", () => {
    const lue = lireListeMaitresse(maitre)!;
    const reduite = listeReduite(lue, lue.variantes[2]!);
    expect(reduite.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1);
    expect(reduite).toContain("http://127.0.0.1:1/s/o/1080.m3u8");
    expect(reduite).toContain("fra.m3u8");
    expect(reduite).not.toContain("qad.m3u8");
    expect(reduite).not.toContain("SUBTITLES");
  });
  it("retire un attribut où qu'il soit placé", () => {
    expect(retirerAttribut('#X:SUBTITLES="t",A=1', "SUBTITLES")).toBe("#X:A=1");
    expect(retirerAttribut('#X:A=1,SUBTITLES="t",B=2', "SUBTITLES")).toBe("#X:A=1,B=2");
    expect(retirerAttribut('#X:A=1,SUBTITLES="t"', "SUBTITLES")).toBe("#X:A=1");
    expect(retirerAttribut("#X:A=1", "SUBTITLES")).toBe("#X:A=1");
  });
});

describe("arguments de la conversion du direct", () => {
  const cnews = lireAnalyse(sondeCnews()) as AnalyseLive;
  it("lit la variante retenue et le son de son programme", () => {
    const args = argumentsConversionLive("http://127.0.0.1:1/s/o/m.m3u8", "/tmp/p0", "hls", false, true, choisirTraitementLive(cnews, tv, true));
    expect(args.slice(args.indexOf("-i") + 1, args.indexOf("-i") + 6)).toEqual(["http://127.0.0.1:1/s/o/m.m3u8", "-map", "0:18", "-map", "0:0?"]);
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("http,tcp,crypto");
    expect(args[args.indexOf("-format_whitelist") + 1]).toContain("webvtt");
  });
  it("ouvre une liste réduite en data:, avec le démultiplexeur HLS imposé", () => {
    const args = argumentsConversionLive("data:application/vnd.apple.mpegurl;base64,AA==", "/tmp/p0", "hls", false, true, choisirTraitementLive(null, tv, false));
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("data,http,tcp,crypto");
    expect(args.slice(args.indexOf("-i") - 2, args.indexOf("-i"))).toEqual(["-f", "hls"]);
    expect(args.slice(args.indexOf("-i") + 2, args.indexOf("-i") + 5)).toEqual(["-map", "0:v:0", "-map"]);
  });
  it("garde le fMP4 d'une session copiée quand une relance convertit", () => {
    const conversion = choisirTraitementLive(cnews, { ...tv, conversionSeule: true }, true);
    const args = argumentsConversionLive("http://x/m.m3u8", "/tmp/p1", "hls", false, true, conversion, true);
    expect(args).toContain("h264_vaapi");
    expect(args[args.indexOf("-hls_segment_type") + 1]).toBe("fmp4");
    expect(args[args.indexOf("-hls_segment_filename") + 1]).toMatch(/segment%09d\.m4s$/);
  });
});

describe("liste composée d'une diffusion", () => {
  it("relève les segments d'une passe", () => {
    expect(segmentsDeLaListe("#EXTM3U\n#EXTINF:2.000000,\nsegment000000001.ts\n#EXTINF:1.960000,\nsegment000000002.ts\n"))
      .toEqual([{ nom: "segment000000001.ts", duree: 2 }, { nom: "segment000000002.ts", duree: 1.96 }]);
  });
  it("déclare une rupture et l'initialisation de chaque passe", () => {
    const liste = composerListe({ retires: 4, ruptures: 1, fmp4: true, segments: [
      { passe: 0, nom: "segment000000005.m4s", duree: 4 }, { passe: 1, nom: "segment000000000.m4s", duree: 3.5 }] });
    expect(liste).toContain("#EXT-X-MEDIA-SEQUENCE:4");
    expect(liste).toContain("#EXT-X-DISCONTINUITY-SEQUENCE:1");
    expect(liste.split("\n").filter((l) => l.startsWith("#EXT-X-MAP"))).toEqual(['#EXT-X-MAP:URI="p0-init.mp4"', '#EXT-X-MAP:URI="p1-init.mp4"']);
    expect(liste.indexOf("#EXT-X-DISCONTINUITY\n")).toBeLessThan(liste.indexOf("p1-segment000000000.m4s"));
    expect(liste).toContain("#EXT-X-TARGETDURATION:4");
  });
  it("ne déclare aucune initialisation en MPEG-TS", () => {
    expect(composerListe({ retires: 0, ruptures: 0, fmp4: false, segments: [{ passe: 0, nom: "s.ts", duree: 2 }] })).not.toContain("EXT-X-MAP");
  });
});
