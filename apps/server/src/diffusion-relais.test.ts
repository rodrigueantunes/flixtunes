import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistreDiffusion } from "./diffusion-registre.js";
import { planDistant, type NiveauDiffusion } from "./diffusion-sonde.js";

const fixture = vi.hoisted(() => ({ preparer: vi.fn(), retirer: vi.fn(), entretenir: vi.fn(), retenues: [] as Array<[string, unknown]>,
  debit: 8_000_000, lectures: 0 }));
vi.mock("./sessions-profil.js", () => ({ jetonDeLaRequete: () => "test", sessionDuJeton: () => ({ profileId: "profil" }) }));
vi.mock("./database.js", async (original) => ({ ...await original<typeof import("./database.js")>(),
  getProfile: (id: string) => ({ id, name: "Rodrigue" }) }));
vi.mock("./diffusion-medias.js", () => ({
  origineDiffusion: () => "http://10.0.0.1:4000", origineDistante: () => "https://flixtunes.exemple.fr",
  contenuAutorise: (_profil: string, c: unknown) => c, mimeDuFichier: () => "video/mp4",
  MediasDiffusion: class { preparer = fixture.preparer; retirer = fixture.retirer; entretenir = fixture.entretenir;
    dureePreparee = async () => 0; fermer = async () => {}; },
}));
vi.mock("./diffusion-reseau.js", () => ({ DecouverteDiffusion: class {
  trouver = () => ({ id: "tv-maison", adresse: "10.0.0.2", port: 8009, nom: "TV du salon", protocole: "googlecast" });
  demarrer = () => {}; fermer = () => {};
  lister = () => [{ id: "tv-maison", adresse: "10.0.0.2", port: 8009, nom: "TV du salon", protocole: "googlecast" }];
} }));
vi.mock("./diffusion-sonde.js", async (original) => ({ ...await original<typeof import("./diffusion-sonde.js")>(),
  // Capacités connues : la diffusion va droit au plan, sans sonde.
  capacitesConnues: () => ({ h264_1080: true, hevc_1080: true, hevc_2160_hdr10: true, verifieLe: 1 }),
  retenirCapacites: (id: string, observe: unknown) => { fixture.retenues.push([id, observe]); return { verifieLe: 1 }; },
}));
vi.mock("./playback.js", () => ({ getPlaybackInfo: async () => ({ container: "matroska", durationSeconds: 6000, overallBitRate: fixture.debit,
  streams: [{ type: "video", codec: "hevc", width: 3840, height: 2160, hdrFormat: "hdr10" }] }) }));
import { routesDiffusion } from "./diffusion-routes.js";

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  fixture.lectures = 0; fixture.retenues = []; fixture.debit = 8_000_000;
  fixture.retirer.mockReset().mockResolvedValue(undefined); fixture.entretenir.mockReset();
  fixture.preparer.mockReset().mockImplementation(async (_profil, contenu, origine) => {
    const cle = `cle-${++fixture.lectures}`;
    return { cle, profil: "profil", contenu, url: `${origine}/api/diffusion/flux/${cle}/index.m3u8`, mime: "application/vnd.apple.mpegurl",
      position: 30, duree: 6000, decalage: 0, requetes: 3, direct: false, segmentsFmp4: true, expire: Date.now() + 3600_000,
      metadonnees: { genre: "film", titre: "Le film", image: `${origine}/api/diffusion/flux/${cle}/affiche` } };
  });
  app = Fastify();
  // Le crochet WAN de l'application pose `expositionWan` ; ici, un en-tête de banc en tient lieu.
  app.addHook("onRequest", async (req: { headers: Record<string, unknown>; expositionWan?: boolean }) => { if (req.headers["x-banc-wan"]) req.expositionWan = true; });
  await routesDiffusion(app);
});
afterEach(async () => { await app.close(); });

const wan = { "x-banc-wan": "1" };
const charger = (qualite?: "maximale") => ({ type: "charger", contenu: { genre: "media", id: "film", titre: "Le film" }, position: 30, ...(qualite ? { qualite } : {}) });

/**
 * Un téléphone hors de chez soi : il annonce le téléviseur qu'il voit, bat, et répond aux ordres du NAS
 * comme le ferait le SDK Cast. `reponse` décide de l'accusé de chaque ordre.
 */
