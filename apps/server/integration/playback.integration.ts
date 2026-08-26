import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PlaybackCapabilities, PlaybackSession } from "@flixtunes/contracts";
import { config } from "../src/config.js";
import { db } from "../src/database.js";
import { probeMedia } from "../src/ffprobe.js";
import { createPlaybackSession, extractExternalSubtitle, getPlaybackFile, getPlaybackInfo, getPlaybackSession, stopPlaybackSession } from "../src/playback.js";

const execFileAsync = promisify(execFile);
const mediaId = "ffmpeg-integration-media";
const eac3MediaId = "ffmpeg-integration-eac3";
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "flixtunes-playback-"));
const mediaPath = path.join(temporaryDirectory, "sample.mp4");
const eac3MediaPath = path.join(temporaryDirectory, "sample-eac3.mkv");

const capabilities: PlaybackCapabilities = {
  containers: ["mp4", "webm"], videoCodecs: ["h264"], audioCodecs: ["aac"], hls: true,
  maxWidth: 1920, maxHeight: 1080, hdr: false, hdrFormats: [], dolbyAtmos: false,
  dolbyVisionProfiles: [],
  immersiveAudioFormats: [], maxAudioChannels: 8, losslessAudio: false, maxVideoBitrate: null,
  audioStreamIndex: null, subtitleStreamIndex: null, burnSubtitles: false, adaptiveStreaming: true, dash: false, streamingProtocol: "hls",
};

async function waitUntilPrepared(session: PlaybackSession): Promise<PlaybackSession> {
  if (!session.id) return session;
  let current = session;
  for (let attempt = 0; attempt < 100 && current.status === "starting"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    current = await getPlaybackSession(session.id) ?? current;
  }
  return current;
}

async function playlistAudioCodec(session: PlaybackSession): Promise<string> {
  const manifest = session.id ? getPlaybackFile(session.id, "manifest.m3u8") : null;
  assert(manifest, "Le manifeste audio doit exister");
  const { stdout } = await execFileAsync(config.ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", manifest.path],
    { windowsHide: true, timeout: 30_000 });
  const codecs = (JSON.parse(stdout).streams as Array<{ codec_name?: string }>).map((stream) => stream.codec_name);
  return codecs.find((codec) => codec && codec !== "h264") ?? "";
}

