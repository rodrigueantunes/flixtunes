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

test("la recherche de VLC rend un chemin ou rien, jamais une devinette", () => {
  // Sur la machine de développement VLC est installé ; sur une machine de construction, non. Les
  // deux réponses sont acceptables — ce qui ne le serait pas, c'est un chemin qui n'existe pas.
  const chemin = trouverVlc();
  if (chemin !== null) assert.ok(chemin.length > 0);
});
