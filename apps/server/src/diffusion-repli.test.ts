import Fastify from "fastify";
import type { EtatDiffusion } from "@flixtunes/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ preparer: vi.fn(), retirer: vi.fn(), charger: vi.fn(), verifier: vi.fn(), lectures: 0 }));
vi.mock("./sessions-profil.js", () => ({ jetonDeLaRequete: () => "test", sessionDuJeton: () => ({ profileId: "profil" }) }));
vi.mock("./diffusion-medias.js", () => ({
  origineDiffusion: () => "http://10.0.0.1:4000", contenuAutorise: (_profil: string, c: unknown) => c,
  MediasDiffusion: class { preparer = fixture.preparer; retirer = fixture.retirer; fermer = async () => {}; },
}));
vi.mock("./diffusion-reseau.js", () => ({ DecouverteDiffusion: class {
  trouver = () => ({ id: "tv", adresse: "10.0.0.2", port: 8009, nom: "TV", protocole: "googlecast" });
  fermer = () => {}; lister = () => [];
} }));
vi.mock("./diffusion-cast.js", async (original) => ({ ...await original<typeof import("./diffusion-cast.js")>(),
  TransportCast: class {
    constructor(_cible: unknown, private actualiser: (e: Partial<EtatDiffusion>) => void) {}
    charger = fixture.charger;
    verifier = async () => { this.actualiser({ volume: .7 }); await fixture.verifier(); };
    fermer = () => {};
  },
}));
import { routesDiffusion } from "./diffusion-routes.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { ErreurCast } from "./diffusion-cast.js";
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  fixture.lectures = 0; fixture.retirer.mockReset().mockResolvedValue(undefined); fixture.charger.mockReset().mockResolvedValue(undefined);
  fixture.verifier.mockReset().mockResolvedValue(undefined);
  fixture.preparer.mockReset().mockImplementation(async (_profil, contenu) => ({ cle: `cle-${++fixture.lectures}`, profil: "profil", contenu,
    url: "http://10.0.0.1:4000/flux", mime: "video/mp4", position: 30, duree: 600, decalage: 0, requetes: 1, direct: false, expire: Date.now() + 3600_000 }));
  app = Fastify(); await routesDiffusion(app);
});
afterEach(async () => { await app.close(); });
const commande = { type: "charger", contenu: { genre: "media", id: "film", titre: "Test" }, position: 30 };
it("révoque la tentative refusée et confirme seulement après le repli compatible", async () => {
  fixture.charger.mockRejectedValueOnce(new ErreurCast("CAST_LOAD_FAILED", "Lecture refusée"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200); expect(r.json()).toEqual({ ok: true });
  expect(fixture.preparer.mock.calls.map(c => c[4])).toEqual([{ qualiteSource: true, compatible: false }, { qualiteSource: false, compatible: false }]);
  expect(fixture.retirer).toHaveBeenCalledWith("cle-1"); expect(fixture.charger).toHaveBeenCalledTimes(2);
});
it("ne lance pas une deuxième conversion pour une panne de connexion", async () => {
  fixture.verifier.mockRejectedValue(new ErreurCast("CAST_CONNEXION_ECONNREFUSED", "Connexion impossible"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(fixture.preparer).not.toHaveBeenCalled();
  expect(r.json().message).toContain("ECONNREFUSED");
});
it("borne à trois les profils source, 1080p et 720p et libère les conversions refusées", async () => {
  fixture.charger.mockRejectedValue(new ErreurCast("CAST_MEDIA", "Format refusé"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(fixture.preparer).toHaveBeenCalledTimes(3);
  expect(fixture.retirer).toHaveBeenCalledWith("cle-1"); expect(fixture.retirer).toHaveBeenCalledWith("cle-2"); expect(fixture.retirer).toHaveBeenCalledWith("cle-3");
});

it("accepte le volume reçu pendant GET_STATUS avant qu’une lecture soit créée", async () => {
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200);
  expect(fixture.verifier).toHaveBeenCalledOnce(); expect(fixture.preparer).toHaveBeenCalledOnce();
  expect(fixture.charger).toHaveBeenCalledOnce();
});

it("recommence la préparation en profil compatible avant tout LOAD si la première conversion échoue", async () => {
  fixture.preparer.mockRejectedValueOnce(new ErreurPreparationDiffusion("CAST_PREPARATION_ECHOUEE", "Encodeur refusé", true));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(200);
  expect(fixture.preparer.mock.calls.map(c => c[4])).toEqual([{ qualiteSource: true, compatible: false }, { qualiteSource: false, compatible: false }]);
  expect(fixture.charger).toHaveBeenCalledOnce();
});
it("ne contourne pas le refus d’admission du NAS", async () => {
  fixture.preparer.mockRejectedValue(new ErreurPreparationDiffusion("CAST_PREPARATION_REFUSEE", "Capacité occupée", false));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(r.json().message).toContain("Capacité occupée");
  expect(fixture.preparer).toHaveBeenCalledOnce(); expect(fixture.charger).not.toHaveBeenCalled();
});
it("borne à trois les essais, même si préparation puis chargement échouent successivement", async () => {
  fixture.preparer.mockRejectedValueOnce(new ErreurPreparationDiffusion("CAST_PREPARATION_DELAI", "Délai", true));
  fixture.charger.mockRejectedValue(new ErreurCast("CAST_LOAD_FAILED", "Refus"));
  const r = await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv/commande", payload: commande });
  expect(r.statusCode).toBe(502); expect(fixture.preparer).toHaveBeenCalledTimes(3);
  expect(fixture.retirer).toHaveBeenCalledWith("cle-1");
});
