import { describe, expect, it } from "vitest";
import type { MediaChapter } from "@flixtunes/contracts";
import { marqueursGenerique } from "./generique.js";

/**
 * Repérer les génériques à partir des chapitres du fichier.
 *
 * Rien n'analyse l'image : ce qui est lu, ce sont les chapitres nommés. La mesure sur la médiathèque
 * de référence dit ce que cela couvre — 1 701 fichiers portent un générique de fin nommé, 1 469 une
 * introduction — et surtout où placer les garde-fous, car les mêmes fichiers portent aussi des
 * chapitres mal étiquetés : un « Credits » de 7 445 secondes, une « Intro » de 2 336.
 */
const chapitre = (index: number, title: string, startSeconds: number, endSeconds: number | null): MediaChapter =>
  ({ index, title, startSeconds, endSeconds });

/** Un épisode ordinaire : introduction de 80 s, générique de fin de 60 s, 1 500 s en tout. */
const episode: MediaChapter[] = [
  chapitre(0, "Intro", 30, 110),
  chapitre(1, "Chapter 1", 110, 1440),
  chapitre(2, "End Credits", 1440, 1500),
];

describe("marqueurs de générique", () => {
  it("lit les deux bornes d'un épisode ordinaire", () => {
    const marqueurs = marqueursGenerique(episode, 1500);
    expect(marqueurs.creditsStartSeconds).toBe(1440);
    expect(marqueurs.intro).toEqual({ startSeconds: 30, endSeconds: 110 });
  });

  it("reconnaît les intitulés des deux langues", () => {
    for (const titre of ["Credits", "End Credits", "Closing Credits", "Outro", "Générique de fin", "generique fin"]) {
      expect(marqueursGenerique([chapitre(0, titre, 1440, 1500)], 1500).creditsStartSeconds, titre).toBe(1440);
    }
    for (const titre of ["Intro", "Introduction", "Opening", "Opening Credits", "OP", "Main Titles", "Générique de début"]) {
      expect(marqueursGenerique([chapitre(0, titre, 30, 110)], 1500).intro, titre).not.toBeNull();
    }
  });

  it("« Générique » seul se tranche par sa position", () => {
    // Le mot désigne les deux en français, et la médiathèque en porte des deux sortes sous ce seul
    // intitulé. Dans le dernier cinquième c'est la fin, dans la première moitié c'est le début.
    expect(marqueursGenerique([chapitre(0, "Générique", 1440, 1500)], 1500).creditsStartSeconds).toBe(1440);
    expect(marqueursGenerique([chapitre(0, "Générique", 30, 110)], 1500).intro)
      .toEqual({ startSeconds: 30, endSeconds: 110 });
  });

  it("un chapitre mal étiqueté ne fait rien croire", () => {
    // Relevés dans la médiathèque : un « Credits » couvrant deux heures, une « Intro » couvrant tout
    // le film. Mieux vaut ne rien proposer que proposer à tort.
    expect(marqueursGenerique([chapitre(0, "Credits", 5, 7500)], 7500).creditsStartSeconds).toBeNull();
    expect(marqueursGenerique([chapitre(0, "Intro", 0, 2336)], 2400).intro).toBeNull();
  });

  it("un générique de fin annoncé trop tôt est ignoré", () => {
    // À mi-film, ce n'en est pas un. Le seuil est le dernier cinquième.
    expect(marqueursGenerique([chapitre(0, "End Credits", 700, 760)], 1500).creditsStartSeconds).toBeNull();
  });

  it("un générique trop court n'est pas annoncé", () => {
    // La carte apparaîtrait à peine avant la fin : autant garder le comportement d'avant.
    expect(marqueursGenerique([chapitre(0, "Credits", 1495, 1500)], 1500).creditsStartSeconds).toBeNull();
    expect(marqueursGenerique([chapitre(0, "Intro", 30, 35)], 1500).intro).toBeNull();
  });

  it("ne conclut rien sans chapitres ni durée", () => {
    const cas: Array<[MediaChapter[] | undefined, number | null]> = [[undefined, 1500], [[], 1500], [episode, null], [episode, 0]];
    for (const [chapitres, duree] of cas) {
      const marqueurs = marqueursGenerique(chapitres, duree);
      expect(marqueurs.creditsStartSeconds).toBeNull();
      expect(marqueurs.intro).toBeNull();
    }
  });

  it("tolère un intitulé numéroté et les conventions de l'animation", () => {
    // La médiathèque porte 45 chapitres « 8. End Credits », que le point d'ancrage rejetait, et
    // « Ending » y est courant. Deux motifs élargis, cent soixante épisodes de plus.
    for (const titre of ["8. End Credits", "12) Credits", "Ending", "Closing"]) {
      expect(marqueursGenerique([chapitre(0, titre, 1440, 1500)], 1500).creditsStartSeconds, titre).toBe(1440);
    }
    expect(marqueursGenerique([chapitre(0, "01. Opening", 30, 110)], 1500).intro).not.toBeNull();
  });

  describe("le dernier chapitre, quand rien n'est nommé", () => {
    // La plupart des épisodes numérotent leurs chapitres sans les nommer. Un dernier chapitre qui
    // s'ouvre après 88 % du film et dure entre 20 s et 150 s n'est pratiquement jamais une scène :
    // mesurés sur 1 994 épisodes, ces segments durent 42 s en médiane — le profil d'un générique.
    const numerotes = (dernierDebut: number, duree = 1500): MediaChapter[] => [
      chapitre(0, "Chapter 1", 0, 500),
      chapitre(1, "Chapter 2", 500, dernierDebut),
      chapitre(2, "Chapter 3", dernierDebut, duree),
    ];

    it("se déduit de sa seule place", () => {
      expect(marqueursGenerique(numerotes(1450), 1500).creditsStartSeconds).toBe(1450);
    });

    it("la fenêtre est plus étroite que pour un chapitre nommé", () => {
      // Un nom est une affirmation, une position n'est qu'un indice : la déduction s'interdit ce que
      // l'intitulé s'autorise.
      expect(marqueursGenerique(numerotes(1300), 1500).creditsStartSeconds, "trop tôt").toBeNull();
      expect(marqueursGenerique(numerotes(1490), 1500).creditsStartSeconds, "trop court").toBeNull();
      expect(marqueursGenerique(numerotes(1330), 1500).creditsStartSeconds, "trop long").toBeNull();
    });

    it("un fichier coupé en deux n'est pas un fichier chapitré", () => {
      expect(marqueursGenerique([chapitre(0, "Part 1", 0, 1450), chapitre(1, "Part 2", 1450, 1500)], 1500)
        .creditsStartSeconds).toBeNull();
    });

    it("un chapitre nommé l'emporte toujours sur la déduction", () => {
      const melange = [chapitre(0, "Chapter 1", 0, 1380), chapitre(1, "Credits", 1380, 1460),
        chapitre(2, "Preview", 1460, 1500)];
      expect(marqueursGenerique(melange, 1500).creditsStartSeconds).toBe(1380);
    });
  });

  it("ignore les chapitres ordinaires du milieu du film", () => {
    const ordinaires = [chapitre(0, "Chapter 1", 0, 500), chapitre(1, "Part 02", 500, 1500)];
    const marqueurs = marqueursGenerique(ordinaires, 1500);
    expect(marqueurs.creditsStartSeconds).toBeNull();
    expect(marqueurs.intro).toBeNull();
  });
});
