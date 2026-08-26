import { describe, expect, it } from "vitest";
import { applyHdrFrameMetadata, chromaSubsamplingFromPixelFormat, mergeEmbeddedMetadata, parseProbeOutput, parseProbeRational } from "./ffprobe.js";
import { parseMediaPath } from "./media-parser.js";

describe("métadonnées intégrées", () => {
  it("extrait durée, langues et tags", () => {
    const metadata = parseProbeOutput({
      format: { duration: "3632.4", tags: { title: "Pilote", show: "Ma Série", date: "2024-01-03", tmdbid: "1234", imdb: "tt1234567" } },
      streams: [
        { index: 0, codec_type: "video", codec_name: "hevc", width: 3840, height: 2160, color_transfer: "smpte2084", color_primaries: "bt2020" },
        { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, disposition: { default: 1 }, tags: { language: "fra" } },
        { index: 2, codec_type: "audio", codec_name: "dts", channels: 6, tags: { language: "eng" } },
        { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "fra" } },
      ],
    });
    expect(metadata).toMatchObject({ durationSeconds: 3632, title: "Pilote", showTitle: "Ma Série", year: 2024,
      externalIds: { tmdb: "1234", imdb: "tt1234567" } });
    expect(metadata.audioLanguages).toEqual(["fra", "eng"]);
    expect(metadata.subtitleLanguages).toEqual(["fra"]);
    expect(metadata.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, codec: "hevc", hdr: true, width: 3840 }),
      expect.objectContaining({ index: 1, codec: "aac", channels: 2, isDefault: true }),
      expect.objectContaining({ index: 3, codec: "subrip", canExtractAsWebVtt: true }),
    ]));
  });

  it("récupère l'année encadrée dans le titre du conteneur sans confondre un nombre du titre", () => {
    expect(parseProbeOutput({ format: { tags: {
      title: "Jurassic Park II (1997) The Lost World [2160p]",
    } } })).toMatchObject({ title: "Jurassic Park II (1997) The Lost World [2160p]", year: 1997 });
    expect(parseProbeOutput({ format: { tags: { title: "2001 : L'Odyssée de l'espace" } } }).year).toBeNull();
  });

  it("nettoie l'année et la langue finales d'un titre de conteneur sans casser les vrais titres français", () => {
    const embedded = parseProbeOutput({ format: { tags: {
      title: "OSS 117 Alerte Rouge en Afrique Noire 2021 FRENCH",
    } } });
    expect(embedded.year).toBe(2021);
    const parsed = parseMediaPath("D:/Films/OSS 117 - Alerte Rouge en Afrique Noire.mkv", "movie");
    expect(mergeEmbeddedMetadata(parsed, embedded)).toMatchObject({
      title: "OSS 117 Alerte Rouge en Afrique Noire", year: 2021, detection: { decision: "auto" },
    });
    expect(parseProbeOutput({ format: { tags: { title: "The French Dispatch" } } }).year).toBeNull();
  });

  it("répare aussi un ancien cache où l'année du tag OSS 117 n'avait pas été extraite", () => {
    const parsed = parseMediaPath("D:/Films/OSS 117 - Alerte Rouge en Afrique Noire.mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 7000, title: "OSS 117 Alerte Rouge en Afrique Noire 2021 FRENCH", year: null,
      showTitle: null, seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "OSS 117 Alerte Rouge en Afrique Noire", year: 2021,
      detection: { decision: "auto" } });
  });

  it("conserve comme alias un titre intégré plus complet qui confirme le nom du fichier", () => {
    const parsed = parseMediaPath("D:/Films/Jurassic Park II (1997).mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 7720, title: "Jurassic Park II (1997) The Lost World [2160p]", year: 1997,
      showTitle: null, seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "Jurassic Park II", year: 1997,
      titleAliases: ["Jurassic Park II The Lost World"], detection: { decision: "auto" } });
  });

  it("ne traite pas le titre officiel d'une suite comme une contradiction du numéro local", () => {
    const parsed = parseMediaPath("D:/Films/Ant-Man 2 (2018).mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 7080, title: "Ant-Man and the Wasp", year: 2018, showTitle: null,
      seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "Ant-Man 2", year: 2018, titleAliases: ["Ant-Man and the Wasp"],
      detection: { decision: "auto" } });
  });

  it("assimile SpiderMan et Spider-Man dans le titre intégré", () => {
    const parsed = parseMediaPath("D:/Films/SpiderMan Far From Home (2019).mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 7740, title: "Spider-Man: Far From Home", year: 2019, showTitle: null,
      seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "SpiderMan Far From Home", year: 2019,
      titleAliases: ["Spider-Man: Far From Home"], detection: { decision: "auto" } });
  });

  it("conserve l'année explicite entre parenthèses du film", () => {
    const parsed = parseMediaPath("D:/Films/Dune (2021)/Dune (2021).mkv");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 9000, title: "Titre interne", year: 1984, showTitle: null,
      seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "Dune", year: 2021 });
  });

  it("utilise le titre embarqué quand le nom de fichier est refusé", () => {
    const parsed = parseMediaPath("D:/Films/x.mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 5400, title: "Le vrai titre", year: 2020, showTitle: null,
      seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ title: "Le vrai titre", year: 2020, detection: { decision: "auto" } });
  });

  it("reconstruit un épisode inconnu depuis son identité intégrée", () => {
    const parsed = parseMediaPath("D:/TV/Import/video_001.mkv", "tv");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 2700, title: "L'inconnu du jour", year: 2026, showTitle: "Le Journal",
      seasonNumber: 2026, episodeNumber: 821, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ kind: "episode", title: "L'inconnu du jour", showTitle: "Le Journal",
      seasonNumber: 2026, episodeNumber: 821, detection: { decision: "auto" } });
  });

  it("résout directement un fichier opaque portant un identifiant intégré", () => {
    const parsed = parseMediaPath("D:/Films/inconnu.mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 6000, title: null, year: null, showTitle: null, seasonNumber: null, episodeNumber: null,
      externalIds: { imdb: "tt10945288" }, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged).toMatchObject({ externalIds: { imdb: "tt10945288" }, detection: { decision: "auto", confidence: 1 } });
  });

  it("met en revue un conflit daté entre le fichier et le titre intégré", () => {
    const parsed = parseMediaPath("D:/Films/BAC Nord (2021).mkv", "movie");
    const merged = mergeEmbeddedMetadata(parsed, {
      durationSeconds: 6000, title: "Boîte noire", year: 2021, showTitle: null,
      seasonNumber: null, episodeNumber: null, audioLanguages: [], subtitleLanguages: [], streams: [], raw: {},
    });
    expect(merged.detection).toMatchObject({ decision: "revue", warnings: ["Le titre intégré contredit le nom du fichier."] });
  });

  it("distingue Dolby Vision, HDR10+ et Dolby Atmos", () => {
    const metadata = parseProbeOutput({ streams: [
      {
        index: 0, codec_type: "video", codec_name: "hevc", codec_tag_string: "dvhe",
        color_transfer: "smpte2084", color_primaries: "bt2020",
        side_data_list: [{ side_data_type: "DOVI configuration record", dv_profile: 8 }],
      },
      {
        index: 1, codec_type: "audio", codec_name: "eac3", profile: "Dolby Digital Plus + Dolby Atmos",
        channels: 8, tags: { language: "eng" },
      },
      {
        index: 2, codec_type: "video", codec_name: "hevc", color_transfer: "smpte2084", color_primaries: "bt2020",
        side_data_list: [{ side_data_type: "HDR Dynamic Metadata SMPTE2094-40" }],
      },
      { index: 3, codec_type: "audio", codec_name: "dts", profile: "DTS-HD Master Audio / DTS:X", channels: 8 },
    ] });
    expect(metadata.streams[0]).toMatchObject({ hdrFormat: "dolbyvision", dolbyVisionProfile: 8 });
    expect(metadata.streams[1]).toMatchObject({ dolbyAtmos: true, codec: "eac3" });
    expect(metadata.streams[2]).toMatchObject({ hdrFormat: "hdr10plus" });
    expect(metadata.streams[3]).toMatchObject({ audioTechnology: "dts-x", losslessAudio: true });
  });

  it("déduit la profondeur 10 bits depuis le format de pixels", () => {
    const metadata = parseProbeOutput({ streams: [{ index: 0, codec_type: "video", codec_name: "hevc", pix_fmt: "yuv420p10le" }] });
    expect(metadata.streams[0]?.bitDepth).toBe(10);
  });

  it("détecte Atmos et DTS:X depuis le titre de piste", () => {
    const metadata = parseProbeOutput({ streams: [
      { index: 0, codec_type: "audio", codec_name: "truehd", tags: { title: "TrueHD 7.1 Atmos" } },
      { index: 1, codec_type: "audio", codec_name: "dts", tags: { title: "DTS-X Master Audio" } },
    ] });
    expect(metadata.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, audioTechnology: "dolby-atmos", losslessAudio: true }),
      expect.objectContaining({ index: 1, audioTechnology: "dts-x" }),
    ]));
  });

  it("inventorie format, chapitres, colorimétrie et accessibilité", () => {
    const metadata = parseProbeOutput({ format: { format_long_name: "Matroska", size: "123456", bit_rate: "9000000" },
      chapters: [{ id: 0, start_time: "0", end_time: "120.5", tags: { title: "Introduction" } }], streams: [{
        index: 4, codec_type: "audio", codec_name: "truehd", codec_long_name: "TrueHD", sample_rate: "48000",
        disposition: { commentary: 1, visual_impaired: 1 }, tags: { language: "fra" },
      }, { index: 5, codec_type: "subtitle", codec_name: "ass", disposition: { hearing_impaired: 1 } }] });
    expect(metadata).toMatchObject({ formatLongName: "Matroska", fileSize: 123456, overallBitRate: 9000000,
      chapters: [{ title: "Introduction", endSeconds: 120.5 }] });
    expect(metadata.streams[0]).toMatchObject({ codecLongName: "TrueHD", sampleRate: 48000, commentary: true, visualImpaired: true });
    expect(metadata.streams[1]).toMatchObject({ hearingImpaired: true });
  });

  it("distingue les sous-titres SRT, ASS et PGS", () => {
    const metadata = parseProbeOutput({ streams: [
      { index: 1, codec_type: "subtitle", codec_name: "subrip" },
      { index: 2, codec_type: "subtitle", codec_name: "ass" },
      { index: 3, codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" },
    ] });
    expect(metadata.streams.map((stream) => [stream.codec, stream.canExtractAsWebVtt])).toEqual([
      ["subrip", true], ["ass", true], ["hdmv_pgs_subtitle", false],
    ]);
  });

  it("classe version originale, doublage, commentaire, audiodescription et captions", () => {
    const metadata = parseProbeOutput({ streams: [
      { index: 0, codec_type: "video", codec_name: "h264", closed_captions: 1 },
      { index: 1, codec_type: "audio", codec_name: "aac", tags: { language: "eng", title: "Original VO" } },
      { index: 2, codec_type: "audio", codec_name: "aac", tags: { language: "fra", title: "Doublage VF" } },
      { index: 3, codec_type: "audio", codec_name: "aac", tags: { title: "Commentaire du réalisateur" } },
      { index: 4, codec_type: "audio", codec_name: "aac", tags: { title: "Audiodescription" } },
    ] });
    expect(metadata.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, closedCaptions: true }), expect.objectContaining({ index: 1, audioRole: "original" }),
      expect.objectContaining({ index: 2, audioRole: "dub" }), expect.objectContaining({ index: 3, audioRole: "commentary", commentary: true }),
      expect.objectContaining({ index: 4, audioRole: "audio-description", visualImpaired: true }),
    ]));
  });

  it("construit le modèle colorimétrique complet d'une piste vidéo", () => {
    const metadata = parseProbeOutput({ streams: [{
      index: 0, codec_type: "video", codec_name: "hevc", pix_fmt: "yuv420p10le", width: 3840, height: 2160,
      color_transfer: "smpte2084", color_primaries: "bt2020", color_space: "bt2020nc", color_range: "tv",
      chroma_location: "left", field_order: "progressive",
    }] });
    expect(metadata.streams[0]?.color).toMatchObject({
      colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorSpace: "bt2020nc", colorRange: "tv",
      chromaLocation: "left", chromaSubsampling: "4:2:0", bitDepth: 10, interlaced: false, rotationDegrees: 0,
    });
  });

  it("lit le profil, la couche et la compatibilité Dolby Vision de la donnée annexe", () => {
    const metadata = parseProbeOutput({ streams: [{
      index: 0, codec_type: "video", codec_name: "hevc", color_transfer: "smpte2084", color_primaries: "bt2020",
      side_data_list: [{ side_data_type: "DOVI configuration record", dv_profile: 8, dv_level: 6,
        rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 1 }],
    }] });
    expect(metadata.streams[0]?.color).toMatchObject({
      dolbyVisionProfile: 8, dolbyVisionLevel: 6, dolbyVisionRpuPresent: true,
      dolbyVisionElPresent: false, dolbyVisionBlPresent: true, dolbyVisionBlCompatibilityId: 1,
    });
    expect(metadata.streams[0]?.dolbyVisionProfile).toBe(8);
  });

  it("normalise la rotation du conteneur et l'entrelacement", () => {
    const metadata = parseProbeOutput({ streams: [
      { index: 0, codec_type: "video", codec_name: "h264", field_order: "tt",
        side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] },
    ] });
    expect(metadata.streams[0]?.color).toMatchObject({ rotationDegrees: 270, interlaced: true, fieldOrder: "tt" });
  });

  it("convertit les rationnels et les sous-échantillonnages FFprobe", () => {
    expect(parseProbeRational("34000/50000")).toBeCloseTo(0.68);
    expect(parseProbeRational("10000000/10000")).toBe(1000);
    expect(parseProbeRational("0/0")).toBeNull();
    expect(chromaSubsamplingFromPixelFormat("yuv422p10le")).toBe("4:2:2");
    expect(chromaSubsamplingFromPixelFormat("yuv444p")).toBe("4:4:4");
    expect(chromaSubsamplingFromPixelFormat("gray")).toBe("4:0:0");
    expect(chromaSubsamplingFromPixelFormat("nv12")).toBe("4:2:0");
  });

  it("complète mastering display, MaxCLL et HDR10+ depuis la donnée annexe d'image", () => {
    const metadata = parseProbeOutput({ streams: [{ index: 0, codec_type: "video", codec_name: "hevc",
      pix_fmt: "yuv420p10le", color_transfer: "smpte2084", color_primaries: "bt2020" }] });
    const enriched = applyHdrFrameMetadata(metadata, [
      { side_data_type: "Mastering display metadata", red_x: "34000/50000", red_y: "16000/50000",
        green_x: "13250/50000", green_y: "34500/50000", blue_x: "7500/50000", blue_y: "3000/50000",
        white_point_x: "15635/50000", white_point_y: "16450/50000", min_luminance: "1/10000", max_luminance: "10000000/10000" },
      { side_data_type: "Content light level metadata", max_content: 1000, max_average: 400 },
      { side_data_type: "HDR Dynamic Metadata SMPTE2094-40" },
    ]);
    expect(enriched.streams[0]?.color?.masteringDisplay).toMatchObject({ maxLuminanceNits: 1000, minLuminanceNits: 0.0001 });
    expect(enriched.streams[0]?.color).toMatchObject({ maxContentLightLevel: 1000, maxFrameAverageLightLevel: 400 });
    expect(enriched.streams[0]?.hdrFormat).toBe("hdr10plus");
  });

  it("conserve Dolby Vision comme format principal tout en exposant le HDR10+ compagnon", () => {
    const metadata = parseProbeOutput({ streams: [{ index: 0, codec_type: "video", codec_name: "hevc",
      pix_fmt: "yuv420p10le", color_transfer: "smpte2084", color_primaries: "bt2020",
      side_data_list: [{ side_data_type: "DOVI configuration record", dv_profile: 8,
        rpu_present_flag: 1, bl_present_flag: 1, dv_bl_signal_compatibility_id: 1 }] }] });
    const enriched = applyHdrFrameMetadata(metadata, [
      { side_data_type: "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)" },
    ]);
    expect(enriched.streams[0]).toMatchObject({ hdrFormat: "dolbyvision",
      availableHdrFormats: ["dolbyvision", "hdr10", "hdr10plus"] });
    // Le scanner persiste le JSON brut : l'enrichissement doit survivre à cette sérialisation.
    expect(parseProbeOutput(JSON.parse(JSON.stringify(enriched.raw))).streams[0]?.availableHdrFormats)
      .toEqual(["dolbyvision", "hdr10", "hdr10plus"]);
  });
});
