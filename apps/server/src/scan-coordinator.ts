import { randomUUID } from "node:crypto";
import type { ScanJob, ScanMode, ScanScope } from "@flixtunes/contracts";
import { activeSessionCosts, currentBudgetUnits, effectiveScanConcurrency, usedCapacityUnits } from "./capacity.js";
import { config } from "./config.js";
import { MATCH_THRESHOLDS } from "./match-engine.js";
import { db, listLibraries } from "./database.js";
import { scanLibraryById, type ScanResult } from "./scanner.js";
import { completerLesGeneriques } from "./marqueurs-passe.js";

/** Trois heures : la plus longue séance qu'on veuille ne pas déranger, et pas plus. */
const PATIENCE_GENERIQUES_MS = 3 * 60 * 60 * 1000;

interface QueuedScan {
  id: string;
  libraryId: string;
  mode: ScanMode;
  scope: ScanScope;
  priority: number;
  /** Reprise ciblée : seules les fiches restées sans correspondance sont redemandées au fournisseur. */
  onlyUnmatched?: boolean;
}

type ScanJobRow = {
  id: string; library_id: string; library_name: string; scope: ScanScope; mode: ScanMode;
  status: ScanJob["status"]; priority: number; discovered: number; imported: number; enriched: number;
  removed: number; error_count: number; error: string | null; created_at: string;
  started_at: string | null; finished_at: string | null;
};

function mapJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id, libraryId: row.library_id, libraryName: row.library_name, scope: row.scope, mode: row.mode,
    status: row.status, priority: row.priority, discovered: row.discovered, imported: row.imported,
    enriched: row.enriched, removed: row.removed, errorCount: row.error_count, error: row.error,
    createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
    cancellable: row.status === "queued" || row.status === "running",
    retryable: row.status === "failed" || row.status === "cancelled",
  };
}

const jobSelect = `SELECT j.*, l.name AS library_name FROM scan_jobs j
  JOIN library_folders l ON l.id = j.library_id`;

class ScanCoordinator {
  private readonly queue: QueuedScan[] = [];
  private readonly active = new Map<string, { job: QueuedScan; controller: AbortController }>();
  private resumeTimer: NodeJS.Timeout | null = null;

  /**
   * Nombre d'analyses réellement autorisées à cet instant.
   * Une analyse ne doit jamais affamer une lecture : la concurrence retombe à un seul travailleur dès
   * qu'une conversion tourne, et à zéro quand le budget de conversion est presque saturé.
   */
  private effectiveConcurrency(): number {
    const transcodes = activeSessionCosts().filter((session) => session.mode !== "direct").length;
    const budget = currentBudgetUnits();
    return effectiveScanConcurrency(config.scanConcurrency, transcodes, budget > 0 ? usedCapacityUnits() / budget : 0);
  }

  stats() {
    const effective = this.effectiveConcurrency();
    return { active: this.active.size, queued: this.queue.length, concurrency: config.scanConcurrency,
      effective, pausedByPlayback: effective < config.scanConcurrency };
  }

  list(limit = 100): ScanJob[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    return (db.prepare(`${jobSelect} ORDER BY j.created_at DESC LIMIT ?`).all(safeLimit) as ScanJobRow[]).map(mapJob);
  }

  get(id: string): ScanJob | null {
    const row = db.prepare(`${jobSelect} WHERE j.id = ?`).get(id) as ScanJobRow | undefined;
    return row ? mapJob(row) : null;
  }

