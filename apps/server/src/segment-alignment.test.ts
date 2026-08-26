import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEGMENT_SECONDS, keyframeArgs } from "./playback.js";

/**
 * Alignement des images-clés sur la frontière des segments — exigence « excellence de lecture ».
 *
 * `-hls_time` n'est qu'un souhait adressé au multiplexeur : ffmpeg ne peut découper un segment que
 * sur une image-clé. Sans images-clés forcées, c'est l'intervalle par défaut de l'encodeur qui
 * décide seul — 250 images pour libx264, soit **10 secondes** à 25 im/s là où le code en demandait
 * 4. Mesuré sur une sortie réelle de 40 s : 4 segments de 10 s sans images-clés forcées, 10 segments
 * de 4 s avec. Le lecteur devait donc télécharger dix secondes avant d'afficher la première image,
 * et ne pouvait se déplacer que par pas de dix secondes.
 *
 * Le chemin adaptatif les forçait déjà ; le chemin à variante unique — celui qu'emprunte la majorité
 * des lectures — ne les forçait pas.
 */

describe("images-clés et durée de segment", () => {
  it("cadence les images-clés exactement sur la durée de segment", () => {
    // Le lien entre les deux valeurs est tout l'enjeu : une expression qui citerait un autre nombre
    // que `SEGMENT_SECONDS` ramènerait des segments de longueur imprévisible.
    expect(keyframeArgs("libx264")).toContain(`expr:gte(t,n_forced*${SEGMENT_SECONDS})`);
  });

  it("neutralise la détection de changement de plan sur les encodeurs logiciels", () => {
    // Un changement de plan insère sinon une image-clé supplémentaire, qui coupe un segment plus
    // court que prévu et rend les durées irrégulières.
    for (const encodeur of ["libx264", "libx265"]) {
      expect(keyframeArgs(encodeur)).toEqual(expect.arrayContaining(["-sc_threshold", "0"]));
    }
  });

  it("n'impose pas d'option logicielle aux encodeurs matériels", () => {
    // `-sc_threshold` n'appartient qu'à x264/x265. Le passer à QuickSync ou VAAPI — les encodeurs du
    // NAS — ne produit qu'un avertissement, mais un avertissement qu'on n'a aucune raison d'émettre.
    for (const encodeur of ["h264_qsv", "hevc_qsv", "h264_vaapi", "h264_nvenc"]) {
      expect(keyframeArgs(encodeur)).not.toContain("-sc_threshold");
      expect(keyframeArgs(encodeur), "le forçage d'images-clés, lui, vaut pour tous les encodeurs")
        .toContain("-force_key_frames");
    }
  });
});

describe("cohérence des durées déclarées à ffmpeg", () => {
  it("ne laisse aucune durée de segment écrite en dur", async () => {
    // La durée demandée au multiplexeur et le rythme des images-clés doivent s'accorder. Quand ils
    // sont écrits séparément, rien n'empêche l'un de bouger sans l'autre — c'est exactement ce qui
    // s'était produit. Ce test protège l'unique source de vérité.
    const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "playback.ts"), "utf8");
    const codeSeul = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const option of ["-hls_time", "-seg_duration"]) {
      const litteraux = [...codeSeul.matchAll(new RegExp(`"${option}",\\s*"(\\d+)"`, "g"))];
      expect(litteraux.map((trouve) => trouve[0]),
        `${option} doit venir de SEGMENT_SECONDS, jamais d'un nombre écrit sur place`).toEqual([]);
    }
    expect(codeSeul).toContain('"-hls_time", String(SEGMENT_SECONDS)');
  });

  it("force les images-clés sur chaque chemin qui encode réellement la vidéo", async () => {
    // La copie de flux (`-c:v copy`) est exclue : on ne peut pas déplacer les images-clés d'un flux
    // qu'on ne réencode pas. Ce sont les chemins d'encodage qui doivent tous passer par l'aide.
    const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "playback.ts"), "utf8");
    const appels = [...source.matchAll(/keyframeArgs\(/g)];
    expect(appels.length, "les deux chemins d'encodage — adaptatif et variante unique — l'utilisent")
      .toBeGreaterThanOrEqual(3); // la définition, plus les deux appels
  });
});
