import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { db } from "./database.js";

/**
 * Ce que la réponse d'ouverture dit du média, et pourquoi le type en fait partie.
 *
 * Le bandeau du lecteur Android compose « Série · S1 E3 · Titre » à partir de cette réponse. Il sait
 * déjà s'abstenir de numéroter une vidéo de plateforme — son numéro d'épisode est un nombre de jours
 * depuis 1970 —, mais encore faut-il qu'on lui dise à quoi il a affaire : sans le type, il annonçait
 * « S1 E20670 · Guillaume Pley : clap de fin d'une LEGEND » sur un téléviseur.
 *
 * Le cas d'une série est ici pour la raison inverse : elle doit **garder** ses saisons et ses
 * épisodes. La correction ne vaut que pour les vidéos.
 */
const racines: string[] = [];
const poses: string[] = [];
const bibliotheques: string[] = [];
let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await app?.close();
  for (const id of poses) db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  for (const id of bibliotheques) db.prepare("DELETE FROM library_folders WHERE id = ?").run(id);
  await Promise.all(racines.map((racine) => rm(racine, { recursive: true, force: true })));
});

async function poser(genre: "video" | "episode", saison: number, episode: number): Promise<string> {
  const racine = await mkdtemp(path.join(os.tmpdir(), "flixtunes-intitule-"));
  racines.push(racine);
  const fichier = path.join(racine, "media.mkv");
  await writeFile(fichier, "");

  // Un média sans bibliothèque n'est servi par aucune route : `mediaRows` exige `library_id`.
  const bibliotheque = randomUUID();
  bibliotheques.push(bibliotheque);
  db.prepare("INSERT INTO library_folders (id, path, kind, language) VALUES (?, ?, ?, 'fr-FR')")
    .run(bibliotheque, racine, genre === "video" ? "web" : "tv");

  const id = randomUUID();
  poses.push(id);
  db.prepare(`INSERT INTO media_items (id, kind, title, sort_title, show_title, season_number,
      episode_number, file_path, library_id, runtime_seconds, available)
    VALUES (?, ?, 'Guillaume Pley : clap de fin', 'guillaume', 'TPZ', ?, ?, ?, ?, 1500, 1)`)
    .run(id, genre, saison, episode, fichier, bibliotheque);
  return id;
}

describe("la réponse qui ouvre une lecture", () => {
  it("dit qu'une vidéo de plateforme en est une", async () => {
    const id = await poser("video", 1, 20670);

    const reponse = await app.inject({ method: "GET", url: `/api/media/${id}/playback-info` });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({
      kind: "video", title: "Guillaume Pley : clap de fin", showTitle: "TPZ",
    });
  });

  it("laisse un épisode de série avec sa saison et son numéro", async () => {
    const id = await poser("episode", 3, 10);

    const reponse = await app.inject({ method: "GET", url: `/api/media/${id}/playback-info` });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json()).toMatchObject({ kind: "episode", seasonNumber: 3, episodeNumber: 10 });
  });
});
