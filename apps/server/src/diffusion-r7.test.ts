import { describe, expect, it } from "vitest";
import { capacitesConnues, enseignement, planDeQualite, retenirCapacites, type SourceVideo } from "./diffusion-sonde.js";
import { dimensionsCible, entreeDecodageMateriel, filtresDecodageMateriel, sourceDecodableMateriellement, TONEMAPX_NV12 } from "./diffusion-chaine.js";
import { listeEvenement } from "./diffusion-medias.js";
import { dlnaLitLeHls } from "./diffusion-dlna.js";
import { commandesDiffusionMaterielle, retenirDiffusion } from "./capacity.js";

/**
 * La r7 du cast, mesurée le 2 octobre 2026 : sur le NAS, un film 4K HDR converti à 0,33 fois le temps
 * réel ; sur la Pixel Tablet, tout HLS au-delà du 720p refusé, et une conversion en cours prise pour un
 * direct. Ces tests figent les règles qui en découlent.
 */
const film4kHdr: SourceVideo = { codec: "hevc", hauteur: 2160, hdr: true, mp4Direct: false };
const film1080H264: SourceVideo = { codec: "h264", hauteur: 1080, hdr: false, mp4Direct: false };
const pixelTablet = { h264_1080: false, hevc_1080: false, hevc_2160_hdr10: false };
const noms = (plan: ReturnType<typeof planDeQualite>) => plan.map((niveau) => `${niveau.nom}:${niveau.hauteurMax}`);

describe("plan de qualité d'après le récepteur", () => {
  it("va droit au 720p sur la Pixel Tablet pour un film 4K HDR", () => {
    expect(noms(planDeQualite(film4kHdr, pixelTablet, false))).toEqual(["compatible:720"]);
  });
  it("garde le plan complet quand le récepteur n'a rien dit", () => {
    expect(noms(planDeQualite(film4kHdr, null, false))).toEqual(["source:2160", "conversion:1080", "compatible:720"]);
  });
  it("copie le HEVC 4K HDR vers un récepteur qui l'accepte", () => {
    const plan = planDeQualite(film4kHdr, { h264_1080: true, hevc_1080: true, hevc_2160_hdr10: true }, false);
    expect(plan[0]).toMatchObject({ nom: "source", hevcHauteurMax: 2160, hdr: true });
  });
  it("copie un HEVC 1080p SDR sans annoncer de HDR", () => {
    const plan = planDeQualite({ codec: "hevc", hauteur: 1080, hdr: false, mp4Direct: false }, { hevc_1080: true, hevc_2160_hdr10: false }, false);
    expect(plan[0]).toMatchObject({ nom: "source", hevcHauteurMax: 1080, hdr: false });
  });
  it("n'essaie pas un HLS 1080p refusé, mais garde un MP4 servi tel quel", () => {
    expect(noms(planDeQualite(film1080H264, pixelTablet, false))).toEqual(["compatible:720"]);
    expect(noms(planDeQualite({ ...film1080H264, mp4Direct: true }, pixelTablet, false))).toEqual(["source:2160", "compatible:720"]);
  });
  it("ne propose pas de conversion 1080p pour une source déjà en 720p", () => {
    expect(noms(planDeQualite({ codec: "mpeg4", hauteur: 720, hdr: false, mp4Direct: false }, null, false))).toEqual(["source:2160", "compatible:720"]);
  });
  it("convertit le direct d'emblée pour un récepteur qui refuse le 1080p", () => {
    expect(noms(planDeQualite(null, pixelTablet, true))).toEqual(["compatible:720"]);
    expect(noms(planDeQualite(null, null, true))).toEqual(["source:2160", "compatible:720"]);
  });
});

