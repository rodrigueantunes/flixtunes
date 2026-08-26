import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../src/config.js";
import { db } from "../src/database.js";
import { probeMedia } from "../src/ffprobe.js";
import { getPlaybackInfo } from "../src/playback.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-codecs-"));
const libraryId = randomUUID();
const fixtures = [
  { name: "h264.mp4", encoder: ["-c:v", "libx264", "-preset", "ultrafast"], codec: "h264", container: "mp4" },
  { name: "hevc.mkv", encoder: ["-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error"], codec: "hevc", container: "matroska" },
  { name: "vp9.webm", encoder: ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"], codec: "vp9", container: "webm" },
  { name: "av1.mp4", encoder: ["-c:v", "libaom-av1", "-cpu-used", "8", "-row-mt", "1"], codec: "av1", container: "mp4" },
  { name: "transport.m2ts", encoder: ["-c:v", "libx264", "-preset", "ultrafast", "-f", "mpegts"], codec: "h264", container: "mpegts" },
] as const;

db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Codec audit', ?, 'movie', 'fr-FR')").run(libraryId, root);
try {
  for (const fixture of fixtures) {
    const filePath = path.join(root, fixture.name);
    await execFileAsync(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12", "-t", "0.5", "-an", ...fixture.encoder, filePath],
    { windowsHide: true, timeout: 90_000, maxBuffer: 2_000_000 });
    const probe = await probeMedia(filePath);
    assert(probe, `${fixture.name} doit être analysable`);
    assert.equal(probe.streams.find((stream) => stream.type === "video")?.codec, fixture.codec);
    const mediaId = randomUUID();
    db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, file_path, library_id, embedded_metadata_json, available)
      VALUES (?, 'movie', ?, ?, ?, ?, ?, 1)`).run(mediaId, fixture.name, fixture.name, filePath, libraryId, JSON.stringify(probe.raw));
    const info = await getPlaybackInfo(mediaId);
    assert.equal(info?.container, fixture.container);
  }
  console.log("Codec matrix OK: H.264, HEVC, VP9, AV1; MP4, MKV, WebM et M2TS.");
} finally {
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  await rm(root, { recursive: true, force: true });
}
