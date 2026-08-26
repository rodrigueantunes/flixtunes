import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";
import { evaluateCorpus, generateNameCorpus, mutateSample, mutations } from "../src/detection-corpus.js";

/**
 * Banc de détection de fichiers — étape 51.
 *
 * Génère un corpus déterministe de noms synthétiques, mesure précision et rappel par catégorie et par
 * règle, puis écrit un rapport lisible ainsi que l'export des échecs, afin qu'un cas raté puisse être
 * rejoué tel quel.
 */

const size = Number(process.argv[2] ?? 10_000);
const target = Number(process.env.FLIXTUNES_DETECTION_TARGET ?? 0.99);
const reportDirectory = path.resolve(config.dataDir, "detection");

const corpus = generateNameCorpus(size);
const evaluation = evaluateCorpus(corpus);
// Un corpus produit par gabarits reste régulier : les mutations mesurent la robustesse réelle.
const mutated = mutations.map((mutation) => ({
  mutation: mutation.name,
  evaluation: evaluateCorpus(corpus.map((sample) => mutateSample(sample, mutation))),
}));
await mkdir(reportDirectory, { recursive: true });

await writeFile(path.join(reportDirectory, `detection-${config.version}.json`),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), version: config.version, size, target, ...evaluation,
    mutations: mutated.map((entry) => ({ mutation: entry.mutation, accuracy: entry.evaluation.accuracy,
      correct: entry.evaluation.correct, failures: entry.evaluation.failures.slice(0, 20) })) }, null, 2)}\n`,
  "utf8");

const percent = (value: number) => `${(value * 100).toFixed(2)} %`;
const lines = [
  `# Rapport de détection de fichiers ${config.version}`, "",
  `Corpus déterministe de **${evaluation.total} noms** synthétiques. Objectif : ${percent(target)} de détections exactes.`, "",
  `**${evaluation.correct} / ${evaluation.total} exactes — ${percent(evaluation.accuracy)}**`, "",
  "## Rappel par catégorie", "",
  "| Catégorie | Échantillons | Exactes | Rappel | Auto | Revue | Rejet |", "| --- | --- | --- | --- | --- | --- | --- |",
  ...evaluation.byCategory.map((entry) => `| ${entry.category} | ${entry.total} | ${entry.correct} | ${percent(entry.recall)} `
    + `| ${entry.auto} | ${entry.revue} | ${entry.rejet} |`),
  "", "## Précision par règle", "",
  "| Règle | Prédictions | Exactes | Précision |", "| --- | --- | --- | --- |",
  ...evaluation.byRule.map((entry) => `| ${entry.rule} | ${entry.predicted} | ${entry.correct} | ${percent(entry.precision)} |`),
  "", "## Robustesse aux mutations de noms", "",
  "Le corpus étant produit par gabarits, il reste plus régulier que la réalité. Chaque mutation ajoute une",
  "déformation courante des noms de partage sans changer ce que le fichier désigne.", "",
  "| Mutation | Exactes | Précision |", "| --- | --- | --- |",
  ...mutated.map((entry) => `| ${entry.mutation} | ${entry.evaluation.correct} / ${entry.evaluation.total} `
    + `| ${percent(entry.evaluation.accuracy)} |`),
];
if (evaluation.failures.length) {
  lines.push("", `## Échecs (${evaluation.failures.length} premiers exportés)`, "",
    "| Catégorie | Nom | Règle attendue | Règle retenue | Écart |", "| --- | --- | --- | --- | --- |",
    ...evaluation.failures.map((failure) => `| ${failure.category} | \`${path.basename(failure.path)}\` `
      + `| ${failure.expectedRule} | ${failure.actualRule} | ${failure.reason} |`));
}
await writeFile(path.join(reportDirectory, `detection-${config.version}.md`), `${lines.join("\n")}\n`, "utf8");

console.log(`Détection : ${evaluation.correct}/${evaluation.total} exactes (${percent(evaluation.accuracy)}), `
  + `objectif ${percent(target)}. Rapports dans ${reportDirectory}`);
for (const entry of mutated) {
  console.log(` mutation ${entry.mutation.padEnd(20)} ${percent(entry.evaluation.accuracy)}`);
  for (const failure of entry.evaluation.failures.slice(0, 3)) {
    console.log(`   · ${failure.category} « ${path.basename(failure.path)} » → ${failure.reason}`);
  }
}
for (const entry of evaluation.byCategory.filter((category) => category.recall < target)) {
  console.log(` - ${entry.category} : ${percent(entry.recall)} (${entry.correct}/${entry.total})`);
}
for (const failure of evaluation.failures.slice(0, 12)) {
  console.log(`   · ${failure.category} « ${path.basename(failure.path)} » → ${failure.reason}`);
}
if (evaluation.accuracy < target) process.exitCode = 1;
