import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MediaStream, PlaybackCapabilities, PlaybackInfo, VideoColorMetadata } from "@flixtunes/contracts";
import { audioFilterChain, buildCompatibilityMatrix, canCopySelectedAudio, convertTextSubtitleToWebVtt, decidePlayback, deinterlaceFilters, detectSubtitleEncoding,
  dolbyVisionBaseLayer, findExternalSubtitles, friendlyTranscodeError, hdrDeliveryFormat, hdrEncoderArguments, normalizeSubtitleLanguage,
  orientedDimensions, parseExternalSubtitleName, parseFfmpegComponentList, parseFfmpegFormats, planColorPipeline, selectAdaptiveLadder,
  remuxVideoArguments, remuxVideoTag, selectAdaptiveProfile, selectAudioOutputEncoder, selectHdrVideoEncoder, selectPreferredAudioStream, selectToneMappingBackend,
  selectVideoEncoder, sessionAbandonnee, sourcePeakLuminance, toneMappingFilters, transcodeScaleFilter,
  DELAI_ABANDON_DEMARRAGE_MS } from "./playback.js";

const baseInfo: PlaybackInfo = {
  mediaId: "media-1",
  container: "mp4",
  durationSeconds: 7200,
  streams: [
    { index: 0, type: "video", codec: "h264", title: null, language: null, channels: null, width: 1920, height: 1080, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: true, isForced: false, canExtractAsWebVtt: false },
    { index: 1, type: "audio", codec: "aac", title: "Français", language: "fra", channels: 2, width: null, height: null, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: true, isForced: false, canExtractAsWebVtt: false },
    { index: 2, type: "audio", codec: "dts", title: "English", language: "eng", channels: 6, width: null, height: null, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: false, isForced: false, canExtractAsWebVtt: false },
    { index: 3, type: "subtitle", codec: "subrip", title: "Français", language: "fra", channels: null, width: null, height: null, hdr: false, hdrFormat: "sdr", dolbyVisionProfile: null, dolbyAtmos: false, isDefault: false, isForced: false, canExtractAsWebVtt: true },
  ],
};

const capabilities: PlaybackCapabilities = {
  containers: ["mp4", "webm"], videoCodecs: ["h264", "vp9"], audioCodecs: ["aac", "opus"],
  hls: true, maxWidth: 3840, maxHeight: 2160, hdr: false, hdrFormats: [], dolbyAtmos: false,
  immersiveAudioFormats: [], maxAudioChannels: 8, losslessAudio: false, maxVideoBitrate: null,
  dolbyVisionProfiles: [],
  audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false, adaptiveStreaming: true, dash: false, streamingProtocol: "hls",
};

/**
 * Quand une session de conversion a perdu son spectateur.
 *
 * Le créneau de conversion est une ressource rare — deux à la fois sur le NAS de référence. Une
 * session qui le retient sans que personne ne regarde fait refuser la lecture suivante, et le serveur
 * se met alors à refuser de démarrer à cause de ses propres échecs.
 */
describe("sessions abandonnées", () => {
  const DIX_MINUTES = 10 * 60_000;
  const maintenant = 1_000_000;

  it("laisse une lecture en cours se taire longtemps", () => {
    // En pause, tampon plein, un lecteur ne demande plus rien. Le brusquer couperait la conversion
    // d'un film qu'on regarde encore.
    expect(sessionAbandonnee({ status: "ready", lastAccess: maintenant - 5 * 60_000 }, maintenant, DIX_MINUTES))
      .toBe(false);
  });

  it("finit par rendre le créneau d'une lecture vraiment partie", () => {
    expect(sessionAbandonnee({ status: "ready", lastAccess: maintenant - DIX_MINUTES }, maintenant, DIX_MINUTES))
      .toBe(true);
  });

  it("rend vite le créneau d'une conversion qui n'a jamais démarré", () => {
    // Une session en préparation n'a pas de tampon à remplir : son client l'interroge sans relâche
    // puis abandonne au bout de trente secondes. Relevé sur Android — deux tentatives infructueuses
    // sur un film 4K suffisaient à faire répondre « limite de 2 conversions simultanées atteinte »
    // alors qu'aucune lecture n'était en cours.
    expect(sessionAbandonnee({ status: "starting", lastAccess: maintenant - DELAI_ABANDON_DEMARRAGE_MS },
      maintenant, DIX_MINUTES)).toBe(true);
  });

  it("laisse à une conversion le temps de démarrer", () => {
    // Le démarrage d'une conversion 4K prend plusieurs secondes, et le client interroge pendant ce
    // temps : la brusquer condamnerait précisément les lectures les plus longues à préparer.
    expect(sessionAbandonnee({ status: "starting", lastAccess: maintenant - 10_000 }, maintenant, DIX_MINUTES))
      .toBe(false);
  });
});

