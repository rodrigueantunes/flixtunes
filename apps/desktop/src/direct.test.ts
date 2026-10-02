import { test } from "node:test";
import assert from "node:assert/strict";
import { adresseDirectAutorisee, CacheDirectBureau, margeDirect, ouvrirDirectBureau, reecrireDirect } from "./direct.ts";

const origine = "https://nas.example";
const source = `${origine}/api/live/relais?t=manifeste`;
const manifeste = "#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:1\n" +
  Array.from({ length: 8 }, (_, i) => `#EXTINF:8,\n/api/live/relais?t=segment${i}`).join("\n");

test("le direct natif ne peut ouvrir que le relais du serveur connecté", () => {
  assert.equal(adresseDirectAutorisee(source, origine), true);
  for (const u of ["file:///etc/passwd", "https://evil.test/api/live/relais", "https://nas.example.evil/api/live/relais",
    "https://secret@nas.example/api/live/relais", "/api/system/config", "//evil.test/api/live/relais"]) {
    assert.equal(adresseDirectAutorisee(u, origine), false, u);
  }
});
test("les manifestes réécrivent segments, variantes et clés", () => {
  const appels: string[] = [];
  const r = reecrireDirect('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/api/live/relais?t=cle"\n/api/live/relais?t=video', source,
    (u) => { appels.push(u); return "http://127.0.0.1/opaque"; });
  assert.deepEqual(appels, [`${origine}/api/live/relais?t=cle`, `${origine}/api/live/relais?t=video`]);
  assert.equal(r.includes("nas.example"), false);
  assert.throws(() => reecrireDirect('#EXTM3U\n#EXT-X-KEY:URI=file:///a', source, (u) => u));
  assert.throws(() => reecrireDirect('#EXTM3U\n#EXTVLCOPT:input-slave=file:///a', source, (u) => u));
  assert.equal(reecrireDirect('#EXTM3U\n#EXT-X-KEY:uri = "cle"', source, () => "locale"), '#EXTM3U\n#EXT-X-KEY:URI="locale"');
});
test("la marge de départ respecte les fenêtres courtes et les programmes terminés", () => {
  assert.equal((margeDirect(manifeste).match(/#EXTINF/g) ?? []).length, 5);
  assert.equal((margeDirect(manifeste, 15).match(/#EXTINF/g) ?? []).length, 7);
  assert.equal((margeDirect(manifeste, 30).match(/#EXTINF/g) ?? []).length, 8);
  assert.equal((margeDirect(manifeste.replaceAll("#EXTINF:8,", "#EXTINF:4,")).match(/#EXTINF/g) ?? []).length, 6);
  assert.equal(margeDirect(manifeste + "\n#EXT-X-ENDLIST"), manifeste + "\n#EXT-X-ENDLIST");
});
test("le cache borne la mémoire, expire et ne conserve pas un segment trop gros", () => {
  const c = new CacheDirectBureau(6);
  c.poser("1", Buffer.from("1234"), 0); c.poser("2", Buffer.from("ab"), 1);
  c.poser("3", Buffer.from("xyz"), 2);
  assert.equal(c.octets, 5); assert.equal(c.lire("1", 3), null);
  c.poser("4", Buffer.alloc(7), 3); assert.equal(c.octets, 5);
  assert.equal(c.lire("2", 90_002), null);
  c.vider(); assert.equal(c.octets, 0);
});
test("le relais sert les segments téléchargés pendant une coupure puis ferme ses connexions", async () => {
  let panne = false, appels = 0;
  const direct = await ouvrirDirectBureau(source, origine, async (u, init) => {
    assert.equal(init.redirect, "manual"); appels++;
    if (panne) return new Response("indisponible", { status: 503 });
    return new Response(u === source ? manifeste : "segment-valide", { headers: { "Content-Type": u === source ? "application/vnd.apple.mpegurl" : "video/mp2t" } });
  });
  try {
    const texte = await (await fetch(direct.url)).text();
    const s = texte.split("\n").find((l) => l.startsWith("http"))!;
    const [a, b] = await Promise.all([fetch(s).then((r) => r.text()), fetch(s).then((r) => r.text())]);
    assert.equal(a, "segment-valide"); assert.equal(a, b); assert.equal(appels, 2);
    panne = true;
    assert.equal(await (await fetch(s)).text(), a);
    assert.equal((await fetch(direct.url)).status, 200);
    assert.ok(direct.diagnostic().cacheOctets > 0);
    assert.equal((await fetch(direct.url.replace(/\/[a-f0-9]{48}\//, "/incorrect/"))).status, 404);
  } finally { await direct.fermer(); }
  await assert.rejects(fetch(direct.url));
});
test("une révocation ne réutilise pas un ancien manifeste et aucune redirection ne sort du NAS", async () => {
  let statut = 200;
  const direct = await ouvrirDirectBureau(source, origine, async () => new Response(statut === 200 ? manifeste : "refus",
    { status: statut, headers: { "Content-Type": "application/vnd.apple.mpegurl", Location: "https://evil.test/" } }));
  try {
    assert.equal((await fetch(direct.url)).status, 200);
    statut = 401; assert.equal((await fetch(direct.url)).status, 502);
  } finally { await direct.fermer(); }
});
test("un manifeste sortant est refusé sans charger son adresse externe", async () => {
  let appels = 0;
  const direct = await ouvrirDirectBureau(source, origine, async () => {
    appels++; return new Response("#EXTM3U\n#EXTINF:8,\nhttps://evil.test/segment.ts");
  });
  try { assert.equal((await fetch(direct.url)).status, 502); assert.equal(appels, 1); }
  finally { await direct.fermer(); }
});
test("une playlist fragmentée sans type HTTP reste contrôlée", async () => {
  const direct = await ouvrirDirectBureau(source, origine, async () => new Response(new ReadableStream({
    start(c) { c.enqueue(Buffer.from("#EX")); c.enqueue(Buffer.from("TM3U\nhttps://evil.test/a")); c.close(); },
  })));
  try { assert.equal((await fetch(direct.url)).status, 502); } finally { await direct.fermer(); }
});
test("le renouvellement d'un maître préserve les URL VLC et remplace les jetons des variantes", async () => {
  const nouvelle = `${origine}/api/live/relais?t=nouveau`;
  const appels: string[] = [];
  const direct = await ouvrirDirectBureau(source, origine, async (u) => {
    appels.push(u);
    const maitre = (t: string) => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n/api/live/relais?t=${t}`;
    return new Response(u === source ? maitre("variante1") : u === nouvelle ? maitre("variante2") : manifeste,
      { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
  });
  try {
    const ancien = await (await fetch(direct.url)).text();
    const variante = ancien.split("\n").find((l) => l.startsWith("http"))!;
    await (await fetch(variante)).text();
    assert.equal(await direct.renouveler(nouvelle), true);
    await (await fetch(variante)).text();
    assert.equal(appels.at(-1), `${origine}/api/live/relais?t=variante2`);
    assert.equal(await direct.renouveler("https://evil.test/api/live/relais"), false);
  } finally { await direct.fermer(); }
});
test("un gros segment reste lisible sans être conservé dans le cache", async () => {
  const gros = Buffer.alloc(13 * 1024 * 1024, 0x47);
  const direct = await ouvrirDirectBureau(source, origine, async (u) => u === source ? new Response(manifeste) :
    new Response(gros, { headers: { "Content-Type": "video/mp2t", "Content-Length": String(gros.length) } }));
  try {
    const texte = await (await fetch(direct.url)).text();
    const s = texte.split("\n").find((l) => l.startsWith("http"))!;
    const r = await fetch(s);
    assert.equal(r.status, 200); assert.equal((await r.arrayBuffer()).byteLength, gros.length);
    assert.equal(direct.diagnostic().cacheOctets, 0);
  } finally { await direct.fermer(); }
});
