import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

/**
 * Le protocole annoncé par une session doit être celui qu'elle produit.
 *
 * Le DASH n'est écrit que par l'échelle adaptative ; le chemin ordinaire écrit du HLS. La session
 * gardait pourtant le protocole **réclamé** par le client, et le serveur attendait alors un
 * `manifest.mpd` que rien ne créait : la session restait en préparation, le client l'interrogeait
 * trente secondes puis abandonnait sur un délai dépassé.
 *
 * Seul Android demande du DASH — le navigateur prend du HLS et ne rencontrait jamais le cas. Et un
 * remux n'étant jamais éligible à l'adaptative, le blocage était garanti sur mobile.
 *
 * Ces cas lisent la source plutôt que d'exécuter FFmpeg : le défaut tenait à deux lignes distantes
 * l'une de l'autre, et c'est leur cohérence qu'il faut retenir, pas un comportement d'exécution.
 */
const source = readFileSync(new URL("./playback.ts", import.meta.url), "utf8");

/**
 * Le corps d'une fonction, borné par son accolade fermante de premier niveau.
 *
 * Chercher la déclaration suivante ne suffit pas : le corps s'étendait alors jusqu'à des fonctions
 * situées bien plus loin, et l'assertion portait sur du code sans rapport.
 */
function corpsDe(nom: string): string {
  const debut = source.indexOf(`async function ${nom}(`);
  expect(debut, `fonction ${nom} introuvable`).toBeGreaterThan(-1);
  const fin = source.indexOf("\n}\n", debut);
  expect(fin, `fin de ${nom} introuvable`).toBeGreaterThan(debut);
  return source.slice(debut, fin);
}

describe("protocole annoncé par une session", () => {
  it("le chemin ordinaire écrit du HLS et l'annonce", () => {
    const corps = corpsDe("startFfmpegSession");
    expect(corps, "ce chemin écrit manifest.m3u8").toContain("manifest.m3u8");
    expect(corps, "et doit le déclarer, sinon le serveur attend un manifeste que rien ne crée")
      .toContain('session.protocol = "hls"');
  });

  it("le chemin ordinaire ne prétend jamais produire du DASH", () => {
    const corps = corpsDe("startFfmpegSession");
    expect(corps).not.toContain('session.protocol = "dash"');
    // L'assertion porte sur l'appel au multiplexeur, pas sur le nom du fichier : celui-ci apparaît
    // légitimement dans le commentaire qui explique le défaut, et le test échouait sur sa propre prose.
    expect(corps, "aucun multiplexeur DASH n'est invoqué ici").not.toContain('"-f", "dash"');
  });

  it("le chemin adaptatif, lui, choisit selon ce qu'il écrit vraiment", () => {
    // Là, les deux existent : le protocole est posé dans la branche qui produit le manifeste
    // correspondant, ce qui est exactement la cohérence qui manquait ailleurs.
    const corps = corpsDe("startAdaptiveFfmpegSession");
    expect(corps).toContain("manifest.mpd");
    expect(corps).toContain('session.protocol = "dash"');
    expect(corps).toContain('session.protocol = "hls"');
  });

  it("la préparation guette le manifeste correspondant au protocole annoncé", () => {
    // C'est cette lecture qui transformait l'incohérence en attente sans fin.
    expect(source).toContain('session.protocol === "dash" ? "manifest.mpd" : "manifest.m3u8"');
  });
});
