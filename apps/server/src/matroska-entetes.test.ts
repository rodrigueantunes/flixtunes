import { describe, expect, it } from "vitest";

import { pistesApresLesDonnees, type LecteurOctets } from "./matroska-entetes.js";

/**
 * Reconnaître un Matroska qu'un lecteur linéaire ne saura pas ouvrir.
 *
 * Le défaut a coûté cher à diagnostiquer parce qu'il ne ressemble pas à une panne : le serveur, le
 * navigateur et FFprobe lisent le fichier sans broncher — tous savent se déplacer dedans — tandis que
 * Media3 joue une image noire, sans son et sans avance rapide, **sans lever d'erreur**. Rien dans les
 * journaux ne le désigne.
 *
 * Ces cas se construisent en octets plutôt que sur des fichiers : ce qui se vérifie ici est la lecture
 * d'un format, pas la présence d'un film sur un disque.
 */

/** Un élément EBML : identifiant, taille, contenu. */
function element(identifiant: number[], contenu: number[] = [], tailleInconnue = false): number[] {
  if (tailleInconnue) return [...identifiant, 0xff, ...contenu];
  return [...identifiant, 0x80 | contenu.length, ...contenu];
}

const ENTETE_EBML = [0x1a, 0x45, 0xdf, 0xa3];
const SEGMENT = [0x18, 0x53, 0x80, 0x67];
const SEEK_HEAD = [0x11, 0x4d, 0x9b, 0x74];
const INFO = [0x15, 0x49, 0xa9, 0x66];
const TRACKS = [0x16, 0x54, 0xae, 0x6b];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

/** Le fichier vu comme une suite d'octets, lus par petites fenêtres comme sur un vrai disque. */
function fichier(...morceaux: number[][]): LecteurOctets {
  const octets = Uint8Array.from(morceaux.flat());
  return async (position, longueur) => octets.subarray(position, position + longueur);
}

describe("où un Matroska range la définition de ses pistes", () => {
  it("un fichier ordinaire : les pistes précèdent les données", async () => {
    const lecteur = fichier(
      element(ENTETE_EBML, [0x42, 0x82, 0x88]),
      element(SEGMENT, [], true),
      element(SEEK_HEAD, [0, 0, 0, 0]),
      element(INFO, [0, 0]),
      element(TRACKS, [1, 2, 3]),
      element(CLUSTER, [4, 5, 6]),
    );
    expect(await pistesApresLesDonnees(lecteur)).toBe(false);
  });

  it("le fichier fautif : les données arrivent avant toute définition de piste", async () => {
    // C'est la forme des deux séries relevées le 25 août 2026 : leurs pistes tiennent dans les
    // derniers octets du fichier, à plus de quatre cents mégaoctets du début.
    const lecteur = fichier(
      element(ENTETE_EBML, [0x42, 0x82, 0x88]),
      element(SEGMENT, [], true),
      element(SEEK_HEAD, [0, 0, 0, 0]),
      element(INFO, [0, 0]),
      element(CLUSTER, [4, 5, 6]),
      element(TRACKS, [1, 2, 3]),
    );
    expect(await pistesApresLesDonnees(lecteur)).toBe(true);
  });

  it("saute les éléments intermédiaires sans les lire", async () => {
    // Étiquettes, chapitres, pièces jointes : un fichier ordinaire en porte plusieurs avant ses
    // pistes, et il ne faut pas confondre « pas encore vues » avec « rangées à la fin ».
    const remplissage = Array.from({ length: 60 }, (_, index) => index & 0xff);
    const lecteur = fichier(
      element(ENTETE_EBML, [0x42, 0x82, 0x88]),
      element(SEGMENT, [], true),
      element([0xec], remplissage),
      element([0x12, 0x54, 0xc3, 0x67], remplissage),
      element(TRACKS, [1, 2, 3]),
      element(CLUSTER, [4, 5, 6]),
    );
    expect(await pistesApresLesDonnees(lecteur)).toBe(false);
  });

  it("le doute profite au fichier", async () => {
    // Se tromper en disant « tout va bien » ne coûte que le défaut déjà connu, sur les seuls fichiers
    // concernés. Se tromper dans l'autre sens imposerait un remux à toute une bibliothèque saine.
    const cas: Array<[string, LecteurOctets]> = [
      ["fichier vide", fichier([])],
      ["octets qui ne forment pas un identifiant", fichier([0x00, 0x00, 0x00, 0x00])],
      ["taille intermédiaire inconnue", fichier(
        element(ENTETE_EBML, [0x42, 0x82, 0x88]),
        element(SEGMENT, [], true),
        element(INFO, [0, 0], true),
      )],
      ["fichier tronqué avant toute piste", fichier(
        element(ENTETE_EBML, [0x42, 0x82, 0x88]),
        element(SEGMENT, [], true),
      )],
    ];
    for (const [nom, lecteur] of cas) {
      expect(await pistesApresLesDonnees(lecteur), nom).toBe(false);
    }
  });

  it("n'entre pas dans les données pour répondre", async () => {
    // La mesure se fait à chaque demande de lecture : elle doit coûter quelques en-têtes, jamais un
    // parcours du film. Le Cluster est ici volontairement immense.
    let luMaximum = 0;
    const octets = Uint8Array.from([
      ...element(ENTETE_EBML, [0x42, 0x82, 0x88]),
      ...element(SEGMENT, [], true),
      ...element(CLUSTER, [4, 5, 6]),
    ]);
    const lecteur: LecteurOctets = async (position, longueur) => {
      luMaximum = Math.max(luMaximum, position + longueur);
      return octets.subarray(position, position + longueur);
    };
    expect(await pistesApresLesDonnees(lecteur)).toBe(true);
    expect(luMaximum, "quelques dizaines d'octets suffisent").toBeLessThan(64);
  });
});
