import { describe, expect, it } from "vitest";
import { DECODE_CANDIDATES, summariseDecodeSupport, type CandidateVerdict } from "./decode-support";

/**
 * Ces cas reproduisent la situation constatée sur une vraie médiathèque : un fichier
 * MKV / HEVC / Dolby Vision P8 / EAC3 en 3840×2076 que le navigateur lit parfaitement en lecture
 * directe, mais que la négociation refusait — conteneur, codec et définition tous trois annoncés
 * incompatibles. Le transcodage 4K qui s'ensuivait saturait l'admission du serveur, laquelle bridait
 * ensuite la lecture à 1080p. Une seule cause, quatre symptômes.
 */

const candidat = (mime: string) => DECODE_CANDIDATES.find((entry) => entry.mimeType === mime)!;
const verdict = (mime: string, supported: boolean, smooth = supported): CandidateVerdict =>
  ({ candidate: candidat(mime), supported, smooth });

describe("étiquettes du même codec", () => {
  it("sonde HEVC sous ses deux noms", () => {
    // `hev1` et `hvc1` désignent le même codec, rangé différemment : le premier porte ses paramètres
    // dans le flux, le second dans l'en-tête du conteneur. Les navigateurs n'acceptent pas les mêmes.
    // Ne sonder que `hvc1` faisait conclure « HEVC non pris en charge » sur une machine dont Chrome
    // lisait pourtant du HEVC 4K en lecture directe forcée — et le film partait alors en conversion 4K
    // au lieu d'un remux qui aurait copié l'image.
    const etiquettes = DECODE_CANDIDATES.filter((candidat) => candidat.codec === "hevc")
      .map((candidat) => candidat.mimeType);
    expect(etiquettes.some((type) => type.includes("hvc1"))).toBe(true);
    expect(etiquettes.some((type) => type.includes("hev1"))).toBe(true);
  });

  it("déclare le codec quelle que soit l'étiquette qui a répondu", () => {
    // Un navigateur qui n'accepte que `hev1` doit faire déclarer « hevc » au serveur, sans quoi la
    // sonde aurait raison sur le détail et tort sur la conclusion.
    const hev1 = DECODE_CANDIDATES.find((candidat) => candidat.mimeType.includes("hev1"))!;
    const resume = summariseDecodeSupport([{ candidate: hev1, supported: true, smooth: true }]);
    expect(resume.videoCodecs).toContain("hevc");
  });
});

describe("synthèse des capacités de décodage", () => {
  it("annonce HEVC, Matroska et la 4K lorsque le navigateur les décode", () => {
    const resume = summariseDecodeSupport([
      verdict('video/mp4; codecs="avc1.640028"', true),
      verdict('video/mp4; codecs="hvc1.1.6.L153.B0"', true),
      verdict('video/x-matroska; codecs="hvc1.1.6.L153.B0"', true),
    ]);
    expect(resume.videoCodecs).toContain("hevc");
    expect(resume.videoCodecs).toContain("hvc1");
    expect(resume.containers).toContain("matroska");
    expect(resume.maxWidth).toBe(3840);
    expect(resume.maxHeight).toBe(2160);
  });

  it("ne déduit plus la définition de la taille de l'écran", () => {
    // C'était le défaut principal : « Définition supérieure à 2560×1600 » décrivait l'écran, alors
    // qu'un navigateur décode une source 4K et la réduit à l'affichage sans difficulté.
    const resume = summariseDecodeSupport([verdict('video/mp4; codecs="avc1.640033"', true)]);
    expect(resume.maxWidth).toBe(3840);
  });

  it("relève la définition d'un codec décodable, même annoncé non fluide", () => {
    // Ce cas disait l'inverse, et l'inverse coûtait cher.
    //
    // `decodingInfo` répond très souvent `supported: true, smooth: false` pour du HEVC 4K alors que le
    // décodage matériel existe : c'est un doute sur la cadence, pas un refus. En le traitant comme un
    // refus, le plafond restait à 1080p, le serveur concluait « définition supérieure à 1920×1080 » et
    // partait en conversion 4K — qu'un NAS Celeron ne produit pas, là où le fichier se lisait
    // directement sans peine.
    //
    // L'erreur n'est pas symétrique : un faux négatif supprime toute lecture, un faux positif donne
    // une lecture imparfaite que la quarantaine de codecs et la renégociation après coupures
    // rattrapent.
    const resume = summariseDecodeSupport([
      verdict('video/mp4; codecs="avc1.640028"', true),
      { candidate: candidat('video/mp4; codecs="hvc1.1.6.L153.B0"'), supported: true, smooth: false },
    ]);
    expect(resume.videoCodecs).toContain("hevc");
    expect(resume.maxHeight).toBe(2160);
    expect(resume.maxWidth).toBe(3840);
  });

  it("ne relève rien sur un codec que l'appareil ne décode pas", () => {
    // La correction précédente ne doit pas devenir de la complaisance : un refus franc reste un refus.
    const resume = summariseDecodeSupport([
      verdict('video/mp4; codecs="avc1.640028"', true),
      { candidate: candidat('video/mp4; codecs="hvc1.1.6.L153.B0"'), supported: false, smooth: false },
    ]);
    expect(resume.videoCodecs).not.toContain("hevc");
    expect(resume.maxHeight).toBe(1080);
  });

  it("conserve le socle universel quand rien n'est reconnu", () => {
    // Un navigateur avare de réponses ne doit pas se retrouver incapable de lire quoi que ce soit,
    // y compris le flux compatible que le serveur produit précisément pour ce cas.
    const resume = summariseDecodeSupport([]);
    expect(resume.videoCodecs).toEqual(["h264", "avc1"]);
    expect(resume.containers).toEqual(["mp4"]);
    expect(resume.maxWidth).toBe(1920);
    expect(resume.maxHeight).toBe(1080);
  });

  it("ignore les configurations refusées", () => {
    const resume = summariseDecodeSupport([
      verdict('video/mp4; codecs="avc1.640028"', true),
      verdict('video/mp4; codecs="hvc1.1.6.L153.B0"', false),
      verdict('video/x-matroska; codecs="hvc1.1.6.L153.B0"', false),
    ]);
    expect(resume.videoCodecs).not.toContain("hevc");
    expect(resume.containers).not.toContain("matroska");
    expect(resume.maxHeight).toBe(1080);
  });

  it("sonde chaque codec en 1080p et en 2160p", () => {
    // Un décodeur peut être fluide dans l'une et pas dans l'autre : sans les deux mesures, la
    // définition annoncée ne serait qu'une supposition.
    for (const codec of ["h264", "hevc", "av1", "vp9"]) {
      const hauteurs = DECODE_CANDIDATES.filter((entry) => entry.codec === codec).map((entry) => entry.height);
      expect(hauteurs, `codec ${codec}`).toContain(1080);
      expect(hauteurs, `codec ${codec}`).toContain(2160);
    }
  });

  it("emploie des chaînes de codec complètes", () => {
    // `codecs="hvc1"` — sans profil ni niveau — est rejeté par la plupart des navigateurs même
    // lorsque le décodage matériel existe. C'est ce raccourci qui faisait refuser le HEVC.
    for (const candidate of DECODE_CANDIDATES) {
      const codecs = candidate.mimeType.match(/codecs="([^"]+)"/)?.[1] ?? "";
      expect(codecs, candidate.mimeType).toMatch(/\./);
    }
  });
});
