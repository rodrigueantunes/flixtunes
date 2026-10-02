import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "./database.js";
import { illustrerChaineConnue, illustrerVideoWeb, oublierLesChainesConnues, reparerAvatarsWeb } from "./web-analyse.js";
import { appliquerCorrespondanceWeb } from "./web-correspondances.js";
import { avatarChaineYoutubeParId, identifierChaineYoutube } from "./web-fournisseurs.js";
import { cacheRemoteArtwork } from "./artwork.js";
vi.mock("./web-fournisseurs.js", async (original) => ({ ...await original<typeof import("./web-fournisseurs.js")>(),
  avatarChaineYoutubeParId: vi.fn(), identifierChaineYoutube: vi.fn() }));
vi.mock("./artwork.js", async (original) => ({ ...await original<typeof import("./artwork.js")>(), cacheRemoteArtwork: vi.fn() }));
const library = randomUUID(), chaine = randomUUID(), video = randomUUID(), dossier = `D:/${library}/YouTube/Arte`;
const poster = () => (db.prepare("SELECT poster_url FROM catalog_items WHERE id = ?").get(chaine) as { poster_url: string | null }).poster_url;
beforeEach(() => {
  vi.resetAllMocks(); oublierLesChainesConnues();
  db.prepare("INSERT INTO library_folders(id,path,kind,language) VALUES (?,?,'web','fr-FR')").run(library, `D:/${library}`);
  db.prepare("INSERT INTO catalog_items(id,library_id,kind,title,sort_title,search_title,source_folder) VALUES (?,?,'show','Arte','arte','arte',?)").run(chaine, library, dossier);
  db.prepare("INSERT INTO catalog_items(id,library_id,parent_id,kind,title,sort_title,search_title) VALUES (?,?,?,'episode','Vidéo','video','video')").run(video, library, chaine);
  vi.mocked(identifierChaineYoutube).mockResolvedValue({ identifiant: "UC_arte", avatar: "https://image.example/avatar.jpg" });
  vi.mocked(avatarChaineYoutubeParId).mockResolvedValue("https://image.example/avatar.jpg");
  vi.mocked(cacheRemoteArtwork).mockResolvedValue("/api/artwork/avatar-local");
});
afterEach(() => { db.prepare("DELETE FROM library_folders WHERE id = ?").run(library); oublierLesChainesConnues(); });
const illustrer = () => illustrerVideoWeb({ library: { id: library } as never, catalogId: video, chaineId: chaine,
  chemin: { plateforme: "youtube", chaine: "Arte", chaineDossier: dossier } as never,
  identite: { identifiant: "video", vignette: null } as never, langue: "fr-FR" });
it("conserve l'avatar de la première résolution après l'enregistrement de l'identifiant", async () => {
  await illustrer();
  expect(poster()).toBe("/api/artwork/avatar-local");
  expect(identifierChaineYoutube).toHaveBeenCalledTimes(1);
  expect(avatarChaineYoutubeParId).not.toHaveBeenCalled();
});
it("répare une chaîne déjà identifiée, sans rechercher de nouveau son nom", async () => {
  db.prepare("UPDATE catalog_items SET external_provider = 'youtube', external_id = 'UC_arte' WHERE id = ?").run(chaine);
  await reparerAvatarsWeb();
  expect(poster()).toBe("/api/artwork/avatar-local");
  expect(avatarChaineYoutubeParId).toHaveBeenCalledWith("UC_arte");
  expect(identifierChaineYoutube).not.toHaveBeenCalled();
  await reparerAvatarsWeb();
  expect(avatarChaineYoutubeParId).toHaveBeenCalledTimes(1);
});
it("préserve un avatar local ou une fiche verrouillée", async () => {
  db.prepare("UPDATE catalog_items SET poster_url = '/api/artwork/existant' WHERE id = ?").run(chaine);
  await illustrer(); expect(poster()).toBe("/api/artwork/existant");
  db.prepare("UPDATE catalog_items SET poster_url = NULL, metadata_locked = 1 WHERE id = ?").run(chaine);
  await illustrer(); expect(poster()).toBeNull();
  expect(cacheRemoteArtwork).not.toHaveBeenCalled();
});
it("ne répète pas un téléchargement en échec pour chaque vidéo", async () => {
  vi.mocked(cacheRemoteArtwork).mockRejectedValue(new Error("Panne"));
  await illustrer(); await illustrer();
  expect(cacheRemoteArtwork).toHaveBeenCalledTimes(1);
  expect(poster()).toBeNull();
});