describe("ce qu'un essai réel apprend", () => {
  const conversion = planDeQualite(film4kHdr, null, false)[1]!;
  const source = planDeQualite(film4kHdr, null, false)[0]!;
  it("retient le refus rapide d'une conversion 1080p", () => {
    expect(enseignement(conversion, film4kHdr, false, true)).toEqual({ h264_1080: false });
    expect(enseignement(conversion, film4kHdr, true, false)).toEqual({ h264_1080: true });
  });
  it("ne conclut rien d'un échec lent, qui peut venir du réseau ou du NAS", () => {
    expect(enseignement(conversion, film4kHdr, false, false)).toEqual({});
  });
  it("range le verdict d'une copie HEVC selon sa définition et son HDR", () => {
    expect(enseignement(source, film4kHdr, false, true)).toEqual({ hevc_2160_hdr10: false });
    expect(enseignement(source, { codec: "hevc", hauteur: 1080, hdr: false, mp4Direct: false }, true, false)).toEqual({ hevc_1080: true });
  });
});

describe("mémoire des capacités", () => {
  it("garde un verdict un mois, et l'oublie si le modèle change", () => {
    const id = `banc-${Date.now()}`, maintenant = Date.now();
    retenirCapacites(id, { h264_1080: false, modele: "Pixel Tablet" }, maintenant);
    expect(capacitesConnues(id, "Pixel Tablet", maintenant + 1000)).toMatchObject({ h264_1080: false });
    expect(capacitesConnues(id, "Autre modèle", maintenant + 1000)).toBeNull();
    expect(capacitesConnues(id, "Pixel Tablet", maintenant + 31 * 24 * 3600_000)).toBeNull();
  });
  it("fusionne un essai réel avec la sonde sans effacer ce qu'il ne dit pas", () => {
    const id = `banc-fusion-${Date.now()}`;
    retenirCapacites(id, { h264_1080: false, hevc_1080: false });
    expect(retenirCapacites(id, { h264_1080: true })).toMatchObject({ h264_1080: true, hevc_1080: false });
  });
});

describe("chaîne matérielle de la diffusion", () => {
  it("ouvre un seul périphérique VA-API, partagé par le décodeur, les filtres et l'encodeur", () => {
    const entree = entreeDecodageMateriel("/dev/dri/renderD128");
    expect(entree).toEqual(["-init_hw_device", "vaapi=flixva:/dev/dri/renderD128", "-filter_hw_device", "flixva",
      "-hwaccel", "vaapi", "-hwaccel_device", "flixva", "-hwaccel_output_format", "vaapi"]);
    expect(entree).not.toContain("-vaapi_device");
  });
  it("réduit sur le circuit, convertit les couleurs sur l'image réduite, puis la renvoie à l'encodeur", () => {
    expect(filtresDecodageMateriel(1280, 720, true)).toEqual(["scale_vaapi=w=1280:h=720:format=p010", "hwdownload", "format=p010le", TONEMAPX_NV12, "hwupload"]);
    expect(filtresDecodageMateriel(1280, 720, false)).toEqual(["scale_vaapi=w=1280:h=720:format=nv12"]);
  });
  it("calcule des dimensions paires qui tiennent dans la boîte sans agrandir", () => {
    expect(dimensionsCible(3840, 2160, 1280, 720)).toEqual({ largeur: 1280, hauteur: 720 });
    expect(dimensionsCible(3840, 1600, 1280, 720)).toEqual({ largeur: 1280, hauteur: 534 });
    expect(dimensionsCible(640, 360, 1920, 1080)).toEqual({ largeur: 640, hauteur: 360 });
    expect(dimensionsCible(1441, 811, 1920, 1080)).toEqual({ largeur: 1442, hauteur: 812 });
  });
  it("ne confie au décodeur matériel que le HEVC jusqu'à 10 bits et le H.264 8 bits", () => {
    expect(sourceDecodableMateriellement("hevc", 10)).toBe(true);
    expect(sourceDecodableMateriellement("hevc", 12)).toBe(false);
    expect(sourceDecodableMateriellement("h264", 10)).toBe(false);
    expect(sourceDecodableMateriellement("av1", 8)).toBe(false);
  });
  it("mesure exactement ce que la conversion exécutera", () => {
    const commandes = commandesDiffusionMaterielle("mire.mkv", ["format=yuv420p10le", TONEMAPX_NV12]);
    expect(commandes["materiel-hdr"]).toEqual(expect.arrayContaining(["-hwaccel", "vaapi", "-c:v", "h264_vaapi"]));
    expect(commandes["materiel-hdr"].join(" ")).toContain(TONEMAPX_NV12);
    expect(commandes["logiciel-hdr"]).toEqual(expect.arrayContaining(["-vaapi_device"]));
    expect(commandes["logiciel-hdr"]).not.toContain("-hwaccel");
  });
  it("ne retient la chaîne matérielle que si elle fonctionne et va plus vite", () => {
    const sonde = (id: "materiel-hdr" | "materiel-sdr" | "logiciel-hdr", framesPerSecond: number | null) =>
      ({ id, label: id, usable: framesPerSecond != null, framesPerSecond, error: null });
    expect(retenirDiffusion([sonde("materiel-hdr", 70), sonde("logiciel-hdr", 9), sonde("materiel-sdr", 200)])).toEqual({ hdr: true, sdr: true });
    expect(retenirDiffusion([sonde("materiel-hdr", 8), sonde("logiciel-hdr", 9), sonde("materiel-sdr", null)])).toEqual({ hdr: false, sdr: false });
    expect(retenirDiffusion([sonde("materiel-hdr", null), sonde("logiciel-hdr", 9)])).toEqual({ hdr: false, sdr: false });
  });
});

