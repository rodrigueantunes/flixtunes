import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";
import { compteDistantRequis, inventaireWan, verdictWan } from "./wan-exposition.js";

/**
 * Routes délibérément fermées à l'accès distant.
 *
 * Ce n'est pas une redite de la liste blanche : c'est le registre des décisions **contraires**. Il
 * n'a aucun effet à l'exécution — seule la liste blanche décide — et n'existe que pour rendre le
 * test ci-dessous capable de distinguer « refusée après réflexion » de « jamais examinée ».
 */
const REFUS_ASSUMES = new Set([
  // Administration de la médiathèque : n'a rien à faire depuis Internet.
  "GET /api/libraries", "POST /api/libraries", "DELETE /api/libraries/:id",
  "PATCH /api/libraries/:id/localization", "POST /api/libraries/:id/refresh-metadata",
  "POST /api/libraries/:id/scan", "POST /api/library/scan",
  "POST /api/setup",
  "GET /api/filesystem/directories",
  // Analyses et corrections de catalogue.
  // Le repérage des génériques se **lit** depuis Internet — c'est de l'avancement, rien de plus —
  // mais s'allume, s'éteint, se reprend et s'arrête depuis le réseau local seulement : lancer une
  // passe qui décode pendant des heures est un geste sur la machine, pas sur la médiathèque.
  "POST /api/system/generiques", "POST /api/system/generiques/arret",
  "POST /api/system/generiques/passe",
  // La télévision en direct, étape 1 : **tout est refusé, y compris la grille**, et les deux cas
  // n'ont pas la même durée de vie.
  //
  // Les réglages resteront fermés : désigner un dossier du NAS, cocher cinq cents listes ou lancer un
  // téléchargement de quarante mégaoctets sont des gestes sur la machine.
  //
  // La grille — `GET /api/live/channels` et `/api/live/groupes` — est en revanche une lecture, et elle
  // a vocation à rejoindre les lectures autorisées **quand son écran existera** et aura été éprouvé.
  // L'ouvrir maintenant exposerait une route dont personne ne se sert encore : ce serait ouvrir sans
  // décider, ce que ce registre existe précisément pour empêcher.
  "GET /api/system/live", "PUT /api/system/live",
  "POST /api/system/live/rafraichir", "POST /api/system/live/arret",
  "GET /api/system/live/listes",
  "GET /api/system/live/sources", "POST /api/system/live/sources", "DELETE /api/system/live/sources/:id",
  "GET /api/live", "GET /api/live/listes", "GET /api/live/pays", "GET /api/live/fiabilites",
  "GET /api/live/channels",
  "GET /api/live/channels/:id", "POST /api/live/channels/:id/resultat", "GET /api/live/numero",
  // L'étoile et la dernière chaîne suivront la grille : elles n'ont de sens que devant une grille
  // qu'on affiche, et la grille elle-même attend encore d'être éprouvée à distance.
  "PUT /api/live/channels/:id/favori", "DELETE /api/live/channels/:id/favori", "GET /api/live/derniere",
  // Le relais suivra la grille : il n'a de sens que pour un navigateur qui affiche déjà des chaînes.
  "GET /api/live/relais",
  // Le rayon Web suit la meme regle que la grille du direct : le drapeau qui decide de son entree de
  // navigation reste ferme tant que son ecran n'existe pas et n'a pas ete eprouve a distance.
  // L'ouvrir maintenant exposerait une route dont personne ne se sert encore — ouvrir sans decider,
  // ce que ce registre existe pour empecher.
  "GET /api/web",
  "GET /api/scans", "POST /api/scans", "GET /api/scans/skipped",
  "POST /api/scans/:id/cancel", "POST /api/scans/:id/retry",
  "GET /api/corrections", "POST /api/corrections", "POST /api/corrections/preview",
  "POST /api/corrections/:id/undo",
  "GET /api/catalog/:id/metadata-provenance", "PATCH /api/catalog/:id/metadata",
  "POST /api/catalog/:id/match", "DELETE /api/catalog/:id/match",
  "GET /api/metadata/review", "GET /api/metadata/search",
  "GET /api/metadata/providers", "PATCH /api/metadata/providers",
  // Sort du NAS vers TMDB avec un chemin fourni par le client : relais d'images ouvert.
  "GET /api/metadata/image/:size/:name",
  // Diagnostic et exploitation.
  "GET /api/system/status", "GET /api/system/metrics", "GET /api/system/capacity",
  "POST /api/system/capacity/recalibrate", "GET /api/system/playback",
  "GET /api/system/media-inventory",
  "GET /api/system/conversion-preferences", "PUT /api/system/conversion-preferences",
  // On ne règle pas l'ouverture d'une porte depuis l'extérieur de celle-ci.
  "GET /api/system/wan", "PUT /api/system/wan", "POST /api/system/wan/verifier",
  "GET /api/system/remote-accounts", "POST /api/system/remote-accounts", "DELETE /api/system/remote-accounts/:id",
  "GET /api/system/backups", "POST /api/system/backups",
  "GET /api/system/backups/:name", "POST /api/system/backups/:name/restore",
  // Quarantaine de codecs partagée par tous les clients.
  "GET /api/playback/codec-quarantine",
  "POST /api/playback/codec-failure", "POST /api/playback/codec-success",
  // Télécommande : affaire de réseau local.
  "GET /api/devices", "GET /api/devices/:id/commands", "POST /api/devices/:id/command",
  "POST /api/devices/announce",
  // Gestion des profils : lecture seule à distance, modification jamais.
  "POST /api/profiles", "PATCH /api/profiles/:id", "PUT /api/profiles/:id",
  "DELETE /api/profiles/:id",
  "POST /api/profile-groups", "PATCH /api/profile-groups/:id",
  "PUT /api/profile-groups/:id", "DELETE /api/profile-groups/:id",
  // Compatibilité d'anciens clients : jamais exposée.
  "GET /api/home-legacy", "GET /api/media-legacy/:id",
]);

