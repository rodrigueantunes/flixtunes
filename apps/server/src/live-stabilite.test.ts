import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { classerParStabilite, classerPourLecteur, lecteurWeb, noterStabilite } from "./live-stabilite.js";

describe("classement de la stabilité réellement observée", () => {
  const id = randomUUID();
  const sources = [{ url: "https://tv.test/rapide" }, { url: "https://tv.test/stable" }];
  const maintenant = Date.now();
  beforeAll(() => {
    db.prepare("INSERT INTO live_sources (id,type,libelle,emplacement) VALUES (?,'m3u','Test',?)").run(id, id);
    db.prepare("INSERT INTO live_playlists (id,source_id,nom,url) VALUES (?,?,'Test',?)").run(id, id, sources[0]!.url);
    db.prepare("INSERT INTO live_channels (id,cle,nom,nom_recherche,adresses) VALUES (?,?,'Test','test',2)").run(id, id);
    for (const s of sources) db.prepare("INSERT INTO live_channel_urls (channel_id,url,playlist_id) VALUES (?,?,?)").run(id, s.url, id);
  });
  afterAll(() => {
    db.prepare("DELETE FROM live_channels WHERE id = ?").run(id);
    db.prepare("DELETE FROM live_sources WHERE id = ?").run(id);
  });
  it("préfère deux minutes stables, garde les anciennes priorités sans mesure", () => {
    expect(classerParStabilite(id, sources, "lan", maintenant)).toEqual(sources);
    noterStabilite(id, sources[1]!.url, "lan", 120, false, maintenant);
    expect(classerParStabilite(id, sources, "lan", maintenant)[0]).toEqual(sources[1]);
  });
  it("isole chaque profil WAN et ne laisse pas multiplier les rapports", () => {
    noterStabilite(id, sources[0]!.url, "wan:A", 120, false, maintenant);
    noterStabilite(id, sources[0]!.url, "wan:A", 120, false, maintenant + 100);
    expect(db.prepare("SELECT secondes FROM live_stabilite WHERE chaine=? AND contexte='wan:A'").get(id)).toEqual({ secondes: 120 });
    expect(classerParStabilite(id, sources, "lan", maintenant)[0]).toEqual(sources[1]);
    expect(classerParStabilite(id, sources, "wan:B", maintenant)).toEqual(sources);
  });
  it("retire temporairement une source puis autorise sa récupération", () => {
    noterStabilite(id, sources[1]!.url, "lan", 0, true, maintenant + 31_000);
    expect(classerParStabilite(id, sources, "lan", maintenant + 32_000)[0]).toEqual(sources[0]);
    expect(classerParStabilite(id, sources, "lan", maintenant + 152_000)[0]).toEqual(sources[1]);
    expect(classerParStabilite(id, sources, "lan", maintenant + 8 * 86400_000)).toEqual(sources);
  });
  it("ignore une URL étrangère à la chaîne", () => {
    noterStabilite(id, "https://inconnu.test", "lan", 120, false, maintenant);
    expect(db.prepare("SELECT 1 FROM live_stabilite WHERE url='https://inconnu.test'").get()).toBeUndefined();
  });
  it("le classement VLC ne reprend pas les incompatibilités du navigateur", () => {
    expect(lecteurWeb("bureau-vlc")).toBe("bureau-vlc");
    noterStabilite(id, sources[1]!.url, "lan:bureau-vlc:relais", 120, false, maintenant);
    expect(classerPourLecteur(id, sources, "lan", "bureau-vlc", maintenant)[0]!.url).toBe(sources[1]!.url);
    expect(classerPourLecteur(id, sources, "lan", "web-safari", maintenant)).toEqual(sources);
    expect(classerPourLecteur(id, sources, "wan:B", "bureau-vlc", maintenant)).toEqual(sources);
  });
  it("sépare Android, les familles Web et la route qui fonctionne", () => {
    const avant = classerPourLecteur(id, sources, "lan", null, maintenant);
    noterStabilite(id, sources[0]!.url, "lan:web-chromium:direct", 0, true, maintenant);
    noterStabilite(id, sources[0]!.url, "lan:web-chromium:relais", 120, false, maintenant);
    const chrome = classerPourLecteur(id, sources, "lan", "web-chromium", maintenant);
    expect(chrome[0]).toMatchObject({ url: sources[0]!.url, cheminPrefere: "relais" });
    expect(classerPourLecteur(id, sources, "lan", "web-firefox", maintenant)).toEqual(sources);
    expect(classerPourLecteur(id, sources, "lan", null, maintenant)).toEqual(avant);
    expect(lecteurWeb("../../arbitraire")).toBeNull();
  });
});
