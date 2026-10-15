import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ sources: new Map<string, string[]>(), chaines: [] as Array<{ id: string; nom: string; adresses?: number }> }));
vi.mock("./television-direct.js", () => ({
  chaineDetaillee: (id: string) => fixture.sources.has(id) ? { sources: fixture.sources.get(id)!.map((url) => ({ url })) } : null,
  listerChaines: () => ({ items: fixture.chaines, total: fixture.chaines.length }),
}));
import { debutDeVideo, etatVerification, lancerVerification, oublierVerifications, sansLesSourcesMortes, sourceJoue, sourcesMortesDe } from "./live-verification.js";

const ts = Buffer.alloc(376, 0); ts[0] = 0x47; ts[188] = 0x47;
/** Un petit Internet : chaque adresse rend un corps et un statut. */
function reseau(pages: Record<string, { statut?: number; corps: string | Buffer }>) {
  const appels: string[] = [];
  const recuperer = async (url: string) => {
    appels.push(url);
    const page = pages[url];
    if (!page) return new Response("introuvable", { status: 404 });
    return new Response(typeof page.corps === "string" ? page.corps : new Uint8Array(page.corps), { status: page.statut ?? 200 });
  };
  return { appels, outils: { recuperer, autorise: async () => true } };
}
const maitre = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nhd.m3u8\n";
const variante = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\ns1.ts\n#EXTINF:6,\ns2.ts\n";

describe("une source joue-t-elle maintenant ?", () => {
  it("descend de la liste maîtresse à la variante, puis au dernier segment publié", async () => {
    const { appels, outils } = reseau({ "https://a.test/m.m3u8": { corps: maitre }, "https://a.test/hd.m3u8": { corps: variante },
      "https://a.test/s2.ts": { corps: ts } });
    expect(await sourceJoue("https://a.test/m.m3u8", outils)).toBe(true);
    expect(appels).toEqual(["https://a.test/m.m3u8", "https://a.test/hd.m3u8", "https://a.test/s2.ts"]);
  });
  it("refuse une liste figée dont le segment rend une page d'erreur, ou a disparu", async () => {
    const html = reseau({ "https://a.test/v.m3u8": { corps: variante }, "https://a.test/s2.ts": { corps: "<html>Chaîne indisponible</html>" } });
    expect(await sourceJoue("https://a.test/v.m3u8", html.outils)).toBe(false);
    const absent = reseau({ "https://a.test/v.m3u8": { corps: variante } });
    expect(await sourceJoue("https://a.test/v.m3u8", absent.outils)).toBe(false);
    const refus = reseau({ "https://a.test/v.m3u8": { statut: 403, corps: "interdit" } });
    expect(await sourceJoue("https://a.test/v.m3u8", refus.outils)).toBe(false);
  });
  it("juge un flux servi tel quel à ses premiers octets", async () => {
    const brut = reseau({ "https://a.test/direct": { corps: ts } });
    expect(await sourceJoue("https://a.test/direct", brut.outils)).toBe(true);
    expect(debutDeVideo(Buffer.from("<!DOCTYPE html>"))).toBe(false);
    expect(debutDeVideo(Buffer.from([0, 0, 0, 24, ...Buffer.from("styp")]))).toBe(true);
    expect(debutDeVideo(Buffer.from("ID3\u0004"))).toBe(true);
  });
});

describe("vérification des chaînes d'une recherche", () => {
  beforeEach(() => { oublierVerifications(); fixture.sources.clear(); });
  it("rend les chaînes qui jouent, dans l'ordre de la recherche, en essayant leurs autres sources", async () => {
    fixture.chaines = [{ id: "a", nom: "A" }, { id: "b", nom: "B" }, { id: "c", nom: "C" }];
    fixture.sources.set("a", ["https://a.test/morte.m3u8", "https://a.test/v.m3u8"]);
    fixture.sources.set("b", ["https://b.test/morte.m3u8"]);
    fixture.sources.set("c", ["https://c.test/direct"]);
    const { outils } = reseau({ "https://a.test/v.m3u8": { corps: variante }, "https://a.test/s2.ts": { corps: ts }, "https://c.test/direct": { corps: ts } });
    const { id, total } = lancerVerification("profil", { q: "x" }, outils);
    expect(total).toBe(3);
    let etat = etatVerification(id, "profil")!;
    while (!etat.fini) { await new Promise((r) => setTimeout(r, 10)); etat = etatVerification(id, "profil")!; }
    expect(etat.faites).toBe(3);
    expect(etat.chaines!.map((c) => c.id)).toEqual(["a", "c"]);
    expect(etat.mortes).toEqual(["b"]);
    // Le résultat est propre au profil.
    expect(etatVerification(id, "autre")).toBeNull();
  });
  it("vérifie en fond les autres sources des chaînes qui jouent, et les retire au lecteur qui cite la vérification", async () => {
    fixture.chaines = [{ id: "a", nom: "A", adresses: 4 }];
    fixture.sources.set("a", ["https://a.test/v.m3u8", "https://a.test/morte1.m3u8", "https://c.test/direct", "https://a.test/morte2.m3u8"]);
    const { outils } = reseau({ "https://a.test/v.m3u8": { corps: variante }, "https://a.test/s2.ts": { corps: ts }, "https://c.test/direct": { corps: ts } });
    const { id } = lancerVerification("profil", { q: "x" }, outils);
    let etat = etatVerification(id, "profil")!;
    while (!etat.sourcesFinies) { await new Promise((r) => setTimeout(r, 10)); etat = etatVerification(id, "profil")!; }
    expect(etat.fini).toBe(true);
    expect([...sourcesMortesDe(id, "profil", "a")!].sort()).toEqual(["https://a.test/morte1.m3u8", "https://a.test/morte2.m3u8"]);
    // Le nombre d'adresses affiché sur la carte suit.
    expect(etat.chaines![0]!.adresses).toBe(2);
    // Une vérification inconnue, ou d'un autre profil, ne retire rien.
    expect(sourcesMortesDe("inconnue", "profil", "a")).toBeNull();
    expect(sourcesMortesDe(id, "autre", "a")).toBeNull();
  });
  it("ne vide jamais une chaîne : sans source vivante, elle s'ouvre entière", () => {
    const sources = [{ url: "u1" }, { url: "u2" }];
    expect(sansLesSourcesMortes(sources, new Set(["u1"]))).toEqual([{ url: "u2" }]);
    expect(sansLesSourcesMortes(sources, new Set(["u1", "u2"]))).toEqual(sources);
    expect(sansLesSourcesMortes(sources, null)).toEqual(sources);
  });
  it("remplace la vérification précédente du profil : une autre recherche a été faite", () => {
    fixture.chaines = [{ id: "a", nom: "A" }];
    fixture.sources.set("a", ["https://a.test/v.m3u8"]);
    const premiere = lancerVerification("profil", { q: "x" }, reseau({}).outils);
    const seconde = lancerVerification("profil", { q: "y" }, reseau({}).outils);
    expect(etatVerification(premiere.id, "profil")).toBeNull();
    expect(etatVerification(seconde.id, "profil")).not.toBeNull();
  });
});