  enqueue(libraryId: string, mode: ScanMode, scope: ScanScope = "library", priority = 50): { queued: boolean; job: ScanJob } {
    const library = listLibraries().find((candidate) => candidate.id === libraryId && candidate.enabled);
    if (!library) throw new Error("Bibliothèque introuvable ou désactivée");
    const duplicate = [...this.active.values()].find(({ job }) => job.libraryId === libraryId)
      ?? this.queue.map((job) => ({ job })).find(({ job }) => job.libraryId === libraryId);
    if (duplicate) return { queued: false, job: this.get(duplicate.job.id)! };

    const job: QueuedScan = { id: randomUUID(), libraryId, mode, scope, priority: Math.max(0, Math.min(100, priority)) };
    db.prepare(`INSERT INTO scan_jobs (id, library_id, scope, mode, status, priority) VALUES (?, ?, ?, ?, 'queued', ?)`)
      .run(job.id, libraryId, scope, mode, job.priority);
    db.prepare(`UPDATE library_folders SET last_scan_mode = ?, last_scan_status = 'queued', last_scan_error = NULL,
      last_scan_discovered = 0, last_scan_imported = 0, last_scan_enriched = 0, last_scan_removed = 0,
      last_scan_started_at = NULL, last_scan_finished_at = NULL WHERE id = ?`).run(mode, libraryId);
    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.pump();
    return { queued: true, job: this.get(job.id)! };
  }

  enqueueScope(scope: Exclude<ScanScope, "library">, mode: ScanMode, priority = 50): ScanJob[] {
    const libraries = listLibraries().filter((library) => library.enabled
      && (scope === "all" || library.resolvedKind === scope));
    return libraries.map((library) => this.enqueue(library.id, mode, scope, priority).job);
  }

  enqueueStartupScans(): void {
    this.enqueueScope("all", "files", 10);
  }

