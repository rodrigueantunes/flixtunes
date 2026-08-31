import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import {
  adresseXtream,
  enregistrerXtream,
  identifiantsXtream,
  listerSources,
  listesDeLaSource,
  reglerFast,
  retirerSource,
} from "./live-fournisseurs.js";

/**
 * Les trois sortes de fournisseurs se ramènent à une seule chose : une liste d'adresses M3U. C'est le
 * seul endroit où elles diffèrent, et c'est donc le seul qui mérite d'être éprouvé — tout ce qui suit
 * est déjà couvert par les tests du modèle.
 */

afterEach(() => {
  for (const source of listerSources()) retirerSource(source.id);
});

describe("un portail Xtream", () => {
  it("se ramène à une adresse M3U qui porte les attributs", () => {
    // `m3u_plus` est la seule forme qui rende `tvg-id`, `tvg-logo` et surtout `tvg-chno` — un portail
    // est l'un des rares fournisseurs à donner les numéros de chaîne, il serait dommage de les perdre.
    const adresse = adresseXtream({ hote: "http://portail.test:8080/", utilisateur: "moi", motDePasse: "secret" });
    expect(adresse).toBe("http://portail.test:8080/get.php?username=moi&password=secret&type=m3u_plus&output=m3u8");
  });

  it("refuse une adresse qui n'est pas un portail", () => {
    // Ce texte devient une adresse que le serveur ira chercher lui-même : un `file://` ou un chemin
    // le ferait sortir d'où il ne doit pas sortir.
    for (const hote of ["file:///etc/passwd", "portail.test", "", "javascript:alert(1)"]) {
      expect(() => enregistrerXtream({ hote, utilisateur: "moi", motDePasse: "x" }), hote).toThrow();
    }
    expect(() => enregistrerXtream({ hote: "http://portail.test", utilisateur: "", motDePasse: "x" })).toThrow(/manquant/);
  });

  it("chiffre le mot de passe au repos, et l'emporte avec la source", () => {
    const source = enregistrerXtream({ hote: "http://portail.test", utilisateur: "moi", motDePasse: "secret" });
    const enBase = db.prepare("SELECT value FROM server_settings WHERE key = ?")
      .get(`live_xtream_${source.id}`) as unknown as { value: string };
    // Le mot de passe ne doit apparaître nulle part en clair, pas même dans la ligne de réglage.
    expect(enBase.value).not.toContain("secret");
    expect(identifiantsXtream(source.id)?.motDePasse).toBe("secret");

    retirerSource(source.id);
    // Un secret dont plus rien ne se sert est le pire des deux mondes : il part avec la source.
    expect(db.prepare("SELECT value FROM server_settings WHERE key = ?").get(`live_xtream_${source.id}`)).toBeUndefined();
  });

  it("n'apporte qu'une liste : le portail rend tout son bouquet d'un coup", async () => {
    const source = enregistrerXtream({ hote: "http://portail.test", utilisateur: "moi", motDePasse: "secret" }, "Mon portail");
    const listes = await listesDeLaSource(source, 2_000_000);
    expect(listes).toHaveLength(1);
    expect(listes[0]?.nom).toBe("Mon portail");
    expect(listes[0]?.url).toContain("type=m3u_plus");
  });
});

describe("les listes publiques", () => {
  it("ne demandent aucun réglage, et s'éteignent d'un geste", async () => {
    const source = reglerFast(true)!;
    expect(source.type).toBe("fast");
    const listes = await listesDeLaSource(source, 2_000_000);
    // Gratuites, légales, distribuées par leurs éditeurs : c'est ce qu'un nouvel arrivant verra en
    // premier s'il n'a rien d'autre.
    expect(listes.length).toBeGreaterThan(1);
    expect(listes.every((liste) => liste.url.startsWith("https://"))).toBe(true);

    expect(reglerFast(false)).toBeNull();
    expect(listerSources().some((candidate) => candidate.type === "fast")).toBe(false);
  });
});

describe("un fichier de listes", () => {
  it("dit clairement qu'il est introuvable plutôt que de rendre une liste vide", async () => {
    db.prepare("INSERT INTO live_sources (id, type, libelle, emplacement) VALUES ('local-test', 'm3u', 'local', ?)")
      .run("Z:/absent/m3u.json");
    const source = listerSources().find((candidate) => candidate.id === "local-test")!;
    await expect(listesDeLaSource(source, 2_000_000)).rejects.toThrow(/introuvable/);
  });
});
