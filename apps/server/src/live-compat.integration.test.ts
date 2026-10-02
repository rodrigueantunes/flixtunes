import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import Fastify from "fastify";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { recupererPublic } from "./live-http-public.js";
import { commencerConversionLive, fichierConversionLive, arreterConversionLive, fermerConversionsLive } from "./live-compat.js";
vi.mock("./live-http-public.js", () => ({ recupererPublic: vi.fn() }));
let dossier = "", depart = 0;
beforeAll(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), "flixtunes-r3-video-"));
  execFileSync(config.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "90", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
    "-g", "60", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "64k", "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
    "-hls_segment_filename", path.join(dossier, "seg%d.ts"), path.join(dossier, "fixture.m3u8")], { windowsHide: true, timeout: 20_000 });
  depart = Date.now() - 24_000;
  vi.mocked(recupererPublic).mockImplementation(async (url) => {
    const cible = new URL(url);
    if (cible.pathname.endsWith("m3u8")) {
      const dernier = Math.min(43, Math.floor((Date.now() - depart) / 2000) - 1);
      const premier = Math.max(0, dernier - 8);
      let texte = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${premier}\n`;
      for (let i = premier; i <= dernier; i++) texte += `#EXTINF:2,\nseg${i}.ts\n`;
      return new Response(texte, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
    }
    const nom = path.basename(cible.pathname);
    if (!/^seg\d+\.ts$/.test(nom)) return new Response(null, { status: 404 });
    return new Response(await readFile(path.join(dossier, nom)), { headers: { "content-type": "video/mp2t" } });
  });
}, 25_000);
afterAll(async () => {
  await fermerConversionsLive();
  if (dossier && path.dirname(path.resolve(dossier)) === path.resolve(tmpdir()) && path.basename(dossier).startsWith("flixtunes-r3-video-")) {
    await rm(dossier, { recursive: true, force: true });
  }
});

it("convertit un vrai direct en H264/AAC borné, isole les profils et libère la capacité", async () => {
  const lecture = await commencerConversionLive("profil-A", "chaine", "http://8.8.8.8/live.m3u8", "test-r3");
  const fichier = await fichierConversionLive("profil-A", lecture.id, "live.m3u8");
  expect(fichier).not.toBeNull();
  const manifeste = await readFile(fichier!.chemin, "utf8");
  expect((manifeste.match(/#EXTINF/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(await fichierConversionLive("profil-B", lecture.id, "live.m3u8")).toBeNull();
  expect(await fichierConversionLive("profil-A", lecture.id, "../secret")).toBeNull();
  await arreterConversionLive("profil-B", lecture.id);
  expect(await fichierConversionLive("profil-A", lecture.id, "live.m3u8")).not.toBeNull();
  await arreterConversionLive("profil-A", lecture.id);
  expect(await fichierConversionLive("profil-A", lecture.id, "live.m3u8")).toBeNull();
}, 40_000);

it("remuxe le direct source en fMP4 sans réduire sa définition, et protège aussi l’init", async () => {
  depart = Date.now() - 24_000;
  const lecture = await commencerConversionLive("profil-A", "chaine", "http://8.8.8.8/live.m3u8", "test-source", undefined, { copieVideo: true });
  try {
    const fichier = await fichierConversionLive("profil-A", lecture.id, "live.m3u8");
    const manifeste = await readFile(fichier!.chemin, "utf8");
    expect(manifeste).toContain('URI="init.mp4"'); expect(manifeste).toContain(".m4s");
    const init = await fichierConversionLive("profil-A", lecture.id, "init.mp4"); expect(init?.type).toBe("video/mp4");
    expect(await fichierConversionLive("profil-B", lecture.id, "init.mp4")).toBeNull();
    const http = Fastify();
    http.get<{Params:{nom:string}}>("/:nom", async (req, reply) => {
      const f = await fichierConversionLive("profil-A", lecture.id, req.params.nom);
      return f ? reply.type(f.type).send(createReadStream(f.chemin)) : reply.code(404).send();
    });
    try {
      const origine = await http.listen({host:"127.0.0.1",port:0});
      const { stdout } = await promisify(execFile)(config.ffprobePath, ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", `${origine}/live.m3u8`], {windowsHide:true,timeout:10000});
      expect(JSON.parse(stdout).streams).toContainEqual(expect.objectContaining({codec_name:"h264",width:320,height:180}));
    } finally { await http.close(); }
  } finally { await arreterConversionLive("profil-A", lecture.id); }
}, 40_000);
