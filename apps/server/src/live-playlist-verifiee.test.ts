import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./database.js";
import { listesDeLaSource, type SourceDirect } from "./live-fournisseurs.js";
import { enregistrerParametres, etatDirect, rafraichirDirect } from "./television-direct.js";

const dossier = mkdtempSync(path.join(tmpdir(), "flixtunes-verifiee-"));
const fichier = path.join(dossier, "m3u.json");
const playlist = path.join(dossier, "chaines_francaises.m3u");
const source: SourceDirect = { id: "verifiee", type: "m3u", libelle: "Test", emplacement: fichier,
  activee: true, rafraichieLe: null, dernierMessage: null };
const bon = '#EXTM3U\n#EXTINF:-1 tvg-id="TF1.fr",TF1\nhttps://video.test/bon\n#EXTINF:-1 tvg-id="TF1.fr",TF1\nhttps://video.test/secours\n';

function ecrire(contenu = bon): void {
  writeFileSync(playlist, contenu, "utf8");
  const genere_le = new Date().toISOString();
  writeFileSync(fichier, JSON.stringify({ version: 2, genere_le,
    listes: [{ nom: "Originale avec pannes", url: "https://origine.test/playlist.m3u", pourcentage: 1 }],
    playlist_verifiee: { fichier: "chaines_francaises.m3u", genere_le,
      sha256: createHash("sha256").update(contenu).digest("hex") } }));
}

function nettoyer(): void {
  db.prepare("DELETE FROM live_sources").run();
  db.prepare("DELETE FROM live_channels").run();
  db.prepare("DELETE FROM server_settings WHERE key LIKE 'live.%'").run();
}

beforeEach(() => { nettoyer(); ecrire(); });
afterAll(() => { nettoyer(); rmSync(dossier, { recursive: true, force: true }); });

describe("le catalogue produit par le vérificateur", () => {
  it("utilise le snapshot vérifié plutôt que les URL d'origine", async () => {
    const listes = await listesDeLaSource(source, 2 * 1024 * 1024);
    expect(listes).toHaveLength(1);
    expect(listes[0]?.url).toBe("flixtunes-local:playlist-verifiee");
    expect(listes[0]?.contenu).toBe(bon);
    expect(listes[0]?.pourcentage).toBe(100);
  });

  it("refuse une playlist remplacée sans son catalogue", async () => {
    writeFileSync(playlist, "#EXTM3U\n#EXTINF:-1,Intrus\nhttps://video.test/intrus\n");
    await expect(listesDeLaSource(source, 2 * 1024 * 1024)).rejects.toThrow(/incohérente/);
  });

  it("refuse les chemins externes et les générations mélangées", async () => {
    const contenu = JSON.parse(readFileSync(fichier, "utf8"));
    contenu.playlist_verifiee.fichier = "../ailleurs.m3u";
    writeFileSync(fichier, JSON.stringify(contenu));
    await expect(listesDeLaSource(source, 2 * 1024 * 1024)).rejects.toThrow(/invalide/);
    ecrire();
    const autre = JSON.parse(readFileSync(fichier, "utf8"));
    autre.playlist_verifiee.genere_le = "2000-01-01T00:00:00Z";
    writeFileSync(fichier, JSON.stringify(autre));
    await expect(listesDeLaSource(source, 2 * 1024 * 1024)).rejects.toThrow(/invalide/);
  });

  it("importe les secours, retire les anciennes listes et ne fait aucun téléchargement de playlist", async () => {
    enregistrerParametres({ actif: true, dossier, fichier: "m3u.json" });
    // Créer une ancienne liste dans la même source, comme après un import de l'ancien JSON.
    const original = JSON.parse(readFileSync(fichier, "utf8"));
    writeFileSync(fichier, JSON.stringify({ version: 2, listes: original.listes }));
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "#EXTM3U\n#EXTINF:-1,Morte\nhttps://video.test/morte\n"));
    try {
      await rafraichirDirect();
      expect(db.prepare("SELECT url FROM live_channel_urls WHERE url = 'https://video.test/morte'").get()).toBeDefined();
      ecrire();
      fetcher.mockClear();
      await rafraichirDirect();
      expect(fetcher.mock.calls.some(([url]) => String(url).includes("origine.test"))).toBe(false);
      expect(db.prepare("SELECT url FROM live_channel_urls ORDER BY url").all()).toEqual([
        { url: "https://video.test/bon" }, { url: "https://video.test/secours" },
      ]);
      expect(etatDirect().adresses).toBe(2);
      // Une passe complètement négative peut publier une playlist propre vide.
      ecrire("#EXTM3U\n");
      await rafraichirDirect();
      expect(etatDirect().adresses).toBe(0);
    } finally { fetcher.mockRestore(); }
  });

  it("ne retélécharge pas les anciennes listes si la première migration est incohérente", async () => {
    enregistrerParametres({ actif: true, dossier, fichier: "m3u.json" });
    const original = JSON.parse(readFileSync(fichier, "utf8"));
    writeFileSync(fichier, JSON.stringify({ version: 2, listes: original.listes }));
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("#EXTM3U\n"));
    try {
      await rafraichirDirect();
      ecrire();
      writeFileSync(playlist, "incorrect");
      fetcher.mockClear();
      await rafraichirDirect();
      expect(fetcher.mock.calls.some(([url]) => String(url).includes("origine.test"))).toBe(false);
    } finally { fetcher.mockRestore(); }
  });
});
