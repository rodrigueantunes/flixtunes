import { describe, expect, it } from "vitest";
import {
  cheminsAnnexe, decoderEntitesHtml, fusionnerIdentites, identifiantDepuisUrl, lireAnnexeWeb,
  lireBalisesWeb, normaliseDate, plateformeDepuisUrl, type IdentiteWeb,
} from "./web-identite.js";

/**
 * Ce qu'un fichier web dit de lui-même.
 *
 * L'enjeu de ces cas est moins la lecture que la **prudence** : ce module alimente un appariement, et
 * un renseignement inventé y vaut moins que rien. D'où les cas de refus — annexe corrompue, année
 * seule, commentaire qui n'est pas une adresse — au moins aussi nombreux que les cas nominaux.
 */
const ANNEXE = JSON.stringify({
  id: "dQw4w9WgXcQ",
  title: "Le monde en cartes",
  description: "Une chronique hebdomadaire.",
  channel: "Arte",
  uploader: "arte-officiel",
  upload_date: "20240115",
  duration: 612.4,
  thumbnail: "https://i.example/hq.jpg",
  webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  extractor_key: "Youtube",
  playlist_title: "Chroniques",
});

describe("annexe deposee par un telechargeur", () => {
  it("lit tout ce que la plateforme a rendu", () => {
    const lu = lireAnnexeWeb(ANNEXE);
    expect(lu).not.toBeNull();
    expect(lu?.titre).toBe("Le monde en cartes");
    expect(lu?.chaine).toBe("Arte");
    expect(lu?.plateforme).toBe("youtube");
    expect(lu?.identifiant).toBe("dQw4w9WgXcQ");
    expect(lu?.publieeLe).toBe("2024-01-15");
    expect(lu?.annee).toBe(2024);
    expect(lu?.dureeSecondes).toBeCloseTo(612.4);
    expect(lu?.playlist).toBe("Chroniques");
  });

  it("prefere le nom de chaine au nom de compte", () => {
    // `channel` est le nom affiché, `uploader` l'identifiant technique. C'est le premier qu'on lit.
    expect(lireAnnexeWeb(ANNEXE)?.chaine).toBe("Arte");
  });

  it("une annexe corrompue n'apporte rien et n'interrompt rien", () => {
    // Une médiathèque entière ne doit pas s'arrêter sur un fichier annexe tronqué.
    expect(lireAnnexeWeb("{ ceci n'est pas du JSON")).toBeNull();
    expect(lireAnnexeWeb("[]")).toBeNull();
    expect(lireAnnexeWeb("42")).toBeNull();
  });

  it("deduit la plateforme de l'extracteur quand l'adresse manque", () => {
    const lu = lireAnnexeWeb(JSON.stringify({ id: "x8kf2p9", title: "Sujet", extractor: "dailymotion" }));
    expect(lu?.plateforme).toBe("dailymotion");
    expect(lu?.url).toBeNull();
  });

  it("retient la plus grande vignette quand aucune n'est designee", () => {
    // La liste est ordonnee du plus petit au plus grand : la derniere entree est la meilleure.
    const lu = lireAnnexeWeb(JSON.stringify({
      title: "Sujet",
      thumbnails: [{ url: "https://i.example/petite.jpg" }, { url: "https://i.example/grande.jpg" }],
    }));
    expect(lu?.vignette).toBe("https://i.example/grande.jpg");
  });
});

