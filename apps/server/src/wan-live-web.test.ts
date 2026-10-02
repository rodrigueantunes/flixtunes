import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { db, setCatalogPeople } from "./database.js";
import { adresseLiveDistante, lireAccesLiveDistant } from "./live-acces-distant.js";
import { adresseRelayee } from "./live-relais.js";
import { recupererPublic } from "./live-http-public.js";
import { fetchTmdbPreview } from "./tmdb.js";
vi.mock("./live-http-public.js", () => ({ recupererPublic: vi.fn() }));
vi.mock("./tmdb.js", async (original) => ({ ...await original<typeof import("./tmdb.js")>(), fetchTmdbPreview: vi.fn() }));

describe("Live TV, Web et portraits en WAN", () => {
  let wan: Awaited<ReturnType<typeof buildApp>>;
  let lan: Awaited<ReturnType<typeof buildApp>>;
  let profil = "", compte = "";
  let headers: Record<string, string>;
  const id = randomUUID(), library = randomUUID(), film = randomUUID(), acteur = randomUUID();
  const source = "http://8.8.8.8/prive/utilisateur/motdepasse/live.m3u8";
  beforeAll(async () => {
    lan = await buildApp(); wan = await buildApp({ exposition: "wan" });
    compte = (await lan.inject({ method: "POST", url: "/api/system/remote-accounts",
      payload: { username: `r19-${id}`, password: "mot-de-passe-solide-r19" } })).json().id;
    const distant = (await wan.inject({ method: "POST", url: "/api/remote/login",
      payload: { username: `r19-${id}`, password: "mot-de-passe-solide-r19", deviceName: "Test" } })).json().token;
    profil = (await lan.inject({ method: "POST", url: "/api/profiles",
      payload: { name: "WAN R19", avatarColor: "#4488ff", language: "fr-FR" } })).json().id;
    const jeton = (await wan.inject({ method: "POST", url: `/api/profiles/${profil}/unlock`,
      headers: { "x-flixtunes-remote-token": distant }, payload: {} })).json().token;
    headers = { cookie: `flixtunes_remote=${distant}; flixtunes_session=${jeton}`,
      "x-flixtunes-remote-token": distant, "x-flixtunes-profile-token": jeton };
    db.prepare("INSERT INTO live_sources (id,type,libelle,emplacement) VALUES (?,'m3u','R19',?)").run(id, id);
    db.prepare("INSERT INTO live_playlists (id,source_id,nom,url) VALUES (?,?,'R19',?)").run(id, id, source);
    db.prepare("INSERT INTO live_channels (id,cle,nom,nom_recherche,logo,adresses) VALUES (?,?,'R19','r19',?,1)")
      .run(id, id, "http://8.8.8.8/logo.png");
    db.prepare("INSERT INTO live_channel_urls (channel_id,url,playlist_id,releve) VALUES (?,?,?,1)").run(id, source, id);
    db.prepare("INSERT INTO library_folders (id,path,kind,language) VALUES (?,?,'web','fr-FR')").run(library, `D:/${library}`);
    db.prepare("INSERT INTO catalog_items (id,library_id,kind,title,sort_title,search_title) VALUES (?,?,'movie','Test','test','test')").run(film, library);
    setCatalogPeople(film, "tmdb", [{ externalId: acteur, name: "Élodie", profileUrl: `/api/metadata/image/w185/${acteur}.jpg`,
      department: "Acting", role: "actor", character: null, job: null, order: 0 }]);
  });
  beforeEach(() => {
    vi.mocked(recupererPublic).mockReset().mockImplementation(async () => new Response(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="cle.key"\n#EXTINF:6,\nsegment.ts\n',
      { headers: { "content-type": "application/vnd.apple.mpegurl" } }));
    vi.mocked(fetchTmdbPreview).mockReset().mockImplementation(async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/jpeg" } }));
  });
  afterAll(async () => {
    await wan?.close(); await lan?.close();
    db.prepare("DELETE FROM live_channels WHERE id = ?").run(id);
    db.prepare("DELETE FROM live_sources WHERE id = ?").run(id);
    db.prepare("DELETE FROM library_folders WHERE id = ?").run(library);
    db.prepare("DELETE FROM catalog_people WHERE id = ?").run(`tmdb:${acteur}`);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(profil);
    db.prepare("DELETE FROM remote_accounts WHERE id = ?").run(compte);
  });
  it("ouvre les menus et la grille avec session, conserve les réglages privés", async () => {
    for (const url of ["/api/live", "/api/web", "/api/live/channels", "/api/live/listes", "/api/live/pays", "/api/live/fiabilites"]) {
      expect((await wan.inject({ url, headers })).statusCode, url).toBe(200);
      expect((await wan.inject({ url })).statusCode, url).toBe(401);
    }
    expect((await wan.inject({ url: "/api/web", headers })).json().modifiable).toBe(false);
    for (const url of ["/api/system/live", "/api/web/correspondances"]) expect((await wan.inject({ url, headers })).statusCode).toBe(404);
  });
  it("renouvelle avant expiration, conserve l'identité et refuse l'ancien lien expiré", async () => {
    const maintenant = Date.now();
    const horloge = vi.spyOn(Date, "now");
    try {
      const url = "https://8.8.8.8/renouvellement.m3u8";
      horloge.mockReturnValue(maintenant);
      const ancien = adresseLiveDistante(url, profil, id);
      horloge.mockReturnValue(maintenant + (5 * 60 + 35) * 60_000);
      const nouveau = adresseLiveDistante(url, profil, id);
      expect(nouveau).not.toBe(ancien);
      const jeton = (adresse: string) => new URL(adresse, "https://test").searchParams.get("t")!;
      expect(lireAccesLiveDistant(jeton(ancien), profil)?.url).toBe(url);
      expect(lireAccesLiveDistant(jeton(nouveau), profil)?.url).toBe(url);
      expect(lireAccesLiveDistant(jeton(nouveau), "autre-profil")).toBeNull();
      horloge.mockReturnValue(maintenant + 6 * 60 * 60_000 + 1);
      expect(lireAccesLiveDistant(jeton(ancien), profil)).toBeNull();
      expect(lireAccesLiveDistant(jeton(nouveau), profil)?.url).toBe(url);
    } finally { horloge.mockRestore(); }
  });
  it("borne les rapports de stabilité et isole les observations WAN", async () => {
    const detail = (await wan.inject({ url: `/api/live/channels/${id}`, headers })).json();
    const url = detail.sources[0].url;
    const poster = (secondesStables: unknown) => wan.inject({ method: "POST",
      url: `/api/live/channels/${id}/resultat`, headers, payload: { url, ok: true, secondesStables } });
    for (const duree of [-1, 121, "120", 1.5]) expect((await poster(duree)).statusCode).toBe(400);
    expect((await poster(120)).statusCode).toBe(204);
    expect(db.prepare("SELECT secondes FROM live_stabilite WHERE chaine=? AND contexte=?").get(id, `wan:${profil}`))
      .toEqual({ secondes: 120 });
    expect(db.prepare("SELECT 1 FROM live_stabilite WHERE chaine=? AND contexte='lan'").get(id)).toBeUndefined();
  });
  it("masque les adresses, y compris dans les logos et les empreintes", async () => {
    const r = await wan.inject({ url: `/api/live/channels/${id}`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("8.8.8.8"); expect(r.body).not.toContain("motdepasse");
    const donnees = r.json();
    expect(donnees.sources[0].url).toContain("/api/live/relais?t=");
    expect(donnees.logo).toContain("/api/live/relais?t=");
    expect(donnees.sources[0].empreinte).toMatch(/^[a-f0-9]{64}$/);
    const local = (await lan.inject({ url: `/api/live/channels/${id}?profileId=${profil}` })).json();
    expect(local.sources[0].url).toBe(source);
  });
  it("réécrit manifeste, segments et clé avec des accès liés au profil", async () => {
    const url = adresseLiveDistante(source, profil, id);
    const r = await wan.inject({ url, headers: { cookie: headers.cookie! } });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("motdepasse");
    const segment = r.body.trim().split("\n").at(-1)!;
    const acces = lireAccesLiveDistant(new URL(segment, "https://local").searchParams.get("t")!, profil);
    expect(acces?.url).toBe("http://8.8.8.8/prive/utilisateur/motdepasse/segment.ts");
    expect(lireAccesLiveDistant(new URL(segment, "https://local").searchParams.get("t")!, "autre")).toBeNull();
    expect((await wan.inject({ url })).statusCode).toBe(401);
    expect(recupererPublic).toHaveBeenCalledTimes(1);
  });
  it("refuse les anciens liens, les accès altérés et les cibles internes", async () => {
    for (const url of [adresseRelayee(source), "/api/live/relais?t=faux", adresseLiveDistante(source, "autre", id)]) {
      expect((await wan.inject({ url, headers })).statusCode).toBe(404);
    }
    expect((await wan.inject({ url: adresseLiveDistante("http://127.0.0.1/prive", profil, id), headers })).statusCode).toBe(403);
    expect(recupererPublic).not.toHaveBeenCalled();
  });
  it("reconnaît aussi un manifeste servi sans extension ni type HLS", async () => {
    vi.mocked(recupererPublic).mockResolvedValueOnce(new Response("#EXTM3U\n#EXTINF:6,\nsegment.ts\n"));
    const r = await wan.inject({ url: adresseLiveDistante("http://8.8.8.8/live", profil, id), headers });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("mpegurl");
    expect(r.body).toContain("/api/live/relais?t=");
  });
  it("retient la dernière chaîne sans modifier le classement global ni lancer de sondes", async () => {
    const url = adresseLiveDistante(source, profil, id);
    expect((await wan.inject({ method: "POST", url: `/api/live/channels/${id}/resultat`, headers, payload: { url, ok: true } })).statusCode).toBe(204);
    expect(db.prepare("SELECT succes FROM live_channel_urls WHERE channel_id = ?").get(id)).toEqual({ succes: 0 });
    expect((await wan.inject({ url: "/api/live/derniere", headers })).json().chaine.id).toBe(id);
    expect((await wan.inject({ method: "POST", url: `/api/live/channels/${id}/sondes`, headers, payload: {} })).statusCode).toBe(200);
    expect(recupererPublic).not.toHaveBeenCalled();
  });
  it("sert les portraits connus et refuse une image arbitraire ou interdite au profil", async () => {
    const url = `/api/metadata/image/w185/${acteur}.jpg`;
    expect((await wan.inject({ url, headers })).statusCode).toBe(200);
    expect((await wan.inject({ url })).statusCode).toBe(401);
    expect((await wan.inject({ url: "/api/metadata/image/w185/arbitraire.jpg", headers })).statusCode).toBe(404);
    db.prepare("UPDATE profiles SET is_child = 1, age = 8 WHERE id = ?").run(profil);
    db.prepare("UPDATE catalog_items SET age_rating = 18 WHERE id = ?").run(film);
    try { expect((await wan.inject({ url, headers })).statusCode).toBe(404); }
    finally { db.prepare("UPDATE profiles SET is_child = 0 WHERE id = ?").run(profil); }
    expect(fetchTmdbPreview).toHaveBeenCalledTimes(1);
  });
  it("refuse les pages HTML, SVG et manifestes surdimensionnés", async () => {
    vi.mocked(recupererPublic).mockResolvedValueOnce(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    expect((await wan.inject({ url: adresseLiveDistante("http://8.8.8.8/logo.svg", profil, id, "image"), headers })).statusCode).toBe(502);
    vi.mocked(recupererPublic).mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "application/vnd.apple.mpegurl" } }));
    expect((await wan.inject({ url: adresseLiveDistante(source, profil, id), headers })).statusCode).toBe(502);
  });
});
