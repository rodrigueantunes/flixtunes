import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import {
  chaineDetaillee,
  enregistrerParametres,
  etatClient,
  etatDirect,
  listerChaines,
  listerListes,
  listerListesClient,
  listerPays,
  noterResultat,
  parametresDirect,
  rafraichirDirect,
  rafraichissementDuAuDemarrage,
} from "./television-direct.js";

/**
 * Le socle de la télévision en direct, éprouvé sur un serveur local plutôt que sur le vrai corpus.
 *
 * Les listes sont servies par un `http.Server` sur la boucle locale : la suite ne dépend donc
 * d'aucune adresse d'Internet, qui serait morte dans six mois — 8 des 535 du fichier de référence le
 * sont déjà. Ce qui est vérifié, ce sont les décisions du chantier : la fusion des doublons, l'écart
 * des transports illisibles, et surtout **la stabilité du numéro**, qui est la promesse la plus
 * facile à casser sans s'en apercevoir.
 */

let serveur: Server;
let base = "";
let dossier = "";

function servir(reponses: Record<string, string>): Promise<void> {
  serveur = createServer((requete, reponse) => {
    const corps = reponses[requete.url ?? ""];
    if (corps === undefined) { reponse.writeHead(404).end("absent"); return; }
    reponse.writeHead(200, { "Content-Type": "audio/x-mpegurl" }).end(corps);
  });
  return new Promise((resoudre) => serveur.listen(0, "127.0.0.1", () => resoudre()));
}

