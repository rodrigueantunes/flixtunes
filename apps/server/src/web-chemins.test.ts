import { describe, expect, it } from "vitest";
import { lireCheminWeb, reconnaitPlateforme } from "./web-chemins.js";

/**
 * La lecture d'une arborescence web.
 *
 * Ces cas fixent surtout deux choses : que le rangement est lu **par position** et non déduit, et que
 * ce module ne reproduit aucune des règles du parseur des films — dont plusieurs seraient nuisibles
 * appliquées à un titre de vidéo.
 */
const RACINE = "N:/Medias/Web";

describe("lecture d'un chemin de bibliothèque web", () => {
  it("lit la plateforme, la chaîne et le titre", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Le monde en cartes.mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.plateforme).toBe("youtube");
    expect(lu.chemin.chaine).toBe("Arte");
    expect(lu.chemin.titre).toBe("Le monde en cartes");
    expect(lu.chemin.dossiers).toEqual([]);
    expect(lu.chemin.palier).toBeNull();
  });

  it("conserve tous les dossiers traversés, à n'importe quelle profondeur", () => {
    // « Garder les dossiers dans le visuel » : l'écran doit pouvoir rendre l'arborescence telle
    // qu'elle est sur le disque. Le stockage n'en retiendra qu'un palier, mais ce module ne tranche
    // pas cette question — il rapporte ce qu'il voit.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Documentaires/2024/Asie/Episode 1.mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.dossiers).toEqual(["Documentaires", "2024", "Asie"]);
    expect(lu.chemin.palier).toBe("Documentaires");
  });

  it("la chaîne est identifiée par son dossier, pas par son nom", () => {
    // Deux chaînes homonymes sur deux plateformes sont deux chaînes. Le chemin les sépare sans qu'on
    // ait à inventer de règle : c'est la même clé que `source_folder` pour une série.
    const chezYoutube = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Konbini/a.mp4");
    const chezDailymotion = lireCheminWeb(RACINE, "N:/Medias/Web/Dailymotion/Konbini/a.mp4");
    expect(chezYoutube.valide && chezDailymotion.valide).toBe(true);
    if (!chezYoutube.valide || !chezDailymotion.valide) return;
    expect(chezYoutube.chemin.chaineDossier).not.toBe(chezDailymotion.chemin.chaineDossier);
    expect(chezYoutube.chemin.chaineDossier).toBe("N:/Medias/Web/YouTube/Konbini");
  });

  it("accepte les séparateurs Windows comme ceux du NAS", () => {
    const windows = lireCheminWeb("N:\\Medias\\Web", "N:\\Medias\\Web\\YouTube\\Arte\\a.mp4");
    const nas = lireCheminWeb("/volume1/Web", "/volume1/Web/YouTube/Arte/a.mp4");
    expect(windows.valide).toBe(true);
    expect(nas.valide).toBe(true);
    if (!windows.valide) return;
    // La clé de chaîne est normalisée : un même dossier ne doit pas produire deux identités selon la
    // machine qui l'a parcouru.
    expect(windows.chemin.chaineDossier).toBe("N:/Medias/Web/YouTube/Arte");
  });

  it("ignore la casse de la racine", () => {
    const lu = lireCheminWeb("N:/Medias/Web", "n:/medias/WEB/YouTube/Arte/a.mp4");
    expect(lu.valide).toBe(true);
  });
});

describe("refus de rangement", () => {
  it("refuse un fichier hors de la bibliothèque", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Films/Arrival.mkv");
    expect(lu).toEqual({ valide: false, raison: "hors-bibliotheque" });
  });

  it("refuse un fichier posé à la racine", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/orpheline.mp4");
    expect(lu).toEqual({ valide: false, raison: "sans-plateforme" });
  });

  it("refuse un fichier posé dans une plateforme, sans chaîne", () => {
    // Deviner la chaîne reviendrait à inventer une provenance — exactement ce que cette arborescence
    // sert à éviter. Le défaut est donc nommé, pour être corrigeable.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/perdue.mp4");
    expect(lu).toEqual({ valide: false, raison: "sans-chaine" });
  });
});

