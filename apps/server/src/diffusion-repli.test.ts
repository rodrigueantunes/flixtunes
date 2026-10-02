import Fastify from "fastify";
import type { EtatDiffusion } from "@flixtunes/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ preparer: vi.fn(), retirer: vi.fn(), charger: vi.fn(), verifier: vi.fn(), sonder: vi.fn(),
  commander: vi.fn(), dureePreparee: vi.fn(), liberer: vi.fn(), reinitialiser: vi.fn(), profil: "profil",
  capacites: null as Record<string, unknown> | null, retenues: [] as unknown[], lectures: 0 }));
vi.mock("./sessions-profil.js", () => ({ jetonDeLaRequete: () => "test", sessionDuJeton: () => ({ profileId: fixture.profil }) }));
vi.mock("./database.js", async (original) => ({ ...await original<typeof import("./database.js")>(),
  getProfile: (id: string) => ({ id, name: id === "profil" ? "Rodrigue" : "Papa" }) }));
vi.mock("./diffusion-medias.js", () => ({
  origineDiffusion: () => "http://10.0.0.1:4000", contenuAutorise: (_profil: string, c: unknown) => c,
  MediasDiffusion: class { preparer = fixture.preparer; retirer = fixture.retirer; dureePreparee = fixture.dureePreparee; fermer = async () => {}; },
}));
vi.mock("./diffusion-reseau.js", () => ({ DecouverteDiffusion: class {
  trouver = () => ({ id: "tv", adresse: "10.0.0.2", port: 8009, nom: "TV", protocole: "googlecast", modele: "Banc" });
  demarrer = () => {}; fermer = () => {}; lister = () => [{ id: "tv", adresse: "10.0.0.2", port: 8009, nom: "TV", protocole: "googlecast", modele: "Banc" }];
} }));
vi.mock("./diffusion-sonde.js", async (original) => ({ ...await original<typeof import("./diffusion-sonde.js")>(),
  capacitesConnues: () => fixture.capacites,
  retenirCapacites: (_id: string, observe: Record<string, unknown>) => { fixture.retenues.push(observe); return { ...fixture.capacites, ...observe, verifieLe: 1 }; },
  segmentDemande: () => true,
}));
vi.mock("./diffusion-cast.js", async (original) => ({ ...await original<typeof import("./diffusion-cast.js")>(),
  TransportCast: class {
    constructor(_cible: unknown, private actualiser: (e: Partial<EtatDiffusion>) => void) {}
    charger = async (...args: unknown[]) => { await fixture.charger(...args); this.actualiser({ lecture: "lecture", position: 1 }); };
    verifier = async () => { this.actualiser({ volume: .7 }); await fixture.verifier(); };
    sonder = fixture.sonder;
    commander = fixture.commander;
    liberer = fixture.liberer;
    reinitialiser = fixture.reinitialiser;
    preparerLecteur = async () => {};
    fermer = () => {};
  },
}));
import { routesDiffusion } from "./diffusion-routes.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { ErreurCast } from "./diffusion-cast.js";
let app: ReturnType<typeof Fastify>;
const niveaux = () => fixture.preparer.mock.calls.map((c) => ({ qualiteSource: c[4].qualiteSource, compatible: c[4].compatible }));
beforeEach(async () => {
  fixture.lectures = 0; fixture.capacites = null; fixture.retenues = []; fixture.profil = "profil";
  fixture.liberer.mockReset().mockResolvedValue(undefined); fixture.reinitialiser.mockReset().mockResolvedValue(undefined);
  fixture.retirer.mockReset().mockResolvedValue(undefined); fixture.charger.mockReset().mockResolvedValue(undefined);
  fixture.verifier.mockReset().mockResolvedValue(undefined); fixture.sonder.mockReset().mockResolvedValue("inconnu");
  fixture.commander.mockReset().mockResolvedValue(undefined); fixture.dureePreparee.mockReset().mockResolvedValue(0);
  fixture.preparer.mockReset().mockImplementation(async (_profil, contenu) => ({ cle: `cle-${++fixture.lectures}`, profil: "profil", contenu,
    url: "http://10.0.0.1:4000/flux", mime: "video/mp4", position: 30, duree: 600, decalage: 0, requetes: 1, direct: false, expire: Date.now() + 3600_000 }));
  app = Fastify(); await routesDiffusion(app);
});
afterEach(async () => { await app.close(); });
const commande = { type: "charger", contenu: { genre: "media", id: "film", titre: "Test" }, position: 30 };
const etatDeLaCible = async () => (await app.inject({ method: "GET", url: "/api/diffusion/cibles" })).json().cibles.find((c: any) => c.id === "tv").etat;

