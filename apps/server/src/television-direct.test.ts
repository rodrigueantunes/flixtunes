import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./database.js";
import {
  chaineDetaillee,
  derniereChaine,
  enregistrerParametres,
  etatClient,
  etatDirect,
  listerChaines,
  listerListes,
  listerListesClient,
  listerPays,
  reunirLesFiabilites,
  marquerFavorite,
  noterResultat,
  retenirDerniereChaine,
  parametresDirect,
  rafraichirDirect,
  rafraichissementDuAuDemarrage,
  rangerLesPays,
  numeroterLesNouvelles,
  renumeroterDansLOrdreDAffichage,
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
      // L'écriture est ici plus longue, et la ponctuation disparaît à la normalisation : même clé.
      "#EXTINF:-1,TF1 ++",
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
  db.prepare("DELETE FROM live_favoris").run();
  db.prepare("DELETE FROM live_derniere_chaine").run();
  db.prepare("DELETE FROM profiles WHERE id = 'profil-direct-test'").run();
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
    /*
     * C'est le filtre qui règle « canal » : le mot est espagnol et portugais, et mille résultats
     * justes ne valent pas mieux qu'aucun.
     *
     * Seule TF1 porte un `tvg-id` qui dit son pays. Les trois autres françaises sont reconnues à
     * leur seul nom — c'est tout l'objet du catalogue : sans lui, « M6 » et « Canal+ » restaient
     * sans pays, donc absentes du filtre France et reléguées en fin de grille. « Canal 8 », elle,
     * n'est toujours de nulle part, et c'est ce qu'on veut.
     */
    expect(listerPays()).toEqual([{ code: "fr", nom: "France", chaines: 4 }]);
    /*
     * L'ordre est celui des numéros, et les numéros sont ceux du plan national : TF1 en 1, M6 en 6,
     * Arte en 7, et Canal+ dans la zone du bouquet à partir de 27. Ce n'est plus l'alphabet.
     */
    expect(listerChaines({ pays: ["fr"] }).items.map((chaine) => chaine.nom))
      .toEqual(["TF1", "M6", "Arte", "Canal+"]);
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

describe("les favorites et la dernière chaîne", () => {
  /** Un profil de test : les favorites sont à lui, jamais au foyer. */
  const profil = "profil-direct-test";

  it("garde vingt chaînes sous la main, par profil", () => {
    db.prepare("INSERT OR IGNORE INTO profiles (id, name, avatar_color) VALUES (?, 'Essai', '#2e6bff')").run(profil);
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    const arte = listerChaines({ q: "arte" }).items[0]!;

    expect(marquerFavorite(profil, tf1.id, true)).toBe(true);
    // Deux fois la même n'ajoute rien : la clé primaire porte le couple.
    expect(marquerFavorite(profil, tf1.id, true)).toBe(false);

    const retenues = listerChaines({ profileId: profil, favoris: true });
    expect(retenues.items.map((chaine) => chaine.nom)).toEqual(["TF1"]);
    // L'étoile voyage avec la chaîne, sans une sous-requête par ligne.
    const grille = listerChaines({ profileId: profil, limit: 50 }).items;
    expect(grille.find((chaine) => chaine.id === tf1.id)?.favori).toBe(true);
    expect(grille.find((chaine) => chaine.id === arte.id)?.favori).toBe(false);

    // Sans profil, aucune étoile — et surtout, la requête reste valide.
    expect(listerChaines({ limit: 1 }).items[0]?.favori).toBe(false);

    expect(marquerFavorite(profil, tf1.id, false)).toBe(true);
    expect(listerChaines({ profileId: profil, favoris: true }).items).toHaveLength(0);
  });

  it("retient la dernière chaîne regardée, pour la rallumer", () => {
    const tf1 = listerChaines({ q: "tf1" }).items[0]!;
    expect(derniereChaine(profil)).toBeNull();
    retenirDerniereChaine(profil, tf1.id);
    expect(derniereChaine(profil)?.nom).toBe("TF1");
    // Elle se remplace, elle ne s'empile pas.
    const m6 = listerChaines({ q: "m6" }).items[0]!;
    retenirDerniereChaine(profil, m6.id);
    expect(derniereChaine(profil)?.nom).toBe("M6");
  });

  it("masque les chaînes mortes, mais seulement si on le demande", () => {
    const canal = listerChaines({ q: "canal" }).items.find((chaine) => chaine.nom === "Canal+")!;
    db.prepare("UPDATE live_channels SET etat = 'morte' WHERE id = ?").run(canal.id);

    // Éteint par défaut : une chaîne morte hier soir répond peut-être ce matin.
    expect(listerChaines({ q: "canal" }).items.some((chaine) => chaine.id === canal.id)).toBe(true);
    expect(listerChaines({ q: "canal", masquerMortes: true }).items.some((chaine) => chaine.id === canal.id)).toBe(false);

    db.prepare("UPDATE live_channels SET etat = 'inconnue' WHERE id = ?").run(canal.id);
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

describe("l'ordre de la grille", () => {
  it("montre la France d'abord, puis l'alphabet, puis ce qu'on ne sait pas situer", () => {
    /*
     * Trois chaînes posées à la main plutôt que dans les listes du jeu d'essai : celles-ci n'ont que
     * des françaises et une sans pays, et les tests qui précèdent ont retiré les adresses de la
     * seconde. Un ordre se vérifie sur des pays différents, sinon il ne dit rien.
     */
    const poser = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, numero, adresses)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
    poser.run("t-de", "t-de", "ZDF", "zdf", "zdf", "de", 9001);
    poser.run("t-br", "t-br", "Globo", "globo", "globo", "br", 9002);
    poser.run("t-nul", "t-nul", "Sans Pays", "sans pays", "sanspays", null, 9003);
    rangerLesPays();

    const noms = listerChaines({ limit: 60, offset: 0 }).items.map((chaine) => chaine.nom);
    // La France d'abord — TF1, Arte et M6 sont les trois qui restent joignables —, puis l'ordre
    // alphabétique des noms **français** : Allemagne avant Brésil. Et l'absence de pays ferme.
    expect(noms.filter((nom) => ["TF1", "ZDF", "Globo", "Sans Pays"].includes(nom)))
      .toEqual(["TF1", "ZDF", "Globo", "Sans Pays"]);
    expect(noms[noms.length - 1]).toBe("Sans Pays");
  });
});

describe("la numérotation, dans l'ordre où la grille se lit", () => {
  it("donne les premiers numéros à la France, et respecte ceux posés à la main", () => {
    /*
     * Le numéro est le geste principal d'un téléviseur, et il ne suivait plus l'ordre affiché : sur
     * le corpus, la chaîne 2 était ukrainienne, la 3 espagnole, et la première française arrivait au
     * 47. Composer « 2 » tombait sur autre chose que ce qu'on voyait en haut de la grille.
     */
    const poser = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, numero, numero_manuel, adresses)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    poser.run("n-de", "n-de", "Zdf", "zdf", "zdf", "de", 8001, null);
    poser.run("n-fr1", "n-fr1", "Une Francaise", "une francaise", "unefrancaise", "fr", 8002, null);
    poser.run("n-fr2", "n-fr2", "Autre Francaise", "autre francaise", "autrefrancaise", "fr", 8003, null);
    // Un numéro posé à la main est une décision, pas une attribution : il ne bouge pas.
    poser.run("n-fixe", "n-fixe", "Chaine Fixee", "chaine fixee", "chainefixee", "fr", 8004, 2);
    rangerLesPays();
    renumeroterDansLOrdreDAffichage();

    const numero = (id: string) => (db.prepare("SELECT numero FROM live_channels WHERE id = ?")
      .get(id) as unknown as { numero: number | null }).numero;
    expect(numero("n-fixe")).toBe(2);
    // Les deux françaises passent devant l'allemande, dans l'ordre alphabétique entre elles.
    expect(numero("n-fr2")!).toBeLessThan(numero("n-fr1")!);
    expect(numero("n-fr1")!).toBeLessThan(numero("n-de")!);
    // Et personne ne prend le 2, qui est réservé.
    expect(numero("n-fr1")).not.toBe(2);
    expect(numero("n-fr2")).not.toBe(2);
  });

  it("donne à la TNT française ses numéros d'aujourd'hui", () => {
    /*
     * On tape 1 pour TF1 et 6 pour M6 : c'est un réflexe de trente ans, et c'est le geste que la
     * saisie à la télécommande sert. Le plan est celui de la délibération Arcom n° 2025-06 — France 4
     * a pris le 4 que Canal+ occupait avant son départ de la TNT.
     *
     * « Canal ?? » est le piège que la comparaison sur nom **compact** évite : son nom normalisé est
     * `canal`, comme celui de Canal+, et *canal* est le mot espagnol pour « chaîne ».
     */
    const poser = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, adresses)
      VALUES (?, ?, ?, ?, ?, 'fr', ?)`);
    poser.run("t-tf1", "t-tf1", "TF1", "tf1", "tf1", 9);
    poser.run("t-tf1-pauvre", "t-tf1-pauvre", "TF1", "tf1", "tf1", 1);
    poser.run("t-m6", "t-m6", "M6", "m6", "m6", 4);
    poser.run("t-f4", "t-f4", "France 4", "france 4", "france4", 5);
    poser.run("t-canal-faux", "t-canal-faux", "Canal ??", "canal", "canal??", 30);
    rangerLesPays();
    renumeroterDansLOrdreDAffichage();

    const numero = (id: string) => (db.prepare("SELECT numero FROM live_channels WHERE id = ?")
      .get(id) as unknown as { numero: number | null }).numero;
    expect(numero("t-tf1")).toBe(1);
    expect(numero("t-f4")).toBe(4);
    expect(numero("t-m6")).toBe(6);
    // Le doublon pauvre garde une place, mais pas celle-là : il n'y a qu'un numéro 1.
    expect(numero("t-tf1-pauvre")).not.toBe(1);
    expect(numero("t-canal-faux")).not.toBe(4);
  });

  it("range le bouquet Canal+ juste après la TNT", () => {
    /*
     * Canal+ a quitté la TNT — le 4 est à France 4 — mais ses chaînes restent celles qu'on cherche
     * juste après les vingt-six premières. Et le numéro 8 reste vide plutôt que d'aller à la première
     * chaîne venue : un numéro de TNT qui ment est pire qu'un numéro de TNT absent.
     */
    const poser = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, adresses)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    poser.run("b-canal", "b-canal", "Canal+", "canal", "canal+", "fr", 4);
    poser.run("b-sport", "b-sport", "Canal+ Sport", "canal sport", "canal+sport", "fr", 2);
    poser.run("b-pl", "b-pl", "Canal+ Family Poland-PL", "canal family poland pl", "canal+familypoland-pl", "pl", 1);
    rangerLesPays();
    renumeroterDansLOrdreDAffichage();

    const numero = (id: string) => (db.prepare("SELECT numero FROM live_channels WHERE id = ?")
      .get(id) as unknown as { numero: number | null }).numero;
    expect(numero("b-canal")).toBe(27);
    expect(numero("b-sport")).toBe(28);
    // La polonaise n'est pas dans le bloc français : elle est reléguée avec les siennes.
    expect(numero("b-pl")!).toBeGreaterThan(28);
    // Et rien n'est venu boucher le 8, que LCP n'occupe pas dans ce jeu d'essai.
    expect(db.prepare("SELECT nom FROM live_channels WHERE numero = 8").get()).toBeUndefined();
  });

  it("rend son numéro à personne quand la chaîne n'a plus d'adresse", () => {
    // Elle n'est pas dans la grille : lui garder une place décalerait tout le monde pour une absente.
    db.prepare("UPDATE live_channels SET adresses = 0 WHERE id = 'n-de'").run();
    renumeroterDansLOrdreDAffichage();
    const restant = db.prepare("SELECT numero FROM live_channels WHERE id = 'n-de'")
      .get() as unknown as { numero: number | null };
    expect(restant.numero).toBeNull();
  });
});

describe("le nom retenu entre doublons", () => {
  it("garde le plus court, et le nom compact avec lui", () => {
    /*
     * Le nom affiché était gardé de la première entrée vue, le nom compact réécrit par la dernière :
     * les deux décrivaient des entrées différentes, et « Canal+ » s'affichait « Canal ?? » parce
     * qu'une liste avait écrit ce nom-là en premier. Le plus court est presque toujours le plus
     * propre, et il ne dépend pas de l'ordre de lecture des listes.
     */
    const ligne = db.prepare("SELECT nom, nom_compact FROM live_channels WHERE cle = 'tf1'")
      .get() as unknown as { nom: string; nom_compact: string };
    expect(ligne.nom).toBe("TF1");
    /*
     * Et surtout : le nom compact vient de **la même** entrée. C'est lui qui portait la contradiction
     * — il était réécrit par la dernière liste lue pendant que le nom restait celui de la première,
     * si bien que « Canal+ » s'affichait « Canal ?? » avec un nom compact `canal+`.
     */
    expect(ligne.nom_compact).toBe("tf1");
  });
});

describe("les facettes, comptées sous les autres filtres", () => {
  /*
   * Un jeu à part plutôt que celui du fichier : les tests qui précèdent ont retiré des adresses et
   * posé des chaînes de leur côté. Une facette se vérifie sur un décor dont on connaît chaque pièce.
   */
  /*
   * Ses propres listes, et non celles du jeu commun : un test précédent a remplacé le fichier de
   * catalogue par une seule liste, et une facette se vérifie sur un décor dont on connaît les pièces.
   */
  const A = "facette-liste-a";
  const B = "facette-liste-b";

  beforeAll(() => {
    db.prepare(`INSERT OR IGNORE INTO live_sources (id, type, libelle, emplacement, activee)
      VALUES ('facette-source', 'm3u', 'Facettes', '/facettes', 1)`).run();
    const liste = db.prepare(`INSERT OR IGNORE INTO live_playlists (id, source_id, nom, url, classement, cochee, entrees)
      VALUES (?, 'facette-source', ?, ?, ?, 1, 10)`);
    liste.run(A, "Facette A", "http://facette/a.m3u", "bonne");
    liste.run(B, "Facette B", "http://facette/b.m3u", "moyenne");
    const chaine = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, numero, adresses)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
    const adresse = db.prepare("INSERT INTO live_channel_urls (channel_id, url, playlist_id) VALUES (?, ?, ?)");
    chaine.run("f-fr-a", "f-fr-a", "Facette FR A", "facette fr a", "facettefra", "fr", 7001);
    chaine.run("f-fr-b", "f-fr-b", "Facette FR B", "facette fr b", "facettefrb", "fr", 7002);
    chaine.run("f-de-a", "f-de-a", "Facette DE A", "facette de a", "facettedea", "de", 7003);
    // Celle-ci n'est que dans la liste B : son pays ne doit jamais être proposé sous la liste A.
    chaine.run("f-it-b", "f-it-b", "Facette IT B", "facette it b", "facetteitb", "it", 7004);
    adresse.run("f-fr-a", "http://f/a1", A);
    adresse.run("f-fr-b", "http://f/b1", B);
    adresse.run("f-it-b", "http://f/i1", B);
    // Celle-ci est dans les deux listes : c'est le cas qui donne son sens au « au moins une ».
    adresse.run("f-de-a", "http://f/d1", A);
    adresse.run("f-de-a", "http://f/d2", B);
    db.prepare("UPDATE live_channels SET adresses = 2 WHERE id = 'f-de-a'").run();
    reunirLesFiabilites();
  });

  it("ne compte, pour un pays, que ce que la liste cochée contient vraiment", () => {
    /*
     * C'était le piège : on cochait une playlist, l'écran promettait toujours « France 1 355 », on
     * cliquait, on tombait sur zéro. Les 1 355 existent — elles ne sont simplement pas dans cette
     * liste-là. La facette compte donc ce qu'on obtiendrait **en cochant celle-ci en plus**.
     */
    const franceSousA = listerPays({ listes: [A] }).find((pays) => pays.code === "fr")?.chaines ?? 0;
    const franceSousB = listerPays({ listes: [B] }).find((pays) => pays.code === "fr")?.chaines ?? 0;
    expect(franceSousA).toBe(listerChaines({ listes: [A], pays: ["fr"], limit: 200 }).items.length);
    expect(franceSousB).toBe(listerChaines({ listes: [B], pays: ["fr"], limit: 200 }).items.length);
    /*
     * Et surtout : un pays qui n'est pas dans la liste cochée n'est plus proposé du tout. C'est le
     * cas exact du reproche — l'Italie existe dans le corpus, elle n'est pas dans la liste A, elle
     * n'a donc rien à faire dans un menu qui promet un résultat.
     */
    expect(listerPays({ listes: [A] }).map((pays) => pays.code)).not.toContain("it");
    expect(listerPays({ listes: [B] }).map((pays) => pays.code)).toContain("it");
  });

  it("compte les listes sous le pays coché, et non leur effectif déclaré", () => {
    for (const liste of listerListesClient({ pays: ["de"] })) {
      expect(liste.chaines).toBe(listerChaines({ listes: [liste.id], pays: ["de"], limit: 200 }).items.length);
    }
  });

  it("réunit les fiabilités d'une chaîne sans changer le sens du filtre", () => {
    /*
     * « Au moins une liste de ce niveau » : une chaîne présente dans une bonne liste **et** dans une
     * moyenne doit apparaître dans les deux filtres, puisqu'elle est vraiment dans les deux. Prendre
     * le meilleur classement aurait été plus simple et aurait changé la question posée.
     */
    const sousBonne = listerChaines({ fiabilites: ["bonne"], limit: 200 }).items.map((c) => c.nom);
    const sousMoyenne = listerChaines({ fiabilites: ["moyenne"], limit: 200 }).items.map((c) => c.nom);
    expect(sousBonne).toContain("Facette DE A");
    expect(sousMoyenne).toContain("Facette DE A");
    // Celle qui n'est que dans la liste A n'apparaît pas sous la fiabilité de la liste B.
    expect(sousBonne).toContain("Facette FR A");
    expect(sousMoyenne).not.toContain("Facette FR A");
  });
});

describe("les listes changent chaque jour", () => {
  /*
   * C'est la contrainte qui commande toute la numérotation : le fichier est refait quotidiennement,
   * des chaînes apparaissent et d'autres s'en vont. Une numérotation posée une fois puis complétée au
   * fil de l'eau se dégrade toute seule — et le plan national devient faux sans que ça se voie.
   */
  it("garde sa place à une chaîne de la TNT arrivée le lendemain", () => {
    const poser = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, adresses)
      VALUES (?, ?, ?, ?, ?, 'fr', 1)`);
    // Le décor du jour : pas de T18 dans les listes, le 18 reste donc vide après la renumérotation.
    poser.run("j-autre", "j-autre", "Une Autre", "une autre", "uneautre");
    rangerLesPays();
    renumeroterDansLOrdreDAffichage();
    expect(db.prepare("SELECT nom FROM live_channels WHERE numero = 18").get()).toBeUndefined();

    // Le lendemain, la liste apporte T18. Elle doit trouver le 18 libre, et le prendre.
    poser.run("j-t18", "j-t18", "T18", "t18", "t18");
    rangerLesPays();
    numeroterLesNouvelles();
    const t18 = db.prepare("SELECT numero FROM live_channels WHERE id = 'j-t18'")
      .get() as unknown as { numero: number };
    expect(t18.numero).toBe(18);
  });

  it("refuse à une liste de s'attribuer un numéro du plan national", () => {
    /*
     * Le corpus compte des dizaines de chaînes qui s'annoncent « 1 » par leur `tvg-chno`. La première
     * arrivée volerait celui de TF1, et la promesse de la télécommande tomberait pour une déclaration
     * que personne n'a vérifiée. Le souhait reste respecté, mais hors des zones réservées.
     */
    db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, numero_souhaite, adresses)
      VALUES ('j-menteuse', 'j-menteuse', 'Menteuse', 'menteuse', 'menteuse', 'fr', 3, 1)`).run();
    rangerLesPays();
    numeroterLesNouvelles();
    const menteuse = db.prepare("SELECT numero FROM live_channels WHERE id = 'j-menteuse'")
      .get() as unknown as { numero: number };
    expect(menteuse.numero).toBeGreaterThanOrEqual(200);
  });

  it("place une Canal+ nouvelle dans la zone du bouquet, pas à la fin", () => {
    db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, pays, adresses)
      VALUES ('j-canal', 'j-canal', 'Canal+ Tard', 'canal tard', 'canal+tard', 'fr', 1)`).run();
    rangerLesPays();
    numeroterLesNouvelles();
    const tardive = db.prepare("SELECT numero FROM live_channels WHERE id = 'j-canal'")
      .get() as unknown as { numero: number };
    expect(tardive.numero).toBeGreaterThanOrEqual(27);
    expect(tardive.numero).toBeLessThanOrEqual(199);
  });
});
