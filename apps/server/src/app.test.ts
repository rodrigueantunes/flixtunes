import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { db } from "./database.js";
import { config } from "./config.js";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("API FlixTunes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app?.close(); });

  it("répond au contrôle de santé", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", name: "FlixTunes", version: config.version, step: config.step, phase: config.phase });
  });

  it("durcit les réponses et expose le diagnostic NAS", async () => {
    const response = await app.inject({ method: "GET", url: "/api/system/status" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.json()).toMatchObject({ database: { integrity: "ok" }, security: { trustedLanCors: true } });
    const publicOrigin = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://example.com" } });
    expect(publicOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("initialise le profil local et l'accueil", async () => {
    const response = await app.inject({ method: "GET", url: "/api/home" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ profile: { name: "Principal" }, recentlyAdded: expect.any(Array), completed: expect.any(Array) });
  });

  it("sert le catalogue par pages et refuse les paramètres invalides", async () => {
    // Cette route a d'abord été déclarée sur « /api/catalog », déjà pris par le centre de
    // correspondances : Fastify refusait le doublon et l'application entière ne démarrait plus.
    const page = await app.inject({ method: "GET", url: "/api/catalog/browse?kind=movies&limit=10" });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ items: expect.any(Array), total: expect.any(Number), offset: 0, limit: 10 });
    expect(page.json().items.length).toBeLessThanOrEqual(10);

    // Le centre de correspondances reste servi par son propre chemin, avec ses propres exigences.
    const matching = await app.inject({ method: "GET", url: "/api/catalog" });
    expect(matching.statusCode).toBe(400);
    expect(matching.json().message).toBe("Bibliothèque requise");

    for (const query of ["", "?kind=séries", "?kind=movies&sort=aléatoire", "?kind=movies&filter=peut-être",
      "?kind=movies&offset=-1", "?kind=movies&limit=0", "?kind=movies&limit=abc"]) {
      const rejected = await app.inject({ method: "GET", url: `/api/catalog/browse${query}` });
      expect(rejected.statusCode, `paramètres « ${query} »`).toBe(400);
    }
  });

  it("expose l'état de configuration et les scans par bibliothèque", async () => {
    const response = await app.inject({ method: "GET", url: "/api/setup" });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().libraries)).toBe(true);
    const history = await app.inject({ method: "GET", url: "/api/scans" });
    expect(history.statusCode).toBe(200);
    expect(Array.isArray(history.json())).toBe(true);
    const invalid = await app.inject({ method: "POST", url: "/api/scans", payload: { scope: "library", mode: "files" } });
    expect(invalid.statusCode).toBe(400);
  });

  it("parcourt uniquement les dossiers des racines locales autorisées", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-api-browser-"));
    const previous = process.env.FLIXTUNES_BROWSE_ROOTS;
    process.env.FLIXTUNES_BROWSE_ROOTS = root;
    try {
      await mkdir(path.join(root, "Films"));
      const canonicalRoot = await realpath(root);
      const roots = await app.inject({ method: "GET", url: "/api/filesystem/directories" });
      expect(roots.statusCode).toBe(200);
      expect(roots.json().directories).toEqual([{ name: path.basename(canonicalRoot), path: canonicalRoot }]);
      const listing = await app.inject({ method: "GET", url: `/api/filesystem/directories?path=${encodeURIComponent(root)}` });
      expect(listing.statusCode).toBe(200);
      expect(listing.json().directories).toEqual([{ name: "Films", path: path.join(canonicalRoot, "Films") }]);
      const denied = await app.inject({ method: "GET", url: `/api/filesystem/directories?path=${encodeURIComponent(os.tmpdir())}` });
      expect(denied.statusCode).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.FLIXTUNES_BROWSE_ROOTS;
      else process.env.FLIXTUNES_BROWSE_ROOTS = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("valide les paramètres d'une recherche de métadonnées", async () => {
    expect((await app.inject({ method: "GET", url: "/api/metadata/search?kind=book&query=Dune" })).statusCode).toBe(400);
    const valid = await app.inject({ method: "GET", url: "/api/metadata/search?kind=movie&query=Dune&language=fr-FR" });
    expect(valid.statusCode).toBe(200);
    expect(Array.isArray(valid.json())).toBe(true);
  });

  it("configure un fournisseur sans exposer son jeton", async () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.jeton-api-test-tmdb";
    try {
      expect((await app.inject({ method: "PATCH", url: "/api/metadata/providers", payload: { tmdbToken: "court" } })).statusCode).toBe(400);
      const response = await app.inject({ method: "PATCH", url: "/api/metadata/providers", payload: { tmdbToken: token } });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(token);
      expect(response.json().providers.find((provider: { id: string }) => provider.id === "tmdb")).toMatchObject({ enabled: true, configured: true });
      const stored = db.prepare("SELECT value FROM server_settings WHERE key = 'provider_secret_tmdbToken'").get() as { value: string };
      expect(stored.value).not.toContain(token);
      expect(stored.value).toMatch(/^v1:/);
    } finally {
      db.prepare("DELETE FROM server_settings WHERE key = 'provider_secret_tmdbToken'").run();
    }
  });

  it("crée, modifie et supprime un profil localisé", async () => {
    const created = await app.inject({ method: "POST", url: "/api/profiles", payload: {
      name: "Cinéphile", avatarColor: "#8b5cf6", language: "en-US",
    } });
    expect(created.statusCode).toBe(201);
    const profile = created.json();
    expect(profile).toMatchObject({ name: "Cinéphile", language: "en-US" });
    const updated = await app.inject({ method: "PATCH", url: `/api/profiles/${profile.id}`, payload: { language: "fr-FR",
      preferredAudioLanguages: ["original", "fr", "en"], audioOutputMode: "ac3", audioNormalization: true, nightMode: true,
      dynamicRangePriority: "dolbyvision", resumeMode: "ask", resumeRewindSeconds: 10,
      defaultPlaybackRate: 1.25, autoplayNext: false, autoplayLimit: 5 } });
    expect(updated.json()).toMatchObject({ language: "fr-FR", preferredAudioLanguages: ["original", "fr", "en"],
      audioOutputMode: "ac3", audioNormalization: true, nightMode: true, dynamicRangePriority: "dolbyvision",
      resumeMode: "ask", resumeRewindSeconds: 10,
      defaultPlaybackRate: 1.25, autoplayNext: false, autoplayLimit: 5 });
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${profile.id}` })).statusCode).toBe(204);
  });

  it("organise les profils par groupe et masque côté serveur les classifications supérieures à l'âge enfant", async () => {
    const suffix = Math.random().toString(36).slice(2);
    const groupResponse = await app.inject({ method: "POST", url: "/api/profile-groups", payload: { name: `Famille ${suffix}` } });
    expect(groupResponse.statusCode).toBe(201);
    const group = groupResponse.json();
    const missingAge = await app.inject({ method: "POST", url: "/api/profiles", payload: {
      groupId: group.id, name: "Enfant invalide", avatarColor: "#10b981", language: "fr-FR", isChild: true,
    } });
    expect(missingAge.statusCode).toBe(400);
    const profileResponse = await app.inject({ method: "POST", url: "/api/profiles", payload: {
      groupId: group.id, name: `Enfant ${suffix}`, avatarColor: "#10b981", language: "fr-FR", isChild: true, age: 10,
    } });
    expect(profileResponse.statusCode).toBe(201);
    const profile = profileResponse.json();
    expect(profile).toMatchObject({ groupId: group.id, isChild: true, age: 10 });
    const libraryId = `parental-lib-${suffix}`;
    const visibleId = `parental-visible-${suffix}`;
    const hiddenId = `parental-hidden-${suffix}`;
    const unknownId = `parental-unknown-${suffix}`;
    try {
      const groupProfiles = await app.inject({ method: "GET", url: `/api/profiles?groupId=${group.id}` });
      expect(groupProfiles.json().map((entry: { id: string }) => entry.id)).toEqual([profile.id]);
      db.prepare("INSERT INTO library_folders (id, name, path, kind) VALUES (?, ?, ?, 'movie')")
        .run(libraryId, "Contrôle parental", `C:\\parental-${suffix}`);
      for (const item of [
        { id: visibleId, title: `Film jeunesse ${suffix}`, age: 8 },
        { id: hiddenId, title: `Film adulte ${suffix}`, age: 16 },
        { id: unknownId, title: `Film non classé ${suffix}`, age: null },
      ]) {
        db.prepare(`INSERT INTO catalog_items
          (id, library_id, kind, title, sort_title, age_rating) VALUES (?, ?, 'movie', ?, ?, ?)`)
          .run(item.id, libraryId, item.title, item.title.toLowerCase(), item.age);
        db.prepare(`INSERT INTO media_items
          (id, kind, title, sort_title, library_id, catalog_id, available)
          VALUES (?, 'movie', ?, ?, ?, ?, 1)`)
          .run(`media-${item.id}`, item.title, item.title.toLowerCase(), libraryId, item.id);
      }
      const browse = await app.inject({ method: "GET", url: `/api/catalog/browse?kind=movies&profileId=${profile.id}` });
      const ids = browse.json().items.map((entry: { catalogId: string }) => entry.catalogId);
      expect(ids).toContain(visibleId);
      expect(ids).toContain(unknownId);
      expect(ids).not.toContain(hiddenId);
      expect((await app.inject({ method: "GET", url: `/api/catalog/${hiddenId}/details?profileId=${profile.id}` })).statusCode).toBe(404);
      const search = await app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(`Film adulte ${suffix}`)}&profileId=${profile.id}` });
      expect(search.json()).toEqual([]);
    } finally {
      db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
      await app.inject({ method: "DELETE", url: `/api/profiles/${profile.id}` });
      await app.inject({ method: "DELETE", url: `/api/profile-groups/${group.id}` });
    }
  });

  it("marque une saison puis une série entière comme vues", async () => {
    const suffix = Math.random().toString(36).slice(2); const libraryId = `watched-lib-${suffix}`;
    const showId = `watched-show-${suffix}`; const seasons = [1, 2].map((n) => `watched-season-${n}-${suffix}`);
    const episodes = seasons.flatMap((seasonId, seasonIndex) => [1, 2].map((n) => ({
      id: `watched-episode-${seasonIndex + 1}-${n}-${suffix}`, seasonId, season: seasonIndex + 1, episode: n,
    })));
    const profile = (await app.inject({ method: "GET", url: "/api/profiles" })).json()[0];
    try {
      db.prepare("INSERT INTO library_folders (id, name, path, kind) VALUES (?, ?, ?, 'tv')")
        .run(libraryId, "Séries vues", `C:\\watched-${suffix}`);
      db.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title) VALUES (?, ?, 'show', ?, ?)")
        .run(showId, libraryId, "Série vue", `serie-vue-${suffix}`);
      seasons.forEach((id, index) => db.prepare(`INSERT INTO catalog_items
        (id, library_id, parent_id, kind, title, sort_title, season_number) VALUES (?, ?, ?, 'season', ?, ?, ?)`)
        .run(id, libraryId, showId, `Saison ${index + 1}`, `saison-${index + 1}`, index + 1));
      episodes.forEach((episode) => {
        db.prepare(`INSERT INTO catalog_items
          (id, library_id, parent_id, kind, title, sort_title, season_number, episode_number)
          VALUES (?, ?, ?, 'episode', ?, ?, ?, ?)`)
          .run(episode.id, libraryId, episode.seasonId, `Épisode ${episode.episode}`, episode.id, episode.season, episode.episode);
        db.prepare(`INSERT INTO media_items
          (id, kind, title, sort_title, library_id, catalog_id, available, show_title, season_number, episode_number)
          VALUES (?, 'episode', ?, ?, ?, ?, 1, 'Série vue', ?, ?)`)
          .run(`media-${episode.id}`, `Épisode ${episode.episode}`, episode.id, libraryId, episode.id, episode.season, episode.episode);
      });
      expect((await app.inject({ method: "PUT", url: `/api/catalog/${seasons[0]}/watched?profileId=${profile.id}`,
        payload: { completed: true } })).json()).toMatchObject({ completed: true, count: 2 });
      let details = (await app.inject({ method: "GET", url: `/api/catalog/${showId}/details?profileId=${profile.id}` })).json();
      expect(details.seasons.map((entry: { completed: boolean }) => entry.completed)).toEqual([true, false]);
      expect(details.item.completed).toBe(false);
      expect((await app.inject({ method: "PUT", url: `/api/catalog/${showId}/watched?profileId=${profile.id}`,
        payload: { completed: true } })).json()).toMatchObject({ completed: true, count: 4 });
      details = (await app.inject({ method: "GET", url: `/api/catalog/${showId}/details?profileId=${profile.id}` })).json();
      expect(details.item.completed).toBe(true);
      expect(details.seasons.every((entry: { completed: boolean }) => entry.completed)).toBe(true);
      const watched = (await app.inject({ method: "GET", url: `/api/catalog/browse?kind=shows&filter=watched&profileId=${profile.id}` })).json();
      expect(watched.items.some((entry: { id: string; completed: boolean }) => entry.id === showId && entry.completed)).toBe(true);
      await app.inject({ method: "PUT", url: `/api/catalog/${showId}/watched?profileId=${profile.id}`, payload: { completed: false } });
      details = (await app.inject({ method: "GET", url: `/api/catalog/${showId}/details?profileId=${profile.id}` })).json();
      expect(details.item.completed).toBe(false);
    } finally {
      db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
    }
  });

  it("protège un profil avec un PIN haché", async () => {
    const created = await app.inject({ method: "POST", url: "/api/profiles", payload: {
      name: "Enfant", avatarColor: "#10b981", language: "fr-FR", pin: "2468",
    } });
    const profile = created.json();
    try {
      expect(profile).toMatchObject({ protected: true });
      expect(created.body).not.toContain("2468");
      expect((await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/unlock`, payload: { pin: "1111" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: `/api/home?profileId=${profile.id}` })).statusCode).toBe(404);
      const unlocked = await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/unlock`, payload: { pin: "2468" } });
      expect(unlocked.statusCode).toBe(200);
      expect(unlocked.json()).toMatchObject({ unlocked: true });
      expect(typeof unlocked.json().token).toBe("string");
      expect((await app.inject({ method: "GET", url: `/api/home?profileId=${profile.id}`,
        headers: { "x-flixtunes-profile-token": unlocked.json().token } })).statusCode).toBe(200);
    } finally { await app.inject({ method: "DELETE", url: `/api/profiles/${profile.id}` }); }
  });

  it("isole la progression et l'historique entre les profils", async () => {
    const suffix = Math.random().toString(36).slice(2);
    const libraryId = `test-library-${suffix}`; const catalogId = `test-catalog-${suffix}`; const mediaId = `test-media-${suffix}`;
    db.prepare("INSERT INTO library_folders (id, name, path, kind) VALUES (?, ?, ?, 'movie')")
      .run(libraryId, "Tests", `C:\\flixtunes-tests-${suffix}`);
    db.prepare("INSERT INTO catalog_items (id, library_id, kind, title, sort_title) VALUES (?, ?, 'movie', 'Film test', 'film test')")
      .run(catalogId, libraryId);
    db.prepare("INSERT INTO media_items (id, kind, title, sort_title, library_id, catalog_id, available) VALUES (?, 'movie', 'Film test', 'film test', ?, ?, 1)")
      .run(mediaId, libraryId, catalogId);
    let firstId = ""; let secondId = "";
    try {
      firstId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: `A-${suffix}`, avatarColor: "#2968ff", language: "fr-FR" } })).json().id;
      secondId = (await app.inject({ method: "POST", url: "/api/profiles", payload: { name: `B-${suffix}`, avatarColor: "#10b981", language: "fr-FR" } })).json().id;
      expect((await app.inject({ method: "PUT", url: `/api/media/${mediaId}/progress?profileId=${firstId}`, payload: { positionSeconds: 95, durationSeconds: 100 } })).statusCode).toBe(204);
      const subtitlePreference = { selectionType: "external", streamIndex: null, externalName: "Film test.fr.srt",
        offsetSeconds: -2.5, size: "large", background: true, color: "yellow", position: "top", fontFamily: "sans", encodingOverride: "windows-1252" };
      expect((await app.inject({ method: "PUT", url: `/api/media/${mediaId}/subtitle-preference?profileId=${firstId}`,
        payload: subtitlePreference })).statusCode).toBe(204);
      expect((await app.inject({ method: "GET", url: `/api/media/${mediaId}/subtitle-preference?profileId=${firstId}` })).json())
        .toEqual(subtitlePreference);
      expect((await app.inject({ method: "GET", url: `/api/media/${mediaId}/subtitle-preference?profileId=${secondId}` })).json()).toBeNull();
      const firstHome = (await app.inject({ method: "GET", url: `/api/home?profileId=${firstId}` })).json();
      const secondHome = (await app.inject({ method: "GET", url: `/api/home?profileId=${secondId}` })).json();
      expect(firstHome.completed.some((item: { id: string }) => item.id === mediaId)).toBe(true);
      expect(secondHome.completed.some((item: { id: string }) => item.id === mediaId)).toBe(false);
      const details = await app.inject({ method: "GET", url: `/api/catalog/${catalogId}/details?profileId=${firstId}` });
      expect(details.json().item).toMatchObject({
        id: mediaId, completed: true, progressPercent: 95,
        progressPositionSeconds: 95, progressDurationSeconds: 100,
      });
    } finally {
      if (firstId) db.prepare("DELETE FROM profiles WHERE id = ?").run(firstId);
      if (secondId) db.prepare("DELETE FROM profiles WHERE id = ?").run(secondId);
      db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
    }
  });

  it("retourne les épisodes voisins dans l'ordre saison/épisode", async () => {
    const suffix = Math.random().toString(36).slice(2); const libraryId = `neighbors-lib-${suffix}`;
    const profile = (await app.inject({ method: "GET", url: "/api/profiles" })).json()[0];
    const mediaIds = [1, 2, 3].map((number) => `neighbors-media-${number}-${suffix}`);
    try {
      db.prepare("INSERT INTO library_folders (id, name, path, kind) VALUES (?, ?, ?, 'tv')").run(libraryId, "Voisins", `C:\\neighbors-${suffix}`);
      for (let index = 0; index < mediaIds.length; index += 1) db.prepare(`INSERT INTO media_items
        (id, kind, title, sort_title, library_id, available, show_title, season_number, episode_number)
        VALUES (?, 'episode', ?, ?, ?, 1, 'Série ordonnée', ?, ?)`)
        .run(mediaIds[index]!, `Épisode ${index + 1}`, String(index + 1).padStart(4, "0"), libraryId, index === 2 ? 2 : 1, index === 2 ? 1 : index + 1);
      const response = await app.inject({ method: "GET", url: `/api/media/${mediaIds[1]}/neighbors?profileId=${profile.id}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ previous: { id: mediaIds[0] }, next: { id: mediaIds[2] } });
    } finally { db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId); }
  });

  it("refuse une planche de vignettes hors limite", async () => {
    // Ce cas visait `/timeline-thumbnail?at=`, disparu avec le passage aux planches. Il recevait donc
    // 404 au lieu de 400 : il continuait de décrire une route qui n'existe plus, et personne ne l'a
    // vu parce que cette suite n'avait pas été relancée depuis le renommage.
    for (const planche of ["-1", "501", "abc"]) {
      const refus = await app.inject({ method: "GET", url: `/api/media/inconnu/timeline-sheet?sheet=${planche}` });
      expect(refus.statusCode, `planche ${planche}`).toBe(400);
    }
    // Une planche valide sur un média inconnu doit passer la validation et échouer plus loin, sinon
    // le cas ci-dessus serait satisfait par n'importe quel refus.
    const introuvable = await app.inject({ method: "GET", url: "/api/media/inconnu/timeline-sheet?sheet=0" });
    expect(introuvable.statusCode).toBe(404);
  });

  it("protège réellement les écritures quand le jeton local est activé", async () => {
    const previous = config.apiToken;
    config.apiToken = "audit-secret";
    try {
      const denied = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Refusé", avatarColor: "#2968ff", language: "fr-FR" } });
      expect(denied.statusCode).toBe(401);
      const allowed = await app.inject({ method: "POST", url: "/api/profiles", headers: { "x-flixtunes-token": "audit-secret" },
        payload: { name: "Autorisé", avatarColor: "#2968ff", language: "fr-FR" } });
      expect(allowed.statusCode).toBe(201);
      await app.inject({ method: "DELETE", url: `/api/profiles/${allowed.json().id}`, headers: { authorization: "Bearer audit-secret" } });
    } finally {
      config.apiToken = previous;
    }
  });
});
