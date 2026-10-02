import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "./database.js";
import { cacheRemoteArtwork, getArtworkAsset, repairMissingArtwork } from "./artwork.js";

const library = randomUUID(), id = randomUUID();
const fichiers: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  db.prepare("DELETE FROM library_folders WHERE id = ?").run(library);
  for (const fichier of fichiers.splice(0)) await unlink(fichier).catch(() => undefined);
});

it("restaure une image perdue à la même adresse, sans toucher à la fiche verrouillée", async () => {
  db.prepare("INSERT INTO library_folders(id,path,kind,language) VALUES (?,?,'web','fr-FR')").run(library, `D:/${library}`);
  db.prepare(`INSERT INTO catalog_items(id,library_id,kind,title,sort_title,search_title,metadata_locked)
    VALUES (?,?,'show','Chaîne','chaine','chaine',1)`).run(id, library);
  const fetch = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  vi.stubGlobal("fetch", fetch);
  const url = await cacheRemoteArtwork(id, "poster", "https://images.example/avatar.png", "fr", "youtube");
  const asset = getArtworkAsset(url!.split("/").at(-1)!)!;
  fichiers.push(asset.localPath);
  db.prepare("UPDATE catalog_items SET poster_url = ? WHERE id = ?").run(url, id);
  await unlink(asset.localPath);
  await repairMissingArtwork(500);
  expect(await readFile(asset.localPath)).toEqual(Buffer.from([137, 80, 78, 71]));
  expect(db.prepare("SELECT poster_url,metadata_locked FROM catalog_items WHERE id = ?").get(id))
    .toMatchObject({ poster_url: url, metadata_locked: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
  await repairMissingArtwork(500);
  expect(fetch).toHaveBeenCalledTimes(2);
});
