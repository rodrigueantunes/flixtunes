import { describe, expect, it } from "vitest";
import { adresseRepond, meilleureVariante, oublierLesJoignabilites, sonderCesAdresses, type VerdictHote } from "./live-qualite.js";

/**
 * Ce qui distingue deux adresses vivantes de la même chaîne.
 *
 * Le repli sait écarter ce qui ne répond pas ; il ne voit pas qu'une source donne du 480p quand sa
 * voisine donne du 1080p. La réponse est écrite dans le manifeste, et les cas ci-dessous viennent des
 * formes qu'on y rencontre réellement.
 */

describe("la meilleure variante d'un manifeste", () => {
  it("retient la plus haute définition, et son débit", () => {
    const maitre = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360',
      "360.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080',
      "1080.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1280x720',
      "720.m3u8",
    ].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 1080, debit: 5_200_000 });
  });

  it("départage deux variantes de même hauteur par le débit", () => {
    // Le cas existe : une même définition proposée en deux qualités d'encodage.
    const maitre = [
      "#EXTM3U",
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080',
      "a.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080',
      "b.m3u8",
    ].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 1080, debit: 6_000_000 });
  });

  it("garde le débit quand aucune résolution n'est déclarée", () => {
    // Beaucoup de listes du corpus annoncent une bande passante et rien d'autre.
    const maitre = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000", "seule.m3u8"].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: null, debit: 800_000 });
  });

  it("ne conclut rien d'une liste de segments", () => {
    /*
     * Un manifeste de variante ne déclare ni définition ni débit : il n'y a rien à en tirer, et ce
     * n'est pas un échec. La source se rangera après celles qui ont su se décrire — on préfère ce
     * qu'on sait à ce qu'on ignore, sans pour autant jeter ce qu'on ignore.
     */
    const variante = [
      "#EXTM3U", "#EXT-X-TARGETDURATION:8", "#EXT-X-MEDIA-SEQUENCE:1204",
      "#EXTINF:8.0,", "seg1204.ts", "#EXTINF:8.0,", "seg1205.ts",
    ].join("\n");
    expect(meilleureVariante(variante)).toEqual({ hauteur: null, debit: null });
  });

  it("lit les attributs quel que soit leur ordre et leur casse", () => {
    const maitre = ["#EXTM3U", "#EXT-X-STREAM-INF:resolution=1280x720,bandwidth=2500000,CODECS=\"avc1\"", "x.m3u8"].join("\n");
    expect(meilleureVariante(maitre)).toEqual({ hauteur: 720, debit: 2_500_000 });
  });
});

describe("les sources qui répondent encore", () => {
  /*
   * Aucune de ces sondes ne sort sur Internet : la récupération et le jugement des hôtes sont prêtés.
   * Une suite qui dépendrait de vrais hébergeurs mentirait un jour sur deux.
   */
  const publics = async () => "public" as VerdictHote;
  const attendre = (ms: number) => new Promise((resoudre) => setTimeout(resoudre, ms));

  it("tient pour muette une adresse qui refuse, un nom introuvable ou un hôte qui se tait", async () => {
    const juger = async (hote: string) => (hote === "disparu.test" ? "introuvable" : "public") as VerdictHote;
    const recuperer = async (url: string) => {
      if (url.includes("refus")) return new Response("non", { status: 404 });
      if (url.includes("silence")) throw new Error("délai dépassé");
      return new Response("#EXTM3U", { status: 200 });
    };
    expect(await adresseRepond("http://hote.test/vivante.m3u8", { juger, recuperer })).toBe(true);
    expect(await adresseRepond("http://hote.test/refus.m3u8", { juger, recuperer })).toBe(false);
    expect(await adresseRepond("http://hote.test/silence.m3u8", { juger, recuperer })).toBe(false);
    expect(await adresseRepond("http://disparu.test/flux.m3u8", { juger, recuperer })).toBe(false);
  });

  it("ne juge pas ce que le NAS n'a pas le droit d'aller voir", async () => {
    // Une source du réseau local peut jouer dans le salon : ne pas pouvoir la sonder ne la condamne pas.
    const juger = async (hote: string) => (["salon.lan", "interne.test"].includes(hote) ? "prive" : "public") as VerdictHote;
    const recuperer = async (url: string) => url.includes("redirige")
      ? new Response(null, { status: 302, headers: { location: "http://interne.test/flux.m3u8" } })
      : new Response("#EXTM3U", { status: 200 });
    expect(await adresseRepond("http://salon.lan/flux.m3u8", { juger, recuperer })).toBeNull();
    expect(await adresseRepond("http://hote.test/redirige.m3u8", { juger, recuperer })).toBeNull();
    expect(await adresseRepond("rtmp://hote.test/flux", { juger, recuperer })).toBeNull();
  });

  it("sonde toutes les autres, douze à la fois, sans celle qui joue, et s'en souvient cinq minutes", async () => {
    oublierLesJoignabilites();
    let appels = 0;
    let enVol = 0;
    let pic = 0;
    const recuperer = async (url: string) => {
      appels += 1;
      enVol += 1;
      pic = Math.max(pic, enVol);
      await attendre(5);
      enVol -= 1;
      return new Response("", { status: url.includes("morte") ? 500 : 200 });
    };
    let horloge = 1_000_000;
    const outils = { recuperer, juger: publics, maintenant: () => horloge };
    const adresses = Array.from({ length: 40 }, (_, index) => `http://hote.test/${index % 4 === 0 ? "morte" : "vive"}-${index}.m3u8`);

    const muettes = await sonderCesAdresses("chaine-a", adresses, adresses[1]!, outils);
    expect(appels).toBe(39);
    expect(pic).toBeLessThanOrEqual(12);
    expect(muettes).toEqual(adresses.filter((url) => url.includes("morte")));

    await sonderCesAdresses("chaine-a", adresses, adresses[1]!, outils);
    expect(appels).toBe(39);
    horloge += 5 * 60 * 1000 + 1;
    await sonderCesAdresses("chaine-a", adresses, adresses[1]!, outils);
    expect(appels).toBe(78);
  });

  it("ne lance qu'une passe par chaîne, même demandée deux fois", async () => {
    oublierLesJoignabilites();
    let appels = 0;
    const recuperer = async () => { appels += 1; await attendre(20); return new Response("", { status: 200 }); };
    const adresses = ["http://hote.test/a.m3u8", "http://hote.test/b.m3u8"];
    await Promise.all([
      sonderCesAdresses("chaine-b", adresses, null, { recuperer, juger: publics }),
      sonderCesAdresses("chaine-b", adresses, null, { recuperer, juger: publics }),
    ]);
    expect(appels).toBe(2);
  });

  it("répond avec ce qu'il sait quand des sondes traînent", async () => {
    oublierLesJoignabilites();
    const recuperer = async (url: string) => {
      if (url.includes("lente")) await attendre(400);
      return new Response("", { status: url.includes("morte") ? 404 : 200 });
    };
    const debut = Date.now();
    const muettes = await sonderCesAdresses("chaine-c", ["http://hote.test/morte.m3u8", "http://hote.test/lente.m3u8"], null,
      { recuperer, juger: publics, attenteMaxMs: 100 });
    expect(Date.now() - debut).toBeLessThan(350);
    expect(muettes).toEqual(["http://hote.test/morte.m3u8"]);
  });
});