describe("négociation de lecture", () => {
  it("normalise les langues et les attributs de sous-titres externes", () => {
    expect(normalizeSubtitleLanguage("FRE")).toBe("fr");
    expect(normalizeSubtitleLanguage("pt_BR")).toBe("pt-BR");
    expect(normalizeSubtitleLanguage("und")).toBeNull();
    expect(parseExternalSubtitleName("Film (2024)", "Film (2024).fr-FR.forced.sdh.srt")).toMatchObject({
      language: "fr-FR", format: "srt", kind: "text", forced: true, hearingImpaired: true, canConvertToWebVtt: true,
    });
    expect(parseExternalSubtitleName("Film (2024)", "Film (2024).en.sup")).toMatchObject({
      language: "en", format: "pgs", kind: "image", canConvertToWebVtt: false,
    });
  });

  it("détecte UTF-8, UTF-16 et Windows-1252 sans corrompre les accents", () => {
    expect(detectSubtitleEncoding(new TextEncoder().encode("Français"))).toBe("utf-8");
    expect(detectSubtitleEncoding(Uint8Array.from([0xff, 0xfe, 0x46, 0x00]))).toBe("utf-16le");
    expect(detectSubtitleEncoding(Uint8Array.from([0x46, 0x72, 0x61, 0x6e, 0xe7, 0x61, 0x69, 0x73]))).toBe("windows-1252");
  });

  it("associe VobSub SUB/IDX sans afficher la piste binaire deux fois", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flixtunes-subtitles-"));
    try {
      const media = path.join(directory, "Episode S01E01.mkv");
      await Promise.all([
        writeFile(media, ""), writeFile(path.join(directory, "Episode S01E01.fr.srt"), "1\n00:00:00,000 --> 00:00:01,000\nBonjour\n"),
        writeFile(path.join(directory, "Episode S01E01.en.idx"), "# VobSub index file"),
        writeFile(path.join(directory, "Episode S01E01.en.sub"), Uint8Array.from([0, 1, 2, 3])),
      ]);
      const subtitles = await findExternalSubtitles(media);
      expect(subtitles).toHaveLength(2);
      expect(subtitles.find((subtitle) => subtitle.format === "vobsub")).toMatchObject({ kind: "image", language: "en" });
      expect(subtitles.find((subtitle) => subtitle.format === "srt")).toMatchObject({ kind: "text", language: "fr", encoding: "utf-8" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each([
    ["srt", "1\n00:00:00,000 --> 00:00:01,000\nBonjour", "00:00:01.500 --> 00:00:02.500"],
    ["sbv", "0:00:00.000,0:00:01.000\nBonjour", "00:00:01.500 --> 00:00:02.500"],
    ["sub", "{0}{25}Bonjour|Monde", "00:00:01.500 --> 00:00:02.500"],
    ["mpl2", "[0][10]Bonjour|Monde", "00:00:01.500 --> 00:00:02.500"],
    ["ttml", '<tt><body><p begin="0s" end="1s">Bonjour<br/>Monde</p></body></tt>', "00:00:01.500 --> 00:00:02.500"],
    ["smi", '<SAMI><BODY><SYNC Start=0><P>Bonjour<br>Monde<SYNC Start=1000><P>&nbsp;</BODY></SAMI>', "00:00:01.500 --> 00:00:02.500"],
  ])("convertit réellement %s en WebVTT avec synchronisation", (format, source, timing) => {
    const result = convertTextSubtitleToWebVtt(format, source, 1.5);
    expect(result).toContain("WEBVTT");
    expect(result).toContain(timing);
    expect(result).toContain("Bonjour");
  });

  it("construit une matrice vérifiable depuis les sorties FFmpeg", () => {
    const decoders = parseFfmpegComponentList(" V....D h264 H.264\n A....D eac3 ATSC A/52B\n A....D aac AAC\n S..... hdmv_pgs_subtitle PGS");
    const encoders = parseFfmpegComponentList(" V....D libx264 H.264\n A....D aac AAC");
    expect(parseFfmpegComponentList(" .. scale V->V Scale\n TS. subtitles V->V Render").has("scale")).toBe(true);
    const formats = parseFfmpegFormats(" DE mov,mp4,m4a QuickTime\n D  matroska,webm Matroska\n  E hls Apple HLS");
    expect([...decoders]).toEqual(expect.arrayContaining(["h264", "eac3", "aac", "hdmv_pgs_subtitle"]));
    expect(formats.demuxers.has("matroska")).toBe(true);
    expect(formats.muxers.has("hls")).toBe(true);
    const matrix = buildCompatibilityMatrix({ version: "ffmpeg 8.1", decoders, encoders, demuxers: formats.demuxers,
      muxers: formats.muxers, hwaccels: new Set(), filters: new Set(["scale", "overlay", "subtitles", "tonemap"]) });
    expect(matrix.audio.find((item) => item.id === "eac3")?.available).toBe(true);
    expect(matrix.processing.find((item) => item.id === "hls-output")?.available).toBe(true);
    expect(matrix.missingCritical).toEqual([]);
  });

  it("signale précisément un moteur multimédia incomplet", () => {
    const matrix = buildCompatibilityMatrix({ version: "ffmpeg minimal", decoders: new Set(["h264"]), encoders: new Set(),
      demuxers: new Set(), muxers: new Set(), hwaccels: new Set(), filters: new Set() });
    expect(matrix.healthy).toBe(false);
    expect(matrix.missingCritical).toEqual(expect.arrayContaining(["AAC", "Dolby Digital Plus / E-AC-3", "Sortie H.264", "Sortie HLS"]));
  });
  it("choisit la lecture directe quand tout est compatible", () => {
    expect(decidePlayback(baseInfo, capabilities)).toMatchObject({ mode: "direct", video: { index: 0 }, audio: { index: 1 } });
  });

  it("lit directement une piste secondaire compatible sans remux inutile", () => {
    expect(decidePlayback(baseInfo, { ...capabilities, audioStreamIndex: 2, audioCodecs: ["aac", "dts"] })).toMatchObject({ mode: "direct", audio: { index: 2 } });
  });

  it("remuxe et stabilise une piste secondaire quand le navigateur ne peut pas l'imposer en Direct Play", () => {
    const drama: PlaybackInfo = {
      ...baseInfo,
      container: "matroska",
      streams: [baseInfo.streams[0]!,
        { ...baseInfo.streams[1]!, index: 1, language: "eng", isDefault: false, audioRole: "original" },
        { ...baseInfo.streams[1]!, index: 2, language: "fre", isDefault: true, audioRole: "dub" }],
    };
    const navigateur = { ...capabilities, containers: ["matroska" as const], audioStreamIndex: 2,
      directAudioStreamSelection: false };
    const decision = decidePlayback(drama, navigateur, { autoriserEssaiDirect: true });
    expect(decision).toMatchObject({
      mode: "remux", audio: { index: 2 }, transcodeVideo: false, transcodeAudio: true,
    });
    expect(canCopySelectedAudio(decision.audio, navigateur, decision.transcodeAudio)).toBe(false);
    expect(selectAudioOutputEncoder(navigateur, false, new Set(["aac"]))).toBe("aac");
  });

  it("sélectionne la langue demandée sans choisir commentaire ou audiodescription par accident", () => {
    const streams = [
      { ...baseInfo.streams[1]!, index: 10, language: "eng", isDefault: true, audioRole: "commentary" as const },
      { ...baseInfo.streams[1]!, index: 11, language: "fra", isDefault: false, audioRole: "main" as const },
      { ...baseInfo.streams[1]!, index: 12, language: "eng", isDefault: false, audioRole: "original" as const },
    ];
    expect(selectPreferredAudioStream(streams, ["fr", "en"])?.index).toBe(11);
    expect(selectPreferredAudioStream(streams, ["original", "fr"])?.index).toBe(12);
    expect(selectPreferredAudioStream(streams, ["commentary"])?.index).toBe(10);
  });

  it("convertit seulement l'audio pour normalisation, mode nuit ou codec demandé", () => {
    expect(decidePlayback(baseInfo, { ...capabilities, audioNormalization: true })).toMatchObject({ mode: "remux", transcodeVideo: false, transcodeAudio: true });
    expect(selectAudioOutputEncoder({ ...capabilities, audioOutputMode: "ac3" }, true, new Set(["aac", "ac3"]))).toBe("ac3");
    expect(selectAudioOutputEncoder({ ...capabilities, audioOutputMode: "opus", hlsSegmentContainer: "mpegts" }, true, new Set(["aac", "libopus"]))).toBe("aac");
    expect(audioFilterChain({ ...capabilities, audioNormalization: true, nightMode: true }, 8, 6).join(","))
      .toMatch(/acompressor=.*loudnorm=.*alimiter=/);
  });

  it("n'impose plus de transcodage sur une estimation de bande passante", () => {
    // Ce cas disait l'inverse, et l'inverse fermait un cercle. `networkMbps` est relevé par hls.js
    // pendant la session en cours : pendant une conversion il mesure la vitesse de l'encodeur, non
    // celle du réseau. Le verdict entrant dans `videoCompatible`, il écartait le remux — qui copie
    // l'image — au profit d'un transcodage complet, confiant au NAS le travail le plus lourd à cause
    // d'une estimation que ce même travail avait faussée.
    const highBitrate = { ...baseInfo, overallBitRate: 50_000_000 };
    expect(decidePlayback(highBitrate, { ...capabilities, networkMbps: 10 }).mode).toBe("direct");
  });

  it("respecte en revanche le plafond posé après des coupures constatées", () => {
    // Celui-là ne s'établit qu'après deux interruptions réelles pendant une lecture réelle : il
    // consigne un fait, et le refuser reviendrait à ignorer ce que le lecteur vient de mesurer.
    const lourd = { ...baseInfo, streams: baseInfo.streams.map((flux) =>
      flux.type === "video" ? { ...flux, bitRate: 50_000_000 } : flux) };
    expect(decidePlayback(lourd, { ...capabilities, maxVideoBitrate: 8_000_000 })).toMatchObject({
      mode: "transcode", reasons: expect.arrayContaining(["Débit au-dessus du plafond posé après des coupures"]),
    });
  });

  it("transcode un codec vidéo non pris en charge", () => {
    const hevcInfo = { ...baseInfo, streams: baseInfo.streams.map((stream) => stream.type === "video" ? { ...stream, codec: "hevc" } : stream) };
    expect(decidePlayback(hevcInfo, capabilities).mode).toBe("transcode");
  });

  it("respecte les modes direct forcé et compatible choisis par l'utilisateur", () => {
    const incompatible = { ...baseInfo, container: "matroska", streams: baseInfo.streams.map((stream) =>
      stream.type === "audio" ? { ...stream, codec: "eac3" } : stream) };
    expect(decidePlayback(incompatible, { ...capabilities, modePreference: "direct" })).toMatchObject({
      mode: "direct", reason: "Lecture directe demandée par l'utilisateur",
    });
    expect(decidePlayback(baseInfo, { ...capabilities, modePreference: "compatible" })).toMatchObject({
      mode: "transcode", transcodeVideo: true,
    });
  });

  /**
   * Le branchement de l'essai de lecture directe.
   *
   * La règle elle-même — ce qui se parie et ce qui ne se parie jamais — est éprouvée dans
   * `essai-direct.test.ts`. Ce qui se joue ici est son câblage : au bon endroit de la cascade, et
   * seulement là où on l'autorise.
   */
  /**
   * Le branchement de la lecture directe par défaut.
   *
   * La règle elle-même — le petit nombre de cas qui refusent encore — est éprouvée dans
   * `essai-direct.test.ts`. Ce qui se joue ici est son câblage : au bon endroit de la cascade, et
   * seulement là où on l'autorise.
   */
  describe("lecture directe tentée d'abord", () => {
    const mkv: PlaybackInfo = { ...baseInfo, container: "matroska" };

    it("sert directement un conteneur que le client ne déclare pas", () => {
      // Le cas le plus fréquent : image et son conviennent, seul le conteneur bloque. Sans essai,
      // chaque MKV impose au NAS d'écrire un remux — pour une source 4K, des dizaines de gigaoctets.
      expect(decidePlayback(mkv, capabilities, { autoriserEssaiDirect: true })).toMatchObject({
        mode: "direct", reason: "Lecture directe tentée d'abord", transcodeVideo: false, transcodeAudio: false,
      });
    });

    it("place l'essai avant le remux, sans quoi il ne servirait à rien", () => {
      // Un conteneur seul en cause mène au remux, pas au transcodage : un essai placé après ne serait
      // jamais atteint dans le cas même qui l'a motivé.
      expect(decidePlayback(mkv, capabilities).mode).toBe("remux");
    });

    it("reste hors du chemin de session, qui n'autorise rien", () => {
      // `startFfmpegSession` recalcule la décision pour bâtir sa ligne de commande. Si « direct » en
      // sortait, aucune branche ne poserait `-c:v copy` ni ne choisirait d'encodeur, et ffmpeg
      // réencoderait au hasard de ses défauts.
      expect(decidePlayback(mkv, capabilities, {}).mode).toBe("remux");
      expect(decidePlayback(mkv, capabilities, { autoriserEssaiDirect: false }).mode).toBe("remux");
    });

    it("sert directement une piste à plus de canaux que la sortie", () => {
      // `maxAudioChannels` décrit la sortie de l'appareil, pas son décodeur : le lecteur mixe lui-même
      // vers la stéréo, comme le ferait le serveur. Ce refus envoyait en conversion tous les films
      // dont la piste principale est en 5.1 ou 7.1 — relevé sur un fichier huit canaux.
      const huitCanaux: PlaybackInfo = { ...mkv, streams: mkv.streams.map((flux) =>
        flux.type === "audio" && flux.index === 1 ? { ...flux, channels: 8 } : flux) };
      const sortieStereo = { ...capabilities, maxAudioChannels: 2 };
      expect(decidePlayback(huitCanaux, sortieStereo, { autoriserEssaiDirect: true }).mode).toBe("direct");
    });

    it("s'en tient au remux quand le son ne sortirait pas", () => {
      // Un film muet ne lève aucune erreur et n'use aucun compteur : c'est le seul échec qui échappe
      // aux trois signaux sur lesquels repose la règle. Le remux le corrige sans toucher à l'image.
      const audioMuet: PlaybackInfo = { ...mkv, streams: mkv.streams.map((flux) =>
        flux.type === "audio" && flux.index === 1 ? { ...flux, codec: "eac3" } : flux) };
      expect(decidePlayback(audioMuet, capabilities, { autoriserEssaiDirect: true }).mode).toBe("remux");
    });

    it("ne retente pas un codec déjà mis en quarantaine sur cet appareil", () => {
      // `withoutQuarantined` a retiré le codec défaillant des capacités, ce qui le fait justement
      // ressembler à un codec « non déclaré ». Sans la liste brute passée à part, l'essai se
      // répéterait à chaque lecture.
      expect(decidePlayback(mkv, capabilities, { autoriserEssaiDirect: true, codecsEnQuarantaine: ["h264"] }).mode)
        .not.toBe("direct");
    });

    it("passe outre l'estimation de bande passante, quelle qu'elle soit", () => {
      // Le coussin de vingt pour cent refusait un fichier de 26,5 Mb/s sur un chemin mesuré à 29,4,
      // qui le porte pourtant. Et cette mesure est relevée pendant la session en cours : pendant une
      // conversion, elle mesure l'encodeur, si bien que le refus se nourrissait de ce qu'il causait.
      const lourd = { ...mkv, overallBitRate: 26_500_000 };
      for (const networkMbps of [29.4, 10, 2]) {
        expect(decidePlayback(lourd, { ...capabilities, networkMbps }, { autoriserEssaiDirect: true }).mode,
          `${networkMbps} Mb/s annoncés`).toBe("direct");
      }
    });

    it("respecte le plafond que le client s'impose après des coupures", () => {
      // Celui-là ne consigne pas une prudence mais des coupures constatées : on ne parie pas contre.
      const lourd = { ...mkv, overallBitRate: 26_500_000, streams: mkv.streams.map((flux) =>
        flux.type === "video" ? { ...flux, bitRate: 26_500_000 } : flux) };
      expect(decidePlayback(lourd, { ...capabilities, networkMbps: 100, maxVideoBitrate: 8_000_000 },
        { autoriserEssaiDirect: true }).mode).not.toBe("direct");
    });
  });

  it("transcode pour incruster une piste de sous-titres demandée", () => {
    expect(decidePlayback(baseInfo, { ...capabilities, subtitleStreamIndex: 3, burnSubtitles: true })).toMatchObject({
      mode: "transcode", subtitle: { index: 3 },
    });
  });

  it("convertit Dolby Vision vers SDR si le client ne l'annonce pas", () => {
    const dolbyVisionInfo = { ...baseInfo, streams: baseInfo.streams.map((stream) => stream.type === "video"
      ? { ...stream, codec: "hevc", hdr: true, hdrFormat: "dolbyvision" as const, dolbyVisionProfile: 8 }
      : stream) };
    expect(decidePlayback(dolbyVisionInfo, { ...capabilities, videoCodecs: ["hevc"] })).toMatchObject({ mode: "transcode", toneMap: true });
    expect(decidePlayback(dolbyVisionInfo, { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["dolbyvision"] })).toMatchObject({ mode: "direct", toneMap: false });
  });

  it("respecte les profils Dolby Vision et construit une sortie SDR BT.709", () => {
    const dolbyVisionInfo = { ...baseInfo, streams: baseInfo.streams.map((stream) => stream.type === "video"
      ? { ...stream, codec: "hevc", hdr: true, hdrFormat: "dolbyvision" as const, dolbyVisionProfile: 5 }
      : stream) };
    expect(decidePlayback(dolbyVisionInfo, { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["dolbyvision"], dolbyVisionProfiles: [7, 8] })).toMatchObject({ mode: "transcode", toneMap: true });
    expect(toneMappingFilters("zscale", 1000).join(",")).toContain("transfer=bt709");
  });

  it("étiquette le remux Dolby Vision en dvh1 pour déclencher la dalle DV", () => {
    const dolby = baseInfo.streams[0] as MediaStream;
    const video = { ...dolby, codec: "hevc", hdr: true, hdrFormat: "dolbyvision" as const, dolbyVisionProfile: 8 };
    expect(remuxVideoTag(video)).toBe("dvh1");
    // `-strict unofficial` autorise réellement FFmpeg à écrire dvcC/dvvC. Sans lui, le tag semble
    // correct dans ffprobe mais Media3 ne reçoit que la couche HDR10/HDR10+.
    expect(remuxVideoArguments(video)).toEqual(["-tag:v", "dvh1", "-strict", "unofficial"]);
    expect(remuxVideoArguments({ ...video, availableHdrFormats: ["dolbyvision", "hdr10plus"] }, "hdr10plus"))
      .toEqual(["-tag:v", "hvc1"]);
    expect(remuxVideoTag({ ...dolby, codec: "hevc", hdr: true, hdrFormat: "hdr10plus" })).toBeNull();
    expect(remuxVideoArguments({ ...dolby, codec: "hevc", hdr: true, hdrFormat: "hdr10plus" })).toEqual([]);
  });

  it("bascule un master hybride Dolby Vision et HDR10+ par simple remux", () => {
    const hybridInfo: PlaybackInfo = { ...baseInfo, container: "matroska", streams: baseInfo.streams.map((stream) => stream.type === "video"
      ? { ...stream, codec: "hevc", hdr: true, hdrFormat: "dolbyvision" as const, dolbyVisionProfile: 8,
        availableHdrFormats: ["dolbyvision" as const, "hdr10plus" as const] }
      : stream) };
    const hybridCapabilities = { ...capabilities, containers: ["matroska" as const, "mp4" as const], videoCodecs: ["hevc"],
      hdrFormats: ["dolbyvision" as const, "hdr10plus" as const, "hdr10" as const], dolbyVisionProfiles: [8] };
    expect(hdrDeliveryFormat(hybridInfo.streams[0], { ...hybridCapabilities, dynamicRangePreference: "dolbyvision" }))
      .toMatchObject({ format: "dolbyvision", viaBaseLayer: false });
    expect(hdrDeliveryFormat(hybridInfo.streams[0], { ...hybridCapabilities, dynamicRangePreference: "hdr10plus" }))
      .toMatchObject({ format: "hdr10plus", viaBaseLayer: true });
    expect(decidePlayback(hybridInfo, { ...hybridCapabilities, dynamicRangePreference: "hdr10plus" }))
      .toMatchObject({ mode: "remux", video: { hdrFormat: "dolbyvision" } });
  });

  it("convertit une piste Dolby Atmos si le client ne sait pas la restituer", () => {
    const atmosInfo = { ...baseInfo, streams: baseInfo.streams.map((stream) => stream.index === 1
      ? { ...stream, codec: "eac3", dolbyAtmos: true }
      : stream) };
    expect(decidePlayback(atmosInfo, { ...capabilities, audioCodecs: ["eac3"], dolbyAtmos: false }).mode).toBe("remux");
  });

  it("conserve l'audio immersif compatible en lecture directe", () => {
    const atmosInfo = { ...baseInfo, streams: baseInfo.streams.map((stream) => stream.index === 1
      ? { ...stream, codec: "eac3", channels: 6, dolbyAtmos: true, audioTechnology: "dolby-atmos" as const }
      : stream) };
    expect(decidePlayback(atmosInfo, { ...capabilities, audioCodecs: ["eac3"], dolbyAtmos: true,
      immersiveAudioFormats: ["dolby-atmos"], maxAudioChannels: 8 })).toMatchObject({ mode: "direct", transcodeAudio: false });
  });

  it("adapte la définition au débit réseau sans dépasser l'écran", () => {
    expect(selectAdaptiveProfile({ ...capabilities, networkMbps: 7 }, 3840, 2160)).toMatchObject({ width: 1280, height: 720 });
    expect(selectAdaptiveProfile({ ...capabilities, networkMbps: 100, maxWidth: 1920 }, 3840, 2160)).toMatchObject({ width: 1920, height: 1080 });
  });

  it("construit une échelle ABR bornée par la source et le réseau", () => {
    const ladder = selectAdaptiveLadder({ ...capabilities, networkMbps: 20, maxWidth: 1920, maxHeight: 1080 }, 1920, 1080);
    expect(ladder.map((profile) => profile.height)).toEqual([1080, 720, 480, 360]);
    expect(ladder.every((profile, index) => index === 0 || profile.videoBitrate < ladder[index - 1]!.videoBitrate)).toBe(true);
    expect(selectAdaptiveLadder({ ...capabilities, networkMbps: 2 }, 3840, 2160)[0]).toMatchObject({ height: 360 });
    expect([100, 40, 15, 5].map((networkMbps) => selectAdaptiveLadder({ ...capabilities, networkMbps }, 3840, 2160)[0]!.height))
      .toEqual([2160, 2160, 1080, 480]);
  });

  it("force des dimensions paires après conservation du ratio cinémascope", () => {
    expect(transcodeScaleFilter(1280, 720, true)).toContain("force_divisible_by=2");
    expect(transcodeScaleFilter(3840, 1604, false)).toContain("trunc(ih/2)*2");
  });

  it("sélectionne VAAPI automatiquement sur un NAS compatible", () => {
    const selected = selectVideoEncoder({ encoders: new Set(["h264_vaapi", "libx264"]), hwaccels: new Set(["vaapi"]) }, "auto");
    expect(selected.encoder).toBe("h264_vaapi");
    expect(selectVideoEncoder({ encoders: new Set(["h264_vaapi", "libx264"]), hwaccels: new Set(["vaapi"]) }, "auto", true).encoder).toBe("libx264");
  });

  it("ne transmet pas les journaux FFmpeg bruts à l'utilisateur", () => {
    expect(friendlyTranscodeError("height not divisible by 2 (1280x535)")).toContain("géométrie");
    expect(friendlyTranscodeError("No space left on device")).toContain("espace libre");
    expect(friendlyTranscodeError("Decoding requested, but no decoder found for: eac3")).toContain("FFmpeg intégré");
    expect(friendlyTranscodeError("[libx264] unknown failure")).not.toContain("libx264");
  });
});

const fullEngine = {
  filters: new Set(["zscale", "tonemap", "libplacebo", "bwdif", "yadif", "scale", "tonemap_vaapi", "tonemap_opencl"]),
  hwaccels: new Set(["vulkan", "vaapi", "opencl", "cuda"]),
  encoders: new Set(["libx264", "libx265"]),
};
const softwareEngine = { filters: new Set(["zscale", "tonemap", "scale"]), hwaccels: new Set<string>(), encoders: new Set(["libx264"]) };

function videoStream(color: Partial<VideoColorMetadata>, hdrFormat: MediaStream["hdrFormat"] = "hdr10"): MediaStream {
  return {
    index: 0, type: "video", codec: "hevc", title: null, language: null, channels: null, width: 3840, height: 2160,
    hdr: hdrFormat !== "sdr", hdrFormat, dolbyVisionProfile: color.dolbyVisionProfile ?? null, dolbyAtmos: false,
    isDefault: true, isForced: false, canExtractAsWebVtt: false, bitDepth: 10, frameRate: 24,
    color: {
      colorSpace: "bt2020nc", colorPrimaries: "bt2020", colorTransfer: "smpte2084", colorRange: "tv",
      chromaLocation: "left", chromaSubsampling: "4:2:0", bitDepth: 10, masteringDisplay: null,
      maxContentLightLevel: null, maxFrameAverageLightLevel: null, rotationDegrees: 0, interlaced: false,
      fieldOrder: "progressive", dolbyVisionProfile: null, dolbyVisionLevel: null, dolbyVisionRpuPresent: false,
      dolbyVisionElPresent: false, dolbyVisionBlPresent: false, dolbyVisionBlCompatibilityId: null, ...color,
    },
  };
}

describe("chaîne colorimétrique HDR", () => {
  it("identifie la couche de base rétrocompatible selon le profil Dolby Vision", () => {
    expect(dolbyVisionBaseLayer(videoStream({ dolbyVisionProfile: 8, dolbyVisionBlCompatibilityId: 1 }).color)).toBe("hdr10");
    expect(dolbyVisionBaseLayer(videoStream({ dolbyVisionProfile: 8, dolbyVisionBlCompatibilityId: 4 }).color)).toBe("hlg");
    expect(dolbyVisionBaseLayer(videoStream({ dolbyVisionProfile: 7 }).color)).toBe("hdr10");
    expect(dolbyVisionBaseLayer(videoStream({ dolbyVisionProfile: 5 }).color)).toBeNull();
  });

  it("lit un Dolby Vision profil 8.1 en direct sur un téléviseur HDR10", () => {
    const video = videoStream({ dolbyVisionProfile: 8, dolbyVisionBlCompatibilityId: 1 }, "dolbyvision");
    const clientHdr10 = { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["hdr10" as const] };
    expect(hdrDeliveryFormat(video, clientHdr10)).toMatchObject({ format: "hdr10", compatible: true, viaBaseLayer: true });
    const plan = planColorPipeline(video, clientHdr10, fullEngine, "direct");
    expect(plan.action).toBe("hdr-base-layer");
    expect(plan.toneMapping).toBe("none");
    expect(plan.lossNotice).toContain("Dolby Vision");
    expect(plan.filters).toEqual([]);
  });

  it("convertit un profil 5 sans couche de base vers le SDR en annonçant la perte", () => {
    const video = videoStream({ dolbyVisionProfile: 5 }, "dolbyvision");
    const clientHdr10 = { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["hdr10" as const] };
    expect(hdrDeliveryFormat(video, clientHdr10).compatible).toBe(false);
    const plan = planColorPipeline(video, clientHdr10, fullEngine, "transcode");
    expect(plan).toMatchObject({ action: "hdr-to-sdr", outputFormat: "sdr", toneMapping: "libplacebo", toneMappingHardware: true });
    expect(plan.lossNotice).toContain("SDR");
    expect(plan.steps.some((step) => step.includes("Sous-titres"))).toBe(true);
  });

  it("accepte un HDR10+ sur un client HDR10 sans reconversion", () => {
    const video = videoStream({}, "hdr10plus");
    const plan = planColorPipeline(video, { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["hdr10"] }, fullEngine, "remux");
    expect(plan).toMatchObject({ action: "hdr-base-layer", outputFormat: "hdr10", preservesDynamicMetadata: false });
    expect(plan.lossNotice).toContain("métadonnées dynamiques");
  });

  it("honore une sortie manuelle disponible puis retombe sur l'ordre automatique", () => {
    const video = videoStream({ dolbyVisionProfile: 8, dolbyVisionBlCompatibilityId: 1 }, "dolbyvision");
    const client: PlaybackCapabilities = { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["dolbyvision", "hdr10"],
      dolbyVisionProfiles: [8] };
    expect(hdrDeliveryFormat(video, { ...client, dynamicRangePreference: "hdr10" })).toMatchObject({
      format: "hdr10", compatible: true, viaBaseLayer: true,
    });
    expect(hdrDeliveryFormat(video, { ...client, dynamicRangePreference: "hdr10plus" })).toMatchObject({
      format: "dolbyvision", compatible: true, viaBaseLayer: false,
    });
    expect(hdrDeliveryFormat(video, { ...client, dynamicRangePreference: "sdr" })).toMatchObject({
      format: "sdr", compatible: false,
    });
  });

  it("préfère libplacebo puis retombe sur zscale sans Vulkan", () => {
    expect(selectToneMappingBackend(fullEngine, "auto")).toMatchObject({ backend: "libplacebo", hardware: true });
    expect(selectToneMappingBackend(softwareEngine, "auto")).toMatchObject({ backend: "zscale", hardware: false });
    expect(selectToneMappingBackend(fullEngine, "auto", true)).toMatchObject({ backend: "zscale", hardware: false });
    // VA-API et OpenCL ne sont jamais choisis automatiquement : ils exigent une décision explicite.
    expect(selectToneMappingBackend(fullEngine, "vaapi")).toMatchObject({ backend: "vaapi" });
    expect(selectToneMappingBackend({ ...fullEngine, filters: new Set(["scale"]) }, "auto")).toMatchObject({ backend: "none" });
  });

  it("normalise le blanc de référence à 100 nits au lieu d'écraser l'image", () => {
    const filters = toneMappingFilters("zscale", 1000);
    expect(filters[0]).toBe("zscale=transfer=linear:npl=100");
    expect(filters.join(",")).toContain("tonemap=hable:desat=0:peak=10");
    expect(filters.join(",")).toContain("zscale=primaries=bt709");
    expect(filters.at(-1)).toBe("format=yuv420p");
  });

  it("déduit la luminance crête du mastering display puis du MaxCLL", () => {
    expect(sourcePeakLuminance(videoStream({ masteringDisplay: { redX: .68, redY: .32, greenX: .265, greenY: .69,
      blueX: .15, blueY: .06, whitePointX: .3127, whitePointY: .329, minLuminanceNits: 0.0001, maxLuminanceNits: 4000 } }))).toBe(4000);
    expect(sourcePeakLuminance(videoStream({ maxContentLightLevel: 600 }))).toBe(600);
    expect(sourcePeakLuminance(videoStream({}, "sdr"))).toBe(100);
  });

  it("désentrelace en conservant la cadence source", () => {
    const interlaced = videoStream({ interlaced: true, fieldOrder: "tt" }, "sdr");
    expect(deinterlaceFilters(interlaced, fullEngine)).toMatchObject({ mode: "bwdif" });
    expect(deinterlaceFilters(interlaced, fullEngine).filters[0]).toContain("send_frame");
    expect(deinterlaceFilters(interlaced, softwareEngine)).toMatchObject({ mode: "none" });
    expect(planColorPipeline(interlaced, capabilities, fullEngine, "transcode").filters[0]).toContain("bwdif");
  });

  it("échange largeur et hauteur quand le conteneur porte une rotation", () => {
    expect(orientedDimensions(videoStream({ rotationDegrees: 90 }))).toEqual({ width: 2160, height: 3840 });
    expect(orientedDimensions(videoStream({ rotationDegrees: 180 }))).toEqual({ width: 3840, height: 2160 });
  });

  it("réencode en HEVC 10 bits pour conserver HDR10 et réinjecte le mastering display", () => {
    const mastering = { redX: .68, redY: .32, greenX: .265, greenY: .69, blueX: .15, blueY: .06,
      whitePointX: .3127, whitePointY: .329, minLuminanceNits: 0.0001, maxLuminanceNits: 1000 };
    const video = videoStream({ masteringDisplay: mastering, maxContentLightLevel: 1000, maxFrameAverageLightLevel: 400 });
    const client = { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["hdr10" as const], maxWidth: 1920, maxHeight: 1080 };
    const plan = planColorPipeline(video, client, fullEngine, "transcode");
    expect(plan).toMatchObject({ action: "preserve", outputFormat: "hdr10", toneMapping: "none", preservesStaticMetadata: true });
    const args = hdrEncoderArguments("libx265", video, plan).join(" ");
    expect(args).toContain("hdr-opt=1");
    expect(args).toContain("master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)");
    expect(args).toContain("max-cll=1000,400");
    expect(args).toContain("yuv420p10le");
    expect(selectHdrVideoEncoder(softwareEngine, "auto")).toBeNull();
  });

  it("bascule en tone mapping SDR quand aucun encodeur HEVC n'existe", () => {
    const client = { ...capabilities, videoCodecs: ["hevc"], hdrFormats: ["hdr10" as const], maxWidth: 1920, maxHeight: 1080 };
    const plan = planColorPipeline(videoStream({}), client, softwareEngine, "transcode");
    expect(plan).toMatchObject({ action: "hdr-to-sdr", toneMapping: "zscale" });
  });

  it("laisse une source SDR intacte", () => {
    const plan = planColorPipeline(videoStream({ colorPrimaries: "bt709", colorTransfer: "bt709" }, "sdr"), capabilities, fullEngine, "transcode");
    expect(plan).toMatchObject({ action: "sdr-passthrough", toneMapping: "none", outputFormat: "sdr", lossNotice: null });
    expect(plan.filters).toEqual([]);
  });

  it("expose la chaîne HDR dans la matrice de diagnostic", () => {
    const matrix = buildCompatibilityMatrix({ version: "ffmpeg 8.1", encoders: fullEngine.encoders, decoders: new Set(["hevc"]),
      hwaccels: fullEngine.hwaccels, demuxers: new Set(["matroska"]), muxers: new Set(["hls"]), filters: fullEngine.filters });
    expect(matrix.colorPipelines?.find((item) => item.id === "tonemap-libplacebo")?.available).toBe(true);
    expect(matrix.colorPipelines?.find((item) => item.id === "hdr10-output")?.available).toBe(true);
  });
});

describe("sous-titres d'un flux qui ne commence pas au début", () => {
  const srt = [
    "1", "00:00:10,000 --> 00:00:12,000", "avant la reprise", "",
    "2", "00:08:05,000 --> 00:08:07,000", "à cheval sur la reprise", "",
    "3", "00:10:00,000 --> 00:10:02,000", "après la reprise", "",
  ].join("\n");

  it("ramène les sous-titres sur la ligne de temps du flux", () => {
    /*
     * Le défaut vu en service : une lecture reprise à huit minutes ouvre une session qui compte à
     * partir de zéro, mais les sous-titres portent les temps du film. Ils étaient chargés,
     * sélectionnés, et n'apparaissaient jamais — la balise vidéo en était à sa huitième seconde quand
     * eux visaient la huitième minute.
     */
    const vtt = convertTextSubtitleToWebVtt("srt", srt, -480);

    expect(vtt).toContain("00:02:00.000 --> 00:02:02.000");
    expect(vtt, "le sous-titre d'après la reprise est décalé, pas perdu").toContain("après la reprise");
  });

  it("écarte ce qui précède le début du flux au lieu de l'empiler sur la première seconde", () => {
    // `subtitleTimestamp` borne à zéro : sans ce tri, tous les sous-titres antérieurs se seraient
    // affichés d'un coup au démarrage.
    const vtt = convertTextSubtitleToWebVtt("srt", srt, -480);

    expect(vtt, "ce qui est déjà passé n'a plus lieu d'être").not.toContain("avant la reprise");
    expect(vtt?.match(/00:00:00\.000 --> 00:00:00\.000/g) ?? [], "aucun sous-titre de durée nulle").toEqual([]);
  });

  it("un sous-titre à cheval sur la reprise commence au début du flux", () => {
    const vtt = convertTextSubtitleToWebVtt("srt", srt, -486);

    expect(vtt).toContain("à cheval sur la reprise");
    expect(vtt, "il commence au début plutôt qu'à un temps négatif").toContain("00:00:00.000 --> 00:00:01.000");
  });

  it("le décalage réglé par la personne continue de fonctionner seul", () => {
    const vtt = convertTextSubtitleToWebVtt("srt", srt, 2);

    expect(vtt).toContain("00:00:12.000 --> 00:00:14.000");
    expect(vtt, "rien n'est écarté quand le flux commence au début").toContain("avant la reprise");
  });
});

