import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveScanConcurrency } from "./capacity.js";

/**
 * Stabilité de la lecture sous charge.
 *
 * Signalement d'usage réel : une analyse complète lancée, puis un film 4K démarré, et le serveur
 * tombe. Deux causes distinctes ont été trouvées, et elles se cumulent.
 *
 * **La protection regardait dans le mauvais sens.** Le contrôle de capacité n'était consulté qu'au
 * moment de *démarrer* une analyse. Une analyse déjà lancée continuait à plein régime si la lecture
 * commençait ensuite — exactement l'ordre du signalement.
 *
 * **Rien ne rattrapait une promesse rejetée.** Node met fin au processus par défaut ; une analyse
 * lance des centaines d'opérations asynchrones, et une seule suffisait à couper le film.
 */

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const lire = (nom: string) => readFile(path.join(sourceDir, nom), "utf8");

describe("l'analyse cède la place à la lecture", () => {
  it("s'arrête complètement quand le budget de conversion est saturé", () => {
    // Au-delà de 85 % du budget, plus aucun travailleur : la lecture passe avant tout.
    expect(effectiveScanConcurrency(4, 1, 0.9)).toBe(0);
  });

  it("retombe à un seul travailleur dès qu'une conversion tourne", () => {
    expect(effectiveScanConcurrency(4, 1, 0.2)).toBe(1);
  });

  it("reprend sa pleine vitesse quand plus rien ne lit", () => {
    expect(effectiveScanConcurrency(4, 0, 0.1)).toBe(4);
  });

  it("interroge la capacité entre deux fichiers, et non seulement au démarrage", async () => {
    // Le cœur du défaut : `pump()` ne consultait la capacité qu'à l'admission d'un travail. Une
    // analyse en cours ne la consultait plus jamais.
    const scanner = await lire("scanner.ts");
    expect(scanner, "la boucle d'analyse doit céder la main entre deux fichiers")
      .toContain("await options.yieldToPlayback?.(options.signal)");

    const coordinateur = await lire("scan-coordinator.ts");
    expect(coordinateur, "le coordinateur doit fournir cette cession à l'analyse")
      .toContain("yieldToPlayback: (signal) => this.yieldToPlayback(signal)");
  });

  it("borne l'attente, pour qu'une session restée ouverte ne fige pas l'analyse", async () => {
    // Sans plafond, une conversion oubliée suspendrait l'analyse indéfiniment et personne ne saurait
    // pourquoi : l'analyse paraîtrait simplement ne jamais finir.
    const coordinateur = await lire("scan-coordinator.ts");
    expect(coordinateur).toContain("10 * 60 * 1000");
  });

  it("respecte l'annulation pendant qu'elle attend", async () => {
    // Une analyse suspendue doit rester annulable : sinon le bouton « annuler » ne ferait rien tant
    // que le film n'est pas terminé.
    const coordinateur = await lire("scan-coordinator.ts");
    expect(coordinateur).toContain('if (signal?.aborted) throw new Error("Analyse annulée")');
  });
});

describe("une erreur de fond n'emporte plus la lecture", () => {
  it("rattrape les promesses rejetées sans capture", async () => {
    // C'est le comportement par défaut de Node qui pose problème : il met fin au processus. Sur un
    // serveur de médias, cela coupe le film de quelqu'un pour une affiche introuvable.
    const index = await lire("index.ts");
    expect(index).toContain('process.on("unhandledRejection"');
  });

  it("rattrape les exceptions non captées", async () => {
    const index = await lire("index.ts");
    expect(index).toContain('process.on("uncaughtException"');
  });

  it("journalise au lieu de taire", async () => {
    // Continuer à servir ne doit pas revenir à masquer le défaut : sans trace, il devient
    // introuvable, et c'est alors le remède qui pose problème.
    const index = await lire("index.ts");
    expect(index).toContain("app.log.error");
  });
});
