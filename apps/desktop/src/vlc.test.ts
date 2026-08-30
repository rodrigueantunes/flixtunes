import test from "node:test";
import assert from "node:assert/strict";
import { lireStatut, trouverVlc, ETAT_INITIAL } from "./vlc.ts";

/**
 * Ce qui se vérifie sans lancer VLC.
 *
 * Le reste — le processus, la fenêtre de dessin, le décodage matériel — ne se prouve qu'à l'écran, et
 * c'est ce que fait la note de validation. Ici on éprouve la seule partie qui se trompera si VLC
 * change son vocabulaire : la lecture de son statut.
 *
 * Les valeurs viennent d'un relevé réel : « 10 000 », HEVC 1080p en Matroska, servi tel quel par le
 * NAS et lu par VLC 3.0.21 le 27 août 2026.
 */
const RELEVE = {
  state: "playing",
  time: 901,
  length: 6535,
  position: 0.13795,
  rate: 1,
  volume: 256,
  stats: { displayedpictures: 381, lostpictures: 4, readbytes: 27775866 },
};

test("lit un statut réel de VLC", () => {
  const statut = lireStatut(RELEVE);
  assert.ok(statut);
  assert.equal(statut.etat, "playing");
  assert.equal(statut.duree, 6535);
  assert.equal(statut.imagesAffichees, 381);
  assert.equal(statut.imagesPerdues, 4);
});

test("tire la position de la fraction, plus fine que la seconde entière annoncée", () => {
  // 0,13795 × 6535 = 901,50 s. `time` disait 901 : une barre de progression nourrie par lui
  // avancerait par sauts d'une seconde, ce qui se voit à l'œil nu.
  const statut = lireStatut(RELEVE);
  assert.ok(statut);
  assert.ok(Math.abs(statut.position - 901.503) < 0.01, `position = ${statut.position}`);
  assert.notEqual(statut.position, 901);
});

test("retombe sur les secondes entières quand la durée est inconnue", () => {
  // Le cas d'une conversion encore en écriture : le flux n'a pas de fin déclarée, donc pas de
  // fraction utilisable. Mieux vaut une position grossière qu'une position fausse.
  const statut = lireStatut({ ...RELEVE, length: 0, position: 0 });
  assert.ok(statut);
  assert.equal(statut.position, 901);
  assert.equal(statut.duree, 0);
});

test("tout ce qui n'est ni lecture ni pause est un arrêt", () => {
  // VLC dit « stopped » aussi bien avant d'avoir ouvert le flux qu'une fois le film fini. Les
  // distinguer n'est pas le travail de cette fonction : elle rapporte, le lecteur conclut.
  for (const etat of ["stopped", "opening", "buffering", "error", undefined]) {
    assert.equal(lireStatut({ ...RELEVE, state: etat })?.etat, "stopped");
  }
});

test("une vitesse absente vaut la vitesse normale", () => {
  assert.equal(lireStatut({ ...RELEVE, rate: undefined })?.vitesse, 1);
  assert.equal(lireStatut({ ...RELEVE, rate: 1.5 })?.vitesse, 1.5);
});

test("refuse ce qui n'est pas un statut plutôt que d'inventer des zéros", () => {
  assert.equal(lireStatut(null), null);
  assert.equal(lireStatut("<html>401 Unauthorized</html>"), null);
  assert.equal(lireStatut(42), null);
});

test("un statut sans compteurs d'images ne fait pas échouer la lecture", () => {
  // VLC omet `stats` tant que rien n'est ouvert. Le client Web s'en sert pour juger le décodage :
  // zéro image affichée et zéro perdue est la seule réponse honnête, et elle ne conclut rien.
  const statut = lireStatut({ state: "stopped", length: 0, time: 0, position: 0 });
  assert.ok(statut);
  assert.equal(statut.imagesAffichees, 0);
  assert.equal(statut.imagesPerdues, 0);
});

