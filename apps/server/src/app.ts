import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { registerRoutes } from "./routes.js";
import { config } from "./config.js";
import { recordRequest } from "./telemetry.js";
import { secureSecretEqual } from "./security.js";
import { compteDistantRequis, verdictWan } from "./wan-exposition.js";
import { jetonDeLaRequete, sessionDuJeton } from "./sessions-profil.js";
import { compteDuJeton, jetonCompteDeLaRequete } from "./comptes-distants.js";
import { journaliserAccesWan } from "./wan-journal.js";
import { parametresWan } from "./wan-parametres.js";

function isTrustedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") ||
      /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch { return false; }
}

/** Sur l'écoute distante, une seule origine est acceptable : le domaine par lequel on y accède. */
function isWanOrigin(origin: string): boolean {
  const domaine = parametresWan().domaine;
  if (!domaine) return false;
  try { return new URL(origin).hostname.toLowerCase() === domaine; }
  catch { return false; }
}

/**
 * Quota d'ouvertures de session de conversion, par profil.
 *
 * Chaque appel démarre un FFmpeg. Sur le réseau local cet appel est exempté de limitation, ce qui est
 * juste — on n'étrangle pas la lecture de la maison. Depuis Internet, la même exemption offrirait à
 * qui possède une session le droit d'allumer des conversions sans fin.
 *
 * Le compteur est gardé en mémoire : un redémarrage remet à zéro une fenêtre de cinq minutes, ce qui
 * est sans conséquence, et cela évite une écriture en base à chaque lancement de film.
 */
const FENETRE_SESSIONS_MS = 5 * 60_000;
const SESSIONS_PAR_FENETRE = 12;
const ouverturesParProfil = new Map<string, number[]>();

function quotaSessionDepasse(profileId: string): boolean {
  const maintenant = Date.now();
  const recentes = (ouverturesParProfil.get(profileId) ?? [])
    .filter((instant) => maintenant - instant < FENETRE_SESSIONS_MS);
  if (recentes.length >= SESSIONS_PAR_FENETRE) {
    ouverturesParProfil.set(profileId, recentes);
    return true;
  }
  recentes.push(maintenant);
  ouverturesParProfil.set(profileId, recentes);
  return false;
}

export interface OptionsApp {
  /**
   * `lan` conserve exactement le comportement historique. `wan` ajoute la liste blanche, la session
   * obligatoire, la confiance au proxy et le journal — et ne retire rien au premier, puisque ce sont
   * deux instances distinctes.
   */
  exposition?: "lan" | "wan";
}

export async function buildApp(options: OptionsApp = {}) {
  const distant = options.exposition === "wan";
  const app = Fastify({ logger: process.env.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.x-flixtunes-token", "req.headers.cookie"] }, bodyLimit: 1024 * 1024,
    trustProxy: distant ? config.wan.proxies : false,
    requestTimeout: 30_000, keepAliveTimeout: 72_000, maxRequestsPerSocket: 1000 });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } });
  // Sur le WAN, l'exemption des routes média disparaît : c'est justement là que se trouve ce qui
  // coûte cher. Le plafond reste large pour ne pas hacher une lecture, le vrai frein étant le quota
  // d'ouvertures de session ci-dessus.
  await app.register(rateLimit, distant
    ? { max: 600, timeWindow: "1 minute" }
    : { max: 600, timeWindow: "1 minute", allowList: (request) => /\/api\/(media|playback|artwork)\//.test(request.url) });
  await app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || (distant ? isWanOrigin(origin) : isTrustedOrigin(origin))),
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: distant,
  });
  const requestStarts = new WeakMap<object, bigint>();
  app.addHook("onRequest", async (request) => { requestStarts.set(request, process.hrtime.bigint()); });
  app.addHook("onResponse", async (request, reply) => { const start = requestStarts.get(request);
    if (start) recordRequest(Number(process.hrtime.bigint() - start) / 1_000_000, reply.statusCode); });
  app.addHook("onRequest", async (request, reply) => {
    if (!config.apiToken || request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    const bearer = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : null;
    const token = request.headers["x-flixtunes-token"];
    if (!secureSecretEqual(bearer, config.apiToken) && !secureSecretEqual(token, config.apiToken)) return reply.code(401).send({ message: "Jeton FlixTunes requis" });
  });

  if (distant) {
    /**
     * Le garde de l'écoute distante.
     *
     * Il s'exécute après le routage — Fastify résout la route avant les crochets — donc
     * `routeOptions.url` porte le motif enregistré et non l'URL reçue. C'est ce qui rend le filtrage
     * exact : aucune expression régulière sur une chaîne que le client contrôle.
     */
    app.addHook("onRequest", async (request, reply) => {
      request.expositionWan = true;
      const motif = request.routeOptions?.url;
      const verdict = verdictWan(request.method, motif);
      const source = request.ip;

      if (!verdict.autorise) {
        if (motif?.startsWith("/api/")) {
          journaliserAccesWan({ verdict: "route-refusee", source, profil: null, route: `${request.method} ${motif}`, appareil: null });
        }
        // 404 et non 403 : de l'extérieur, une administration interdite doit être indiscernable
        // d'une administration inexistante.
        return reply.code(404).send({ message: "Route introuvable" });
      }

      if (compteDistantRequis(request.method, motif)) {
        const compte = compteDuJeton(jetonCompteDeLaRequete(request));
        if (!compte) {
          journaliserAccesWan({ verdict: "session-absente", source, profil: null,
            route: motif ?? null, appareil: "compte distant requis" });
          return reply.code(401).send({ message: "Compte de connexion requis", code: "REMOTE_ACCOUNT_REQUIRED" });
        }
        request.compteDistantId = compte.id;
      }
      if (!verdict.sessionRequise) return;

      const jeton = jetonDeLaRequete(request);
      if (!jeton) {
        journaliserAccesWan({ verdict: "session-absente", source, profil: null, route: motif ?? null, appareil: null });
        return reply.code(401).send({ message: "Session requise" });
      }
      const session = sessionDuJeton(jeton);
      if (!session) {
        journaliserAccesWan({ verdict: "session-invalide", source, profil: null, route: motif ?? null, appareil: null });
        return reply.code(401).send({ message: "Session expirée" });
      }
      // Le profil est imposé par la session, jamais par la requête : sans cela, un jeton valide
      // permettrait de lire la progression et la liste de n'importe quel autre profil en changeant
      // simplement `profileId` dans la chaîne de requête.
      request.profilImpose = session.profileId;

      if (request.method === "POST" && motif === "/api/media/:id/playback" && quotaSessionDepasse(session.profileId)) {
        return reply.code(429).send({ message: "Trop de lectures ouvertes en peu de temps. Patientez quelques minutes." });
      }
    });
  }

  await registerRoutes(app);
  if (existsSync(config.webDistDir)) {
    await app.register(fastifyStatic, { root: config.webDistDir, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
      ? reply.code(404).send({ message: "Route introuvable" }) : reply.type("text/html").sendFile("index.html"));
  }
  return app;
}
