import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ecrireReglages, estLocale, lireReglages, normaliserAdresse } from "./reglages.ts";

/**
 * L'adresse du serveur, seule chose que la coque retient.
 *
 * Ce qui compte ici n'est pas la persistance — écrire un fichier JSON n'a rien d'incertain — mais la
 * **normalisation** : c'est elle qui décide si l'accès depuis Internet peut retomber en clair.
 */

test("une adresse locale reçoit http et le port du serveur", () => {
  assert.equal(normaliserAdresse("192.168.1.50"), "http://192.168.1.50:4000");
  assert.equal(normaliserAdresse("  10.0.0.7  "), "http://10.0.0.7:4000");
  assert.equal(normaliserAdresse("nas.local"), "http://nas.local:4000");
});

test("un port indiqué est respecté", () => {
  assert.equal(normaliserAdresse("192.168.1.50:8096"), "http://192.168.1.50:8096");
});

test("une adresse publique passe en https, jamais en clair", () => {
  // C'est la règle qui compte : le client Android l'applique déjà, et elle interdit qu'un accès
  // depuis Internet se fasse sans chiffrement parce que quelqu'un a tapé un nom sans schéma.
  assert.equal(normaliserAdresse("flixtunes.exemple.fr"), "https://flixtunes.exemple.fr");
});

test("un schéma explicite est respecté tel quel", () => {
  assert.equal(normaliserAdresse("http://flixtunes.exemple.fr"), "http://flixtunes.exemple.fr");
  assert.equal(normaliserAdresse("https://192.168.1.50:4000/"), "https://192.168.1.50:4000");
});

test("une saisie inutilisable est refusée plutôt que devinée", () => {
  for (const saisie of ["", "   ", "http://", "://nas"]) {
    assert.equal(normaliserAdresse(saisie), null, `refus attendu pour « ${saisie} »`);
  }
});

test("les plages privées sont reconnues, les autres non", () => {
  for (const hote of ["localhost", "nas.local", "10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.254"]) {
    assert.equal(estLocale(hote), true, `${hote} devrait être locale`);
  }
  for (const hote of ["8.8.8.8", "172.32.0.1", "203.0.113.4", "exemple.fr"]) {
    assert.equal(estLocale(hote), false, `${hote} ne devrait pas être locale`);
  }
});

test("les réglages se relisent, et un fichier abîmé ne bloque pas le démarrage", () => {
  const dossier = mkdtempSync(path.join(os.tmpdir(), "flixtunes-bureau-"));
  try {
    assert.equal(lireReglages(dossier).serveur, null, "premier démarrage : rien de retenu");

    ecrireReglages(dossier, { serveur: "http://192.168.1.50:4000" });
    assert.equal(lireReglages(dossier).serveur, "http://192.168.1.50:4000");

    // Un fichier illisible ne doit pas empêcher l'application de s'ouvrir : elle redemande l'adresse.
    writeFileSync(path.join(dossier, "reglages.json"), "{ ceci n'est pas du JSON", "utf8");
    assert.equal(lireReglages(dossier).serveur, null);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
