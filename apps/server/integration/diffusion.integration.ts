/** Banc réel de préparation Cast : FFmpeg, manifeste HTTP, segments et décodage.
 * Facultatif : chemin d'un fichier local à échantillonner (8 s à partir de 108 s).
 * Toutes les données et conversions sont isolées dans un répertoire temporaire. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Fastify from "fastify";

const exec = promisify(execFile);
const dossier = await mkdtemp(path.join(tmpdir(), "flixtunes-cast-test-"));
process.env.FLIXTUNES_DATA_DIR = path.join(dossier, "data");
process.env.FLIXTUNES_HW_ACCEL = "software";
process.env.FLIXTUNES_TONEMAP = "software";
const [{ config }, { db, getDefaultProfile }, { probeMedia }, { MediasDiffusion }] = await Promise.all([
  import("../src/config.js"), import("../src/database.js"), import("../src/ffprobe.js"), import("../src/diffusion-medias.js"),
]);
const medias = new MediasDiffusion(), app = Fastify();
app.get<{ Params: { cle: string; nom: string } }>("/api/diffusion/flux/:cle/:nom", (req, reply) => medias.servir(req.params.cle, req.params.nom, req, reply));
try {
  const origine = await app.listen({ host: "127.0.0.1", port: 0 });
  const profil = getDefaultProfile().id, sd = path.join(dossier, "sd.mp4"), hdr = path.join(dossier, "hdr.mkv");
  await exec(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=sample_rate=48000",
    "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", sd], { windowsHide: true, timeout: 60_000 });
  if (process.argv[2]) {
    await exec(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "108", "-i", process.argv[2],
      "-t", "8", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", hdr], { windowsHide: true, timeout: 90_000 });
  } else {
    await exec(config.ffmpegPath, ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=24", "-f", "lavfi", "-i", "sine=sample_rate=48000",
      "-t", "4", "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le",
      "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-c:a", "eac3", hdr],
    { windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 });
  }
  db.prepare("INSERT INTO library_folders (id,path,kind) VALUES ('banc-cast',?,'movie')").run(dossier);
  for (const [id, fichier] of [["cast-sd", sd], ["cast-hdr", hdr]]) {
    const info = await probeMedia(fichier!); assert(info);
    db.prepare(`INSERT INTO media_items (id,library_id,kind,title,sort_title,file_path,runtime_seconds,file_size,file_modified_at,
      embedded_metadata_json,audio_languages,subtitle_languages,available)
      VALUES (?, 'banc-cast', 'movie', 'Banc Cast', 'banc cast', ?, ?, 1, 1, ?, ?, '[]', 1)`)
      .run(id!, fichier!, info.durationSeconds, JSON.stringify(info.raw), JSON.stringify(info.audioLanguages));
  }
  for (const [id, compatible, qualiteSource] of [["cast-sd", false, false], ["cast-hdr", false, true], ["cast-hdr", false, false], ["cast-hdr", true, false]] as const) {
    const debut = Date.now();
    const m = await medias.preparer(profil, { genre: "media", id, titre: "Banc Cast" }, origine, 1, { compatible, qualiteSource });
    const reponse = await fetch(m.url); assert.equal(reponse.status, 200);
    if (m.session) {
      const manifeste = await reponse.text(); assert.match(manifeste, /#EXTINF:/);
      const segment = manifeste.split(/\r?\n/).find(l => l && !l.startsWith("#")); assert(segment);
      const r = await fetch(new URL(segment, m.url)); assert.equal(r.status, 200); assert((await r.arrayBuffer()).byteLength > 188);
      const { stdout } = await exec(config.ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name,width,height",
        "-of", "json", m.url], { windowsHide: true, timeout: 30_000 });
      const flux = JSON.parse(stdout).streams;
      assert(flux.some((s: any) => qualiteSource ? s.codec_name === "hevc" && s.height === 2160 : s.codec_name === "h264" && s.height <= (compatible ? 720 : 1080)));
      assert(flux.some((s: any) => s.codec_name === "aac"));
      await exec(config.ffmpegPath, ["-nostdin", "-v", "error", "-i", m.url, "-t", "2", "-f", "null", "-"],
        { windowsHide: true, timeout: 45_000 });
    } else {
      await reponse.body?.cancel();
      const r = await fetch(m.url, { headers: { Range: "bytes=0-99" } }); assert.equal(r.status, 206);
      assert.equal((await r.arrayBuffer()).byteLength, 100);
    }
    await medias.retirer(m.cle); assert.equal((await fetch(m.url)).status, 404);
    console.log(JSON.stringify({ id, compatible, qualiteSource, preparationHttpDecodage: "OK", ms: Date.now() - debut }));
  }
} finally {
  await medias.fermer(); await app.close(); db.close();
  const absolu = path.resolve(dossier);
  assert.equal(path.dirname(absolu), path.resolve(tmpdir()));
  assert(path.basename(absolu).startsWith("flixtunes-cast-test-"));
  await rm(absolu, { recursive: true, force: true });
}