  cancel(id: string): ScanJob | null {
    const queuedIndex = this.queue.findIndex((job) => job.id === id);
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1);
      this.finishCancelled(job!);
      return this.get(id);
    }
    const running = this.active.get(id);
    if (running) running.controller.abort();
    return this.get(id);
  }

  retry(id: string): { queued: boolean; job: ScanJob } | null {
    const previous = this.get(id);
    if (!previous || !previous.retryable) return null;
    return this.enqueue(previous.libraryId, previous.mode, previous.scope, previous.priority);
  }

  private finishCancelled(job: QueuedScan): void {
    db.prepare("UPDATE scan_jobs SET status = 'cancelled', error = 'Analyse annulée', finished_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(job.id);
    db.prepare(`UPDATE library_folders SET last_scan_status = 'cancelled', last_scan_error = 'Analyse annulée',
      last_scan_finished_at = CURRENT_TIMESTAMP WHERE id = ?`).run(job.libraryId);
  }

  private pump(): void {
    const limit = this.effectiveConcurrency();
    while (this.active.size < limit && this.queue.length) {
      const job = this.queue.shift()!;
      const controller = new AbortController();
      this.active.set(job.id, { job, controller });
      // Une reprise différée peut survenir après l'arrêt du serveur : l'échec ne doit pas rester non capté.
      void this.run(job, controller).catch(() => { this.active.delete(job.id); });
    }
    // Une file retenue par la charge de lecture doit repartir seule dès que celle-ci retombe.
    if (this.queue.length && !this.resumeTimer) {
      this.resumeTimer = setInterval(() => {
        if (!this.queue.length) { this.clearResumeTimer(); return; }
        try { if (this.active.size < this.effectiveConcurrency()) this.pump(); }
        catch { this.clearResumeTimer(); }
      }, 15_000);
      this.resumeTimer.unref?.();
    }
  }

  private clearResumeTimer(): void {
    if (!this.resumeTimer) return;
    clearInterval(this.resumeTimer);
    this.resumeTimer = null;
  }

  /**
   * Suspend une analyse **en cours** tant qu'une lecture réclame la machine.
   *
   * `pump()` ne consultait la capacité qu'au moment de démarrer un travail. Une analyse déjà lancée
   * continuait donc à plein régime si une lecture commençait ensuite : analyse d'abord, film 4K
   * après, et les deux se disputent le processeur du NAS. La protection existait, mais elle ne
   * regardait que vers l'avant.
   *
   * L'attente est active plutôt que bloquante : on redemande toutes les deux secondes, ce qui laisse
   * l'analyse repartir dès la fin de la lecture sans qu'aucun signal n'ait à être émis. Deux secondes
   * sont insensibles à l'échelle d'une analyse et évitent de scruter en boucle.
   *
   * Le plafond de dix minutes n'est pas une politesse : sans lui, une session de conversion restée
   * ouverte à tort figerait l'analyse indéfiniment, et personne ne saurait pourquoi.
   */
  /**
   * Lancer une passe de repérage hors analyse, quand on vient d'allumer la fonction.
   *
   * Sans cela, allumer l'interrupteur ne ferait rien de visible jusqu'à la prochaine analyse — et
   * l'utilisateur, lui, vient de demander que ça se fasse. Même politesse qu'après un scan : la passe
   * s'efface devant une lecture en cours.
   */
  relancerLesGeneriques(): void {
    void completerLesGeneriques({ attendreCreneau: (signal) => this.yieldToPlayback(signal, PATIENCE_GENERIQUES_MS) })
      .catch((error: unknown) => {
        console.warn("[FlixTunes] Repérage des génériques interrompu :",
          error instanceof Error ? error.message : String(error));
      });
  }

  /**
   * Attendre que la machine se libère, avec une patience qui dépend de ce qu'on fait attendre.
   *
   * Le plafond protège d'une session de lecture restée ouverte à tort, qui figerait le travail
   * indéfiniment. Dix minutes conviennent à une analyse de bibliothèque — la retarder davantage
   * priverait la médiathèque de ses nouveautés.
   *
   * Le repérage des génériques, lui, n'a aucune raison d'être pressé : il tourne des heures, se
   * reprend là où il en est, et son seul devoir est de **ne pas se faire remarquer**. Le laisser
   * repartir au bout de dix minutes au milieu d'un film de deux heures allait exactement contre cela.
   * D'où un plafond réglable, et une patience de trois heures pour lui — assez pour couvrir la plus
   * longue des séances, sans renoncer à la garde contre une session fantôme.
   */
  private async yieldToPlayback(signal?: AbortSignal, plafondMs = 10 * 60 * 1000): Promise<void> {
    const limite = Date.now() + plafondMs;
    while (this.effectiveConcurrency() === 0 && Date.now() < limite) {
      if (signal?.aborted) throw new Error("Analyse annulée");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  /**
   * Enchaîne une reprise ciblée si des fiches sont restées de côté.
   *
   * C'est ce qui manquait : une fiche laissée sans correspondance par une requête infructueuse ou une
   * indisponibilité passagère du fournisseur n'était **jamais** reprise. Elle restait telle quelle
   * jusqu'à ce que la personne relance une analyse complète de toute la médiathèque.
   *
   * La reprise ne part qu'après une analyse ordinaire, jamais après une autre reprise : sans cette
   * garde, deux fiches définitivement introuvables — un bonus, un spectacle — relanceraient une
   * analyse à l'infini.
   *
   * Sa priorité est la plus basse : elle attend derrière tout le reste, et le contrôle de capacité
   * l'empêche de partir tant qu'une lecture demande la machine.
   */
  private enqueueRepairIfNeeded(job: QueuedScan): void {
    if (job.onlyUnmatched) return;
    const restantes = Number((db.prepare(`SELECT COUNT(*) AS n FROM catalog_items
      WHERE library_id = ? AND kind IN ('movie', 'show') AND metadata_locked = 0
        AND (match_status IN ('unmatched', 'review') OR COALESCE(match_confidence, 0) < ?)`)
      .get(job.libraryId, MATCH_THRESHOLDS.automatic) as { n: number }).n);
    if (restantes === 0) return;

    const reprise: QueuedScan = {
      id: randomUUID(), libraryId: job.libraryId, mode: "metadata", scope: "library",
      priority: 1, onlyUnmatched: true,
    };
    db.prepare("INSERT INTO scan_jobs (id, library_id, scope, mode, status, priority) VALUES (?, ?, ?, ?, 'queued', ?)")
      .run(reprise.id, reprise.libraryId, reprise.scope, reprise.mode, reprise.priority);
    this.queue.push(reprise);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.pump();
  }

  private async run(job: QueuedScan, controller: AbortController): Promise<void> {
    db.prepare("UPDATE scan_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ?").run(job.id);
    db.prepare(`UPDATE library_folders SET last_scan_status = 'running', last_scan_started_at = CURRENT_TIMESTAMP,
      last_scan_finished_at = NULL, last_scan_error = NULL WHERE id = ?`).run(job.libraryId);
    let lastProgressWrite = 0;
    const writeProgress = (result: ScanResult, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressWrite < 350) return;
      lastProgressWrite = now;
      db.prepare(`UPDATE scan_jobs SET discovered = ?, imported = ?, enriched = ?, removed = ?, error_count = ? WHERE id = ?`)
        .run(result.discovered, result.imported, result.enriched, result.removed, result.errors.length, job.id);
      db.prepare(`UPDATE library_folders SET last_scan_discovered = ?, last_scan_imported = ?,
        last_scan_enriched = ?, last_scan_removed = ? WHERE id = ?`)
        .run(result.discovered, result.imported, result.enriched, result.removed, job.libraryId);
    };

    try {
      const result = await scanLibraryById(job.libraryId, { mode: job.mode, signal: controller.signal,
        onlyUnmatched: job.onlyUnmatched,
        yieldToPlayback: (signal) => this.yieldToPlayback(signal),
        onProgress: (progress) => writeProgress(progress) });
      writeProgress(result, true);
      const errorSummary = result.errors.length
        ? `${result.errors.length} erreur(s). ${result.errors[0]?.message ?? ""}`.slice(0, 1000) : null;
      db.prepare(`UPDATE scan_jobs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?`)
        .run(errorSummary, job.id);
      db.prepare(`UPDATE library_folders SET last_scan_status = 'completed', last_scan_finished_at = CURRENT_TIMESTAMP,
        last_scan_error = ? WHERE id = ?`).run(errorSummary, job.libraryId);
      /*
       * Les repères de générique se complètent ici, et nulle part ailleurs.
       *
       * C'est le seul moment où l'on connaît une saison entière, et c'est surtout le seul moment où
       * l'on peut se permettre de calculer : une lecture qui démarre ne doit jamais attendre après
       * une déduction. La passe ne lit aucun fichier — tout vient des métadonnées déjà rangées — et
       * elle se relance sans dommage, ce qui la rend juste après l'ajout d'un épisode comme après un
       * scan complet.
       */
      void completerLesGeneriques({
        signal: controller.signal,
        // La passe sonore décode ; elle s'efface donc devant une lecture, exactement comme l'analyse
        // elle-même. Sur un Celeron à quatre cœurs, la politesse n'est pas une figure de style.
        attendreCreneau: (signal) => this.yieldToPlayback(signal, PATIENCE_GENERIQUES_MS),
      }).then((repere) => {
        if (!repere.parVoisins && !repere.parEmpreinte) return;
        console.info(`[FlixTunes] Génériques complétés — ${repere.parVoisins} par les voisins de saison, `
          + `${repere.parEmpreinte} par l'empreinte sonore sur ${repere.saisonsEcoutees} saison(s)`
          + `${repere.illisibles ? `, ${repere.illisibles} fichier(s) illisible(s)` : ""}.`);
      }).catch((error: unknown) => {
        // Un repère manquant n'est pas une raison de faire échouer une analyse.
        console.warn("[FlixTunes] Repérage des génériques interrompu :",
          error instanceof Error ? error.message : String(error));
      });
      this.enqueueRepairIfNeeded(job);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? "Analyse annulée" : (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      db.prepare(`UPDATE scan_jobs SET status = ?, finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?`)
        .run(cancelled ? "cancelled" : "failed", message, job.id);
      db.prepare(`UPDATE library_folders SET last_scan_status = ?, last_scan_finished_at = CURRENT_TIMESTAMP,
        last_scan_error = ? WHERE id = ?`).run(cancelled ? "cancelled" : "failed", message, job.libraryId);
    } finally {
      this.active.delete(job.id);
      this.pump();
    }
  }
}

export const scanCoordinator = new ScanCoordinator();
