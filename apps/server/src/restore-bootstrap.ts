import { copyFile, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/**
 * La restauration s'applique **avant** que la base ne soit ouverte.
 *
 * Remplacer un fichier SQLite pendant qu'un processus le tient ouvert ne remplace rien de fiable :
 * les pages en cache, le journal WAL et l'index partagé continuent de décrire l'ancien contenu. La
 * demande de restauration ne fait donc que poser un **marqueur** ; c'est le démarrage suivant qui
 * l'exécute, à un moment où personne ne lit la base.
 *
 * C'est aussi le chemin de retour d'une migration ratée. Il n'y a pas de migration inverse dans ce
 * projet — reconstruire une table SQLite pour défaire une colonne est plus dangereux que ce que cela
 * répare —, et cette fonction est éprouvée par ses propres cas de test, ce qu'une migration inverse
 * écrite « au cas où » ne serait jamais.
 */
export const restoreMarkerPath = path.join(config.dataDir, "restore-pending.json");

/** Un nom de sauvegarde, et rien d'autre : ce nom désigne un fichier qui va écraser la base. */
const NOM_VALIDE = /^flixtunes-\d{8}-\d{9}\.db$/;

export async function applyPendingRestore(racine: string = config.dataDir): Promise<void> {
  const marqueur = path.join(racine, "restore-pending.json");
  let marker: { backup: string };
  try { marker = JSON.parse(await readFile(marqueur, "utf8")) as { backup: string }; }
  catch { return; }
  // Le marqueur est un fichier du disque : il peut avoir été écrit par autre chose que le service.
  // Un nom non conforme désignerait un fichier quelconque, à copier par-dessus la base.
  if (!NOM_VALIDE.test(marker.backup)) throw new Error("Marqueur de restauration invalide");
  const source = path.join(racine, "backups", marker.backup);
  const database = path.join(racine, "flixtunes.db");
  /*
   * L'ancienne base est **déplacée**, pas supprimée.
   *
   * Une restauration se demande souvent dans l'urgence, et parfois par erreur. Le fichier écarté
   * reste sur le disque sous un nom horodaté : s'il s'avère qu'on a restauré la mauvaise sauvegarde,
   * l'état d'avant est encore là.
   */
  const safety = path.join(racine, `flixtunes-before-restore-${Date.now()}.db`);
  try { await rename(database, safety); } catch { /* Première restauration ou base absente. */ }
  await copyFile(source, database);
  // Le WAL et l'index partagé décrivent la base qu'on vient d'écarter : les laisser corromprait la
  // lecture de celle qu'on vient de poser.
  await Promise.all([rm(`${database}-wal`, { force: true }), rm(`${database}-shm`, { force: true }), rm(marqueur, { force: true })]);
}