async function relais(reponse: (action: any) => Record<string, unknown> = () => ({ ok: true })) {
  const r = await app.inject({ method: "POST", url: "/api/diffusion/relais", headers: wan, payload: { nom: "TV de Paul", modele: "Chromecast" } });
  expect(r.statusCode).toBe(200);
  const { id, cle } = r.json() as { id: string; cle: string };
  const recus: any[] = [];
  let accuses: unknown[] = [], etat: Record<string, unknown> = { lecture: "repos" }, media: string | undefined;
  const battre = async () => {
    const b = await app.inject({ method: "POST", url: `/api/diffusion/lecteurs/${id}`, headers: wan, payload: { cle, etat, accuses, media } });
    accuses = [];
    for (const ordre of b.json().ordres ?? []) {
      recus.push(ordre.relais);
      const accuse = reponse(ordre.relais);
      if (ordre.relais.type === "charger" && accuse.ok) { media = ordre.relais.url; etat = { lecture: "lecture", position: 30, duree: 6000, volume: .4 }; }
      accuses.push({ id: ordre.id, ...accuse });
    }
  };
  /** Bat jusqu'à ce que la promesse donnée soit tenue : le NAS attend les accusés pendant ce temps. */
  const pendant = async (attente: PromiseLike<{ statusCode: number }>): Promise<{ statusCode: number }> => {
    let fini = false; const resultat = Promise.resolve(attente).finally(() => { fini = true; });
    while (!fini) { await battre(); await new Promise((r) => setTimeout(r, 20)); }
    return resultat;
  };
  return { id, recus, battre, pendant, poser: (e: Record<string, unknown>, m?: string) => { etat = e; media = m ?? media; } };
}

describe("téléviseur relayé par un téléphone hors de chez soi", () => {
  it("s'inscrit, apparaît parmi les cibles, et se pilote par des ordres de relais", async () => {
    const tel = await relais();
    const cibles = (await app.inject({ url: "/api/diffusion/cibles", headers: wan })).json().cibles;
    expect(cibles.find((c: any) => c.id === tel.id)).toMatchObject({ nom: "TV de Paul", protocole: "googlecast", modele: "Chromecast", relais: true });

    const r = await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: charger() }));
    expect(r.statusCode).toBe(200);
    expect(tel.recus.map((a) => a.type)).toEqual(["verifier", "charger"]);
    // Le média est préparé pour un téléviseur distant, et annoncé par le domaine public.
    expect(fixture.preparer.mock.calls[0]![2]).toBe("https://flixtunes.exemple.fr");
    expect(fixture.preparer.mock.calls[0]![4]).toMatchObject({ distant: true, qualiteSource: true });
    expect(tel.recus[1]).toMatchObject({ url: "https://flixtunes.exemple.fr/api/diffusion/flux/cle-1/index.m3u8", fmp4: true,
      position: 30, direct: false, metadonnees: { titre: "Le film", image: "https://flixtunes.exemple.fr/api/diffusion/flux/cle-1/affiche" } });

    // L'état rapporté par le relais devient celui de la cible, et entretient la clé pendant une pause.
    tel.poser({ lecture: "pause", position: 95, duree: 6000, volume: .4 });
    await tel.battre();
    const etat = (await app.inject({ url: "/api/diffusion/cibles", headers: wan })).json().cibles.find((c: any) => c.id === tel.id).etat;
    expect(etat).toMatchObject({ lecture: "pause", position: 95, volume: .4 });
    expect(fixture.entretenir).toHaveBeenCalledWith("cle-1");

    const p = await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: { type: "reprendre" } }));
    expect(p.statusCode).toBe(200); expect(tel.recus.at(-1)).toEqual({ type: "commande", commande: { type: "reprendre" } });

    const a = await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: { type: "arreter" } }));
    expect(a.statusCode).toBe(200); expect(tel.recus.at(-1)).toEqual({ type: "liberer" });
    expect(fixture.retirer).toHaveBeenCalledWith("cle-1");
  });

  it("replie au niveau suivant quand le téléviseur refuse, et retient ce qu'il lit par modèle", async () => {
    let refus = true;
    const tel = await relais((action) => action.type === "charger" && refus ? (refus = false, { ok: false, code: "CAST_LOAD_FAILED", erreur: "Format refusé" }) : { ok: true });
    const r = await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: charger() }));
    expect(r.statusCode).toBe(200);
    expect(fixture.preparer.mock.calls.map((c) => c[4].qualiteSource)).toEqual([true, false]);
    // Le téléviseur est libéré avant que le flux refusé ne soit révoqué, puis le niveau suivant repart.
    expect(tel.recus.map((a) => a.type)).toEqual(["verifier", "charger", "liberer", "charger"]);
    expect(fixture.retirer).toHaveBeenCalledWith("cle-1");
    expect(fixture.retenues.map(([id]) => id)).toContain("relais:Chromecast");
  });

  it("ne copie pas une source trop lourde pour un réseau inconnu, sauf qualité maximale demandée", async () => {
    fixture.debit = 60_000_000;
    const tel = await relais();
    await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: charger() }));
    expect(fixture.preparer.mock.calls[0]![4]).toMatchObject({ qualiteSource: false, hauteurMax: 1080 });
    await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: charger("maximale") }));
    expect(fixture.preparer.mock.calls.at(-1)![4]).toMatchObject({ qualiteSource: true });
  });

  it("depuis l'accès distant, ne liste ni ne pilote les téléviseurs de la maison", async () => {
    const dehors = (await app.inject({ url: "/api/diffusion/cibles", headers: wan })).json().cibles;
    expect(dehors.map((c: any) => c.id)).not.toContain("tv-maison");
    expect((await app.inject({ method: "POST", url: "/api/diffusion/cibles/tv-maison/commande", headers: wan, payload: charger() })).statusCode).toBe(404);
    // À la maison, rien ne change.
    expect((await app.inject({ url: "/api/diffusion/cibles" })).json().cibles.map((c: any) => c.id)).toContain("tv-maison");
  });

  it("garde fermées au WAN les routes de diffusion que la r10 n'ouvre pas", async () => {
    app.get("/api/diffusion/route-de-demain", async () => ({ ok: true }));
    expect((await app.inject({ url: "/api/diffusion/route-de-demain", headers: wan })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/diffusion/route-de-demain" })).statusCode).toBe(200);
  });

  it("ignore l'état d'un autre média : le téléviseur repris par une autre application passe au repos", async () => {
    const tel = await relais();
    await tel.pendant(app.inject({ method: "POST", url: `/api/diffusion/cibles/${tel.id}/commande`, headers: wan, payload: charger() }));
    tel.poser({ lecture: "lecture", position: 3, duree: 200, volume: 1 }, "https://www.youtube.com/autre");
    await tel.battre();
    const etat = (await app.inject({ url: "/api/diffusion/cibles", headers: wan })).json().cibles.find((c: any) => c.id === tel.id).etat;
    expect(etat).toMatchObject({ lecture: "repos", motifRepos: "tiers" });
  });
});

