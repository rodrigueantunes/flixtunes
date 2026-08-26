import { describe, expect, it } from "vitest";

import {
  debitAnnonce, debitMemorise, memoriserDebit, plafondApresCoupures, REBUFFERS_AVANT_REPLI,
} from "./debit-reseau";

/**
 * Ce que le lecteur annonce du réseau, et ce qu'il fait quand ça coupe.
 *
 * L'enjeu est mesurable : sans annonce, le serveur suppose une bande passante illimitée et sert le
 * fichier tel quel. Relevé sur une lecture réelle — source 26,5 Mb/s, chemin mesuré 29,4 Mb/s, onze
 * pour cent de marge, et une coupure.
 */
function stockage(): Storage {
  const donnees = new Map<string, string>();
  return {
    getItem: (cle) => donnees.get(cle) ?? null,
    setItem: (cle, valeur) => { donnees.set(cle, valeur); },
    removeItem: (cle) => { donnees.delete(cle); },
    clear: () => donnees.clear(),
    key: (rang) => [...donnees.keys()][rang] ?? null,
    get length() { return donnees.size; },
  } as Storage;
}

describe("débit annoncé au serveur", () => {
  it("préfère la mesure à ce que le navigateur déclare", () => {
    // `downlink` rapporte la vitesse du lien local — cent mégabits sur un Wi-Fi domestique — qui ne dit
    // rien du chemin jusqu'au NAS. La mesure, elle, porte sur ce chemin.
    expect(debitAnnonce(29.4, { downlink: 100, type: "wifi" })).toBe(29.4);
  });

  it("annonce la mesure quel que soit le type de connexion", () => {
    // C'est le défaut d'origine : la valeur n'était transmise qu'en cellulaire, donc jamais en Wi-Fi,
    // en Ethernet, ni au travers d'un VPN — précisément les cas où le chemin est plus lent que le lien.
    for (const type of ["wifi", "ethernet", undefined]) {
      expect(debitAnnonce(18.2, { type })).toBe(18.2);
    }
  });

  it("se rabat sur la déclaration du navigateur en cellulaire, faute de mesure", () => {
    expect(debitAnnonce(null, { downlink: 1.4, type: "cellular" })).toBe(1.4);
    expect(debitAnnonce(null, { downlink: 2, effectiveType: "2g" })).toBe(2);
  });

  it("n'annonce rien plutôt qu'une valeur trompeuse", () => {
    // En Wi-Fi sans mesure, `downlink` ferait croire à un chemin large qui n'existe peut-être pas.
    expect(debitAnnonce(null, { downlink: 100, type: "wifi" })).toBeNull();
    expect(debitAnnonce(null, null)).toBeNull();
    expect(debitAnnonce(0, null)).toBeNull();
  });

  it("arrondit au dixième, la précision au-delà n'ayant aucun sens", () => {
    expect(debitAnnonce(29.437_218, { type: "wifi" })).toBe(29.4);
  });
});

describe("mémoire du débit entre deux lectures", () => {
  it("retient la mesure et la rend au serveur suivant", () => {
    // Sans mémoire, la première négociation d'une séance se fait toujours à l'aveugle — et c'est celle
    // qui décide de remultiplexer ou non.
    const magasin = stockage();
    memoriserDebit("nas-salon", 22.5, magasin);
    expect(debitMemorise("nas-salon", magasin)).toBe(22.5);
  });

  it("garde les serveurs séparés", () => {
    const magasin = stockage();
    memoriserDebit("nas-salon", 22.5, magasin);
    expect(debitMemorise("nas-distant", magasin)).toBeNull();
  });

  it("ignore une mesure absurde plutôt que de la retenir", () => {
    const magasin = stockage();
    memoriserDebit("nas", 0, magasin);
    memoriserDebit("nas", null, magasin);
    // Sous un mégabit, il s'agit d'un blocage et non d'un réseau.
    memoriserDebit("nas", 0.4, magasin);
    expect(debitMemorise("nas", magasin)).toBeNull();
  });

  it("retient la meilleure mesure, pas la dernière", () => {
    // C'est le défaut qui a fait servir une source 4K en 1280×720 : l'estimation de hls.js s'effondre
    // pendant un démarrage difficile, et cette valeur-là devenait la mémoire du serveur. Le maximum
    // décrit ce que le chemin sait faire ; un creux décrit un incident.
    const magasin = stockage();
    memoriserDebit("nas", 28.6, magasin);
    memoriserDebit("nas", 2.1, magasin);
    expect(debitMemorise("nas", magasin)).toBe(28.6);
  });

  it("relève la mémoire quand le réseau se révèle meilleur", () => {
    const magasin = stockage();
    memoriserDebit("nas", 12, magasin);
    memoriserDebit("nas", 31.4, magasin);
    expect(debitMemorise("nas", magasin)).toBe(31.4);
  });
});

describe("repli après coupures", () => {
  it("laisse passer une coupure isolée", () => {
    // Un creux passager, une autre machine qui télécharge : insister est la bonne réponse.
    expect(plafondApresCoupures(29.4, 1)).toBeNull();
  });

  it("impose un plafond dès la deuxième", () => {
    // Deux coupures disent que le débit demandé ne passe pas. Le plafond fait convertir le serveur au
    // lieu de servir le fichier tel quel.
    expect(plafondApresCoupures(29.4, REBUFFERS_AVANT_REPLI)).toBe(20_580_000);
  });

  it("garde trente pour cent de marge sous le chemin mesuré", () => {
    expect(plafondApresCoupures(10, 5)).toBe(7_000_000);
  });

  it("ne descend jamais sous un mégabit", () => {
    // En dessous, l'image ne vaudrait plus la peine d'être servie, et le plafond deviendrait la cause
    // du problème qu'il prétend résoudre.
    expect(plafondApresCoupures(0.5, 5)).toBe(1_000_000);
  });

  it("ne décide rien sans mesure", () => {
    expect(plafondApresCoupures(null, 9)).toBeNull();
  });
});
