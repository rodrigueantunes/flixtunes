import { describe, expect, it } from "vitest";
import { analyserWebVtt, lireHorodatage, repliquesA } from "./sous-titres-bureau";

/**
 * Ce que le serveur produit vraiment, pris tel quel.
 *
 * `cuesToWebVtt` écrit un en-tête, une ligne blanche, puis des blocs « début --> fin » suivis de leur
 * texte. Éprouver une invention plutôt que cette forme-là ferait passer les tests sur un fichier que
 * personne ne sert.
 */
const DU_SERVEUR = `WEBVTT

00:00:12.500 --> 00:00:15.000
Tu as vu ça ?

00:00:15.200 --> 00:00:18.750
Non, j'étais occupé.
Raconte.

00:01:02.000 --> 00:01:04.100
<i>Au loin, une sirène.</i>
`;

describe("les sous-titres du client de bureau", () => {
  it("lit le WebVTT du serveur, répliques et retours à la ligne compris", () => {
    const repliques = analyserWebVtt(DU_SERVEUR);
    expect(repliques).toHaveLength(3);
    expect(repliques[0]).toEqual({ debut: 12.5, fin: 15, texte: "Tu as vu ça ?" });
    // Une réplique sur deux lignes reste sur deux lignes : c'est de la mise en scène, pas du hasard.
    expect(repliques[1]?.texte).toBe("Non, j'étais occupé.\nRaconte.");
  });

  it("retire les balises plutôt que de les insérer dans la page", () => {
    // Insérer telles quelles les balises d'un fichier de sous-titres reviendrait à lui faire
    // confiance pour écrire du HTML dans le lecteur. L'italique se perd ; c'est le prix, et il est
    // moindre que l'inverse.
    expect(analyserWebVtt(DU_SERVEUR)[2]?.texte).toBe("Au loin, une sirène.");
  });

  it("accepte les deux formes d'horodatage de WebVTT", () => {
    expect(lireHorodatage("01:23:45.678")).toBeCloseTo(5025.678, 3);
    expect(lireHorodatage("23:45.678")).toBeCloseTo(1425.678, 3);
    // La virgule est la forme SRT ; elle survit parfois à une conversion.
    expect(lireHorodatage("00:00:01,500")).toBeCloseTo(1.5, 3);
    expect(lireHorodatage("pas une heure")).toBeNull();
  });

  it("supporte un identifiant de réplique et des réglages de placement", () => {
    // Rien de ce que le serveur produit, mais tout ce qu'on peut rencontrer dans la nature. Un bloc
    // mal formé ne doit pas faire perdre le fichier entier.
    const repliques = analyserWebVtt(`WEBVTT

12
00:00:01.000 --> 00:00:02.000 line:90% align:center
Bonjour

NOTE ceci est un commentaire

00:00:03.000 --> 00:00:04.000
Au revoir
`);
    expect(repliques.map((replique) => replique.texte)).toEqual(["Bonjour", "Au revoir"]);
  });

  it("écarte une réplique dont la fin précède le début", () => {
    expect(analyserWebVtt("WEBVTT\n\n00:00:05.000 --> 00:00:02.000\nImpossible\n")).toHaveLength(0);
  });

  it("rend ce qui doit être à l'écran, et rien avant ni après", () => {
    const repliques = analyserWebVtt(DU_SERVEUR);
    expect(repliquesA(repliques, 12.4)).toEqual([]);
    expect(repliquesA(repliques, 12.5)).toEqual(["Tu as vu ça ?"]);
    expect(repliquesA(repliques, 14.9)).toEqual(["Tu as vu ça ?"]);
    // La borne de fin est exclue : sans cela, deux répliques qui se suivent à la milliseconde près
    // s'afficheraient un instant ensemble.
    expect(repliquesA(repliques, 15)).toEqual([]);
    expect(repliquesA(repliques, 16)).toEqual(["Non, j'étais occupé.\nRaconte."]);
  });

  it("empile les répliques qui se chevauchent, comme le fait le navigateur", () => {
    const repliques = analyserWebVtt(`WEBVTT

00:00:01.000 --> 00:00:05.000
— Tu viens ?

00:00:02.000 --> 00:00:04.000
[au loin] Attends-moi
`);
    expect(repliquesA(repliques, 3)).toEqual(["— Tu viens ?", "[au loin] Attends-moi"]);
  });

  it("ne rend rien sur une position que le lecteur ne connaît pas encore", () => {
    // Avant la première image, la position vaut NaN dans certains chemins : mieux vaut rien qu'une
    // réplique choisie au hasard.
    expect(repliquesA(analyserWebVtt(DU_SERVEUR), Number.NaN)).toEqual([]);
  });

  it("ne perd pas un fichier vide ou sans horodatage", () => {
    expect(analyserWebVtt("")).toEqual([]);
    expect(analyserWebVtt("WEBVTT\n")).toEqual([]);
    expect(analyserWebVtt("<html>404</html>")).toEqual([]);
  });
});
