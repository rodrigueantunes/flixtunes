import { describe, expect, it } from "vitest";
import { analyserM3U, cleDeChaine, decouperClassement, decouperNumeroDuNom, lireCatalogueM3U, lisibleParNosLecteurs } from "./m3u.js";

/**
 * Les cas éprouvés ici viennent tous du corpus réel — 527 listes, 181 126 entrées, relevées le
 * 30 août 2026. Aucun n'est inventé pour le plaisir d'avoir un test : chacun a été rencontré, et
 * plusieurs faisaient perdre des chaînes à la lecture naïve dont partait TvPourTous.
 */

describe("analyserM3U", () => {
  it("lit une entrée ordinaire avec ses attributs", () => {
    const entrees = analyserM3U(`#EXTM3U
#EXTINF:-1 tvg-id="TF1.fr" tvg-logo="http://logo/tf1.png" group-title="Généralistes" tvg-chno="1",TF1
https://exemple.test/tf1.m3u8`);
    expect(entrees).toEqual([{
      nom: "TF1",
      url: "https://exemple.test/tf1.m3u8",
      logo: "http://logo/tf1.png",
      groupe: "Généralistes",
      tvgId: "TF1.fr",
      numero: 1,
    }]);
  });

  it("coupe le nom à la virgule qui n'est pas entre guillemets", () => {
    // TvPourTous prenait la dernière virgule : « Paris Première, la chaîne » devenait « la chaîne ».
    // Couper à la première serait faux aussi, puisque `group-title` en contient une.
    const entrees = analyserM3U(`#EXTINF:-1 group-title="Films, Séries",Paris Première, la chaîne
https://exemple.test/pp.m3u8`);
    expect(entrees[0]?.nom).toBe("Paris Première, la chaîne");
    expect(entrees[0]?.groupe).toBe("Films, Séries");
  });

  it("saute les directives glissées entre l'entrée et son adresse", () => {
    // `#EXTVLCOPT` et `#KODIPROP` sont fréquents. Les prendre pour l'adresse perd la chaîne.
    const entrees = analyserM3U(`#EXTINF:-1,Canal+
#EXTVLCOPT:http-user-agent=Mozilla
#KODIPROP:inputstream=inputstream.adaptive
https://exemple.test/canal.m3u8`);
    expect(entrees).toHaveLength(1);
    expect(entrees[0]?.url).toBe("https://exemple.test/canal.m3u8");
  });

  it("applique le groupe posé par #EXTGRP aux entrées suivantes", () => {
    const entrees = analyserM3U(`#EXTGRP:Sport
#EXTINF:-1,beIN 1
https://exemple.test/bein1.m3u8
#EXTINF:-1 group-title="Cinéma",Ciné+
https://exemple.test/cine.m3u8`);
    expect(entrees[0]?.groupe).toBe("Sport");
    // L'attribut de la ligne l'emporte sur le groupe courant : il est plus précis.
    expect(entrees[1]?.groupe).toBe("Cinéma");
  });

  it("supporte la marque d'ordre des octets et les fins de ligne Windows", () => {
    const entrees = analyserM3U("﻿#EXTM3U\r\n#EXTINF:-1,M6\r\nhttps://exemple.test/m6.m3u8\r\n");
    expect(entrees).toEqual([expect.objectContaining({ nom: "M6", url: "https://exemple.test/m6.m3u8" })]);
  });

  it("abandonne une entrée qui n'a pas d'adresse, sans perdre la suivante", () => {
    const entrees = analyserM3U(`#EXTINF:-1,Sans adresse
#EXTINF:-1,Avec adresse
https://exemple.test/ok.m3u8`);
    expect(entrees.map((entree) => entree.nom)).toEqual(["Avec adresse"]);
  });

  it("lit tvg-ID comme tvg-id — le corpus mêle les deux casses", () => {
    const entrees = analyserM3U(`#EXTINF:-1 tvg-ID="Arte.fr",Arte
https://exemple.test/arte.m3u8`);
    expect(entrees[0]?.tvgId).toBe("Arte.fr");
  });

  it("ignore un tvg-chno illisible plutôt que d'inventer un numéro", () => {
    const entrees = analyserM3U(`#EXTINF:-1 tvg-chno="",Chaîne
https://exemple.test/x.m3u8
#EXTINF:-1 tvg-chno="abc",Autre
https://exemple.test/y.m3u8`);
    expect(entrees[0]?.numero).toBeNull();
    expect(entrees[1]?.numero).toBeNull();
  });

  it("rend une liste vide sur un fichier qui n'est pas une liste", () => {
    expect(analyserM3U("<html><body>404</body></html>")).toEqual([]);
  });
});