beforeAll(async () => {
  await servir({
    "/a.m3u": [
      "#EXTM3U",
      '#EXTINF:-1 tvg-chno="1" tvg-id="TF1.fr" tvg-logo="http://logo/tf1.png" group-title="Généralistes",TF1',
      "http://exemple.test/tf1-a.m3u8",
      '#EXTINF:-1 group-title="Généralistes",M6',
      "http://exemple.test/m6.m3u8",
      "#EXTINF:-1,Arte",
      "http://exemple.test/arte.m3u8",
      "",
    ].join("\n"),
    "/b.m3u": [
      "#EXTM3U",
      // Même chaîne, autre écriture et autre adresse : c'est le doublon que la fusion doit réunir.
      "#EXTINF:-1,tf1",
      "http://exemple.test/tf1-b.m3u8",
      "#EXTINF:-1,Canal+",
      "http://exemple.test/canal.m3u8",
      // Le corpus réel en compte plus de mille : *canal* est le mot espagnol pour « chaîne ».
      "#EXTINF:-1,Canal 8",
      "http://exemple.test/canal8.m3u8",
      // Aucun de nos trois lecteurs ne sait ouvrir une multidiffusion : elle est écartée, et comptée.
      "#EXTINF:-1,Multidiffusion",
      "rtp://239.0.0.1:1234",
      "",
    ].join("\n"),
  });
  const port = (serveur.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-direct-"));
  writeFileSync(path.join(dossier, "m3u.json"), JSON.stringify({
    "✅ Liste A": `${base}/a.m3u`,
    "〰️ Liste B": `${base}/b.m3u`,
    "❌ Liste morte": `${base}/absente.m3u`,
  }), "utf8");
  enregistrerParametres({ actif: true, dossier, fichier: "m3u.json" });
});

afterAll(async () => {
  // Ce qu'un fichier de tests laisse en base, un autre le paie : la suite partage une seule base.
  db.prepare("DELETE FROM live_channel_urls").run();
  db.prepare("DELETE FROM live_channels").run();
  db.prepare("DELETE FROM live_playlists").run();
  db.prepare("DELETE FROM live_sources").run();
  db.prepare("DELETE FROM server_settings WHERE key = 'live.parametres'").run();
  rmSync(dossier, { recursive: true, force: true });
  await new Promise<void>((resoudre) => serveur.close(() => resoudre()));
});

describe("les réglages", () => {
  it("part éteinte, et le dit", () => {
    // Une fonction qui coûte ne s'impose pas : elle s'active. Ici elle l'est, par le `beforeAll`.
    expect(parametresDirect().actif).toBe(true);
    expect(parametresDirect().fichier).toBe("m3u.json");
  });

  it("refuse un nom de fichier qui contient un chemin", () => {
    // `../../etc/passwd` dans ce champ remonterait hors du dossier choisi.
    expect(() => enregistrerParametres({ fichier: "../secrets.json" })).toThrow(/chemin/);
    expect(() => enregistrerParametres({ fichier: "sous/dossier.json" })).toThrow(/chemin/);
    expect(parametresDirect().fichier).toBe("m3u.json");
  });
});

describe("le rafraîchissement", () => {
  it("lit le catalogue, télécharge les listes, et fusionne les doublons", async () => {
    const etat = await rafraichirDirect();

    expect(etat.listes).toBe(3);
    expect(etat.listesRetenues).toBe(3);
    // TF1 est dans les deux listes : cinq entrées lues, quatre chaînes.
    expect(etat.chaines).toBe(5);
    expect(etat.adresses).toBe(6);
    expect(etat.fusionnees).toBe(1);
    // La multidiffusion de la liste B, écartée et comptée.
    expect(etat.ecartees).toBe(1);
    expect(etat.enCours).toBe(false);
    expect(etat.dureeSecondes).toBeGreaterThanOrEqual(0);
  });

  it("garde le classement lu dans le nom, et retire le préfixe", () => {
    const listes = listerListes();
    expect(listes.map((liste) => [liste.nom, liste.classement])).toEqual(
      expect.arrayContaining([["Liste A", "bonne"], ["Liste B", "moyenne"], ["Liste morte", "faible"]]),
    );
  });

  it("dit ce qui n'a pas répondu, sans faire échouer le reste", () => {
    const morte = listerListes().find((liste) => liste.nom === "Liste morte");
    expect(morte?.dernierMessage).toBe("HTTP 404");
    expect(morte?.entrees).toBe(0);
    // Les deux autres ont bien été lues malgré elle.
    expect(listerListes().find((liste) => liste.nom === "Liste A")?.entrees).toBe(3);
  });

  it("réunit les adresses d'une même chaîne sous une seule entrée", () => {
    const tf1 = listerChaines({ q: "tf1" }).items;
    expect(tf1).toHaveLength(1);
    expect(tf1[0]?.adresses).toBe(2);
    // La fiche garde le logo et le groupe de celle des deux listes qui les portait.
    expect(tf1[0]?.logo).toBe("http://logo/tf1.png");
    expect(tf1[0]?.groupe).toBe("Généralistes");
  });

  it("respecte le tvg-chno quand il est là, et numérote le reste", () => {
    const grille = listerChaines({ limit: 10 }).items;
    expect(grille[0]?.nom).toBe("TF1");
    expect(grille[0]?.numero).toBe(1);
    // Les autres reçoivent un numéro : aucune chaîne de la grille n'en est dépourvue.
    expect(grille.every((chaine) => chaine.numero != null)).toBe(true);
    expect(new Set(grille.map((chaine) => chaine.numero)).size).toBe(grille.length);
  });
});

describe("la stabilité du numéro", () => {
  it("ne renumérote pas au rafraîchissement suivant", async () => {
    const avant = new Map(listerChaines({ limit: 50 }).items.map((chaine) => [chaine.nom, chaine.numero]));
    await rafraichirDirect();
    const apres = new Map(listerChaines({ limit: 50 }).items.map((chaine) => [chaine.nom, chaine.numero]));
    expect(apres).toEqual(avant);
  });

  it("garde le numéro d'une chaîne qui disparaît puis revient", async () => {
    const numeroCanal = listerChaines({ q: "canal" }).items[0]?.numero;
    expect(numeroCanal).toBeTypeOf("number");

    // La liste B est retirée du fichier : Canal+ n'a plus d'adresse, donc plus de grille.
    writeFileSync(path.join(dossier, "m3u.json"), JSON.stringify({ "✅ Liste A": `${base}/a.m3u` }), "utf8");
    await rafraichirDirect();
    expect(listerChaines({ q: "canal" }).items).toHaveLength(0);
    expect(listerChaines({ q: "tf1" }).items[0]?.adresses).toBe(1);

    // Elle revient, et **avec le même numéro** : c'est la promesse faite à la télécommande.
    writeFileSync(path.join(dossier, "m3u.json"), JSON.stringify({
      "✅ Liste A": `${base}/a.m3u`, "〰️ Liste B": `${base}/b.m3u`, "❌ Liste morte": `${base}/absente.m3u`,
    }), "utf8");
    await rafraichirDirect();
    expect(listerChaines({ q: "canal" }).items[0]?.numero).toBe(numeroCanal);
  });
});

describe("la grille", () => {
  it("cherche sans accent ni ponctuation", () => {
    // « canal » trouve « Canal+ », comme « amelie » trouve « Amélie » dans le catalogue.
    expect(listerChaines({ q: "canal" }).items[0]?.nom).toBe("Canal+");
    expect(listerChaines({ q: "ARTE" }).items[0]?.nom).toBe("Arte");
  });

  it("pagine, et annonce le total", () => {
    const page = listerChaines({ limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(listerChaines({ limit: 2, offset: 2 }).items).toHaveLength(2);
  });

  it("filtre par liste de lecture, comme le catalogue filtre par genre", () => {
    const listeA = listerListes().find((liste) => liste.nom === "Liste A")!;
    const noms = listerChaines({ listes: [listeA.id] }).items.map((chaine) => chaine.nom);
    expect(noms).toEqual(expect.arrayContaining(["TF1", "M6", "Arte"]));
    expect(noms).not.toContain("Canal+");
  });

  it("filtre par pays, sans exclure les chaînes dont on ignore le pays", () => {
    // C'est le filtre qui règle « canal » : le mot est espagnol et portugais, et mille résultats
    // justes ne valent pas mieux qu'aucun. Ici seule TF1 porte un `tvg-id` qui dit son pays.
    expect(listerPays()).toEqual([{ code: "fr", nom: "France", chaines: 1 }]);
    expect(listerChaines({ pays: ["fr"] }).items.map((chaine) => chaine.nom)).toEqual(["TF1"]);
    // Sans pays coché, tout le monde reste visible — y compris les trois chaînes sans indice.
    expect(listerChaines({}).total).toBe(5);
  });

  it("prend un signe tapé au sérieux : « canal + » n'est pas « canal »", () => {
    // Mesuré sur le corpus réel : « canal » rend 1 141 chaînes, « canal + » en rend 66. L'index ne
    // connaît que des mots et découpe les deux saisies de la même façon ; c'est la suite de
    // caractères, espaces mis à part, qui les distingue.
    expect(listerChaines({ q: "canal" }).items.map((chaine) => chaine.nom)).toEqual(["Canal+", "Canal 8"]);
    expect(listerChaines({ q: "canal +" }).items.map((chaine) => chaine.nom)).toEqual(["Canal+"]);
    // L'espace ne compte pas : on ne se souvient jamais s'il y en a un.
    expect(listerChaines({ q: "canal+" }).items.map((chaine) => chaine.nom)).toEqual(["Canal+"]);
  });

  it("classe une recherche par pertinence, pas par numéro", () => {
    // « canal » rendait 1 452 chaînes dont Canal+ était noyée : le nom exact passe devant, puis ce qui
    // commence par la saisie, puis la chaîne la plus reprise — la meilleure mesure de notoriété qu'on
    // ait. La normalisation retire la ponctuation, si bien que « canal + » retrouve « Canal+ ».
    const exact = listerChaines({ q: "canal +" }).items;
    expect(exact[0]?.nom).toBe("Canal+");

    const prefixe = listerChaines({ q: "tf" }).items;
    expect(prefixe[0]?.nom).toBe("TF1");
  });
});

describe("l'interrupteur", () => {
  it("refuse de rafraîchir quand la fonction est désactivée", async () => {
    enregistrerParametres({ actif: false });
    await expect(rafraichirDirect()).rejects.toThrow(/désactivée/);
    expect(etatDirect().actif).toBe(false);
    enregistrerParametres({ actif: true });
  });
});

describe("le repli sur les adresses de secours", () => {
  it("rend les adresses d'une chaîne, celle qui a marché en tête", () => {
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    const avant = chaineDetaillee(tf1.id)!;
    expect(avant.sources).toHaveLength(2);

    // La seconde adresse joue, la première refuse : l'ordre d'essai s'inverse pour la fois suivante.
    const seconde = avant.sources[1]!.url;
    expect(noterResultat(tf1.id, avant.sources[0]!.url, false)).toBe(true);
    expect(noterResultat(tf1.id, seconde, true)).toBe(true);

    const apres = chaineDetaillee(tf1.id)!;
    expect(apres.sources[0]?.url).toBe(seconde);
    expect(apres.etat).toBe("bonne");
  });

  it("ne déclare morte une chaîne que lorsque toutes ses adresses ont échoué", () => {
    const canal = listerChaines({ q: "canal" }).items[0]!;
    // Canal+ n'a qu'une adresse : un seul échec suffit à la condamner…
    expect(noterResultat(canal.id, chaineDetaillee(canal.id)!.sources[0]!.url, false)).toBe(true);
    expect(chaineDetaillee(canal.id)?.etat).toBe("morte");

    // …tandis que TF1, qui en a deux dont une qui a réussi, reste bonne.
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    expect(chaineDetaillee(tf1.id)?.etat).toBe("bonne");
  });

  it("refuse une adresse qui n'appartient pas à la chaîne", () => {
    // Sans cette vérification, n'importe quel corps de requête écrirait n'importe quelle ligne.
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    expect(noterResultat(tf1.id, "http://exemple.test/inventee.m3u8", false)).toBe(false);
    expect(chaineDetaillee("chaine-qui-n-existe-pas")).toBeNull();
  });

  it("efface l'ardoise d'une adresse qui rejoue", () => {
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    const adresse = chaineDetaillee(tf1.id)!.sources.find((candidate) => candidate.echecs > 0)!;
    noterResultat(tf1.id, adresse.url, true);
    const rejouee = chaineDetaillee(tf1.id)!.sources.find((candidate) => candidate.url === adresse.url)!;
    // Un échec d'hier ne doit pas la faire passer derrière une adresse qui n'a jamais rien rendu.
    expect(rejouee.echecs).toBe(0);
    expect(rejouee.succes).toBeGreaterThan(0);
  });
});

describe("ce qu'un client voit", () => {
  it("n'annonce la fonction disponible que si des chaînes existent vraiment", () => {
    expect(etatClient().disponible).toBe(true);
    expect(etatClient().chaines).toBeGreaterThan(0);
    enregistrerParametres({ actif: false });
    // Un réglage à demi fait n'ajoute pas une section vide au menu.
    expect(etatClient().disponible).toBe(false);
    enregistrerParametres({ actif: true });
  });

  it("ne propose que les listes cochées qui ont rendu des chaînes", () => {
    const proposees = listerListesClient();
    expect(proposees.map((liste) => liste.nom)).toEqual(expect.arrayContaining(["Liste A", "Liste B"]));
    // La liste qui n'a pas répondu n'a rien à proposer : elle n'encombre pas le filtre.
    expect(proposees.map((liste) => liste.nom)).not.toContain("Liste morte");
  });
});

describe("le rafraîchissement au démarrage", () => {
  it("ne part que si la fonction est activée, réglée, et la cadence échue", async () => {
    // Une source vient d'être relue par les tests précédents : la cadence de douze heures n'est pas
    // échue, donc rien ne doit repartir. Redémarrer trois fois de suite ne retélécharge pas trois fois.
    expect(rafraichissementDuAuDemarrage()).toBe(false);

    // Cadence d'une heure et dernière lecture reculée de deux : elle est échue.
    enregistrerParametres({ cadenceHeures: 1 });
    db.prepare("UPDATE live_sources SET rafraichie_le = datetime('now', '-2 hours')").run();
    expect(rafraichissementDuAuDemarrage()).toBe(true);

    // Éteinte, rien ne part — quelle que soit la cadence.
    enregistrerParametres({ actif: false });
    expect(rafraichissementDuAuDemarrage()).toBe(false);
    enregistrerParametres({ actif: true, cadenceHeures: 12 });
    await rafraichirDirect();
  });
});

describe("changer de fichier de listes", () => {
  it("retire les listes du précédent au lieu de les empiler", async () => {
    // Sans cela, les chaînes de l'ancien fichier resteraient dans la grille sans que rien à l'écran
    // ne dise d'où elles viennent ni comment s'en défaire.
    const numeroTf1 = listerChaines({ q: "tf1" }).items[0]?.numero;
    const autre = mkdtempSync(path.join(tmpdir(), "flixtunes-direct-2-"));
    writeFileSync(path.join(autre, "m3u.json"), JSON.stringify({ "✅ Seule liste": `${base}/a.m3u` }), "utf8");
    enregistrerParametres({ dossier: autre });

    await rafraichirDirect();
    expect(listerListes().map((liste) => liste.nom)).toEqual(["Seule liste"]);
    // Canal+ ne venait que de l'ancien fichier : plus d'adresse, donc plus dans la grille.
    expect(listerChaines({ q: "canal" }).items).toHaveLength(0);
    // TF1 est dans la liste conservée, et garde le numéro qu'elle avait.
    expect(listerChaines({ q: "tf1" }).items[0]?.numero).toBe(numeroTf1);

    enregistrerParametres({ dossier });
    rmSync(autre, { recursive: true, force: true });
  });
});
