import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
const fixture = vi.hoisted(() => ({ dossier: "", permis: true, hls: false, source: vi.fn(), fermer: vi.fn(), live: vi.fn(), etat: vi.fn(), decision: vi.fn() }));
vi.mock("./database.js", () => ({ getProfile: (id: string) => id === "profil" ? { preferredAudioLanguages: ["fra"] } : null,
  db: { prepare: () => ({ get: () => ({ file_path: path.join(fixture.dossier, "media.mp4") }) }) } }));
vi.mock("./catalog-view.js", () => ({ getMediaItem: (profil: string, id: string) => profil === "profil" && fixture.permis && ["film", "episode", "video-web"].includes(id)
  ? { id, title: "Été à la télé", runtimeSeconds: 1800 } : null }));
vi.mock("./television-direct.js", () => ({ chaineDetaillee: (id: string) => id === "chaine" ? { nom: "Télévision", sources: [{ url: "http://example.com/live.m3u8" }, { url: "http://example.com/secours.m3u8" }] } : null }));
vi.mock("./playback.js", () => ({ getPlaybackInfo: async () => ({}), decidePlayback: fixture.decision, createPlaybackSession: fixture.source, getPlaybackSession: fixture.etat, stopPlaybackSession: fixture.fermer,
  getPlaybackFile: (_id: string, nom: string) => ["manifest.m3u8", "segment_00000.ts"].includes(nom)
    ? { path: path.join(fixture.dossier, nom), contentType: nom.endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" } : null }));
vi.mock("./live-compat.js", () => ({ commencerConversionLive: fixture.live,
  arreterConversionLive: fixture.fermer,
  fichierConversionLive: async (_profil: string, _id: string, nom: string) => nom === "live.m3u8"
    ? { chemin: path.join(fixture.dossier, "manifest.m3u8"), type: "application/vnd.apple.mpegurl" } : null }));
import { MediasDiffusion } from "./diffusion-medias.js";
const medias = new MediasDiffusion(), app = Fastify();
beforeAll(async () => {
  fixture.dossier = await mkdtemp(path.join(tmpdir(), "flixtunes-cast-media-"));
  await writeFile(path.join(fixture.dossier, "media.mp4"), "0123456789");
  await writeFile(path.join(fixture.dossier, "segment_00000.ts"), "segment-test");
  app.get<{ Params: { cle: string; nom: string } }>("/api/diffusion/flux/:cle/:nom", (req, reply) => medias.servir(req.params.cle, req.params.nom, req, reply));
});
beforeEach(async () => {
  fixture.permis = true; fixture.hls = false; fixture.source.mockReset(); fixture.etat.mockReset(); fixture.decision.mockReset().mockReturnValue({transcodeVideo:false}); fixture.fermer.mockReset();
  fixture.live.mockReset().mockResolvedValue({ id: "live", url: "/api/live/compat/live/live.m3u8" });
  fixture.source.mockImplementation(async (_id, caps) => fixture.hls ? { id: "session", url: "/api/playback/session/manifest.m3u8", mode: "remux", status: "ready", startOffsetSeconds: caps.startSeconds }
    : { id: null, url: "/api/media/film/stream", mode: "direct", status: "ready" });
  await writeFile(path.join(fixture.dossier, "manifest.m3u8"), "#EXTM3U\n#EXTINF:6,\nsegment_00000.ts\n");
});
afterEach(async () => { vi.useRealTimers(); await medias.fermer(); });
afterAll(async () => { await app.close(); await medias.fermer();
  if (path.dirname(fixture.dossier) === tmpdir() && path.basename(fixture.dossier).startsWith("flixtunes-cast-media-")) await rm(fixture.dossier, { recursive: true, force: true });
});
it.each(["film", "episode", "video-web"])("diffuse %s avec une URL temporaire sans jeton de profil et respecte Range", async (id) => {
  const m = await medias.preparer("profil", { genre: "media", id, titre: "ignoré" }, "http://10.0.0.1:4000", 120);
  expect(m.url).not.toContain("profileId"); expect(m.url).not.toContain("/media/film/");
  expect(m.position).toBe(120);
  const r = await app.inject({ url: new URL(m.url).pathname, headers: { range: "bytes=2-5" } });
  expect(r.statusCode).toBe(206); expect(r.body).toBe("2345"); expect(r.headers["content-range"]).toBe("bytes 2-5/10");
  expect(r.headers["access-control-allow-origin"]).toBe("*");
  expect((await app.inject({ url: new URL(m.url).pathname, headers: { range: "bytes=50-60" } })).statusCode).toBe(416);
  expect((await app.inject({ url: `/api/diffusion/flux/${m.cle}/autre.mp4` })).statusCode).toBe(404);
  expect(await medias.retirerPourProfil(m.cle, "autre")).toBe(false);
  expect(await medias.retirerPourProfil(m.cle, "profil")).toBe(true);
  expect((await app.inject(new URL(m.url).pathname)).statusCode).toBe(404);
});
it("prépare une conversion indépendante au point de reprise sans l'essai direct des clients locaux", async () => {
  fixture.hls = true;
  const m = await medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1:4000", 600);
  expect(m.decalage).toBe(600); expect(m.position).toBe(0);
  expect(fixture.source.mock.calls[0]?.[2]).toEqual({ essaiDirect: false, diffusion: true });
  expect(fixture.source.mock.calls[0]?.[1].deviceId).toMatch(/^cast-/);
  const r = await app.inject(new URL(m.url).pathname); expect(r.statusCode).toBe(200); expect(r.body).toContain("segment_00000.ts");
  const segment = await app.inject(`/api/diffusion/flux/${m.cle}/segment_00000.ts`); expect(segment.body).toBe("segment-test");
});
it("ne transforme pas un manifeste en relais ouvert et réévalue les droits", async () => {
  fixture.hls = true;
  const m = await medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1:4000", 0);
  await writeFile(path.join(fixture.dossier, "manifest.m3u8"), '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="http://autre/secret"\n');
  expect((await app.inject(new URL(m.url).pathname)).statusCode).toBe(502);
  fixture.permis = false; expect((await app.inject(`/api/diffusion/flux/${m.cle}/segment_00000.ts`)).statusCode).toBe(404);
});
it("prépare le Live TV sans exposer l'adresse du fournisseur", async () => {
  const m = await medias.preparer("profil", { genre: "direct", id: "chaine", titre: "TV" }, "http://10.0.0.1:4000", 50);
  expect(m.direct).toBe(true); expect(m.position).toBe(0); expect(m.url).not.toContain("example.com");
  expect((await app.inject(new URL(m.url).pathname)).statusCode).toBe(200);
});
it("refuse une préparation non autorisée", async () => {
  await expect(medias.preparer("autre", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0)).rejects.toThrow("inaccessible");
});
it("essaye la source suivante du direct mais ne contourne pas un refus de capacité", async () => {
  fixture.live.mockRejectedValueOnce(new Error("Ce flux ne peut pas être converti"));
  const m = await medias.preparer("profil", { genre: "direct", id: "chaine", titre: "TV" }, "http://10.0.0.1", 0);
  expect(fixture.live).toHaveBeenCalledTimes(2); expect(fixture.live.mock.calls[1]?.[2]).toContain("secours");
  await medias.retirer(m.cle);
  fixture.live.mockClear().mockRejectedValue(new Error("Conversion occupée ou mémoire insuffisante"));
  await expect(medias.preparer("profil", { genre: "direct", id: "chaine", titre: "TV" }, "http://10.0.0.1", 0)).rejects.toThrow("occupée");
  expect(fixture.live).toHaveBeenCalledTimes(1);
});
it("demande une conversion H.264/AAC SDR lors du second essai", async () => {
  const m = await medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 40, { compatible: true });
  expect(fixture.source.mock.calls[0]?.[1]).toMatchObject({ modePreference: "compatible", audioOutputMode: "aac", dynamicRangePreference: "sdr", seekableTrackHeaders: false });
  await medias.retirer(m.cle);
});

it("conserve le motif d’un refus de capacité sans autoriser un repli supplémentaire", async () => {
  fixture.source.mockResolvedValue({ id: null, status: "failed", url: null, error: "Limite de conversions atteinte" });
  await expect(medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0))
    .rejects.toMatchObject({ code: "CAST_PREPARATION_REFUSEE", repliPossible: false, message: expect.stringContaining("Limite de conversions") });
});
it("libère une conversion échouée avant de permettre un second essai", async () => {
  fixture.source.mockResolvedValue({ id: "echec", status: "failed", url: null, error: "Encodeur indisponible" });
  await expect(medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0))
    .rejects.toMatchObject({ code: "CAST_PREPARATION_ECHOUEE", repliPossible: true });
  expect(fixture.fermer).toHaveBeenCalledWith("echec");
});
it("attend un démarrage lent au-delà de 45 secondes et conserve le point de reprise", async () => {
  vi.useFakeTimers(); const debut = Date.now();
  const session = { id: "lent", mode: "transcode", status: "starting", url: "/api/playback/lent/manifest.m3u8", startOffsetSeconds: 108 };
  fixture.source.mockResolvedValue(session);
  fixture.etat.mockImplementation(async () => ({ ...session, status: Date.now() - debut >= 60_000 ? "ready" : "starting" }));
  const attente = medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 108);
  await vi.advanceTimersByTimeAsync(60_400);
  const m = await attente; expect(m.position).toBe(0); expect(m.decalage).toBe(108);
});
it("borne l’attente à 90 secondes et libère la conversion sans premier segment", async () => {
  vi.useFakeTimers();
  const session = { id: "bloque", mode: "transcode", status: "starting", url: "/api/playback/bloque/manifest.m3u8" };
  fixture.source.mockResolvedValue(session); fixture.etat.mockResolvedValue(session);
  const resultat = expect(medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0))
    .rejects.toMatchObject({ code: "CAST_PREPARATION_DELAI", repliPossible: true });
  await vi.advanceTimersByTimeAsync(90_400); await resultat;
  expect(fixture.fermer).toHaveBeenCalledWith("bloque");
});

