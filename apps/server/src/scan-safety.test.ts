import { describe, expect, it } from "vitest";
import {
  assessDisappearance, isStableFile, needsStabilityCheck,
  MASS_DISAPPEARANCE_RATIO, SMALL_LIBRARY_THRESHOLD,
} from "./scan-safety.js";

describe("garde-fou de disparition", () => {
  it("laisse passer une analyse qui ne perd rien", () => {
    expect(assessDisappearance(500, 0, 500).code).toBe("ok");
  });

  it("refuse d'effacer un catalogue quand la racine ne rend aucun fichier", () => {
    // Partage démonté, disque en veille, permissions perdues : la marche ne voit rien et l'analyse
    // s'apprêtait à marquer indisponible l'intégralité de la bibliothèque.
    const verdict = assessDisappearance(2000, 2000, 0);
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("empty-root");
    expect(verdict.reason).toContain("2000");
  });

  it("refuse une disparition massive même si quelques fichiers subsistent", () => {
    const verdict = assessDisappearance(1000, 900, 100);
    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe("mass-disappearance");
    expect(verdict.reason).toContain("90 %");
  });

  it("accepte une disparition partielle ordinaire", () => {
    expect(assessDisappearance(1000, 120, 880).accepted).toBe(true);
  });

  it("ne se mêle pas des petites bibliothèques, racine vide comprise", () => {
    // Supprimer l'unique film d'un dossier est un geste courant et sans ambiguïté. Le refuser
    // laisserait la fiche affichée comme disponible jusqu'à confirmation, ce qui serait absurde.
    // Marquer indisponible n'efface rien : une analyse ultérieure rétablit la disponibilité dès que
    // les fichiers réapparaissent. Le préjudice d'une erreur suit donc le volume, et c'est lui qui
    // décide de la prudence à appliquer.
    expect(assessDisappearance(1, 1, 0).accepted).toBe(true);
    expect(assessDisappearance(3, 3, 1).accepted).toBe(true);
    expect(assessDisappearance(SMALL_LIBRARY_THRESHOLD - 1, SMALL_LIBRARY_THRESHOLD - 1, 0).accepted).toBe(true);
    // À partir du seuil, une racine muette est refusée.
    expect(assessDisappearance(SMALL_LIBRARY_THRESHOLD, SMALL_LIBRARY_THRESHOLD, 0).code).toBe("empty-root");
  });

  it("respecte une confirmation explicite", () => {
    expect(assessDisappearance(2000, 2000, 0, true).accepted).toBe(true);
    expect(assessDisappearance(1000, 900, 100, true).accepted).toBe(true);
  });

  it("place la bascule exactement au seuil annoncé", () => {
    const total = 1000;
    const atThreshold = Math.floor(total * MASS_DISAPPEARANCE_RATIO);
    expect(assessDisappearance(total, atThreshold, 500).accepted).toBe(true);
    expect(assessDisappearance(total, atThreshold + 1, 500).accepted).toBe(false);
  });
});

describe("stabilité d'un fichier en cours d'écriture", () => {
  it("reconnaît un fichier au repos", () => {
    expect(isStableFile({ size: 1024, modifiedMs: 1000 }, { size: 1024, modifiedMs: 1000 })).toBe(true);
  });

  it("reconnaît une copie en cours à sa taille qui grandit", () => {
    expect(isStableFile({ size: 1024, modifiedMs: 1000 }, { size: 4096, modifiedMs: 1200 })).toBe(false);
  });

  it("reconnaît une réécriture sur place à sa date qui change", () => {
    // Une taille identique ne suffit pas : un fichier réécrit peut retrouver la même taille.
    expect(isStableFile({ size: 1024, modifiedMs: 1000 }, { size: 1024, modifiedMs: 5000 })).toBe(false);
  });

  it("ignore les fractions de milliseconde", () => {
    // Les systèmes de fichiers ne rendent pas tous la même précision ; comparer les flottants bruts
    // ferait passer pour instable un fichier parfaitement immobile.
    expect(isStableFile({ size: 10, modifiedMs: 1000.4 }, { size: 10, modifiedMs: 1000.9 })).toBe(true);
  });
});

describe("choix des fichiers à observer", () => {
  const now = 1_000_000;

  it("observe un fichier écrit à l'instant", () => {
    expect(needsStabilityCheck(now - 1_000, now)).toBe(true);
  });

  it("n'observe pas un fichier au repos depuis longtemps", () => {
    // Le second relevé doublerait le coût de l'analyse sur des dizaines de milliers de fichiers.
    expect(needsStabilityCheck(now - 3_600_000, now)).toBe(false);
  });

  it("observe un fichier daté du futur", () => {
    // Horloge de NAS déréglée : la date ne permet plus de conclure, on observe par prudence.
    expect(needsStabilityCheck(now + 500_000, now)).toBe(true);
  });

  it("place la bascule sur la fenêtre demandée", () => {
    expect(needsStabilityCheck(now - 59_999, now, 60_000)).toBe(true);
    expect(needsStabilityCheck(now - 60_000, now, 60_000)).toBe(false);
  });
});
