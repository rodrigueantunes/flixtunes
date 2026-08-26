import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { activerLesGeneriques, completerLesGeneriques, etatDesGeneriques } from "./marqueurs-passe.js";
import { marqueursRanges } from "./marqueurs-memoire.js";

/**
 * L'enchaînement des trois sources, et ce qu'il refuse de faire.
 *
 * Le point qui compte n'est pas qu'elles marchent — chacune a ses propres cas — mais qu'elles se
 * succèdent dans le bon ordre et que la plus coûteuse ne travaille que sur ce qui reste. Une passe
 * sonore qui réécouterait une médiathèque entière à chaque analyse serait pire que pas de passe du
 * tout : deux à trois secondes de décodage par épisode, répétées indéfiniment.
 */

const chapitres = (intro: [number, number] | null, credits: number | null, duree = 1500) => JSON.stringify({
  format: { duration: String(duree) },
  streams: [{ index: 0, codec_type: "video", codec_name: "h264" }],
  chapters: [
    ...(intro ? [{ start_time: String(intro[0]), end_time: String(intro[1]), tags: { title: "Intro" } }] : []),
    ...(credits != null ? [{ start_time: String(credits), end_time: String(duree), tags: { title: "End Credits" } }] : []),
  ],
});

let compteur = 0;
const identifiants: string[] = [];

