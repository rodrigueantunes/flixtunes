import { enveloppeDuFichier } from "./empreinte-extraction.js";
import { repereParEmpreinte } from "./marqueurs-empreinte.js";
const lots: Array<[string, string[], number]> = [
  ["DragonBallZ", [1,2,3,4,5].map(n => "M:/Serie Tv/Dragon Ball Z/Saison 1/E00" + n + ".mkv"), 0.7],
  ["TheOffice", [2,3,4,5,6].map(n => "M:/Serie Tv/The Office/Saison 5/S05E0" + n + ".mkv"), 45.4],
  ["Silo", [2,3,4,5,6].map(n => "M:/Serie Tv/Silo/Saison 2/S02E0" + n + ".mkv"), 347.5],
  ["Evangelion", [1,2,3,4,5].map(n => "M:/Serie Tv/Evangelion/Saison 1/S01E0" + n + ".mkv"), 0.3],
  ["Bleach", [1,2,3,4,5].map(n => "M:/Serie Tv/Bleach/Saison 4/S04E0" + n + ".mkv"), 15.8],
];
const fenetre = Number(process.argv[2]);
let bons = 0, ms = 0; const det: string[] = [];
for (const [nom, fichiers, attendu] of lots) {
  const env = (await Promise.all(fichiers.map(f => enveloppeDuFichier(f, { debutSecondes: 0, dureeSecondes: fenetre })))).filter(Boolean) as Float64Array[];
  const t0 = Date.now();
  const r = repereParEmpreinte(env[0]!, env.slice(1));
  ms += Date.now() - t0;
  const ok = r != null && Math.abs(r.debutSecondes - attendu) < 6;
  if (ok) bons++;
  det.push(nom.slice(0, 6) + (ok ? "=OK" : "=" + (r ? r.debutSecondes.toFixed(0) : "rien")));
}
console.log("fenetre " + String(fenetre).padStart(3) + " s : " + bons + "/5, " + Math.round(ms / 5) + " ms/episode   " + det.join(" "));