it("révoque la tentative refusée et confirme seulement après le repli", async () => {
  fixture.charger.mockRejectedValueOnce(new ErreurCast("CAST_LOAD_FAILED", "Lecture refusée"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true });
  expect(niveaux()).toEqual([{ qualiteSource: true, compatible: false }, { qualiteSource: false, compatible: false }]);
  expect(fixture.retirer).toHaveBeenCalledWith("cle-1"); expect(fixture.charger).toHaveBeenCalledTimes(2);
});
it("ne lance aucune conversion pour une panne de connexion", async () => {
  fixture.verifier.mockRejectedValue(new ErreurCast("CAST_CONNEXION_ECONNREFUSED", "Connexion impossible"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(fixture.preparer).not.toHaveBeenCalled(); expect(fixture.sonder).not.toHaveBeenCalled();
  expect(r.json().message).toContain("ECONNREFUSED");
});
it("borne les essais au plan source, 1080p et 720p et libère les conversions refusées", async () => {
  fixture.charger.mockRejectedValue(new ErreurCast("CAST_MEDIA", "Format refusé"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(fixture.preparer).toHaveBeenCalledTimes(3);
  for (const cle of ["cle-1", "cle-2", "cle-3"]) expect(fixture.retirer).toHaveBeenCalledWith(cle);
});
it("accepte le volume reçu pendant GET_STATUS avant qu’une lecture soit créée", async () => {
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200);
  expect(fixture.verifier).toHaveBeenCalledOnce(); expect(fixture.preparer).toHaveBeenCalledOnce();
  expect(fixture.charger).toHaveBeenCalledOnce();
});
it("passe au niveau suivant avant tout LOAD si la première préparation échoue", async () => {
  fixture.preparer.mockRejectedValueOnce(new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE", "Encodeur refusé", true));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200);
  expect(niveaux()).toEqual([{ qualiteSource: true, compatible: false }, { qualiteSource: false, compatible: false }]);
  expect(fixture.charger).toHaveBeenCalledOnce();
});
it("ne contourne pas le refus d’admission du NAS", async () => {
  fixture.preparer.mockRejectedValue(new ErreurPreparationDiffusion("CAST_PREPARATION_REFUSEE", "Capacité occupée", false));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(r.json().message).toContain("Capacité occupée");
  expect(fixture.preparer).toHaveBeenCalledOnce(); expect(fixture.charger).not.toHaveBeenCalled();
});

it("sonde un récepteur inconnu et convertit directement à ce qu’il accepte", async () => {
  // Le verdict de la Pixel Tablet, relevé le 2 octobre 2026 : ni HLS 1080p, ni HEVC.
  fixture.sonder.mockResolvedValue("refuse");
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200);
  expect(fixture.sonder).toHaveBeenCalledTimes(3);
  expect(fixture.retenues[0]).toMatchObject({ h264_1080: false, hevc_1080: false, hevc_2160_hdr10: false, modele: "Banc" });
  // Sans source connue, la copie reste tentée ; le 1080p, lui, est écarté.
  expect(niveaux()).toEqual([{ qualiteSource: true, compatible: false }]);
  expect(fixture.preparer.mock.calls[0]![4].hauteurMax).toBe(2160);
});
it("ne sonde pas un récepteur déjà connu", async () => {
  fixture.capacites = { h264_1080: false, verifieLe: Date.now() };
  fixture.charger.mockRejectedValueOnce(new ErreurCast("CAST_LOAD_FAILED", "Refus"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200); expect(fixture.sonder).not.toHaveBeenCalled();
  expect(niveaux()).toEqual([{ qualiteSource: true, compatible: false }, { qualiteSource: false, compatible: true }]);
});

it("répond tout de suite en asynchrone et publie l’étape en cours", async () => {
  let liberer: () => void = () => {};
  fixture.preparer.mockImplementationOnce(async (_profil, contenu) => {
    await new Promise<void>((resolve) => { liberer = resolve; });
    return { cle: "cle-lente", profil: "profil", contenu, url: "http://10.0.0.1:4000/flux", mime: "video/mp4", position: 0, duree: 600, decalage: 0, requetes: 1, direct: false, expire: Date.now() + 3600_000 };
  });
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande?asynchrone=1", payload: commande });
  expect(r.statusCode).toBe(202); expect(r.json().operation).toEqual(expect.any(String));
  await vi.waitFor(async () => expect(await etatDeLaCible()).toMatchObject({ lecture: "chargement", etape: "preparation", qualite: "Vidéo source conservée" }));
  liberer();
  await vi.waitFor(async () => expect((await etatDeLaCible()).lecture).toBe("lecture"));
});
it("annule une préparation en cours sans prendre le récepteur", async () => {
  fixture.preparer.mockImplementationOnce((_p, _c, _o, _pos, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("annulé")));
  }));
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande?asynchrone=1", payload: commande });
  await vi.waitFor(async () => expect((await etatDeLaCible())?.etape).toBe("preparation"));
  const arret = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "arreter" } });
  expect(arret.statusCode).toBe(200);
  expect(await etatDeLaCible()).toBeNull();
  expect(fixture.charger).not.toHaveBeenCalled();
});
it("montre l’échec d’une préparation asynchrone aux clients qui suivent la cible", async () => {
  fixture.preparer.mockRejectedValue(new ErreurPreparationDiffusion("CAST_PREPARATION_REFUSEE", "Capacité occupée", false));
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande?asynchrone=1", payload: commande });
  await vi.waitFor(async () => expect(await etatDeLaCible()).toMatchObject({ lecture: "erreur", erreur: expect.stringContaining("Capacité occupée") }));
});

