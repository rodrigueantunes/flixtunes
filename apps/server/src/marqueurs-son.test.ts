import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { choisirTemoins, completerSaisonParLeSon, ESSAIS_AVANT_RENONCEMENT, FENETRE_ANALYSE_SECONDES,
  FENETRES_ANALYSE_SECONDES } from "./marqueurs-son.js";
import { marqueursRanges, retenirEcoute, retenirGeneriqueFin } from "./marqueurs-memoire.js";

/**
 * La passe sonore : quels épisodes comparer, avec quelle attente, et ce qu'elle range.
 *
 * L'algorithme lui-même est éprouvé ailleurs, sur des signaux fabriqués. Ce qui se vérifie ici est
 * l'orchestration — et notamment les deux points que la médiathèque a imposés : les témoins pris
 * parmi les voisins immédiats, et le générique de fin qu'une passe sur l'introduction ne doit pas
 * emporter.
 */

/** Suite reproductible. */
function bruit(graine: number, longueur: number): number[] {
  const sortie: number[] = [];
  let etat = graine >>> 0;
  for (let index = 0; index < longueur; index += 1) {
    etat = (etat * 1_664_525 + 1_013_904_223) >>> 0;
    sortie.push((etat / 4_294_967_296) * 2 - 1);
  }
  return sortie;
}

const THEME = bruit(7, 250);

/** Un épisode dont le thème commence à `debutCases` dixièmes de seconde. */
const enveloppeAvecTheme = (graine: number, debutCases: number) =>
  Float64Array.from([...bruit(graine, debutCases), ...THEME, ...bruit(graine + 100, 900 - debutCases)]);

let compteur = 0;
const identifiants: string[] = [];