describe("reconnaissance de la plateforme", () => {
  it("reconnaît les orthographes courantes", () => {
    expect(reconnaitPlateforme("YouTube")).toBe("youtube");
    expect(reconnaitPlateforme("youtube")).toBe("youtube");
    expect(reconnaitPlateforme("You Tube")).toBe("youtube");
    expect(reconnaitPlateforme("Daily Motion")).toBe("dailymotion");
  });

  it("une plateforme inconnue n'invalide rien", () => {
    // Ne pas reconnaître une plateforme empêche d'interroger son API, rien de plus : les métadonnées
    // locales suffisent à peupler la fiche. Le rangement reste donc valide.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/UnTube/Chaine/a.mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.plateforme).toBeNull();
    expect(lu.chemin.plateformeLibelle).toBe("UnTube");
  });
});

describe("identifiant de vidéo", () => {
  it("lit l'identifiant que les téléchargeurs écrivent entre crochets", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Le monde en cartes [dQw4w9WgXcQ].mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBe("dQw4w9WgXcQ");
    // Et il disparaît du titre : c'est une clé, pas un mot.
    expect(lu.chemin.titre).toBe("Le monde en cartes");
  });

  it("refuse un groupe qui n'a pas la longueur d'un identifiant YouTube", () => {
    // Onze caractères, toujours. Prendre autre chose pour un identifiant attribuerait la vidéo à une
    // autre avec l'assurance d'une correspondance exacte — l'erreur que rien ne viendrait relire.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Sujet [court].mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBeNull();
  });

  it("refuse le bruit technique, et le retire du titre", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Reportage [1080p].mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBeNull();
    expect(lu.chemin.titre).toBe("Reportage");
  });

  it("garde un groupe qui est du texte", () => {
    // « (partie 2) » n'est ni un identifiant ni du bruit : c'est le titre. On n'y touche pas.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Arte/Enquete (partie 2).mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBeNull();
    expect(lu.chemin.titre).toBe("Enquete (partie 2)");
  });

  it("accepte une forme plausible sur une plateforme sans règle connue", () => {
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/Dailymotion/Konbini/Sujet [x8kf2p9].mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBe("x8kf2p9");
  });
});

describe("le titre n'est pas nettoyé comme un nom de film", () => {
  it("ne coupe pas un titre au premier mot technique", () => {
    // `cleanTitle` applique `/\b(…|hdr|…)\b.*$/` : il supprime du mot jusqu'à la fin. Appliqué ici, il
    // réduirait ce titre à « Comparatif ». C'est la raison d'être de ce module.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Chaine/Comparatif HDR10 contre Dolby Vision.mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.titre).toBe("Comparatif HDR10 contre Dolby Vision");
  });

  it("ne prend pas les points pour des séparateurs", () => {
    // Dans un nom de release ils le sont ; dans un titre de vidéo ils appartiennent au texte.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Chaine/Debuter avec Node.js en 2024.mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.titre).toBe("Debuter avec Node.js en 2024");
  });

  it("garde une annee entre parentheses, qui fait partie du titre", () => {
    // La convention `Titre (2024)` appartient aux films, ou la parenthese porte l'annee de sortie. Un
    // nom de fichier web ne transporte que le titre : l'annee vient de la recherche des metadonnees.
    // L'amputer inventerait une convention que personne n'a suivie.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Chaine/Retrospective (2024).mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.titre).toBe("Retrospective (2024)");
    expect(lu.chemin.identifiant).toBeNull();
  });

  it("un groupe numerique ne passe jamais pour un identifiant", () => {
    // Sur une plateforme sans regle de longueur connue, « 2024 » aurait la forme d'un identifiant
    // plausible — et aurait attribue la video a une autre.
    const lu = lireCheminWeb(RACINE, "N:/Medias/Web/Dailymotion/Chaine/Bilan (2024).mp4");
    expect(lu.valide).toBe(true);
    if (!lu.valide) return;
    expect(lu.chemin.identifiant).toBeNull();
    expect(lu.chemin.titre).toBe("Bilan (2024)");
  });

  it("remplace les tirets bas seulement quand ils tiennent lieu d'espaces", () => {
    const separateurs = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Chaine/Un_titre_sans_espaces.mp4");
    const texte = lireCheminWeb(RACINE, "N:/Medias/Web/YouTube/Chaine/Le fichier _final_ du projet.mp4");
    expect(separateurs.valide && texte.valide).toBe(true);
    if (!separateurs.valide || !texte.valide) return;
    expect(separateurs.chemin.titre).toBe("Un titre sans espaces");
    expect(texte.chemin.titre).toBe("Le fichier _final_ du projet");
  });
});
