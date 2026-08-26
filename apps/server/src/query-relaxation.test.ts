import { describe, expect, it, vi } from "vitest";
import { elisionsRestaurees, relaxationQueries, sansArticleInitial, searchWithRelaxation, sigleRestaure } from "./query-relaxation.js";
import { MATCH_THRESHOLDS } from "./match-engine.js";

/**
 * Élargissement progressif des requêtes de métadonnées.
 *
 * Les cas éprouvés ici viennent d'une médiathèque réelle de 1 449 films : 42 fiches restaient sans
 * correspondance alors que le calcul de score les acceptait dès qu'on lui présentait la bonne
 * candidate. Le défaut n'était donc pas dans l'analyse du nom ni dans le score, mais dans la requête
 * envoyée — une seule, sans repli.
 */

describe("élisions perdues par le nom de fichier", () => {
  it("recolle l'apostrophe que le point a effacée", () => {
    // Cas signalé sur la médiathèque réelle : le film restait sans jaquette. Le fournisseur cherchait
    // un titre commençant par le mot « C », qui n'existe pas.
    expect(elisionsRestaurees("C est arrive pres de chez vous")).toBe("C'est arrive pres de chez vous");
    expect(elisionsRestaurees("L auberge espagnole")).toBe("L'auberge espagnole");
    expect(elisionsRestaurees("J ai perdu mon corps")).toBe("J'ai perdu mon corps");
  });

  it("recolle plusieurs élisions dans le même titre", () => {
    expect(elisionsRestaurees("Qu est ce qu on a fait au bon Dieu"))
      .toBe("Qu'est ce qu'on a fait au bon Dieu");
  });

  it("laisse tranquille un titre sans élision", () => {
    // Rendre `null` plutôt que le titre inchangé évite une requête en double au fournisseur.
    expect(elisionsRestaurees("Camping 3")).toBeNull();
    expect(elisionsRestaurees("Ant-Man et la Guepe")).toBeNull();
  });

  it("ne colle pas une lettre qui n'est pas une élision française", () => {
    // « I Am Legend », « A Star Is Born » : la lettre y est un mot entier. Les recoller inventerait
    // des titres qui n'existent pas et ferait perdre des correspondances anglaises.
    expect(elisionsRestaurees("I Am Legend")).toBeNull();
    expect(elisionsRestaurees("A Star Is Born")).toBeNull();
  });

  it("laisse intactes les initiales, qui ne sont pas des élisions", () => {
    // Ces treize titres viennent de la médiathèque réelle, et sont les *seuls* que la première
    // version de la règle transformait — treize abîmés, zéro réparé. Une élision précède un mot
    // ordinaire ; une initiale précède un nom propre. La majuscule les sépare.
    for (const titre of ["J Edgar", "M Butterfly", "M Popper et ses pingouins", "R A I D Special Unit",
      "Still Michae J For Movie", "E T l Extraterrestre", "Ghost in the Shell S A C - Solid State Society"]) {
      expect(elisionsRestaurees(titre), titre).toBeNull();
    }
  });

  it("ne redouble pas l'apostrophe d'un possessif anglais", () => {
    // « Ocean's Twelve » devenait « Ocean's'Twelve » : le « s » y appartient au possessif et n'attend
    // aucune seconde apostrophe.
    for (const titre of ["Ocean's Twelve", "Ocean's Eleven", "Pirates of the Caribbean - Dead Man's Chest",
      "Kaiju No 8 Hoshina's Day Off"]) {
      expect(elisionsRestaurees(titre), titre).toBeNull();
    }
  });

  it("propose la variante élidée juste après le titre brut", () => {
    // L'ordre compte : les tentatives suivantes tronquent le titre, donc perdent de l'information.
    // La variante élidée n'en perd aucune et doit passer avant.
    const tentatives = relaxationQueries("C est arrive pres de chez vous");
    expect(tentatives[0]).toBe("C est arrive pres de chez vous");
    expect(tentatives[1]).toBe("C'est arrive pres de chez vous");
  });
});


describe("sigles éparpillés par le nom de fichier", () => {
  it("recolle un sigle dont les points sont devenus des espaces", () => {
    // Relevé sur la médiathèque réelle : « R.A.I.D. Special Unit » était apparié à un film
    // intitulé « R ». Le fournisseur n'y voyait plus un sigle mais cinq mots d'une lettre.
    expect(sigleRestaure("R A I D Special Unit")).toBe("R.A.I.D. Special Unit");
    expect(sigleRestaure("S W A T")).toBe("S.W.A.T.");
    expect(sigleRestaure("E T l Extraterrestre")).toBe("E.T. l Extraterrestre");
  });

  it("laisse tranquille un titre sans lettres isolées consécutives", () => {
    // Une seule lettre isolée ne fait pas un sigle : « Numéro 9 », « Rambo 3 », « M Butterfly ».
    expect(sigleRestaure("Camping 3")).toBeNull();
    expect(sigleRestaure("M Butterfly")).toBeNull();
    expect(sigleRestaure("Ocean's Twelve")).toBeNull();
  });

  it("propose la variante sigle au fournisseur", () => {
    expect(relaxationQueries("R A I D Special Unit")).toContain("R.A.I.D. Special Unit");
  });
});

