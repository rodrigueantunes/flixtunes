import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import {
  avatarDeChaineYoutube, chercherYoutube, dureeIso, quotaDisponible, quotaDuJour,
  resoudreParOEmbed, resoudreYoutube,
} from "./web-fournisseurs.js";

/**
 * Interroger les plateformes, sans jamais dépenser plus que prévu.
 *
 * Ces cas fixent deux choses. Que les réponses sont lues correctement — titre, chaîne, date, durée,
 * vignette —, et surtout que **rien ne part sans clé et sans budget**. Le quota YouTube est une
 * ressource quotidienne : l'épuiser rend la clé inutilisable jusqu'au lendemain, y compris pour les
 * résolutions à une unité qui sont pourtant ce qui marche le mieux.
 */
const CLE = "cle-d-essai";

/** Une réponse d'API, et la trace de l'adresse appelée. */
function faussaire(charge: unknown) {
  const appels: string[] = [];
  return {
    appels,
    recuperer: async (url: string) => { appels.push(url); return new Response(JSON.stringify(charge)); },
  };
}

const VIDEO = {
  items: [{
    id: "dQw4w9WgXcQ",
    snippet: {
      title: "Le monde en cartes",
      channelTitle: "Arte",
      description: "Une chronique hebdomadaire.",
      publishedAt: "2024-01-15T09:30:00Z",
      thumbnails: { default: { url: "https://i.example/petite.jpg" }, maxres: { url: "https://i.example/grande.jpg" } },
    },
    contentDetails: { duration: "PT12M34S" },
  }],
};

afterEach(() => {
  db.prepare("DELETE FROM server_settings WHERE key = 'web_quota_youtube'").run();
});

