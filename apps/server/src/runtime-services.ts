import type { FastifyBaseLogger } from "fastify";
import { hostname } from "node:os";
import { Bonjour } from "bonjour-service";
import chokidar, { type FSWatcher } from "chokidar";
import { config } from "./config.js";
import { getSetting, listLibraries, repairTranscodedProgress, setSetting } from "./database.js";
import { scanCoordinator } from "./scan-coordinator.js";
import { cleanupIdleSessions, cleanupPlaybackSessions, detectFfmpegSupport } from "./playback.js";
import { calibrateHardware, refreshTemperature } from "./capacity.js";
import { createBackup, listBackups } from "./maintenance.js";
import { rafraichirDirect, rafraichissementDuAuDemarrage } from "./television-direct.js";

/**
 * Génération de l'agent de métadonnées.
 *
 * Elle est comparée à la valeur inscrite en base : toute différence déclenche une réévaluation des
 * fiches existantes. On l'incrémente donc à chaque correctif qui change ce qu'une analyse aurait
 * trouvé — ici les traductions françaises explicites des épisodes TMDB et le refus de présenter le
 * texte anglais de TVmaze comme s'il était français.
 */
export const METADATA_AGENT_GENERATION = "12";

export interface RuntimeServices { close(): Promise<void> }

export function startRuntimeServices(log: FastifyBaseLogger): RuntimeServices {
  const timers: NodeJS.Timeout[] = []; const debounce = new Map<string, NodeJS.Timeout>();
  let bonjour: Bonjour | null = null; let watcher: FSWatcher | null = null;
  if (config.mdnsEnabled) {
    try {
      bonjour = new Bonjour();
      const serviceName = `FlixTunes (${hostname().slice(0, 32)}:${config.port})`;
      const service = bonjour.publish({ name: serviceName, type: "flixtunes", protocol: "tcp", port: config.port,
        txt: { version: config.version, path: "/", api: "/api", secure: config.apiToken ? "token" : "lan" } });
      service.on("error", (error) => log.warn({ err: error, service: serviceName }, "Publication mDNS indisponible"));
      log.info({ service: "_flixtunes._tcp", name: serviceName, port: config.port }, "Service mDNS publié");
    } catch (error) { log.warn({ err: error }, "Publication mDNS indisponible"); }
  }

  if (config.watchLibraries) {
    const watchedRoots = new Set<string>();
    watcher = chokidar.watch([], { ignoreInitial: true, usePolling: config.watchPolling, awaitWriteFinish: { stabilityThreshold: 4000, pollInterval: 500 } });
    const refreshWatchedRoots = () => {
      const desired = new Set(listLibraries().filter((library) => library.enabled).map((library) => library.path));
      for (const root of desired) if (!watchedRoots.has(root)) { watcher?.add(root); watchedRoots.add(root); }
      for (const root of [...watchedRoots]) if (!desired.has(root)) { void watcher?.unwatch(root); watchedRoots.delete(root); }
    };
    refreshWatchedRoots(); timers.push(setInterval(refreshWatchedRoots, 30_000));
    watcher.on("all", (_event, changedPath) => {
      const library = listLibraries().filter((candidate) => candidate.enabled)
        .sort((a, b) => b.path.length - a.path.length).find((candidate) => changedPath.toLowerCase().startsWith(candidate.path.toLowerCase()));
      if (!library) return;
      const previous = debounce.get(library.id); if (previous) clearTimeout(previous);
      debounce.set(library.id, setTimeout(() => { debounce.delete(library.id); scanCoordinator.enqueue(library.id, "files"); }, 8000));
    });
    watcher.on("error", (error) => log.warn({ err: error }, "Surveillance des bibliothèques interrompue"));
  }

  /**
   * La télévision en direct se relit au démarrage — si elle est activée, et si la cadence est échue.
   *
   * Le départ est différé de trente secondes : au démarrage, le serveur calibre le matériel, répare
   * ce qu'il faut et met en file les analyses de bibliothèque. Cinq cents téléchargements lancés
   * dans la même seconde disputeraient le réseau et le processeur à tout cela, et c'est la
   * médiathèque qu'on veut voir d'abord.
   *
   * Un échec n'arrête rien : c'est un travail de fond, et une liste injoignable au démarrage le sera
   * peut-être encore à la prochaine occasion. On le journalise, et le serveur continue de servir.
   */
  if (rafraichissementDuAuDemarrage()) {
    timers.push(setTimeout(() => {
      log.info("Télévision en direct : relecture des listes au démarrage");
      void rafraichirDirect()
        .then((etat) => log.info({ chaines: etat.chaines, listes: etat.listesRetenues, secondes: etat.dureeSecondes },
          "Télévision en direct : listes relues"))
        .catch((cause) => log.warn({ err: cause }, "Télévision en direct : relecture impossible"));
    }, 30_000));
  }

  // Réparation unique des progressions faussées par la durée du flux transcodé, jusqu'à 0.5.2 incluse.
  if (getSetting("progress_duration_repaired") !== "1") {
    try {
      const repaired = repairTranscodedProgress();
      setSetting("progress_duration_repaired", "1");
      if (repaired > 0) log.info({ repaired }, "Progressions de lecture rétablies sur la durée réelle du média");
    } catch (error) { log.warn({ err: error }, "Réparation des progressions impossible"); }
  }
  // Le micro-banc matériel est différé : il ne doit ni retarder le démarrage ni concurrencer le scan initial.
  const calibrationTimer = setTimeout(() => {
    void (async () => {
      const calibration = await calibrateHardware(await detectFfmpegSupport());
      const selected = calibration.probes.find((probe) => probe.selected);
      log.info({ encoder: selected?.encoder ?? "aucun", framesPerSecond: selected?.framesPerSecond ?? null,
        rejected: calibration.probes.filter((probe) => probe.compiled && !probe.usable).map((probe) => probe.encoder) },
      "Calibrage matériel terminé");
    })().catch((error) => log.warn({ err: error }, "Calibrage matériel impossible"));
  }, 5_000);
  calibrationTimer.unref?.();
  timers.push(calibrationTimer);
  // Le contrôle d'admission lit une température en cache : elle est rafraîchie hors du chemin de lecture.
  void refreshTemperature().catch(() => undefined);
  timers.push(setInterval(() => void refreshTemperature().catch(() => undefined), 60_000));
  timers.push(setInterval(() => scanCoordinator.enqueueStartupScans(), config.scanIntervalHours * 3_600_000));
  // Les tests d'API créent volontairement des bibliothèques factices sans dossier réel. Une reprise
  // planifiée pendant leur exécution les analyserait en arrière-plan et détruirait leur état de test ;
  // les migrations de génération ne s'exécutent donc que dans le serveur réellement démarré.
  //
  // La reprise était une minuterie unique de quinze secondes : si la mise en file ne rendait pas
  // immédiatement des travaux tous en mode « métadonnées » — par exemple parce qu'une analyse était
  // déjà en cours à cet instant précis —, rien n'était inscrit et **rien ne réessayait jamais**.
  // Constaté sur l'installation réelle : le serveur annonçait la révision r36, qui attend la
  // génération 10, alors que la base était restée à la génération 4. Les correctifs livrés depuis ne
  // s'étaient donc jamais appliqués aux fiches existantes, et les défauts réputés corrigés restaient
  // visibles à l'écran.
  //
  // Une reprise qui abandonne au premier contretemps n'est pas une reprise. Celle-ci réessaie
  // jusqu'à ce que la génération soit effectivement inscrite, puis s'arrête d'elle-même.
  if (process.env.NODE_ENV !== "test" && getSetting("metadata_agent_generation") !== METADATA_AGENT_GENERATION) {
    let tentatives = 0;
    const reprendre = () => {
      if (getSetting("metadata_agent_generation") === METADATA_AGENT_GENERATION) { clearInterval(upgradeTimer); return; }
      tentatives += 1;
      try {
        const jobs = scanCoordinator.enqueueScope("all", "metadata", 70);
        if (jobs.length && jobs.every((job) => job.mode === "metadata")) {
          setSetting("metadata_agent_generation", METADATA_AGENT_GENERATION);
          clearInterval(upgradeTimer);
          log.info({ jobs: jobs.length, tentatives }, "Réévaluation des fiches existantes planifiée");
        } else {
          log.info({ tentatives, jobs: jobs.length }, "Réévaluation différée : une analyse occupe déjà la file");
        }
      } catch (error) { log.warn({ err: error, tentatives }, "Enrichissement automatique différé"); }
    };
    const upgradeTimer = setInterval(reprendre, 5 * 60_000);
    upgradeTimer.unref?.();
    timers.push(upgradeTimer);
    const première = setTimeout(reprendre, 15_000);
    première.unref?.();
    timers.push(première);
  }
  timers.push(setInterval(() => { try { createBackup(); } catch (error) { log.error({ err: error }, "Sauvegarde automatique impossible"); } }, config.backupIntervalHours * 3_600_000));
  timers.push(setInterval(() => void cleanupPlaybackSessions(), 60 * 60_000));
  timers.push(setInterval(() => void cleanupIdleSessions(), 60_000));
  const latest = listBackups()[0];
  if (!latest || Date.now() - Date.parse(latest.createdAt) > config.backupIntervalHours * 3_600_000) {
    try { const backup = createBackup(); log.info({ backup: backup.name }, "Sauvegarde de démarrage créée"); }
    catch (error) { log.warn({ err: error }, "Sauvegarde de démarrage impossible"); }
  }

  return { async close() { for (const timer of timers) clearInterval(timer); for (const timer of debounce.values()) clearTimeout(timer); await watcher?.close(); bonjour?.unpublishAll(); bonjour?.destroy(); } };
}