describe("requêtes successives", () => {
  it("commence toujours par le titre tel quel", () => {
    // Ne rien changer pour les fiches qui fonctionnent déjà est la première exigence.
    expect(relaxationQueries("Destination Finale I")[0]).toBe("Destination Finale I");
  });

  it("propose le titre sans article initial quand TMDB l'exige", () => {
    expect(sansArticleInitial("The Avengers EndGame")).toBe("Avengers EndGame");
    expect(relaxationQueries("The Avengers EndGame")).toContain("Avengers EndGame");
    expect(sansArticleInitial("Iron Man 3")).toBeNull();
  });

  it("retire les chiffres romains que le fournisseur n'emploie pas", () => {
    // « Destination Finale I » ne ramenait rien ; « Destination Finale » ramène le bon film à 1,000.
    expect(relaxationQueries("Destination Finale I")).toContain("Destination Finale");
  });

  it("retire les mentions techniques restées dans le titre", () => {
    const essais = relaxationQueries("Ant-Man et la Guepe MULTI 1080p");
    expect(essais).toContain("Ant-Man et la Guepe");
  });

  it("raccourcit par la droite, là où se trouvent les ajouts", () => {
    // « L'Empire du Soleil Steven Spielberg » ne ramenait rien ; sans le nom du réalisateur, 0,959.
    expect(relaxationQueries("L'Empire du Soleil Steven Spielberg", 6)).toContain("L'Empire du Soleil");
  });

  it("descend jusqu'à un seul mot", () => {
    // C'est le seul moyen de rattraper une faute de frappe en fin de titre : « Asterix et Cleoptre »
    // ne ramène rien, « Asterix » ramène « Astérix et Cléopâtre » à 0,959.
    expect(relaxationQueries("Asterix et Cleoptre", 6)).toContain("Asterix");
  });

  it("ne propose jamais deux fois la même requête", () => {
    const essais = relaxationQueries("Destination Finale I", 8);
    expect(new Set(essais.map((e) => e.toLowerCase())).size).toBe(essais.length);
  });

  it("borne le nombre de tentatives", () => {
    // Chaque tentative est un appel réseau. Sur 1 449 films, une borne lâche multiplierait la charge
    // du fournisseur — ce qui est précisément ce qu'on cherche à éviter pendant une analyse complète.
    expect(relaxationQueries("Un Titre Vraiment Tres Long Avec Beaucoup De Mots", 3)).toHaveLength(3);
  });

  it("rend une liste vide pour un titre vide", () => {
    expect(relaxationQueries("   ")).toEqual([]);
  });
});

describe("arrêt dès qu'une candidate convient", () => {
  interface Candidate { score: number }
  const candidate = (score: number): Candidate => ({ score });

  it("n'élargit pas quand la première requête suffit", async () => {
    const chercher = vi.fn().mockResolvedValue([candidate(0.95)]);
    const { tentatives, query } = await searchWithRelaxation("Le Bon Titre", chercher,
      (r: Candidate[]) => r.some((c) => c.score >= MATCH_THRESHOLDS.review));
    expect(tentatives).toBe(1);
    expect(query).toBe("Le Bon Titre");
    expect(chercher).toHaveBeenCalledTimes(1);
  });

  it("élargit jusqu'à trouver, puis s'arrête", async () => {
    const chercher = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(0.9)])
      .mockResolvedValue([candidate(1)]);
    const { tentatives, resultats } = await searchWithRelaxation("Destination Finale I", chercher,
      (r: Candidate[]) => r.some((c) => c.score >= MATCH_THRESHOLDS.review));
    expect(tentatives).toBe(2);
    expect(resultats).toHaveLength(1);
    // La troisième requête n'a pas lieu : chaque tentative évitée est un appel de moins.
    expect(chercher).toHaveBeenCalledTimes(2);
  });

  it("rend la liste la plus fournie quand rien n'atteint le seuil", async () => {
    // Une fiche « à revoir » vaut mieux qu'une fiche sans correspondance : elle apparaît dans l'écran
    // de correction, où la personne tranche. Rendre les mains vides la ferait disparaître.
    const chercher = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate(0.3), candidate(0.2)])
      .mockResolvedValue([candidate(0.25)]);
    const { resultats } = await searchWithRelaxation("Titre Introuvable Ailleurs", chercher, () => false);
    expect(resultats).toHaveLength(2);
  });

  it("n'accepte pas une candidate notée sur la requête raccourcie", async () => {
    // Le défaut trouvé sur une médiathèque réelle : « Camping 3 » élargi en « Camping » retenait
    // « Julien Courbet fait son show au camping ! » à 0,899, donc en automatique, parce que ce titre
    // contient le mot « camping ». Noté contre le titre entier, il tombe à 0,370.
    //
    // La recherche peut être élargie ; le jugement, jamais. Ce test décrit ce contrat : ce que le
    // prédicat reçoit doit déjà être noté sur le titre complet.
    const brutes = [{ score: 0.899, note: "notee sur le fragment" }];
    const surTitreComplet = (r: typeof brutes) => r.map((c) => ({ ...c, score: 0.37 }));
    const chercher = vi.fn().mockImplementation(async () => surTitreComplet(brutes));

    const { resultats } = await searchWithRelaxation("Camping 3", chercher,
      (r: Array<{ score: number }>) => r.some((c) => c.score >= MATCH_THRESHOLDS.automatic));

    expect(resultats[0]?.score, "la note doit être celle du titre entier").toBe(0.37);
    expect(resultats[0]?.score).toBeLessThan(MATCH_THRESHOLDS.automatic);
  });

  it("ne rappelle pas le fournisseur pour une requête déjà tentée", async () => {
    const chercher = vi.fn().mockResolvedValue([]);
    await searchWithRelaxation("Solo", chercher, () => false);
    const envoyees = chercher.mock.calls.map((appel) => String(appel[0]).toLowerCase());
    expect(new Set(envoyees).size).toBe(envoyees.length);
  });
});
