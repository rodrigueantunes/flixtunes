import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffusionMaterielleProbe } from "@flixtunes/contracts";

const amont = vi.hoisted(() => ({ appels: 0, simultanes: 0, max: 0, echec: false }));
vi.mock("./live-relais.js", async (original) => ({ ...await original<typeof import("./live-relais.js")>(),
  // Un hébergeur de logos lent : 40 ms par image, qui compte ses téléchargements simultanés.
  recupererSansSortirDuPublic: async (url: string) => {
    amont.appels++; amont.simultanes++; amont.max = Math.max(amont.max, amont.simultanes);
    await new Promise((r) => setTimeout(r, 40));
    amont.simultanes--;
    if (amont.echec) return { url, reponse: new Response("introuvable", { status: 404 }) };
    return { url, reponse: new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) };
  } }));
import { DIRECT_IMAGES_MIN, retenirDiffusion } from "./capacity.js";
import { argumentsSondeDirect, argumentsVideoLive, choisirTraitementLive, erreurFfmpegLisible, type AnalyseLive } from "./live-diffusion.js";
import { conversionsDuDirectMax } from "./live-compat.js";
import { adresseLiveDistante } from "./live-acces-distant.js";
import { oublierImagesRelayees, relayerLiveDistant } from "./live-relais-distant.js";

const sonde = (id: DiffusionMaterielleProbe["id"], framesPerSecond: number | null): DiffusionMaterielleProbe =>
  ({ id, label: id, usable: framesPerSecond != null, framesPerSecond, error: null });

describe("calibrage du direct (r11)", () => {
  it("retient le débit variable s'il tient le temps réel, sinon la qualité constante, sinon rien", () => {
    expect(retenirDiffusion([sonde("direct-vbr", 180), sonde("direct-cqp", 190), sonde("direct-desentrelace", 120)]))
      .toMatchObject({ direct: "vbr", desentrelacement: true });
    // Débit variable refusé par le pilote : la qualité constante, que la lecture des films emploie déjà.
    expect(retenirDiffusion([sonde("direct-vbr", null), sonde("direct-cqp", 190), sonde("direct-desentrelace", null)]))
      .toMatchObject({ direct: "cqp", desentrelacement: false });
    // Trop lent pour un 1080p50 : le direct reste en logiciel, sans passe matérielle vouée à l'échec.
    expect(retenirDiffusion([sonde("direct-vbr", DIRECT_IMAGES_MIN - 10), sonde("direct-cqp", 30)])).toMatchObject({ direct: null, desentrelacement: false });
    expect(retenirDiffusion([])).toMatchObject({ direct: null });
  });

  it("sonde le direct avec les arguments mêmes de la conversion réelle", () => {
    const progressif = argumentsSondeDirect("vbr", false).join(" ");
    expect(progressif).toContain("testsrc2=size=1920x1080:rate=50");
    expect(progressif).toContain("-c:v h264_vaapi -rc_mode VBR");
    expect(progressif).toContain("scale_vaapi=w=1920:h=1080");
    expect(progressif.endsWith("-f null -")).toBe(true);
    const entrelace = argumentsSondeDirect("cqp", true).join(" ");
    expect(entrelace).toContain("setfield=tff,format=nv12,hwupload,deinterlace_vaapi=rate=field");
    expect(entrelace).toContain("-qp 21");
    expect(entrelace).not.toContain("-rc_mode");
  });
});