describe("résolution par identifiant", () => {
  it("lit ce que la plateforme rend", async () => {
    const faux = faussaire(VIDEO);
    const lu = await resoudreYoutube("dQw4w9WgXcQ", { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer });

    expect(lu?.titre).toBe("Le monde en cartes");
    expect(lu?.chaine).toBe("Arte");
    expect(lu?.plateforme).toBe("youtube");
    expect(lu?.publieeLe).toBe("2024-01-15");
    expect(lu?.annee).toBe(2024);
    expect(lu?.dureeSecondes).toBe(754);
    expect(lu?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("prend la plus grande vignette proposée", async () => {
    // Elle est telechargee une fois puis servie localement : son poids ne se paie qu'au premier
    // passage, alors qu'une vignette trop petite se paie a chaque affichage.
    const faux = faussaire(VIDEO);
    const lu = await resoudreYoutube("dQw4w9WgXcQ", { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer });
    expect(lu?.vignette).toBe("https://i.example/grande.jpg");
  });

  it("n'appelle rien sans clé", async () => {
    // Le fournisseur est desactive par absence de cle, comme TMDB : c'est le meme geste d'activation.
    const faux = faussaire(VIDEO);
    const lu = await resoudreYoutube("dQw4w9WgXcQ", { cleYoutube: null, comptabiliser: false, recuperer: faux.recuperer });

    expect(lu).toBeNull();
    expect(faux.appels).toHaveLength(0);
  });

  it("rend null sur une réponse vide", async () => {
    const faux = faussaire({ items: [] });
    expect(await resoudreYoutube("inconnu", { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer }))
      .toBeNull();
  });
});

describe("recherche par titre", () => {
  it("joint le nom de la chaîne au titre", async () => {
    // Deux videos peuvent porter le meme titre : la chaine les departage. C'est aussi ce que
    // l'utilisateur a decrit — on a le fournisseur et la chaine, donc ca va.
    const faux = faussaire({ items: [{ id: { videoId: "abc12345678" }, snippet: {
      title: "Le monde en cartes", channelTitle: "Arte", publishedAt: "2024-01-15T00:00:00Z", thumbnails: {} } }] });

    const lu = await chercherYoutube("Arte", "Le monde en cartes",
      { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer });

    expect(lu?.identifiant).toBe("abc12345678");
    expect(faux.appels[0]).toContain(encodeURIComponent("Arte Le monde en cartes"));
  });

  it("rend null quand la recherche ne trouve pas de vidéo", async () => {
    const faux = faussaire({ items: [{ id: { kind: "youtube#channel" }, snippet: {} }] });
    expect(await chercherYoutube("Arte", "Introuvable",
      { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer })).toBeNull();
  });
});

describe("avatar de chaîne", () => {
  it("rend la plus grande image de la chaîne", async () => {
    // C'est la seule information de cet ecran qui ne puisse venir d'aucun fichier.
    const faux = faussaire({ items: [{ snippet: { thumbnails: { high: { url: "https://i.example/avatar.jpg" } } } }] });
    expect(await avatarDeChaineYoutube("Arte", { cleYoutube: CLE, comptabiliser: false, recuperer: faux.recuperer }))
      .toBe("https://i.example/avatar.jpg");
  });
});

describe("quota", () => {
  it("compte ce qui est dépensé, et refuse quand le budget est épuisé", async () => {
    const faux = faussaire(VIDEO);

    await resoudreYoutube("dQw4w9WgXcQ", { cleYoutube: CLE, recuperer: faux.recuperer });
    expect(quotaDuJour().depense, "une résolution coûte une unité").toBe(1);

    await chercherYoutube("Arte", "Un titre", { cleYoutube: CLE, recuperer: faux.recuperer });
    expect(quotaDuJour().depense, "une recherche en coûte cent").toBe(101);
  });

  it("s'arrête avant d'épuiser la clé", async () => {
    // Epuiser le quota rend la cle inutilisable jusqu'au lendemain — y compris pour les resolutions
    // a une unite. Mieux vaut s'arreter en le disant que continuer jusqu'a l'echec.
    const etat = quotaDuJour();
    db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run("web_quota_youtube", JSON.stringify({ date: etat.date, depense: etat.plafond }));

    expect(quotaDisponible(1)).toBe(false);
    const faux = faussaire(VIDEO);
    expect(await resoudreYoutube("dQw4w9WgXcQ", { cleYoutube: CLE, recuperer: faux.recuperer })).toBeNull();
    expect(faux.appels, "aucun appel ne part quand le budget est épuisé").toHaveLength(0);
  });

  it("repart à zéro en changeant de jour", async () => {
    db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run("web_quota_youtube", JSON.stringify({ date: "2000-01-01", depense: 9999 }));

    expect(quotaDuJour().depense).toBe(0);
  });
});

describe("oEmbed, le filet universel", () => {
  it("résout une adresse sans clé ni quota", async () => {
    const faux = faussaire({ title: "Un sujet", author_name: "Konbini", thumbnail_url: "https://i.example/v.jpg" });

    const lu = await resoudreParOEmbed("dailymotion", "https://www.dailymotion.com/video/x8kf2p9",
      { recuperer: faux.recuperer });

    expect(lu?.titre).toBe("Un sujet");
    expect(lu?.chaine).toBe("Konbini");
    expect(lu?.plateforme).toBe("dailymotion");
    expect(faux.appels[0]).not.toContain("key=");
  });

  it("ne connaît pas toutes les plateformes, et le dit", async () => {
    // Il resout une adresse qu'on possede deja, il ne cherche pas — et il ne couvre que les
    // plateformes qui publient un point d'entree. Ailleurs, les metadonnees locales font seules.
    const faux = faussaire({});
    expect(await resoudreParOEmbed("peertube", "https://exemple.invalid/v", { recuperer: faux.recuperer })).toBeNull();
    expect(faux.appels).toHaveLength(0);
  });
});

describe("durées ISO 8601", () => {
  it("lit les formes que YouTube emploie", () => {
    expect(dureeIso("PT12M34S")).toBe(754);
    expect(dureeIso("PT1H2M3S")).toBe(3723);
    expect(dureeIso("PT45S")).toBe(45);
    expect(dureeIso("P1DT2H")).toBe(93_600);
  });

  it("refuse ce qui n'en est pas une", () => {
    expect(dureeIso("12:34")).toBeNull();
    expect(dureeIso(null)).toBeNull();
    expect(dureeIso("PT0S")).toBeNull();
  });
});