function poserEpisode(serie: string, numero: number, metadonnees: string | null = null): string {
  const id = `passe-test-${(compteur += 1)}`;
  identifiants.push(id);
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, search_title, show_title, season_number,
      episode_number, file_path, runtime_seconds, embedded_metadata_json, available)
    VALUES (?, 'episode', ?, ?, ?, ?, 1, ?, ?, 1500, ?, 1)`)
    .run(id, `E${numero}`, `e${numero}`, `e${numero}`, serie, numero, `/passe/${id}.mkv`, metadonnees);
  return id;
}

// Le repérage est éteint tant qu'on ne l'a pas demandé : ces cas l'allument, comme le fait l'écran.
beforeEach(() => { activerLesGeneriques(true); });

afterEach(() => {
  activerLesGeneriques(false);
  for (const id of identifiants.splice(0)) {
    db.prepare("DELETE FROM marqueurs_generique WHERE media_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  }
});

describe("enchaînement des sources de repères", () => {
  it("les voisins travaillent sans qu'on écoute quoi que ce soit", async () => {
    const serie = "Passe témoin A";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero, chapitres([30, 110], 1440));
    const muet = poserEpisode(serie, 4);

    const bilan = await completerLesGeneriques({ ecouter: false });
    expect(bilan.parVoisins).toBeGreaterThanOrEqual(1);
    expect(bilan.saisonsEcoutees).toBe(0);
    expect(marqueursRanges(muet)?.creditsStartSeconds).toBe(1440);
    expect(marqueursRanges(muet)?.sourceIntro).toBe("voisins");
  });

  it("laisse la place aux lectures entre deux saisons", async () => {
    // La passe décode ; sur un Celeron à quatre cœurs, elle doit s'effacer devant une lecture en
    // cours, exactement comme l'analyse de bibliothèque le fait déjà.
    const serie = "Passe témoin B";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero);
    let creneauxDemandes = 0;
    await completerLesGeneriques({ attendreCreneau: async () => { creneauxDemandes += 1; } });
    expect(creneauxDemandes).toBeGreaterThanOrEqual(1);
  });

  it("n'écoute pas deux fois la même saison", async () => {
    // Une série sans thème commun n'en aura pas davantage au prochain scan. Sans cette garantie, la
    // passe redécoderait les mêmes fichiers à chaque analyse, pour rien.
    const serie = "Passe témoin C";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero);

    const premiere = await completerLesGeneriques({});
    expect(premiere.saisonsEcoutees).toBeGreaterThanOrEqual(1);

    const seconde = await completerLesGeneriques({});
    expect(seconde.saisonsEcoutees, "la seconde passe ne doit rien réécouter").toBe(0);
  });

  it("une saison entièrement chapitrée quitte la file au lieu d'y revenir sans fin", async () => {
    /*
     * Le défaut mesuré en r75 : les repères de chapitre ne se rangeant pas en base, et la file ne
     * consultant que la base, une saison dont tous les épisodes portent leurs propres chapitres y
     * restait indéfiniment. Elle y revenait à chaque analyse pour n'y rien faire, et surtout elle
     * interdisait au compteur d'avancement d'atteindre son terme — 44 % des épisodes sont chapitrés.
     */
    const serie = "Passe témoin K";
    const ids = [1, 2, 3, 4].map((numero) => poserEpisode(serie, numero, chapitres([30, 110], 1440)));
    // Mesuré une fois les épisodes posés : la saison est alors dans la file, et doit en sortir.
    const avant = etatDesGeneriques();
    expect(avant.saisonsTotal - avant.saisonsFaites, "elle y est bien entrée").toBeGreaterThan(0);

    await completerLesGeneriques({});

    const apres = etatDesGeneriques();
    expect(apres.saisonsTotal - apres.saisonsFaites,
      "la saison a quitté la file").toBe(avant.saisonsTotal - avant.saisonsFaites - 1);
    for (const id of ids) {
      expect(marqueursRanges(id)?.sourceIntro,
        "le repère du fichier est recopié, avec sa provenance").toBe("chapitre");
    }
  });

  it("éteint, rien n'est écouté — mais les voisins travaillent toujours", async () => {
    // L'interrupteur ne coupe que ce qui coûte. Les deux premières sources ne lisent aucun fichier ;
    // les priver n'économiserait rien et ferait perdre des repères déjà acquis.
    const serie = "Passe témoin G";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero, chapitres([30, 110], 1440));
    const muet = poserEpisode(serie, 4);
    activerLesGeneriques(false);

    const bilan = await completerLesGeneriques({});

    expect(bilan.saisonsEcoutees, "aucune saison écoutée").toBe(0);
    expect(bilan.parVoisins, "les voisins ont quand même déduit").toBeGreaterThan(0);
    expect(marqueursRanges(muet)?.creditsStartSeconds, "le repère déduit est bien posé").toBeCloseTo(1440, 0);
    expect(etatDesGeneriques().actif).toBe(false);
  });

  it("éteindre pendant une passe l'arrête au lieu d'attendre la fin", async () => {
    /*
     * Le seul comportement cohérent avec la raison qu'on a d'éteindre : on veut sa machine
     * maintenant, pas dans quatre cents saisons. La passe ne redemande donc pas de créneau.
     */
    for (const serie of ["Passe témoin H", "Passe témoin I", "Passe témoin J"]) {
      for (let numero = 1; numero <= 2; numero += 1) poserEpisode(serie, numero);
    }
    let creneaux = 0;

    await completerLesGeneriques({
      attendreCreneau: async () => { creneaux += 1; activerLesGeneriques(false); },
    });

    expect(creneaux, "elle s'est arrêtée après la première saison, pas après la troisième").toBe(1);
    expect(etatDesGeneriques().enCours, "et elle a bien rendu la main").toBe(false);
  });

  it("l'activation survit au redémarrage : elle se lit en base", () => {
    activerLesGeneriques(true);
    expect(etatDesGeneriques().actif).toBe(true);
    activerLesGeneriques(false);
    expect(etatDesGeneriques().actif, "l'état vient de la base, pas d'une variable").toBe(false);
  });

  it("distingue l'avancement du travail de celui de la passe", async () => {
    // Deux questions différentes : « où en est-on » et « est-ce que ça avance en ce moment ». Hors
    // passe, le total reste renseigné et le détail de la passe disparaît.
    const serie = "Passe témoin F";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero);
    await completerLesGeneriques({});
    const etat = etatDesGeneriques();
    expect(etat.enCours).toBe(false);
    expect(etat.passe, "aucune passe en cours").toBeNull();
    expect(etat.saisonsTotal, "le total reste connu").toBeGreaterThan(0);
  });

  it("l'avancement survit à un redémarrage : il se lit en base", async () => {
    /*
     * Le défaut qui a motivé r74, et la question qui l'a révélé : « t'es sûr que ça ne reprend pas
     * de zéro ? »
     *
     * Le compteur vivait en mémoire et repartait à zéro à chaque démarrage du service. Après une nuit
     * de travail et quarante-trois saisons acquises, l'écran annonçait « 0 saison sur 434 » : le
     * travail était intact, la présentation mentait. Ce cas vérifie que le chiffre affiché ne dépend
     * plus d'une passe en cours.
     */
    const serie = "Passe témoin E";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero);

    const avant = etatDesGeneriques();
    expect(avant.enCours, "hors passe").toBe(false);
    expect(avant.saisonsTotal, "la saison compte dans le total").toBeGreaterThan(0);

    await completerLesGeneriques({});

    // Hors passe, et pourtant l'avancement est là : c'est le travail qu'on affiche, pas l'exécution.
    const apres = etatDesGeneriques();
    expect(apres.enCours).toBe(false);
    expect(apres.episodesEcoutes, "les écoutes sont comptées en base").toBeGreaterThanOrEqual(3);
    expect(apres.saisonsFaites, "la saison traitée sort de la file").toBeGreaterThan(avant.saisonsFaites);
  });

  it("s'arrête quand l'analyse est annulée", async () => {
    const serie = "Passe témoin D";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, numero);
    const controle = new AbortController();
    controle.abort();
    const bilan = await completerLesGeneriques({ signal: controle.signal });
    expect(bilan.saisonsEcoutees).toBe(0);
  });
});
