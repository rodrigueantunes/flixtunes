import { config } from "./config.js";
import { applyPendingRestore } from "./restore-bootstrap.js";

await applyPendingRestore();
const [{ buildApp }, { scanCoordinator }, { isFirstRunRequired }, { startRuntimeServices }, { parametresWan }] = await Promise.all([
  import("./app.js"), import("./scan-coordinator.js"), import("./database.js"), import("./runtime-services.js"), import("./wan-parametres.js"),
]);
const app = await buildApp();
/**
 * Seconde écoute, réservée à l'accès distant.
 *
 * Elle n'existe que si un domaine a été posé — aucune mise à jour ne peut donc ouvrir l'accès
 * distant par effet de bord. Les deux instances partagent les mêmes modules : base, coordinateur
 * d'analyse, sessions de lecture. Ce ne sont pas deux serveurs, c'est un serveur avec deux portes,
 * dont une seule laisse passer presque rien.
 */
const appWan = parametresWan().domaine ? await buildApp({ exposition: "wan" }) : null;
let runtime: ReturnType<typeof startRuntimeServices> | null = null;

/**
 * Filet de dernier recours du processus.
 *
 * Sans ces deux écoutes, une seule promesse rejetée sans capture **arrête le serveur** — Node y met
 * fin par défaut. Or une analyse de médiathèque lance des centaines d'opérations asynchrones : une
 * lecture d'affiche qui échoue, un `ffprobe` qui rend la main autrement que prévu, un fournisseur
 * injoignable. Chacune suffisait à interrompre le film en cours.
 *
 * Le choix assumé : **journaliser et continuer à servir**. Poursuivre après une exception non captée
 * est déconseillé en général, parce que l'état du programme peut être incohérent. Ici, l'alternative
 * est de couper la lecture de quelqu'un qui regarde un film — ce qui est certainement pire qu'un état
 * douteux dans un travail de fond. Le message est journalisé en entier, pour rester diagnosticable :
 * on ne masque pas le défaut, on refuse seulement qu'il emporte la lecture avec lui.
 */
process.on("unhandledRejection", (cause) => {
  app.log.error({ cause }, "Promesse rejetée sans capture — le serveur continue de servir");
});
process.on("uncaughtException", (error) => {
  app.log.error({ err: error }, "Exception non captée — le serveur continue de servir");
});

try {
  await app.listen({ host: config.host, port: config.port });
  if (appWan) {
    // La boucle locale, et rien d'autre : c'est Caddy qui porte TLS devant. Une écoute en clair sur
    // 0.0.0.0 serait joignable depuis le réseau, et une redirection malheureuse sur la box la
    // rendrait joignable depuis Internet — en clair.
    await appWan.listen({ host: config.wan.host, port: parametresWan().portInterne });
    app.log.info({ host: config.wan.host, port: parametresWan().portInterne, domaine: parametresWan().domaine },
      "Écoute distante active derrière le proxy");
  }
  if (!isFirstRunRequired()) scanCoordinator.enqueueStartupScans();
  runtime = startRuntimeServices(app.log);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await runtime?.close(); await appWan?.close(); await app.close(); process.exit(0); });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
