import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { MediaStream, PlaybackInfo } from "@flixtunes/contracts";
import { config } from "../src/config.js";
import { AUDIO_VIDEO_TOLERANCE_MS, corpus, referenceClients, validateCorpus, type CorpusFixture } from "../src/corpus.js";
import { db } from "../src/database.js";
import { probeMedia } from "../src/ffprobe.js";
import { decidePlayback, detectFfmpegSupport, getPlaybackInfo, planColorPipeline } from "../src/playback.js";

/**
 * Banc de qualification de la lecture — étape 50.
 *
 * Génère le corpus synthétique, le sonde avec FFprobe, rejoue la négociation réelle pour chaque client de
 * référence et compare au résultat attendu. Produit un résultat lisible par machine et un rapport humain.
 * Aucun média sous droits n'est utilisé : toutes les fixtures viennent de `lavfi`.
 */

const execFileAsync = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "flixtunes-qualification-"));
const reportDirectory = path.resolve(config.dataDir, "qualification");
const libraryId = randomUUID();

interface CaseResult {
  fixture: string;
  description: string;
  client: string;
  expectedMode: string;
  actualMode: string;
  expectedOutputFormat: string | null;
  actualOutputFormat: string | null;
  expectedAudioLanguage: string | null;
  actualAudioLanguage: string | null;
  passed: boolean;
  critical: boolean;
  notes: string[];
}

interface FixtureReport {
  fixture: string;
  generated: boolean;
  probed: boolean;
  durationSeconds: number | null;
  audioVideoOffsetMs: number | null;
  error: string | null;
}

const results: CaseResult[] = [];
const fixtureReports: FixtureReport[] = [];

function firstVideo(info: PlaybackInfo): MediaStream | null {
  return info.streams.find((stream) => stream.type === "video") ?? null;
}

/**
 * Décalage audio/vidéo en millisecondes, positif quand l'audio démarre après l'image.
 * Le `start_time` déclaré par le conteneur est retenu en premier ; à défaut, l'horodatage du premier
 * paquet de chaque flux est mesuré.
 */
