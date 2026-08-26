import { afterEach, describe, expect, it } from "vitest";
import { db } from "./database.js";
import { completerSaison, marqueursDeduits } from "./marqueurs-saison.js";

/**
 * La passe qui complète une saison, sur une vraie base.
 *
 * Ces cas-ci écrivent en base parce que c'est là que le raisonnement se joue : quels épisodes servent
 * de témoins, lesquels sont complétés, et ce qui se passe quand la saison est trop maigre pour se
 * suffire. Deux questions posées pendant la conception ont chacune leur cas — la saison d'un seul
 * épisode, et l'épisode ajouté après coup.
 */

const chapitres = (intro: [number, number] | null, credits: number | null, duree: number) => JSON.stringify({
  format: { duration: String(duree) },
  streams: [{ index: 0, codec_type: "video", codec_name: "h264" }],
  chapters: [
    ...(intro ? [{ start_time: String(intro[0]), end_time: String(intro[1]), tags: { title: "Intro" } }] : []),
    ...(credits != null ? [{ start_time: String(credits), end_time: String(duree), tags: { title: "End Credits" } }] : []),
  ],
});

let compteur = 0;
const identifiants: string[] = [];

function poserEpisode(serie: string, saison: number | null, numero: number, metadonnees: string | null, duree = 1500): string {
  const id = `marqueurs-test-${(compteur += 1)}`;
  identifiants.push(id);
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, search_title, show_title, season_number,
      episode_number, file_path, runtime_seconds, embedded_metadata_json, available)
    VALUES (?, 'episode', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, `E${numero}`, `e${numero}`, `e${numero}`, serie, saison, numero, `/x/${id}.mkv`, duree, metadonnees);
  return id;
}

afterEach(() => {
  for (const id of identifiants.splice(0)) {
    db.prepare("DELETE FROM marqueurs_generique WHERE media_id = ?").run(id);
    db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  }
});

describe("compléter une saison depuis ses voisins", () => {
  it("complète les épisodes muets à partir des épisodes chapitrés", () => {
    const serie = "Série témoin A";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 110], 1440, 1500));
    const muet = poserEpisode(serie, 1, 4, null, 1800);

    const bilan = completerSaison(serie, 1);
    expect(bilan.dejaConnus).toBe(3);
    expect(bilan.deduits).toBe(1);

    const repere = marqueursDeduits(muet);
    expect(repere).not.toBeNull();
    // Le générique se déduit par sa durée : 60 s de carton sur un épisode de 1 800 s.
    expect(repere!.creditsStartSeconds).toBe(1740);
    expect(repere!.introStartSeconds).toBe(30);
    expect(repere!.sourceCredits).toBe("voisins");
    expect(repere!.sourceIntro).toBe("voisins");
  });

  it("ne touche pas un épisode dont le fichier parle déjà", () => {
    const serie = "Série témoin B";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 110], 1440, 1500));
    const chapitre = poserEpisode(serie, 1, 4, chapitres([50, 130], 1400, 1500));
    completerSaison(serie, 1);
    // Rien n'est rangé pour lui : ses chapitres se relisent du fichier, et priment de toute façon.
    expect(marqueursDeduits(chapitre)).toBeNull();
  });

  it("une saison d'un seul épisode emprunte au reste de la série", () => {
    // Première question posée pendant la conception : sans ce repli, un pilote rangé seul dans sa
    // saison n'aurait jamais rien, alors que la saison d'à côté dit tout.
    const serie = "Série témoin C";
    for (let numero = 1; numero <= 4; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 110], 1440, 1500));
    const isole = poserEpisode(serie, 2, 1, null, 1500);

    const bilan = completerSaison(serie, 2);
    expect(bilan.deduits).toBe(1);
    expect(marqueursDeduits(isole)?.creditsStartSeconds).toBe(1440);
  });

  it("l'emprunt refuse de conclure quand la série change de générique", () => {
    // Le cas de Silo : 77 s d'introduction en saisons 1 et 2, 97,8 s en saison 3. Mélangées, ces
    // valeurs dépassent la dispersion tolérée, et le repli s'abstient plutôt que d'inventer.
    const serie = "Série témoin D";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 107], null, 1500));
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 2, numero, chapitres([30, 210], null, 1500));
    const isole = poserEpisode(serie, 3, 1, null, 1500);

    completerSaison(serie, 3);
    expect(marqueursDeduits(isole)?.introStartSeconds ?? null).toBeNull();
  });

  it("un épisode ajouté plus tard est complété au scan suivant", () => {
    // Seconde question posée pendant la conception. La passe se relance sans dommage : elle
    // recalcule tout et n'écrase jamais une source plus sûre.
    const serie = "Série témoin E";
    for (let numero = 1; numero <= 3; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 110], 1440, 1500));
    expect(completerSaison(serie, 1).deduits).toBe(0);

    const nouveau = poserEpisode(serie, 1, 4, null, 1500);
    const bilan = completerSaison(serie, 1);
    expect(bilan.deduits).toBe(1);
    expect(marqueursDeduits(nouveau)?.creditsStartSeconds).toBe(1440);
  });

  it("un nouvel épisode chapitré enrichit ses voisins à son tour", () => {
    // Une saison qui n'avait que deux témoins n'atteignait pas le quorum ; le troisième arrive et
    // débloque la déduction pour tous les muets.
    const serie = "Série témoin F";
    for (let numero = 1; numero <= 2; numero += 1) poserEpisode(serie, 1, numero, chapitres([30, 110], 1440, 1500));
    const muet = poserEpisode(serie, 1, 5, null, 1500);
    completerSaison(serie, 1);
    expect(marqueursDeduits(muet)).toBeNull();

    poserEpisode(serie, 1, 3, chapitres([30, 110], 1440, 1500));
    completerSaison(serie, 1);
    expect(marqueursDeduits(muet)?.creditsStartSeconds).toBe(1440);
  });

  it("une saison sans aucun repère ne produit rien", () => {
    const serie = "Série témoin G";
    for (let numero = 1; numero <= 4; numero += 1) poserEpisode(serie, 1, numero, null, 1500);
    const bilan = completerSaison(serie, 1);
    expect(bilan.dejaConnus).toBe(0);
    expect(bilan.deduits).toBe(0);
  });
});
