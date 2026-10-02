import { afterEach, describe, expect, it, vi } from "vitest";
import { reconnaitreFormat, reecrireDash, ouvrirEntreeLive, formatLive } from "./live-compat-entree.js";
import { recupererPublic } from "./live-http-public.js";
vi.mock("./live-http-public.js", () => ({ recupererPublic: vi.fn() }));
const entrees: Array<Awaited<ReturnType<typeof ouvrirEntreeLive>>> = [];
afterEach(async () => { await Promise.all(entrees.splice(0).map((e) => e.fermer())); vi.resetAllMocks(); });

describe("entrée contrôlée pour la compatibilité Live", () => {
  it("reconnaît le contenu avant l'extension", () => {
    expect(reconnaitreFormat(Buffer.from("#EXTM3U\n"), "application/octet-stream")).toBe("hls");
    expect(reconnaitreFormat(Buffer.from('<?xml version="1.0"?><MPD/>'))).toBe("dash");
    const ts = Buffer.alloc(376); ts[0] = ts[188] = 0x47;
    expect(reconnaitreFormat(ts)).toBe("ts");
    expect(reconnaitreFormat(Buffer.from("erreur"), "text/html")).toBe("inconnu");
  });
  it("réécrit les bases et modèles DASH tout en gardant les paramètres et substitutions", () => {
    const proxy = (url: string) => `http://127.0.0.1/proxy/${new URL(url).pathname.slice(1)}${new URL(url).search}`;
    const resultat = reecrireDash('<MPD><BaseURL>https://8.8.8.8/video/</BaseURL><Period><AdaptationSet><SegmentTemplate media="part-$Number$.m4s?x=1&amp;y=2" initialization="/init.mp4"/></AdaptationSet></Period></MPD>', "https://1.1.1.1/live/index.mpd", proxy);
    expect(resultat).toContain('http://127.0.0.1/proxy/video/part-$Number$.m4s?x=1&amp;y=2');
    expect(resultat).toContain('initialization="http://127.0.0.1/proxy/init.mp4"');
    expect(resultat).not.toContain("8.8.8.8");
    expect(() => reecrireDash('<!DOCTYPE MPD><MPD/>', "https://8.8.8.8/", proxy)).toThrow();
    expect(() => reecrireDash('<MPD><ContentProtection/></MPD>', "https://8.8.8.8/", proxy)).toThrow();
  });
  it("ne sert ni une URL inventée ni une redirection vers le LAN", async () => {
    vi.mocked(recupererPublic).mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/interne" } }));
    const e = await ouvrirEntreeLive("http://8.8.8.8/live"); entrees.push(e);
    expect((await fetch(e.url)).status).toBe(502);
    expect((await fetch(new URL("/inconnu", e.url))).status).toBe(404);
    expect(recupererPublic).toHaveBeenCalledTimes(1);
  });
  it("réécrit le HLS et annule la sonde après les premiers octets", async () => {
    const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://1.1.1.1/segment.ts\n';
    vi.mocked(recupererPublic).mockImplementation(async () => new Response(playlist));
    expect(await formatLive("http://8.8.8.8/direct")).toBe("hls");
    const e = await ouvrirEntreeLive("http://8.8.8.8/direct"); entrees.push(e);
    const texte = await (await fetch(e.url)).text();
    expect(texte).toContain("http://127.0.0.1:");
    expect(texte).not.toContain("1.1.1.1");
  });
});