async function measureAudioVideoOffset(filePath: string): Promise<number | null> {
  const number = (value: string | undefined) => {
    const parsed = Number(value?.replace(/,+$/, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  try {
    const { stdout } = await execFileAsync(config.ffprobePath,
      ["-v", "error", "-show_entries", "stream=codec_type,start_time", "-of", "csv=p=0", filePath],
      { windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
    const rows = stdout.split(/\r?\n/).map((line) => line.split(",")).filter((columns) => columns.length >= 2);
    const video = number(rows.find((columns) => columns[0] === "video")?.[1]);
    const audio = number(rows.find((columns) => columns[0] === "audio")?.[1]);
    if (video != null && audio != null) return Math.round((audio - video) * 1000);
  } catch { /* repli sur la mesure par paquet */ }
  const firstPacket = async (selector: string) => {
    try {
      const { stdout } = await execFileAsync(config.ffprobePath,
        ["-v", "error", "-select_streams", selector, "-show_entries", "packet=pts_time",
          "-read_intervals", "%+#1", "-of", "csv=p=0", filePath],
        { windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
      return number(stdout.split(/\r?\n/).find((line) => line.trim()));
    } catch { return null; }
  };
  const [video, audio] = await Promise.all([firstPacket("v:0"), firstPacket("a:0")]);
  return video != null && audio != null ? Math.round((audio - video) * 1000) : null;
}

async function generate(fixture: CorpusFixture): Promise<string | null> {
  const filePath = path.join(root, fixture.filename);
  try {
    if (fixture.postProcess === "pipe") {
      // Sortie non repositionnable : FFmpeg ne peut réécrire ni l'index ni la durée dans l'en-tête.
      const { stdout } = await execFileAsync(config.ffmpegPath,
        ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...fixture.recipe, "pipe:1"],
        { windowsHide: true, timeout: 180_000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
      await writeFile(filePath, stdout);
      return filePath;
    }
    await execFileAsync(config.ffmpegPath,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...fixture.recipe, filePath],
      { windowsHide: true, timeout: 180_000, maxBuffer: 4_000_000 });
    if (fixture.postProcess === "truncate") {
      const info = await stat(filePath);
      await truncate(filePath, Math.floor(info.size * 0.6));
    }
    return filePath;
  } catch (error) {
    fixtureReports.push({ fixture: fixture.id, generated: false, probed: false, durationSeconds: null,
      audioVideoOffsetMs: null, error: error instanceof Error ? error.message.slice(0, 400) : String(error) });
    return null;
  }
}

const problems = validateCorpus();
if (problems.length) {
  console.error("Manifeste de corpus invalide :");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

db.prepare("INSERT INTO library_folders (id, name, path, kind, language) VALUES (?, 'Qualification 0.5.0', ?, 'movie', 'fr-FR')")
  .run(libraryId, root);
const support = await detectFfmpegSupport();

try {
  for (const fixture of corpus) {
    const filePath = await generate(fixture);
    if (!filePath) continue;
    const probe = await probeMedia(filePath);
    if (!probe) {
      fixtureReports.push({ fixture: fixture.id, generated: true, probed: false, durationSeconds: null,
        audioVideoOffsetMs: null, error: "FFprobe n'a pas pu analyser le fichier" });
      continue;
    }
    const mediaId = randomUUID();
    db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, file_path, library_id, embedded_metadata_json, available)
      VALUES (?, 'movie', ?, ?, ?, ?, ?, 1)`)
      .run(mediaId, fixture.id, fixture.id, filePath, libraryId, JSON.stringify(probe.raw));
    const info = await getPlaybackInfo(mediaId);
    if (!info) {
      fixtureReports.push({ fixture: fixture.id, generated: true, probed: false, durationSeconds: null,
        audioVideoOffsetMs: null, error: "Le serveur n'a produit aucune information de lecture" });
      continue;
    }
    const audioVideoOffsetMs = await measureAudioVideoOffset(filePath);
    fixtureReports.push({ fixture: fixture.id, generated: true, probed: true,
      durationSeconds: info.durationSeconds, audioVideoOffsetMs, error: null });

    // La synchronisation A/V est un critère, pas un simple relevé : un écart au-delà de la tolérance échoue.
    if (fixture.expectedAudioVideoOffsetMs != null) {
      const drift = audioVideoOffsetMs == null ? null : Math.abs(audioVideoOffsetMs - fixture.expectedAudioVideoOffsetMs);
      results.push({
        fixture: fixture.id, description: `Synchronisation A/V — ${fixture.description}`, client: "banc",
        expectedMode: `${fixture.expectedAudioVideoOffsetMs} ms ±${AUDIO_VIDEO_TOLERANCE_MS}`,
        actualMode: audioVideoOffsetMs == null ? "non mesurable" : `${audioVideoOffsetMs} ms`,
        expectedOutputFormat: null, actualOutputFormat: null,
        expectedAudioLanguage: null, actualAudioLanguage: null,
        passed: drift != null && drift <= AUDIO_VIDEO_TOLERANCE_MS,
        critical: !fixture.knownLimitation, notes: [],
      });
    }

    for (const expectation of fixture.expectations) {
      const capabilities = referenceClients[expectation.client];
      const decision = decidePlayback(info, capabilities);
      const pipeline = planColorPipeline(firstVideo(info), capabilities, support, decision.mode, config.toneMapping);
      const audio = decision.audio;
      const notes: string[] = [];
      if (fixture.knownLimitation) notes.push(fixture.knownLimitation);
      if (decision.reasons.length) notes.push(...decision.reasons);

      const modeOk = decision.mode === expectation.mode;
      const formatOk = !expectation.outputFormat || pipeline.outputFormat === expectation.outputFormat;
      const languageOk = !expectation.audioLanguage || audio?.language === expectation.audioLanguage;
      results.push({
        fixture: fixture.id, description: fixture.description, client: expectation.client,
        expectedMode: expectation.mode, actualMode: decision.mode,
        expectedOutputFormat: expectation.outputFormat ?? null, actualOutputFormat: pipeline.outputFormat,
        expectedAudioLanguage: expectation.audioLanguage ?? null, actualAudioLanguage: audio?.language ?? null,
        passed: modeOk && formatOk && languageOk,
        critical: !fixture.knownLimitation,
        notes,
      });
    }
  }

  const failures = results.filter((result) => !result.passed);
  const criticalFailures = failures.filter((result) => result.critical);
  await mkdir(reportDirectory, { recursive: true });
  const machineReport = {
    generatedAt: new Date().toISOString(), version: config.version, step: config.step,
    engine: support.version, platform: `${os.platform()}-${os.arch()}`,
    totals: { cases: results.length, passed: results.length - failures.length, failed: failures.length,
      criticalFailed: criticalFailures.length, fixtures: corpus.length },
    fixtures: fixtureReports, cases: results,
  };
  await writeFile(path.join(reportDirectory, `qualification-${config.version}.json`),
    `${JSON.stringify(machineReport, null, 2)}\n`, "utf8");

  const lines = [
    `# Rapport de qualification de lecture ${config.version}`, "",
    `Moteur : ${support.version ?? "inconnu"} · Plateforme : ${os.platform()}-${os.arch()}`,
    `Généré le ${new Date().toISOString()}`, "",
    `**${results.length - failures.length} / ${results.length} cas réussis**, `
      + `${criticalFailures.length} échec(s) critique(s).`, "",
    "| Fixture | Client | Mode attendu | Mode obtenu | Sortie | Résultat |", "| --- | --- | --- | --- | --- | --- |",
    ...results.map((result) => `| ${result.fixture} | ${result.client} | ${result.expectedMode} | ${result.actualMode} `
      + `| ${result.actualOutputFormat ?? "—"} | ${result.passed ? "OK" : result.critical ? "ÉCHEC" : "limite connue"} |`),
    "", "## Fixtures", "",
    "| Fixture | Durée | Décalage A/V | État |", "| --- | --- | --- | --- |",
    ...fixtureReports.map((report) => `| ${report.fixture} | ${report.durationSeconds ?? "inconnue"} s `
      + `| ${report.audioVideoOffsetMs ?? "—"} ms | ${report.error ?? "analysée"} |`),
  ];
  if (failures.length) {
    lines.push("", "## Échecs", "");
    for (const failure of failures) {
      lines.push(`- **${failure.fixture} / ${failure.client}** : attendu ${failure.expectedMode}, obtenu ${failure.actualMode}.`
        + (failure.notes.length ? ` ${failure.notes.join(" ")}` : ""));
    }
  }
  await writeFile(path.join(reportDirectory, `qualification-${config.version}.md`), `${lines.join("\n")}\n`, "utf8");

  console.log(`Qualification : ${results.length - failures.length}/${results.length} cas réussis, `
    + `${criticalFailures.length} échec(s) critique(s). Rapports dans ${reportDirectory}`);
  for (const failure of failures) {
    console.log(` - ${failure.critical ? "ÉCHEC" : "limite"} ${failure.fixture} / ${failure.client} : `
      + `attendu ${failure.expectedMode}, obtenu ${failure.actualMode}`);
  }
  if (criticalFailures.length) process.exitCode = 1;
} finally {
  db.prepare("DELETE FROM media_items WHERE library_id = ?").run(libraryId);
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(libraryId);
  await rm(root, { recursive: true, force: true });
}