it("se déplace sur le récepteur dans la partie convertie, et relance la conversion au-delà", async () => {
  fixture.preparer.mockImplementation(async (_profil, contenu, _o, position) => ({ cle: `cle-${++fixture.lectures}`, profil: "profil", contenu,
    url: "http://10.0.0.1:4000/flux", mime: "application/vnd.apple.mpegurl", position: 0, duree: 600, decalage: position, requetes: 1,
    direct: false, session: "session", expire: Date.now() + 3600_000 }));
  fixture.capacites = { h264_1080: true, verifieLe: Date.now() };
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  fixture.dureePreparee.mockResolvedValue(120);
  // 30 s de décalage, 120 s prêtes : 100 s tombe dedans et devient un déplacement relatif de 70 s.
  const dedans = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "position", valeur: 100 } });
  expect(dedans.statusCode).toBe(200);
  expect(fixture.commander).toHaveBeenCalledWith({ type: "position", valeur: 70 });
  expect(fixture.preparer).toHaveBeenCalledTimes(1);
  const dehors = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "position", valeur: 400 } });
  expect(dehors.statusCode).toBe(200);
  expect(fixture.preparer).toHaveBeenCalledTimes(2);
  expect(fixture.preparer.mock.calls[1]![3]).toBe(400);
});

it("rend le téléviseur libre avant de révoquer un flux refusé, et sur un arrêt", async () => {
  // Le 58PUS7304 restait sur un flux révoqué, en chargement sans fin, jusqu'à son redémarrage.
  const ordre: string[] = [];
  fixture.liberer.mockImplementation(async () => { ordre.push("liberer"); });
  fixture.retirer.mockImplementation(async (cle: string) => { ordre.push(`retirer ${cle}`); });
  fixture.charger.mockRejectedValueOnce(new ErreurCast("CAST_DEMARRAGE", "Pas de progression"));
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(ordre.slice(0, 2)).toEqual(["liberer", "retirer cle-1"]);
  ordre.length = 0;
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "arreter" } });
  expect(ordre).toEqual(["liberer", "retirer cle-2"]);
  expect(fixture.commander).not.toHaveBeenCalled();
});
it("réinitialise un téléviseur même sans diffusion connue", async () => {
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "reinitialiser" } });
  expect(r.statusCode).toBe(200); expect(fixture.reinitialiser).toHaveBeenCalledOnce();
});
it("montre la diffusion à tous les profils, qui peuvent la piloter et la remplacer", async () => {
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  fixture.profil = "autre";
  const vue = (await app.inject({ method: "GET", url: "/api/diffusion/cibles" })).json().cibles.find((c: any) => c.id === "tv");
  expect(vue).toMatchObject({ occupe: false, proprietaire: "Rodrigue", etat: { lecture: "lecture" } });
  expect((await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: { type: "pause" } })).statusCode).toBe(200);
  expect(fixture.commander).toHaveBeenCalledWith({ type: "pause" });
  const remplace = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(remplace.statusCode).toBe(200);
  const apres = (await app.inject({ method: "GET", url: "/api/diffusion/cibles" })).json().cibles.find((c: any) => c.id === "tv");
  expect(apres.proprietaire).toBe("Papa");
});
it("s'arrête à la première sonde quand le récepteur lit le HEVC 4K HDR", async () => {
  fixture.sonder.mockResolvedValue("accepte");
  await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(fixture.sonder).toHaveBeenCalledOnce();
  expect(fixture.retenues[0]).toMatchObject({ hevc_2160_hdr10: true, h264_1080: true, hevc_1080: true });
});
