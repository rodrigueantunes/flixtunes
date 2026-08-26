import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resumePosition } from "./Player";

/**
 * Déplacement dans un flux transcodé — exigence « excellence de lecture ».
 *
 * Un transcodage démarre à un point donné et encode linéairement. L'instant 0 du flux ne correspond
 * donc pas à l'instant 0 du film, et deux échelles de temps coexistent. Confondre les deux produit
 * des symptômes qui ressemblent tous à « le lecteur est instable » : une barre qui saute, une
 * progression enregistrée au mauvais endroit, une reprise qui repart du début.
 *
 * Ces tests vérifient la règle sur le code livré. Ils ne remplacent pas un essai sur un vrai film,
 * mais ils empêchent les confusions d'échelle de revenir sans qu'on s'en aperçoive.
 */

const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "Player.tsx"), "utf8");

describe("reprise calculée sur la durée réelle", () => {
  it("place la reprise au bon endroit d'un film long", () => {
    // 90 % d'un film de deux heures, moins cinq secondes de contexte.
    expect(resumePosition(7200, 50, 5)).toBeCloseTo(3595, 0);
  });

  it("ne propose pas de reprise quand la lecture était presque terminée", () => {
    expect(resumePosition(7200, 95, 5)).toBe(0);
  });

  it("n'utilise jamais la durée du flux pour calculer une reprise", () => {
    // `video.duration` ne couvre que la portion déjà encodée : s'en servir ramenait la reprise près
    // du début du film. La seule référence valable est la durée réelle du média.
    expect(source).not.toContain("resumePosition(video.duration");
    expect(source).toContain("resumePosition(trueDurationRef.current");
  });
});

describe("séparation des deux échelles de temps", () => {
  it("enregistre la progression en temps de film, jamais en temps de flux", () => {
    expect(source).toContain("api.saveProgress(media.id, profile.id, startOffsetRef.current + video.currentTime");
  });

  it("affiche une position et un tampon ramenés au film", () => {
    expect(source).toContain("setCurrentTime(offset + (video.currentTime || 0))");
    expect(source).toContain("offset + video.buffered.end(video.buffered.length - 1)");
  });

  it("conserve une position de film pour la reprise après incident réseau", () => {
    // Cette position sert à recoller après une coupure : exprimée en temps de flux, elle ferait
    // repartir la lecture ailleurs dès que la session redémarre à un autre point.
    const enregistrements = [...source.matchAll(/reconnectPositionRef\.current = ([^;]+);/g)]
      .map((trouve) => trouve[1]!.trim());
    for (const enregistrement of enregistrements) {
      if (enregistrement === "0") continue;
      expect(enregistrement, "la position conservée doit inclure le décalage de session")
        .toContain("startOffsetRef.current");
    }
  });

  it("redemande une session au serveur quand la cible sort de la portion encodée", () => {
    // C'est le cœur de la correction : sans cela, le lecteur attend indéfiniment que l'encodeur
    // rattrape le point demandé.
    expect(source).toContain("void start(info, modePreferenceRef.current, cible)");
  });

  it("attend l'immobilisation du curseur avant de relancer une session", () => {
    // La barre de progression émet un événement à chaque pixel parcouru : sans cette attente, un seul
    // glissement lancerait des dizaines de transcodages sur le processeur du NAS.
    expect(source).toContain("seekRestartRef.current = window.setTimeout");
    expect(source, "une relance en attente doit être annulée si la cible change")
      .toContain("if (seekRestartRef.current) window.clearTimeout(seekRestartRef.current)");
  });

  it("ne redemande jamais de session en lecture directe", () => {
    // Le fichier entier est déjà à disposition du navigateur : relancer une négociation n'apporterait
    // rien et couperait la lecture pour rien.
    expect(source).toContain('session?.mode === "direct"');
  });
});