describe("decouperNumeroDuNom", () => {
  it("récupère le numéro que la liste range dans le nom", () => {
    // Vu à l'écran sur le corpus réel : beaucoup de listes numérotent ainsi, et ce numéro était jeté.
    expect(decouperNumeroDuNom("21. LA CHAÎNE L'ÉQUIPE")).toEqual({ nom: "LA CHAÎNE L'ÉQUIPE", numero: 21 });
    expect(decouperNumeroDuNom("10. TMC [720p]")).toEqual({ nom: "TMC [720p]", numero: 10 });
    expect(decouperNumeroDuNom("4) Canal+")).toEqual({ nom: "Canal+", numero: 4 });
    expect(decouperNumeroDuNom("6 - M6")).toEqual({ nom: "M6", numero: 6 });
  });

  it("laisse intact un nom qui commence par un chiffre", () => {
    // Le séparateur est ce qui distingue une numérotation d'un nom : ceux-ci sont des noms.
    for (const nom of ["24 Horas", "13 Kids", "2x2", "24H", "6ter", "365 days TV"]) {
      expect(decouperNumeroDuNom(nom)).toEqual({ nom, numero: null });
    }
  });

  it("garde le nom quand il n'y a rien après le numéro", () => {
    expect(decouperNumeroDuNom("21. ")).toEqual({ nom: "21.", numero: null });
  });
});

describe("lisibleParNosLecteurs", () => {
  it("retient http et https, écarte les transports qu'aucun client ne lit", () => {
    // 1 347 entrées du corpus mesuré sont dans ce cas : ni le navigateur, ni Media3.
    expect(lisibleParNosLecteurs("https://exemple.test/a.m3u8")).toBe(true);
    expect(lisibleParNosLecteurs("http://exemple.test/a.m3u8")).toBe(true);
    expect(lisibleParNosLecteurs("rtp://239.0.0.1:1234")).toBe(false);
    expect(lisibleParNosLecteurs("rtsp://exemple.test/live")).toBe(false);
    expect(lisibleParNosLecteurs("plugin://plugin.video.x/")).toBe(false);
  });
});

describe("decouperClassement", () => {
  it("lit le classement du préfixe et le retire du nom", () => {
    expect(decouperClassement("✅ iptv-org France")).toEqual({ nom: "iptv-org France", classement: "bonne" });
    expect(decouperClassement("〰️ Free-TV France")).toEqual({ nom: "Free-TV France", classement: "moyenne" });
    expect(decouperClassement("⚠️ bililive (mursor1985/LIVE)")).toEqual({ nom: "bililive (mursor1985/LIVE)", classement: "douteuse" });
    // ❌ ne veut pas dire « morte » : le script le pose sur 25 à 49 % de flux qui répondent.
    expect(decouperClassement("❌ france (aria-tv/aria)")).toEqual({ nom: "france (aria-tv/aria)", classement: "faible" });
  });

  it("laisse intact un nom sans préfixe connu", () => {
    expect(decouperClassement("Ma liste perso")).toEqual({ nom: "Ma liste perso", classement: "inconnue" });
  });
});

describe("cleDeChaine", () => {
  it("réunit les écritures d'un même nom", () => {
    // C'est cette clé qui fusionne les 44,7 % de doublons du corpus en un repli.
    expect(cleDeChaine("TF1")).toBe(cleDeChaine("tf1"));
    expect(cleDeChaine("Canal+")).toBe(cleDeChaine("canal +"));
    expect(cleDeChaine("Ciné+ Émotion")).toBe(cleDeChaine("Cine+ Emotion"));
  });

  it("ne réunit pas deux chaînes différentes", () => {
    expect(cleDeChaine("TF1")).not.toBe(cleDeChaine("TF1 Séries Films"));
  });
});

describe("lireCatalogueM3U", () => {
  it("lit un m3u.json au format de TvPourTous", () => {
    const listes = lireCatalogueM3U(JSON.stringify({
      "✅ iptv-org France": "https://exemple.test/fr.m3u",
      "❌ morte": "https://exemple.test/morte.m3u",
    }));
    expect(listes).toEqual([
      { nom: "iptv-org France", url: "https://exemple.test/fr.m3u", classement: "bonne" },
      { nom: "morte", url: "https://exemple.test/morte.m3u", classement: "faible" },
    ]);
  });

  it("écarte une valeur qui n'est pas une adresse, sans perdre les autres", () => {
    // Sur 535 entrées, une faute de frappe ne doit pas coûter les 534 restantes.
    const listes = lireCatalogueM3U(JSON.stringify({ bonne: "https://exemple.test/a.m3u", cassee: "pas une adresse", nulle: null }));
    expect(listes.map((liste) => liste.nom)).toEqual(["bonne"]);
  });

  it("ne garde qu'une entrée par adresse", () => {
    const listes = lireCatalogueM3U(JSON.stringify({ "✅ a": "https://exemple.test/a.m3u", "〰️ a bis": "https://exemple.test/a.m3u" }));
    expect(listes).toHaveLength(1);
  });

  it("refuse un fichier qui n'est pas un objet", () => {
    expect(() => lireCatalogueM3U("[]")).toThrow(/objet/);
  });
});