describe("registre des relais", () => {
  it("rend l'accusé d'un ordre, et rend la main quand le relais se tait", async () => {
    let maintenant = 1_000_000;
    const registre = new RegistreDiffusion(() => maintenant);
    const { id, cle } = registre.inscrireRelais("profil", "TV", "Chromecast");
    const attente = registre.ordonner(id, "profil", { type: "verifier" }, 5_000);
    const [ordre] = registre.battre(id, "profil", cle, { lecture: "repos" } as never, [])!;
    registre.battre(id, "profil", cle, { lecture: "repos" } as never, [{ id: ordre!.id, ok: true }]);
    expect(await attente).toEqual({ id: ordre!.id, ok: true });

    const muette = registre.ordonner(id, "profil", { type: "verifier" }, 60_000);
    maintenant += 31_000;
    expect(registre.lister("profil")).toEqual([]);
    expect(await muette).toBeNull();
  });
  it("refuse les battements d'une autre clé, et les ordres d'un autre profil", async () => {
    const registre = new RegistreDiffusion();
    const { id } = registre.inscrireRelais("profil", "TV");
    expect(registre.battre(id, "profil", "0".repeat(64), { lecture: "repos" } as never, [])).toBeNull();
    expect(await registre.ordonner(id, "autre", { type: "verifier" }, 50)).toBeNull();
    expect(registre.relais(id, "autre")).toBeNull();
  });
});

describe("plan hors de chez soi", () => {
  const plan: NiveauDiffusion[] = [{ nom: "source", qualiteSource: true, compatible: false, hauteurMax: 2160 },
    { nom: "conversion", qualiteSource: false, compatible: false, hauteurMax: 1080 }];
  it("garde la copie jusqu'à 25 Mbit/s, la retire au-delà sauf qualité maximale", () => {
    const source = (debit?: number) => ({ codec: "hevc", hauteur: 2160, hdr: true, mp4Direct: false, debit });
    expect(planDistant(plan, source(20_000_000), false)).toEqual(plan);
    expect(planDistant(plan, source(), false)).toEqual(plan);
    expect(planDistant(plan, source(60_000_000), false).map((n) => n.nom)).toEqual(["conversion"]);
    expect(planDistant(plan, source(60_000_000), true)).toEqual(plan);
    expect(planDistant([plan[0]!], source(60_000_000), false)).toEqual([plan[0]]);
  });
});