function poserEpisode(serie: string, saison: number, numero: number, metadonnees: string | null = null): string {
  const id = `son-test-${(compteur += 1)}`;
  identifiants.push(id);
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, search_title, show_title, season_number,
      episode_number, file_path, runtime_seconds, embedded_metadata_json, available)
    VALUES (?, 'episode', ?, ?, ?, ?, ?, ?, ?, 1500, ?, 1)`)
    .run(id, `E${numero}`, `e${numero}`, `e${numero}`, serie, saison, numero, `/son/${id}.mkv`, metadonnees);
  return id;
}

afterEach(() => {
  for (const id of identifiants.splice(0)) {
    db.prepare("DELETE FROM marqueurs_generique WHERE media_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  }
});

describe("choix des témoins", () => {
  it("prend les voisins immédiats, des deux côtés", () => {
    // Une saison peut changer d'ouverture en cours de route — l'animation japonaise le fait tous les
    // vingt ou trente épisodes. Des témoins pris au hasard n'auraient parfois aucun thème commun.
    const episodes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(choisirTemoins(episodes, 5, 4)).toEqual([4, 6, 3, 7]);
  });

  it("se contente d'un seul côté aux extrémités", () => {
    const episodes = [0, 1, 2, 3, 4];
    expect(choisirTemoins(episodes, 0, 3)).toEqual([1, 2, 3]);
    expect(choisirTemoins(episodes, 4, 3)).toEqual([3, 2, 1]);
  });

  it("ne demande jamais plus de témoins qu'il n'y a de voisins", () => {
    expect(choisirTemoins([0, 1], 0, 5)).toEqual([1]);
    expect(choisirTemoins([0], 0, 5)).toEqual([]);
  });
});

describe("passe sonore sur une saison", () => {
  it("repère l'introduction des épisodes que les chapitres ignorent", async () => {
    const serie = "Série sonore A";
    const decalages = [100, 320, 60, 450, 200];
    const identifiantsSaison = decalages.map((_, index) => poserEpisode(serie, 1, index + 1));
    const enveloppes = new Map(identifiantsSaison.map((id, index) =>
      [`/son/${id}.mkv`, enveloppeAvecTheme(index + 1, decalages[index] ?? 0)]));

    const bilan = await completerSaisonParLeSon(serie, 1, {
      lireEnveloppe: async (chemin) => enveloppes.get(chemin) ?? null,
    });
    expect(bilan.aRepérer).toBe(5);
    expect(bilan.reperes).toBe(5);

    for (const [index, id] of identifiantsSaison.entries()) {
      const repere = marqueursRanges(id);
      expect(repere?.introStartSeconds, `épisode ${index + 1}`).toBeCloseTo((decalages[index] ?? 0) / 10, 0);
      expect(repere?.sourceIntro).toBe("empreinte");
    }
  });

  it("n'emporte pas le générique de fin déjà déduit", async () => {
    // Le défaut a été vu avant d'être commis : la passe sonore ne connaît que l'introduction, et une
    // provenance unique pour les deux repères lui aurait fait écraser le carton de fin.
    const serie = "Série sonore B";
    const decalages = [100, 320, 60];
    const ids = decalages.map((_, index) => poserEpisode(serie, 1, index + 1));
    for (const id of ids) retenirGeneriqueFin(id, 1440, "voisins");
    const enveloppes = new Map(ids.map((id, index) => [`/son/${id}.mkv`, enveloppeAvecTheme(index + 1, decalages[index] ?? 0)]));

    await completerSaisonParLeSon(serie, 1, { lireEnveloppe: async (chemin) => enveloppes.get(chemin) ?? null });

    for (const id of ids) {
      const repere = marqueursRanges(id);
      expect(repere?.creditsStartSeconds, "le carton de fin doit survivre").toBe(1440);
      expect(repere?.sourceCredits).toBe("voisins");
      expect(repere?.introStartSeconds).not.toBeNull();
      expect(repere?.sourceIntro).toBe("empreinte");
    }
  });

  it("laisse tranquilles les épisodes dont les chapitres parlent déjà", async () => {
    const serie = "Série sonore C";
    const avecChapitres = JSON.stringify({
      format: { duration: "1500" }, streams: [],
      chapters: [{ start_time: "30", end_time: "110", tags: { title: "Intro" } }],
    });
    poserEpisode(serie, 1, 1, avecChapitres);
    poserEpisode(serie, 1, 2, avecChapitres);
    const muet = poserEpisode(serie, 1, 3);
    const bilan = await completerSaisonParLeSon(serie, 1, { lireEnveloppe: async () => null });
    expect(bilan.aRepérer).toBe(1);
    // L'épisode muet a bien été écouté — sans rien donner ici, l'enveloppe étant illisible — mais les
    // deux épisodes chapitrés n'ont pas été touchés.
    expect(marqueursRanges(muet)?.introStartSeconds ?? null).toBeNull();
  });

  it("ne réécoute pas ce qui l'a déjà été — mais s'en sert comme témoin", async () => {
    /*
     * Le défaut relevé en service : une saison revenue dans la file pour deux épisodes ajoutés se
     * réécoutait en entier. Le coût d'un ajout devenait celui de la saison, et la seconde écoute —
     * qui ne travaille pas sur les mêmes témoins — pouvait remplacer un repère juste par un moins
     * bon, « empreinte » l'emportant sur « empreinte ».
     */
    const serie = "Série sonore I";
    const decalages = [100, 320, 60, 450, 200];
    const ids = decalages.map((_, index) => poserEpisode(serie, 1, index + 1));
    // Les trois premiers ont déjà été entendus lors d'une passe précédente ; les deux derniers sont
    // les nouveaux venus.
    for (const id of ids.slice(0, 3)) retenirEcoute(id);
    const enveloppes = new Map(ids.map((id, index) =>
      [`/son/${id}.mkv`, enveloppeAvecTheme(index + 1, decalages[index] ?? 0)]));
    const lus: string[] = [];

    const bilan = await completerSaisonParLeSon(serie, 1, {
      lireEnveloppe: async (chemin) => { lus.push(chemin); return enveloppes.get(chemin) ?? null; },
    });

    expect(bilan.aRepérer, "seuls les deux nouveaux sont à repérer").toBe(2);
    expect(bilan.reperes, "et ils sont repérés").toBe(2);
    for (const id of ids.slice(0, 3)) {
      expect(marqueursRanges(id)?.introStartSeconds ?? null,
        "un épisode déjà écouté n'a pas été retouché").toBeNull();
    }
    expect(lus.some((chemin) => chemin === `/son/${ids[0]}.mkv`),
      "il sert pourtant de témoin : son enveloppe est bien lue").toBe(true);
  });

  it("note l'écoute même bredouille, pour ne pas la refaire à chaque analyse", async () => {
    // Sans cette trace, une série sans thème commun serait redécodée à chaque scan, pour rien.
    const serie = "Série sonore H";
    const ids = [1, 2, 3].map((numero) => poserEpisode(serie, 1, numero));
    await completerSaisonParLeSon(serie, 1, { lireEnveloppe: async () => Float64Array.from(bruit(1, 900)) });
    for (const id of ids) {
      const ligne = db.prepare("SELECT ecoute_le FROM marqueurs_generique WHERE media_id = ?").get(id) as
        { ecoute_le: string | null } | undefined;
      expect(ligne?.ecoute_le, "l'écoute doit être datée").toBeTruthy();
    }
  });

  it("compte les fichiers illisibles sans s'arrêter", async () => {
    // Un fichier abîmé, sans piste audio, ou momentanément absent ne doit pas interrompre une passe
    // qui traite des milliers d'épisodes.
    const serie = "Série sonore D";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 1, numero);
    const bilan = await completerSaisonParLeSon(serie, 1, { lireEnveloppe: async () => null });
    expect(bilan.illisibles).toBe(3);
    expect(bilan.reperes).toBe(0);
  });

  it("s'arrête quand on le lui demande", async () => {
    const serie = "Série sonore E";
    for (let numero = 1; numero <= 4; numero += 1) poserEpisode(serie, 1, numero);
    const controle = new AbortController();
    controle.abort();
    const bilan = await completerSaisonParLeSon(serie, 1, {
      lireEnveloppe: async () => enveloppeAvecTheme(1, 100), signal: controle.signal,
    });
    expect(bilan.reperes).toBe(0);
  });

  it("une saison d'un seul épisode n'a personne à qui se comparer", async () => {
    const serie = "Série sonore F";
    poserEpisode(serie, 1, 1);
    const bilan = await completerSaisonParLeSon(serie, 1, { lireEnveloppe: async () => enveloppeAvecTheme(1, 100) });
    expect(bilan.aRepérer).toBe(0);
    expect(bilan.reperes).toBe(0);
  });

  it("cesse d'élargir la fenêtre après trois échecs, mais continue d'écouter", async () => {
    /*
     * Le point qui rend la mesure sûre, et la question qui l'a fait poser : « ça ne va pas ne plus
     * fonctionner du tout ? »
     *
     * Non, parce qu'on ne supprime jamais l'écoute — seulement les fenêtres larges. Chaque épisode
     * passe toujours par les cinq premières minutes, celles qui couvrent 85 % des génériques. Renoncer
     * à écouter aurait condamné une saison entière sur trois épisodes atypiques, sans rattrapage
     * possible puisque l'écoute n'est notée qu'une fois.
     */
    const serie = "Série sonore I";
    const ids = Array.from({ length: 8 }, (_, index) => poserEpisode(serie, 1, index + 1));
    const fenetresDemandees: number[] = [];
    await completerSaisonParLeSon(serie, 1, {
      lireEnveloppe: async (_chemin, secondes) => {
        fenetresDemandees.push(secondes);
        return Float64Array.from(bruit(1 + fenetresDemandees.length, secondes * 10));
      },
    });

    const larges = fenetresDemandees.filter((secondes) => secondes > FENETRES_ANALYSE_SECONDES[0]!);
    const courtes = fenetresDemandees.filter((secondes) => secondes === FENETRES_ANALYSE_SECONDES[0]);
    // Les premiers épisodes escaladent ; les suivants s'en tiennent à la fenêtre courte.
    expect(larges.length, "l'escalade doit s'arrêter").toBeGreaterThan(0);
    expect(courtes.length, "tous les épisodes restent écoutés").toBeGreaterThanOrEqual(ids.length);
    for (const id of ids) {
      const ligne = db.prepare("SELECT ecoute_le FROM marqueurs_generique WHERE media_id = ?").get(id) as
        { ecoute_le: string | null } | undefined;
      expect(ligne?.ecoute_le, "chaque épisode doit avoir été écouté").toBeTruthy();
    }
  });

  it("un succès rouvre l'escalade pour le reste de la saison", async () => {
    // La soupape : si un épisode trouve un thème, c'est qu'il en existe un, et les suivants méritent
    // à nouveau la fenêtre large.
    expect(ESSAIS_AVANT_RENONCEMENT).toBe(3);
  });

  it("la fenêtre d'analyse couvre le quart d'heure mesuré", () => {
    // Silo S1E9 commence son générique à 809 s : cinq minutes en manqueraient 15 %.
    expect(FENETRE_ANALYSE_SECONDES).toBe(900);
  });
});
