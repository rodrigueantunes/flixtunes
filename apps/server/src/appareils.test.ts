import { beforeEach, describe, expect, it } from "vitest";

import {
  annoncerAppareil, appareilsActifs, DELAI_PRESENCE_MS, envoyerCommande, oublierAppareils, retirerCommandes,
} from "./appareils.js";

/**
 * Le registre des appareils pilotables.
 *
 * Ce qui compte ici n'est pas d'acheminer un ordre — c'est de ne jamais laisser croire qu'un ordre est
 * parti quand il ne l'est pas. Le défaut le plus déroutant d'une télécommande est d'appuyer sans rien
 * voir se produire, sans savoir si l'appareil a reçu, refusé, ou n'était plus là.
 */
const televiseur = { id: "salon", nom: "Téléviseur du salon", type: "tv" as const, mediaEnCours: null };

beforeEach(() => oublierAppareils());

describe("présence des appareils", () => {
  it("annonce puis renouvelle sans créer de doublon", () => {
    annoncerAppareil(televiseur, 1_000);
    annoncerAppareil({ ...televiseur, mediaEnCours: "film-1" }, 2_000);
    const actifs = appareilsActifs(2_000);
    expect(actifs).toHaveLength(1);
    expect(actifs[0]?.mediaEnCours).toBe("film-1");
    expect(actifs[0]?.vuA).toBe(2_000);
  });

  it("oublie un appareil silencieux", () => {
    // Une liste qui garde les absents propose des cibles vers lesquelles rien ne part.
    annoncerAppareil(televiseur, 1_000);
    expect(appareilsActifs(1_000 + DELAI_PRESENCE_MS)).toHaveLength(1);
    expect(appareilsActifs(1_001 + DELAI_PRESENCE_MS)).toHaveLength(0);
  });

  it("présente le plus récemment vu en tête", () => {
    annoncerAppareil(televiseur, 1_000);
    annoncerAppareil({ id: "chambre", nom: "Chambre", type: "tv", mediaEnCours: null }, 2_000);
    expect(appareilsActifs(2_000).map((appareil) => appareil.id)).toEqual(["chambre", "salon"]);
  });
});

describe("ordres adressés à une cible", () => {
  it("achemine un ordre et ne le rend qu'une fois", () => {
    annoncerAppareil(televiseur, 1_000);
    expect(envoyerCommande("salon", { type: "lire", mediaId: "film-1" }, 1_000)).toBe(true);
    expect(retirerCommandes("salon", 1_000)).toEqual([{ type: "lire", mediaId: "film-1" }]);
    expect(retirerCommandes("salon", 1_000)).toEqual([]);
  });

  it("refuse un ordre pour une cible inconnue ou partie", () => {
    // C'est ce refus qui permet de le dire à la personne, au lieu de la laisser appuyer dans le vide.
    expect(envoyerCommande("absent", { type: "pause" })).toBe(false);
    annoncerAppareil(televiseur, 1_000);
    expect(envoyerCommande("salon", { type: "pause" }, 1_001 + DELAI_PRESENCE_MS)).toBe(false);
  });

  it("le retrait vaut signe de vie", () => {
    // Une cible qui vient chercher ses ordres est vivante par définition ; exiger un appel séparé
    // doublerait le trafic sans rien apprendre de plus.
    annoncerAppareil(televiseur, 1_000);
    retirerCommandes("salon", 1_000 + DELAI_PRESENCE_MS);
    expect(appareilsActifs(1_000 + DELAI_PRESENCE_MS)).toHaveLength(1);
  });

  it("un appareil parti emporte ses ordres en attente", () => {
    // Sans cela, un téléviseur rallumé une heure plus tard exécuterait un ordre donné pour une autre
    // soirée — le comportement le plus déconcertant qu'une télécommande puisse avoir.
    annoncerAppareil(televiseur, 1_000);
    envoyerCommande("salon", { type: "lire", mediaId: "film-1" }, 1_000);
    appareilsActifs(1_001 + DELAI_PRESENCE_MS);
    annoncerAppareil(televiseur, 9_000_000);
    expect(retirerCommandes("salon", 9_000_000)).toEqual([]);
  });

  it("cesse d'empiler devant une cible qui ne retire plus rien", () => {
    annoncerAppareil(televiseur, 1_000);
    for (let rang = 0; rang < 30; rang += 1) {
      envoyerCommande("salon", { type: "naviguer", positionSecondes: rang }, 1_000);
    }
    const ordres = retirerCommandes("salon", 1_000);
    expect(ordres).toHaveLength(20);
    // Le plus ancien cède la place au plus récent : c'est le dernier geste qui compte.
    expect(ordres.at(-1)).toEqual({ type: "naviguer", positionSecondes: 29 });
  });

  it("conserve l'ordre des gestes", () => {
    annoncerAppareil(televiseur, 1_000);
    envoyerCommande("salon", { type: "lire", mediaId: "film-1" }, 1_000);
    envoyerCommande("salon", { type: "pause" }, 1_000);
    envoyerCommande("salon", { type: "naviguer", positionSecondes: 120 }, 1_000);
    expect(retirerCommandes("salon", 1_000).map((ordre) => ordre.type)).toEqual(["lire", "pause", "naviguer"]);
  });
});