test("l'état initial n'annonce ni ouverture ni erreur", () => {
  assert.equal(ETAT_INITIAL.ouvert, false);
  assert.equal(ETAT_INITIAL.termine, false);
  assert.equal(ETAT_INITIAL.erreur, null);
  assert.equal(ETAT_INITIAL.vitesse, 1);
});

/**
 * Le relevé réel d'un Matroska à dix pistes, tel que VLC le rend sur une installation française.
 *
 * Le serveur décrit le même fichier ainsi : vidéo 0, audio 1 (eng), 2 (fre), 3 (spa), sous-titres 4
 * (eng), 5 (fre), 6 (spa), 7 (spa), 8 (fre), 9 (spa). Les numéros et les langues se correspondent un
 * à un — y compris le « fre » isolé en huitième position. C'est cette correspondance qui permet au
 * client Web de désigner une piste par l'index qu'il connaît déjà.
 */
const DIX_PISTES = {
  state: "playing", time: 62, length: 6535, position: 0.0095, rate: 1,
  stats: { displayedpictures: 1500, lostpictures: 0 },
  information: { chapter: 0, title: 0, category: {
    meta: { filename: "10 000" },
    "Flux 0": { Type_: "Vidéo", Codec_: "MPEG-H Part2/HEVC (H.265) (hevc)" },
    "Flux 1": { Type_: "Audio", Langue_: "Anglais" },
    "Flux 2": { Type_: "Audio", Langue_: "Français" },
    "Flux 3": { Type_: "Audio", Langue_: "Espagnol" },
    "Flux 4": { Type_: "Sous-titres ", Langue_: "Anglais" },
    "Flux 5": { Type_: "Sous-titres ", Langue_: "Français" },
    "Flux 6": { Type_: "Sous-titres ", Langue_: "Espagnol" },
    "Flux 7": { Type_: "Sous-titres ", Langue_: "Espagnol" },
    "Flux 8": { Type_: "Sous-titres ", Langue_: "Français" },
    "Flux 9": { Type_: "Sous-titres ", Langue_: "Espagnol" },
  } },
};

test("relève les numéros des pistes, dans l'ordre", () => {
  assert.deepEqual(lireStatut(DIX_PISTES)?.pistes, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("ne lit que le nombre, jamais les libellés de VLC", () => {
  // « Flux » devient « Stream » sur une installation anglaise, et autre chose ailleurs ; ni
  // `--language=en` ni rien d'autre ne le fige. S'y fier ferait dépendre le choix des pistes de la
  // langue du système — un défaut qui n'apparaîtrait que chez quelqu'un d'autre.
  const anglais = { ...DIX_PISTES, information: { category: {
    "Stream 0": { Type: "Video" }, "Stream 1": { Type: "Audio" }, "Stream 12": { Type: "Subtitle" },
  } } };
  assert.deepEqual(lireStatut(anglais)?.pistes, [0, 1, 12]);
});

test("aucune piste tant que rien n'est ouvert, et jamais d'exception", () => {
  assert.deepEqual(lireStatut({ ...DIX_PISTES, information: undefined })?.pistes, []);
  assert.deepEqual(lireStatut({ ...DIX_PISTES, information: { category: null } })?.pistes, []);
  // « meta » n'est pas une piste : il ne porte aucun nombre, et se trouve donc écarté sans règle
  // particulière.
  assert.deepEqual(lireStatut({ ...DIX_PISTES, information: { category: { meta: {} } } })?.pistes, []);
});

test("la recherche de VLC rend un chemin ou rien, jamais une devinette", () => {
  // Sur la machine de développement VLC est installé ; sur une machine de construction, non. Les
  // deux réponses sont acceptables — ce qui ne le serait pas, c'est un chemin qui n'existe pas.
  const chemin = trouverVlc();
  if (chemin !== null) assert.ok(chemin.length > 0);
});