describe("une conversion en cours n'est pas un direct", () => {
  const brute = "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.002,\nsegment_00000.ts\n";
  it("déclare un événement qui commence au début", () => {
    const liste = listeEvenement(brute);
    expect(liste).toContain("#EXT-X-PLAYLIST-TYPE:EVENT\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n#EXT-X-TARGETDURATION:2");
    expect(listeEvenement(liste)).toBe(liste);
  });
  it("respecte un type déjà déclaré", () => {
    const vod = brute.replace("#EXT-X-VERSION:6\n", "#EXT-X-VERSION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n");
    expect(listeEvenement(vod)).toBe(vod);
  });
});

describe("formats déclarés par un téléviseur DLNA", () => {
  it("reconnaît le HLS, son absence, et le silence", () => {
    expect(dlnaLitLeHls(["http-get:*:video/mp4:*", "http-get:*:application/vnd.apple.mpegurl:*"])).toBe(true);
    expect(dlnaLitLeHls(["http-get:*:video/mp4:*", "http-get:*:video/mpeg:DLNA.ORG_PN=MPEG_TS_HD_NA"])).toBe(false);
    expect(dlnaLitLeHls([])).toBeNull();
    expect(dlnaLitLeHls(null)).toBeNull();
  });
});

describe("réserve du direct pour un téléviseur", () => {
  it("repart cinq segments en arrière pour un téléviseur, et garde le dernier pour le lecteur local", async () => {
    const { argumentsConversionLive, RETARD_SOURCE_DIFFUSION } = await import("./live-compat.js");
    const indice = (args: string[]) => args[args.indexOf("-live_start_index") + 1];
    expect(indice(argumentsConversionLive("http://source/live.m3u8", "dossier", "hls", false, true))).toBe(String(-RETARD_SOURCE_DIFFUSION));
    expect(indice(argumentsConversionLive("http://source/live.m3u8", "dossier", "hls", false))).toBe("-1");
  });
});

describe("position de départ d'une diffusion", () => {
  it("repart du début depuis le générique de fin, et garde la position ailleurs", async () => {
    const { positionDeDepart } = await import("./diffusion-medias.js");
    expect(positionDeDepart(61, 60)).toBe(0);
    expect(positionDeDepart(7915, 7920)).toBe(0);
    expect(positionDeDepart(1800, 7920)).toBe(1800);
    expect(positionDeDepart(30, 0)).toBe(30);
    expect(positionDeDepart(Number.NaN, 600)).toBe(0);
  });
});