async function routesEnregistrees(): Promise<string[]> {
  const app = Fastify({ logger: false });
  const trouvees: string[] = [];
  app.addHook("onRoute", (route) => {
    const methodes = Array.isArray(route.method) ? route.method : [route.method];
    for (const methode of methodes) {
      if (methode === "HEAD" || methode === "OPTIONS") continue;
      trouvees.push(`${methode} ${route.url}`);
    }
  });
  await registerRoutes(app);
  await app.close();
  return [...new Set(trouvees)].sort();
}

describe("exposition WAN", () => {
  /**
   * Le test qui garde la liste blanche honnête.
   *
   * Une route ajoutée par une étape ultérieure n'apparaît ni dans la liste blanche, ni dans les refus
   * assumés : ce test échoue alors, et nomme la route. C'est voulu. Il ne demande pas d'ouvrir la
   * route — seulement de **décider**, puis d'inscrire la décision quelque part.
   *
   * Sans lui, la protection se dégraderait en silence : chaque nouvelle route serait fermée par
   * défaut, ce qui est sûr, mais personne ne se rendrait compte qu'une fonction attendue à distance
   * ne marche pas — ou qu'une route sensible n'a jamais été examinée.
   */
  it("n'a aucune route qui n'ait été examinée", async () => {
    const inventaire = inventaireWan();
    const connues = new Set([
      ...inventaire.sansSession, ...inventaire.lectures, ...inventaire.ecritures,
      ...REFUS_ASSUMES,
    ]);
    const jamaisExaminees = (await routesEnregistrees()).filter((route) => !connues.has(route));
    expect(jamaisExaminees, "Routes sans décision d'exposition WAN — ouvrir dans wan-exposition.ts, "
      + "ou inscrire dans REFUS_ASSUMES de ce fichier").toEqual([]);
  });

  it("refuse toute route inconnue, en la rendant indiscernable d'une route inexistante", () => {
    expect(verdictWan("GET", "/api/system/backups/:name")).toEqual({ autorise: false, sessionRequise: false });
    expect(verdictWan("GET", "/api/filesystem/directories")).toEqual({ autorise: false, sessionRequise: false });
    expect(verdictWan("GET", undefined)).toEqual({ autorise: false, sessionRequise: false });
    expect(verdictWan("POST", "/api/route/inventee/demain")).toEqual({ autorise: false, sessionRequise: false });
  });

  it("exige une session sur les lectures comme sur le flux vidéo", () => {
    expect(verdictWan("GET", "/api/catalog")).toEqual({ autorise: true, sessionRequise: true });
    expect(verdictWan("GET", "/api/media/:id/stream")).toEqual({ autorise: true, sessionRequise: true });
    expect(verdictWan("GET", "/api/artwork/:id")).toEqual({ autorise: true, sessionRequise: true });
    expect(verdictWan("GET", "/api/playback/:id/:file")).toEqual({ autorise: true, sessionRequise: true });
  });

  it("laisse passer sans session le strict nécessaire au déverrouillage", () => {
    expect(verdictWan("GET", "/api/health")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("GET", "/api/profiles")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("POST", "/api/profiles/:id/unlock")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("GET", "/api/setup")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("GET", "/api/remote/session")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("POST", "/api/remote/login")).toEqual({ autorise: true, sessionRequise: false });
  });

  it("exige le compte d'appareil avant toute donnée, y compris groupes, profils et setup", () => {
    expect(compteDistantRequis("GET", "/api/health")).toBe(false);
    expect(compteDistantRequis("GET", "/api/remote/session")).toBe(false);
    expect(compteDistantRequis("POST", "/api/remote/login")).toBe(false);
    expect(compteDistantRequis("GET", "/api/setup")).toBe(true);
    expect(compteDistantRequis("GET", "/api/profile-groups")).toBe(true);
    expect(compteDistantRequis("GET", "/api/profiles")).toBe(true);
  });

  it("sert l'interface Web sans session, puisque la page précède l'authentification", () => {
    expect(verdictWan("GET", "/")).toEqual({ autorise: true, sessionRequise: false });
    expect(verdictWan("GET", "/assets/index-abc123.js")).toEqual({ autorise: true, sessionRequise: false });
  });

  it("n'autorise aucune écriture hors de celles qui appartiennent au profil", () => {
    const { ecritures } = inventaireWan();
    expect(ecritures).not.toContain("POST /api/libraries");
    expect(ecritures).not.toContain("POST /api/setup");
    expect(ecritures).not.toContain("PATCH /api/metadata/providers");
    expect(ecritures).not.toContain("POST /api/system/backups");
  });
});