try {
  await execFileAsync(config.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
    "-t", "4", "-map", "0:v", "-map", "1:a", "-map", "2:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-metadata:s:a:0", "language=fra", "-disposition:a:0", "default",
    "-metadata:s:a:1", "language=eng", mediaPath,
  ], { windowsHide: true, timeout: 60_000 });
  const metadata = await probeMedia(mediaPath);
  assert(metadata, "FFprobe doit analyser le média d'intégration");
  db.prepare(`
    INSERT OR REPLACE INTO media_items (
      id, kind, title, sort_title, file_path, runtime_seconds, file_size, file_modified_at,
      embedded_metadata_json, audio_languages, subtitle_languages, available
    ) VALUES (?, 'movie', 'Test FFmpeg', 'test ffmpeg', ?, ?, 1, 1, ?, ?, '[]', 1)
  `).run(mediaId, mediaPath, metadata.durationSeconds, JSON.stringify(metadata.raw), JSON.stringify(metadata.audioLanguages));
  config.hardwareAcceleration = "none";

  const direct = await createPlaybackSession(mediaId, capabilities);
  assert.equal(direct?.mode, "direct");
  assert.equal(direct?.status, "ready");

  const remux = await createPlaybackSession(mediaId, { ...capabilities, containers: ["webm"], audioStreamIndex: 2 });
  assert(remux, "La session de remux doit être créée");
  const remuxReady = await waitUntilPrepared(remux);
  assert.match(remuxReady.status, /ready|completed/, remuxReady.error ?? "Le remux doit être prêt");
  const manifest = getPlaybackFile(remuxReady.id!, "manifest.m3u8");
  const initialization = getPlaybackFile(remuxReady.id!, "init.mp4");
  const segment = getPlaybackFile(remuxReady.id!, "segment_00000.m4s");
  assert(manifest && initialization && segment);
  await Promise.all([access(manifest.path), access(initialization.path), access(segment.path)]);
  await stopPlaybackSession(remuxReady.id!);

  const mpegTs = await createPlaybackSession(mediaId, { ...capabilities, containers: ["webm"], audioStreamIndex: 2, hlsSegmentContainer: "mpegts" });
  assert(mpegTs, "La session MPEG-TS doit être créée");
  const mpegTsReady = await waitUntilPrepared(mpegTs);
  assert.equal(mpegTsReady.segmentContainer, "mpegts");
  const tsSegment = getPlaybackFile(mpegTsReady.id!, "segment_00000.ts");
  assert(tsSegment); await access(tsSegment.path); await stopPlaybackSession(mpegTsReady.id!);

  await writeFile(path.join(temporaryDirectory, "sample.fr.forced.srt"), "1\n00:00:00,000 --> 00:00:01,000\nBonjour FlixTunes\n");
  const playbackInfo = await getPlaybackInfo(mediaId);
  const external = playbackInfo?.externalSubtitles?.find((subtitle) => subtitle.format === "srt");
  assert(external?.forced && external.canConvertToWebVtt, "Le sous-titre SRT forcé doit être détecté");
  const webVtt = await extractExternalSubtitle(mediaId, external.id);
  assert(webVtt); await access(webVtt.path);
  const shiftedWebVtt = await extractExternalSubtitle(mediaId, external.id, 1.5);
  assert(shiftedWebVtt);
  assert.match(await readFile(shiftedWebVtt.path, "utf8"), /00:00:01\.500\s+-->\s+00:00:02\.500/,
    "Le décalage positif doit être appliqué aux horodatages WebVTT");
  await writeFile(path.join(temporaryDirectory, "sample.fr.sdh.srt"), Uint8Array.from([
    0x31, 0x0d, 0x0a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x2c, 0x30, 0x30, 0x30, 0x20,
    0x2d, 0x2d, 0x3e, 0x20, 0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30, 0x30, 0x0d,
    0x0a, 0x46, 0x72, 0x61, 0x6e, 0xe7, 0x61, 0x69, 0x73, 0x0d, 0x0a,
  ]));
  const encodedInfo = await getPlaybackInfo(mediaId);
  const legacy = encodedInfo?.externalSubtitles?.find((subtitle) => subtitle.hearingImpaired);
  assert.equal(legacy?.encoding, "windows-1252");
  const convertedLegacy = legacy ? await extractExternalSubtitle(mediaId, legacy.id) : null;
  assert(convertedLegacy);
  assert.match(await readFile(convertedLegacy.path, "utf8"), /Français/, "Les accents Windows-1252 doivent rester intacts");

  const transcode = await createPlaybackSession(mediaId, { ...capabilities, videoCodecs: [] });
  assert(transcode, "La session de transcodage doit être créée");
  const transcodeReady = await waitUntilPrepared(transcode);
  assert.equal(transcodeReady.mode, "transcode");
  assert.equal(transcodeReady.videoEncoder, "libx264");
  assert.match(transcodeReady.status, /ready|completed/, transcodeReady.error ?? "Le transcodage doit être prêt");
  assert.equal(transcodeReady.variants?.length, 3, "La session de transcodage doit publier trois variantes ABR");
  const master = getPlaybackFile(transcodeReady.id!, "manifest.m3u8"); assert(master);
  assert.match(await readFile(master.path, "utf8"), /EXT-X-STREAM-INF/, "Le manifeste maître ABR doit publier les variantes");
  const shared = await createPlaybackSession(mediaId, { ...capabilities, videoCodecs: [] });
  assert.equal(shared?.id, transcodeReady.id, "Deux clients identiques doivent partager le cache de segments ABR");
  await stopPlaybackSession(shared!.id!);
  assert(await getPlaybackSession(transcodeReady.id!), "La session partagée doit survivre au départ d'un client");
  await stopPlaybackSession(transcodeReady.id!);

  const dash = await createPlaybackSession(mediaId, { ...capabilities, videoCodecs: [], dash: true, streamingProtocol: "dash" });
  assert(dash); const dashReady = await waitUntilPrepared(dash);
  assert.match(dashReady.status, /ready|completed/, dashReady.error ?? "Le manifeste DASH doit être prêt");
  assert.equal(dashReady.protocol, "dash"); const mpd = getPlaybackFile(dashReady.id!, "manifest.mpd"); assert(mpd);
  assert.match(await readFile(mpd.path, "utf8"), /<MPD/, "Le manifeste DASH doit être valide"); await stopPlaybackSession(dashReady.id!);

  const normalized = await createPlaybackSession(mediaId, { ...capabilities, audioNormalization: true, nightMode: true, hlsSegmentContainer: "mpegts" });
  assert(normalized);
  const normalizedReady = await waitUntilPrepared(normalized);
  assert.match(normalizedReady.status, /ready|completed/, normalizedReady.error ?? "La normalisation EBU R128 doit fonctionner");
  assert.equal(normalizedReady.mode, "remux"); assert.equal(normalizedReady.audioEncoder, "aac");
  assert.equal(await playlistAudioCodec(normalizedReady), "aac"); await stopPlaybackSession(normalizedReady.id!);

  const ac3 = await createPlaybackSession(mediaId, { ...capabilities, audioOutputMode: "ac3", hlsSegmentContainer: "mpegts" });
  assert(ac3);
  const ac3Ready = await waitUntilPrepared(ac3);
  assert.match(ac3Ready.status, /ready|completed/, ac3Ready.error ?? "La conversion AC-3 doit fonctionner");
  assert.equal(ac3Ready.audioEncoder, "ac3"); assert.equal(await playlistAudioCodec(ac3Ready), "ac3");
  await stopPlaybackSession(ac3Ready.id!);

  const opus = await createPlaybackSession(mediaId, { ...capabilities, audioOutputMode: "opus", hlsSegmentContainer: "fmp4" });
  assert(opus);
  const opusReady = await waitUntilPrepared(opus);
  assert.match(opusReady.status, /ready|completed/, opusReady.error ?? "La conversion Opus doit fonctionner");
  assert.equal(opusReady.audioEncoder, "libopus"); assert.equal(await playlistAudioCodec(opusReady), "opus");
  await stopPlaybackSession(opusReady.id!);

  await execFileAsync(config.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "eac3", eac3MediaPath,
  ], { windowsHide: true, timeout: 60_000 });
  const eac3Metadata = await probeMedia(eac3MediaPath);
  assert.equal(eac3Metadata?.streams.find((stream) => stream.type === "audio")?.codec, "eac3");
  db.prepare(`INSERT OR REPLACE INTO media_items (
    id, kind, title, sort_title, file_path, runtime_seconds, file_size, file_modified_at,
    embedded_metadata_json, audio_languages, subtitle_languages, available
  ) VALUES (?, 'movie', 'Test E-AC-3', 'test eac3', ?, ?, 1, 1, ?, ?, '[]', 1)`)
    .run(eac3MediaId, eac3MediaPath, eac3Metadata?.durationSeconds, JSON.stringify(eac3Metadata?.raw ?? {}), JSON.stringify(eac3Metadata?.audioLanguages ?? []));
  const eac3Session = await createPlaybackSession(eac3MediaId, { ...capabilities, videoCodecs: [], audioCodecs: ["aac"], hlsSegmentContainer: "mpegts" });
  assert(eac3Session, "La session MKV/E-AC-3 compatible doit être créée");
  const eac3Ready = await waitUntilPrepared(eac3Session);
  assert.match(eac3Ready.status, /ready|completed/, eac3Ready.error ?? "Le décodage E-AC-3 doit fonctionner");
  await stopPlaybackSession(eac3Ready.id!);
  console.log("FFmpeg integration: Direct Play, HLS ABR fMP4/MPEG-TS, DASH, partage de session, AAC/AC-3/Opus, EBU R128/mode nuit, E-AC-3, WebVTT et transcodage validés.");
} finally {
  db.prepare("DELETE FROM media_items WHERE id IN (?, ?)").run(mediaId, eac3MediaId);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