it("ne publie pas un HLS incomplet réduit à un seul segment", async () => {
  fixture.hls = true;
  fixture.etat.mockResolvedValue({ id: "session", mode: "remux", status: "ready", url: "/manifest.m3u8" });
  await writeFile(path.join(fixture.dossier, "manifest.m3u8"), "#EXTM3U\n#EXTINF:2,\nsegment_00000.ts\n");
  let prete = false;
  const attente = medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0).then(m => { prete = true; return m; });
  await new Promise(r => setTimeout(r, 500)); expect(prete).toBe(false);
  await writeFile(path.join(fixture.dossier, "manifest.m3u8"), "#EXTM3U\n#EXTINF:6,\nsegment_00000.ts\n");
  await attente; expect(prete).toBe(true);
});
it("accepte un média court terminé sans attendre six secondes de contenu", async () => {
  fixture.hls = true;
  await writeFile(path.join(fixture.dossier, "manifest.m3u8"), "#EXTM3U\n#EXTINF:2,\nsegment_00000.ts\n#EXT-X-ENDLIST\n");
  expect((await medias.preparer("profil", { genre: "media", id: "film", titre: "Film" }, "http://10.0.0.1", 0)).session).toBe("session");
});

it.each(["film", "episode", "video-web"])("conserve la définition source 4K de %s avant les conversions de secours", async (id) => {
  fixture.hls = true;
  const m = await medias.preparer("profil", { genre: "media", id, titre: "Test" }, "http://10.0.0.1", 0, { qualiteSource: true });
  expect(fixture.source.mock.calls[0]?.[1]).toMatchObject({ maxWidth: 3840, maxHeight: 2160, hlsSegmentContainer: "fmp4", hdr: true });
  expect(m.segmentsFmp4).toBe(true); expect(m.qualite).toContain("source");
});
it("ne lance pas une lourde conversion 4K pour simuler une copie source impossible", async () => {
  fixture.decision.mockReturnValue({transcodeVideo:true});
  await expect(medias.preparer("profil", { genre: "media", id: "film", titre: "Test" }, "http://10.0.0.1", 0, { qualiteSource: true }))
    .rejects.toMatchObject({repliPossible:true});
  expect(fixture.source).not.toHaveBeenCalled();
});
it("demande la copie vidéo pour le direct source et le fMP4 adapté au HEVC", async () => {
  const m = await medias.preparer("profil", { genre: "direct", id: "chaine", titre: "Test" }, "http://10.0.0.1", 0, { qualiteSource: true });
  expect(fixture.live.mock.calls[0]?.[5]).toEqual({copieVideo:true}); expect(m.segmentsFmp4).toBe(true);
});