const identifierManuellement = () => db.prepare(`UPDATE catalog_items SET title = 'Joueur du Grenier',
  external_provider = 'youtube', external_id = 'UC_yP2DpIgs5Y1uWC0T03Chw',
  match_status = 'manual', metadata_locked = 1 WHERE id = ?`).run(chaine);
const identiteChaine = () => db.prepare(`SELECT title, external_id, match_status, metadata_locked
  FROM catalog_items WHERE id = ?`).get(chaine);

it("complète l'avatar absent de Joueur du Grenier sans déverrouiller sa correction manuelle", async () => {
  identifierManuellement();
  const avant = identiteChaine();
  expect(await reparerAvatarsWeb()).toBe(1);
  expect(poster()).toBe("/api/artwork/avatar-local");
  expect(identiteChaine()).toEqual(avant);
  expect(avatarChaineYoutubeParId).toHaveBeenCalledWith("UC_yP2DpIgs5Y1uWC0T03Chw");
  expect(identifierChaineYoutube).not.toHaveBeenCalled();
});

it("préserve toute image choisie sur une chaîne verrouillée", async () => {
  identifierManuellement();
  db.prepare("UPDATE catalog_items SET poster_url = 'https://image.example/choisie.jpg' WHERE id = ?").run(chaine);
  await reparerAvatarsWeb();
  await illustrerChaineConnue(chaine, "UC_yP2DpIgs5Y1uWC0T03Chw", null, "fr");
  expect(poster()).toBe("https://image.example/choisie.jpg");
  expect(cacheRemoteArtwork).not.toHaveBeenCalled();
});

it("ne pose pas un ancien avatar si l'identité change pendant le téléchargement", async () => {
  identifierManuellement();
  vi.mocked(cacheRemoteArtwork).mockImplementationOnce(async () => {
    db.prepare("UPDATE catalog_items SET external_id = 'UC_autre' WHERE id = ?").run(chaine);
    return "/api/artwork/ancien-avatar";
  });
  await reparerAvatarsWeb();
  expect(cacheRemoteArtwork).toHaveBeenCalledTimes(1);
  expect(poster()).toBeNull();
});

it("préserve une image choisie pendant la récupération de l'avatar", async () => {
  identifierManuellement();
  vi.mocked(cacheRemoteArtwork).mockImplementationOnce(async () => {
    db.prepare("UPDATE catalog_items SET poster_url = '/api/artwork/choisie' WHERE id = ?").run(chaine);
    return "/api/artwork/avatar-recu";
  });
  await reparerAvatarsWeb();
  expect(poster()).toBe("/api/artwork/choisie");
});

it("récupère l'avatar immédiatement lors d'une correction manuelle", async () => {
  const resultat = await appliquerCorrespondanceWeb(chaine, "UC_yP2DpIgs5Y1uWC0T03Chw", "fr-FR");
  expect(resultat.applique).toBe(true);
  expect(poster()).toBe("/api/artwork/avatar-local");
  expect(identiteChaine()).toMatchObject({ external_id: "UC_yP2DpIgs5Y1uWC0T03Chw", metadata_locked: 1 });
});

it("signale un avatar indisponible et permet de réessayer la correction immédiatement", async () => {
  vi.mocked(cacheRemoteArtwork).mockRejectedValueOnce(new Error("Panne temporaire"));
  const premier = await appliquerCorrespondanceWeb(chaine, "UC_yP2DpIgs5Y1uWC0T03Chw", "fr-FR");
  expect(premier.applique).toBe(true);
  expect(premier.message).toMatch(/vignette.*réessayer/);
  expect(poster()).toBeNull();
  await appliquerCorrespondanceWeb(chaine, "UC_yP2DpIgs5Y1uWC0T03Chw", "fr-FR");
  expect(poster()).toBe("/api/artwork/avatar-local");
});