describe("balises du conteneur", () => {
  it("rattache le fichier a sa plateforme par l'adresse d'origine", () => {
    // `purl` est la balise que FFmpeg emploie pour l'adresse. Le sondage a deja eu lieu de toute
    // facon : ces renseignements ne coutent aucune relecture.
    const lu = lireBalisesWeb({
      format: {
        duration: "612.400000",
        tags: { title: "Le monde en cartes", ARTIST: "Arte", DATE: "20240115",
          PURL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      },
    });
    expect(lu.titre).toBe("Le monde en cartes");
    expect(lu.chaine).toBe("Arte");
    expect(lu.plateforme).toBe("youtube");
    expect(lu.identifiant).toBe("dQw4w9WgXcQ");
    expect(lu.publieeLe).toBe("2024-01-15");
    expect(lu.dureeSecondes).toBeCloseTo(612.4);
  });

  it("ne prend pas un commentaire libre pour une adresse", () => {
    // Plusieurs encodeurs rangent l'adresse dans `comment`, mais il contient aussi bien du texte.
    // Retenir « Merci de votre soutien » comme adresse d'origine ferait entrer une absurdite dans la
    // fiche, et pire, dans l'appariement.
    const lu = lireBalisesWeb({ format: { tags: { comment: "Merci de votre soutien !" } } });
    expect(lu.url).toBeNull();
    expect(lu.plateforme).toBeNull();
  });

  it("accepte un commentaire qui est vraiment une adresse", () => {
    const lu = lireBalisesWeb({ format: { tags: { comment: "https://vimeo.com/123456789" } } });
    expect(lu.url).toBe("https://vimeo.com/123456789");
    expect(lu.plateforme).toBe("vimeo");
  });

  it("un fichier sans balises ne rend que du vide", () => {
    expect(lireBalisesWeb({}).titre).toBeNull();
    expect(lireBalisesWeb(null).plateforme).toBeNull();
    expect(lireBalisesWeb({ format: {} }).chaine).toBeNull();
  });
});

describe("dates de publication", () => {
  it("normalise les trois ecritures rencontrees", () => {
    expect(normaliseDate("20240115")).toEqual({ publieeLe: "2024-01-15", annee: 2024 });
    expect(normaliseDate("2024-01-15")).toEqual({ publieeLe: "2024-01-15", annee: 2024 });
    expect(normaliseDate("2024-01-15T09:30:00Z")).toEqual({ publieeLe: "2024-01-15", annee: 2024 });
  });

  it("une annee seule ne devient pas un premier janvier", () => {
    // Inventer un jour donnerait a une approximation l'apparence d'un fait — et cette date sert a
    // ordonner les videos d'une chaine.
    expect(normaliseDate("2024")).toEqual({ publieeLe: null, annee: 2024 });
  });

  it("refuse ce qui n'est pas une date", () => {
    expect(normaliseDate("hier")).toEqual({ publieeLe: null, annee: null });
    expect(normaliseDate(null)).toEqual({ publieeLe: null, annee: null });
  });
});

describe("adresses", () => {
  it("reconnait les domaines des plateformes", () => {
    expect(plateformeDepuisUrl("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(plateformeDepuisUrl("https://youtu.be/abc")).toBe("youtube");
    expect(plateformeDepuisUrl("https://dai.ly/x8kf2p9")).toBe("dailymotion");
    expect(plateformeDepuisUrl("https://exemple.invalid/video")).toBeNull();
    expect(plateformeDepuisUrl("pas une adresse")).toBeNull();
  });

  it("extrait l'identifiant des formes YouTube", () => {
    expect(identifiantDepuisUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(identifiantDepuisUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(identifiantDepuisUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("superposition des sources", () => {
  const annexe: IdentiteWeb = { ...lireAnnexeWeb(JSON.stringify({ title: "Titre de la plateforme" }))! };
  const balises = lireBalisesWeb({
    format: { tags: { title: "Titre du conteneur", ARTIST: "Arte", PURL: "https://youtu.be/dQw4w9WgXcQ" } },
  });

  it("la premiere source renseignee l'emporte", () => {
    expect(fusionnerIdentites(annexe, balises).titre).toBe("Titre de la plateforme");
  });

  it("une source amputee n'efface pas ce que la suivante sait", () => {
    // Le melange se fait champ par champ, pas source par source : une annexe reduite au titre laisse
    // les balises fournir la chaine et l'adresse.
    const fusion = fusionnerIdentites(annexe, balises);
    expect(fusion.chaine).toBe("Arte");
    expect(fusion.identifiant).toBe("dQw4w9WgXcQ");
  });

  it("ignore les sources absentes", () => {
    expect(fusionnerIdentites(null, null, balises).chaine).toBe("Arte");
    expect(fusionnerIdentites(null).titre).toBeNull();
  });
});

describe("emplacement de l'annexe", () => {
  it("essaie les trois conventions rencontrees", () => {
    const candidats = cheminsAnnexe("/web/YouTube/Arte/Sujet [dQw4w9WgXcQ].mp4")
      .map((chemin) => chemin.replace(/\\/g, "/"));
    expect(candidats).toEqual([
      "/web/YouTube/Arte/Sujet [dQw4w9WgXcQ].info.json",
      "/web/YouTube/Arte/Sujet [dQw4w9WgXcQ].mp4.info.json",
      "/web/YouTube/Arte/Sujet [dQw4w9WgXcQ].json",
    ]);
  });
});

/**
 * Les entités HTML d'un titre de plateforme.
 *
 * L'API de YouTube échappe ses textes pour du HTML ; le client, lui, affiche du texte. Sans décodage,
 * « Greg &amp;amp; Greg retournent la street » se lit tel quel sur la carte, dans le lecteur et dans
 * les résultats de recherche — constaté à l'écran sur une médiathèque réelle.
 */
describe("décodage des entités", () => {
  it("rend l'esperluette, l'apostrophe et les guillemets", () => {
    expect(decoderEntitesHtml("Greg &amp; Greg")).toBe("Greg & Greg");
    expect(decoderEntitesHtml("L&#39;amour propre")).toBe("L'amour propre");
    expect(decoderEntitesHtml("&quot;Le Pire Stagiaire&quot;")).toBe('"Le Pire Stagiaire"');
    expect(decoderEntitesHtml("1 &lt; 2 &gt; 0")).toBe("1 < 2 > 0");
  });

  it("lit aussi les références hexadécimales", () => {
    expect(decoderEntitesHtml("L&#x27;aspirateur")).toBe("L'aspirateur");
    expect(decoderEntitesHtml("caf&#xe9;")).toBe("café");
  });

  it("ne décode qu'un seul cran", () => {
    // Un texte doublement echappe a la source doit le rester d'un cran : decoder jusqu'au bout
    // fabriquerait un balisage que personne n'a ecrit.
    expect(decoderEntitesHtml("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });

  it("laisse en place ce qu'il ne sait pas rendre", () => {
    // Une entite a moitie rendue serait pire que rien : elle ne serait plus reparable par une passe
    // ulterieure, puisqu'on ne saurait plus ce qui a ete ecrit.
    expect(decoderEntitesHtml("R&D et &inconnue; et &#0; et 100 % & fin"))
      .toBe("R&D et &inconnue; et &#0; et 100 % & fin");
  });

  it("ne touche pas à un texte sans esperluette", () => {
    const titre = "Le train de nuit, 1974";
    expect(decoderEntitesHtml(titre)).toBe(titre);
  });
});