describe("traitement du direct selon le circuit mesuré", () => {
  const variante = (entrelace: boolean): AnalyseLive => {
    const v = { flux: 0, fluxAudio: 1, codec: "h264", largeur: 1920, hauteur: 1080, entrelace, imagesParSeconde: entrelace ? 25 : 50, debit: 5_000_000 };
    return { ...v, variantes: [v], audio: "aac" };
  };
  const dlna = { hauteurMax: 1080, hevc: false, conversionSeule: true };

  it("encode en qualité constante quand c'est ce que la machine a tenu", () => {
    const t = choisirTraitementLive(variante(false), dlna, { reglage: "cqp", desentrelacement: true });
    expect(t).toMatchObject({ encodeur: "vaapi", reglage: "cqp", hauteur: 1080, imagesParSeconde: 50 });
    const sortie = argumentsVideoLive(t).sortie.join(" ");
    expect(sortie).toContain("-qp 21"); expect(sortie).not.toContain("-rc_mode");
  });

  it("ne désentrelace au circuit vidéo que si ce désentrelacement a été qualifié", () => {
    expect(choisirTraitementLive(variante(true), dlna, { reglage: "vbr", desentrelacement: true }))
      .toMatchObject({ encodeur: "vaapi", entrelace: true, imagesParSeconde: 50 });
    expect(choisirTraitementLive(variante(true), dlna, { reglage: "vbr", desentrelacement: false }))
      .toMatchObject({ encodeur: "logiciel", entrelace: true, hauteur: 720, imagesParSeconde: 25 });
    expect(choisirTraitementLive(variante(false), dlna, null)).toMatchObject({ encodeur: "logiciel", hauteur: 720 });
  });

  it("retire toute adresse des messages de FFmpeg avant de les journaliser", () => {
    const brut = "Opening 'http://fournisseur.example/live/token=abc/index.m3u8' for reading\n"
      + "[h264_vaapi] Failed to end picture encode issue: 23 (internal encoding error).\n"
      + "data:application/vnd.apple.mpegurl;base64,AAAA: Invalid data\nError while filtering: Input/output error\n";
    const lisible = erreurFfmpegLisible(brut);
    expect(lisible).not.toMatch(/fournisseur|token|base64/);
    expect(lisible).toContain("[adresse]"); expect(lisible).toContain("internal encoding error");
  });
});

describe("conversions du direct menées de front", () => {
  const avant = process.env.FLIXTUNES_LIVE_CONVERSIONS;
  afterEach(() => { if (avant === undefined) delete process.env.FLIXTUNES_LIVE_CONVERSIONS; else process.env.FLIXTUNES_LIVE_CONVERSIONS = avant; });
  it("en tient deux avec un circuit vidéo qualifié, une sans, et suit le réglage du NAS", () => {
    delete process.env.FLIXTUNES_LIVE_CONVERSIONS;
    expect(conversionsDuDirectMax({ reglage: "vbr", desentrelacement: true })).toBe(2);
    expect(conversionsDuDirectMax(null)).toBe(1);
    process.env.FLIXTUNES_LIVE_CONVERSIONS = "3";
    expect(conversionsDuDirectMax(null)).toBe(3);
    process.env.FLIXTUNES_LIVE_CONVERSIONS = "9";
    expect(conversionsDuDirectMax(null)).toBe(3);
  });
});

describe("logos du direct par l'accès distant", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    amont.appels = 0; amont.simultanes = 0; amont.max = 0; amont.echec = false; oublierImagesRelayees();
    app = Fastify();
    app.get("/api/live/relais", (req: FastifyRequest, reply: FastifyReply) => relayerLiveDistant(req, reply, "profil"));
  });
  afterEach(async () => { await app.close(); });
  const logo = (n: number) => adresseLiveDistante(`https://logos.example/${n}.png`, "profil", `chaine-${n}`, "image");

  it("sert toute une grille sans refus, six téléchargements à la fois au plus, puis depuis la mémoire", async () => {
    // Quarante logos d'un coup : la r10 en refusait tout ce qui dépassait vingt-quatre requêtes.
    const reponses = await Promise.all(Array.from({ length: 40 }, (_, n) => app.inject({ url: logo(n) })));
    expect(reponses.map((r) => r.statusCode)).toEqual(Array(40).fill(200));
    expect(amont.max).toBeLessThanOrEqual(6);
    expect(amont.appels).toBe(40);
    const encore = await Promise.all(Array.from({ length: 40 }, (_, n) => app.inject({ url: logo(n) })));
    expect(encore.every((r) => r.statusCode === 200 && r.headers["content-type"] === "image/png")).toBe(true);
    expect(amont.appels).toBe(40);
  });

  it("retient un logo absent, pour ne pas le redemander à chaque grille", async () => {
    amont.echec = true;
    expect((await app.inject({ url: logo(1) })).statusCode).toBe(502);
    expect((await app.inject({ url: logo(1) })).statusCode).toBe(502);
    expect(amont.appels).toBe(1);
  });
});
