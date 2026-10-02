import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import mime from "mime-types";
import { config } from "./config.js";
import { db } from "./database.js";

export type ArtworkRole = "poster" | "backdrop" | "still";

const artworkDirectory = path.join(config.dataDir, "artwork");
const execFileAsync = promisify(execFile);

// L'origine reste côté serveur ; elle permet de restaurer un fichier perdu sans réapparier sa fiche.
db.exec(`CREATE TABLE IF NOT EXISTS artwork_origins (
  asset_id TEXT PRIMARY KEY REFERENCES artwork_assets(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL)`);
let repairCursor = "";
let repairRunning = false;

export async function repairMissingArtwork(limit = 200): Promise<{ checked: number; repaired: number; missing: number }> {
  const result = { checked: 0, repaired: 0, missing: 0 };
  if (repairRunning) return result;
  repairRunning = true;
  try {
    const assets = db.prepare(`SELECT a.id, a.local_path, a.source, a.catalog_id, o.source_url
      FROM artwork_assets a LEFT JOIN artwork_origins o ON o.asset_id = a.id
      WHERE a.id > ? ORDER BY a.id LIMIT ?`).all(repairCursor, Math.max(1, Math.min(500, limit))) as
      Array<{ id: string; local_path: string; source: string; catalog_id: string; source_url: string | null }>;
    let downloads = 0;
    for (const asset of assets) {
      repairCursor = asset.id; result.checked++;
      try { if ((await stat(asset.local_path)).size > 0) continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
      result.missing++;
      const retrouverAvatar = () => {
        if (asset.source !== "youtube") return;
        db.prepare(`UPDATE catalog_items SET poster_url = NULL WHERE id = ? AND kind = 'show'
          AND external_provider = 'youtube' AND external_id IS NOT NULL AND poster_url = ?`)
          .run(asset.catalog_id, apiUrl(asset.id));
      };
      if (asset.source_url && downloads < 10 && path.dirname(path.resolve(asset.local_path)) === path.resolve(artworkDirectory)) {
        downloads++;
        const temporary = `${asset.local_path}.${randomUUID()}.partial`;
        try {
          const { bytes } = await downloadArtwork(asset.source_url);
          await mkdir(artworkDirectory, { recursive: true });
          await writeFile(temporary, bytes);
          await rename(temporary, asset.local_path);
          result.repaired++;
        } catch { retrouverAvatar(); /* Une ancienne URL YouTube peut avoir expiré. */ }
        finally { await unlink(temporary).catch(() => undefined); }
      } else if (!asset.source_url && asset.source === "youtube") {
        // Anciennes versions : l'origine n'était pas conservée. Une chaîne connue sait la retrouver.
        retrouverAvatar();
      }
    }
    if (assets.length < Math.max(1, Math.min(500, limit))) repairCursor = "";
    return result;
  } finally { repairRunning = false; }
}

/** Le délai et la limite couvrent aussi le corps HTTP, même sans Content-Length. */
async function downloadArtwork(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { headers: { Accept: "image/*" }, signal: controller.signal });
    const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!response.ok || !contentType.startsWith("image/") || !response.body) {
      await response.body?.cancel();
      throw new Error(`Image distante indisponible (${response.status})`);
    }
    const maximum = 20 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maximum) {
      await response.body.cancel(); throw new Error("Image distante trop volumineuse");
    }
    const lecteur = response.body.getReader(), morceaux: Uint8Array[] = [];
    let taille = 0;
    try {
      while (true) {
        const partie = await lecteur.read();
        if (partie.done) break;
        taille += partie.value.byteLength;
        if (taille > maximum) throw new Error("Image distante trop volumineuse");
        morceaux.push(partie.value);
      }
    } finally { await lecteur.cancel().catch(() => undefined); }
    if (!taille) throw new Error("Image distante vide");
    return { bytes: Buffer.concat(morceaux, taille), contentType };
  } finally { clearTimeout(timer); }
}

function apiUrl(id: string): string {
  return `/api/artwork/${id}`;
}

function extensionFor(contentType: string, source: string): string {
  const extension = mime.extension(contentType) || path.extname(new URL(source, "file:///").pathname).slice(1) || "jpg";
  return `.${extension === "jpeg" ? "jpg" : extension}`;
}

async function existingAsset(catalogId: string, role: ArtworkRole, sourceKey: string): Promise<string | null> {
  const row = db.prepare(
    "SELECT id, local_path FROM artwork_assets WHERE catalog_id = ? AND role = ? AND source_key = ?",
  ).get(catalogId, role, sourceKey) as { id: string; local_path: string } | undefined;
  if (!row) return null;
  try {
    await access(row.local_path);
    return apiUrl(row.id);
  } catch {
    db.prepare("DELETE FROM artwork_assets WHERE id = ?").run(row.id);
    return null;
  }
}

function registerAsset(args: {
  id: string;
  catalogId: string;
  role: ArtworkRole;
  language: string | null;
  source: "local" | "tmdb" | "tvmaze" | "wikidata" | "youtube";
  sourceKey: string;
  localPath: string;
  mimeType: string;
}): string {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE artwork_assets SET is_primary = 0 WHERE catalog_id = ? AND role = ?")
      .run(args.catalogId, args.role);
    db.prepare(`
      INSERT INTO artwork_assets (id, catalog_id, role, language, source, source_key, local_path, mime_type, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(args.id, args.catalogId, args.role, args.language, args.source, args.sourceKey, args.localPath, args.mimeType);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return apiUrl(args.id);
}

export async function cacheRemoteArtwork(
  catalogId: string,
  role: ArtworkRole,
  sourceUrl: string | null,
  language: string,
  source: "tmdb" | "tvmaze" | "wikidata" | "youtube" = "tmdb",
): Promise<string | null> {
  if (!sourceUrl) return null;
  const sourceKey = createHash("sha256").update(sourceUrl).digest("hex");
  const existing = await existingAsset(catalogId, role, sourceKey);
  if (existing) {
    db.prepare("INSERT OR IGNORE INTO artwork_origins(asset_id, source_url) VALUES (?, ?)")
      .run(existing.slice("/api/artwork/".length), sourceUrl);
    return existing;
  }

  const { bytes, contentType } = await downloadArtwork(sourceUrl);
  const id = randomUUID();
  const localPath = path.join(artworkDirectory, `${id}${extensionFor(contentType, sourceUrl)}`);
  await mkdir(artworkDirectory, { recursive: true });
  await writeFile(localPath, bytes);
  const adresse = registerAsset({ id, catalogId, role, language, source, sourceKey, localPath, mimeType: contentType });
  db.prepare("INSERT INTO artwork_origins(asset_id, source_url) VALUES (?, ?)").run(id, sourceUrl);
  return adresse;
}

export async function cacheLocalArtwork(
  catalogId: string,
  role: ArtworkRole,
  sourcePath: string | null,
  language: string,
): Promise<string | null> {
  if (!sourcePath) return null;
  const info = await stat(sourcePath);
  const sourceKey = createHash("sha256")
    .update(`${path.resolve(sourcePath)}:${info.size}:${Math.floor(info.mtimeMs)}`)
    .digest("hex");
  const existing = await existingAsset(catalogId, role, sourceKey);
  if (existing) return existing;
  const mimeType = mime.lookup(sourcePath) || "image/jpeg";
  const id = randomUUID();
  const localPath = path.join(artworkDirectory, `${id}${extensionFor(mimeType, sourcePath)}`);
  await mkdir(artworkDirectory, { recursive: true });
  await copyFile(sourcePath, localPath);
  return registerAsset({ id, catalogId, role, language, source: "local", sourceKey, localPath, mimeType });
}

export function generatedArtworkFilter(role: ArtworkRole): string {
  return role === "poster"
    ? "thumbnail=30,scale=600:900:force_original_aspect_ratio=increase,crop=600:900"
    : "thumbnail=30,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720";
}

export function generatedArtworkIsBlack(stderr: string): boolean {
  return [...stderr.matchAll(/\bpblack:([0-9]+(?:\.[0-9]+)?)/g)]
    .some((match) => Number(match[1]) >= 96);
}

/** Une image extraite de la vidéo peut servir de fond, jamais de jaquette de catalogue. */
export function canGenerateArtwork(role: ArtworkRole): boolean {
  return role !== "poster";
}

/** Reconnaît les anciennes captures générées (source locale sans langue) afin de ne plus les afficher. */
export function artworkUrlIsGenerated(url: string | null | undefined, role: ArtworkRole): boolean {
  const id = url?.match(/^\/api\/artwork\/([0-9a-f-]+)$/i)?.[1];
  if (!id) return false;
  return Boolean(db.prepare(`SELECT 1 FROM artwork_assets
    WHERE id = ? AND role = ? AND source = 'local' AND language IS NULL`).get(id, role));
}

export async function cacheGeneratedArtwork(
  catalogId: string,
  role: ArtworkRole,
  mediaPath: string,
): Promise<string | null> {
  if (!canGenerateArtwork(role)) return null;
  try {
    const info = await stat(mediaPath);
    const sourceKey = createHash("sha256")
      .update(`generated:${role}:${path.resolve(mediaPath)}:${info.size}:${Math.floor(info.mtimeMs)}`)
      .digest("hex");
    const existing = await existingAsset(catalogId, role, sourceKey);
    if (existing) return existing;

    const id = randomUUID();
    const localPath = path.join(artworkDirectory, `${id}.jpg`);
    await mkdir(artworkDirectory, { recursive: true });
    const { stderr } = await execFileAsync(config.ffmpegPath, [
      // Une seconde tombe presque toujours dans un fondu ou un carton noir. Trente secondes et le
      // choix parmi trente images donnent un aperçu utile sans décoder une longue portion du film.
      "-nostdin", "-hide_banner", "-loglevel", "info", "-y", "-ss", "30", "-i", mediaPath,
      "-frames:v", "1", "-vf", `${generatedArtworkFilter(role)},blackframe=amount=96:threshold=32`,
      "-q:v", "3", localPath,
    ], { windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    await access(localPath);
    if (generatedArtworkIsBlack(stderr)) {
      await unlink(localPath).catch(() => undefined);
      if (process.env.NODE_ENV !== "test") console.info(JSON.stringify({ scope: "metadata", event: "artwork-rejected",
        role, file: path.basename(mediaPath), reason: "image presque entièrement noire" }));
      return null;
    }
    return registerAsset({
      id, catalogId, role, language: null, source: "local", sourceKey, localPath, mimeType: "image/jpeg",
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "test") console.warn(JSON.stringify({ scope: "metadata", event: "artwork-generation-failed",
      role, file: path.basename(mediaPath), error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

export async function findLocalArtwork(mediaPath: string, role: ArtworkRole, parentLevels = 0): Promise<string | null> {
  let directory = path.dirname(mediaPath);
  for (let index = 0; index < parentLevels; index += 1) directory = path.dirname(directory);
  const preferred = role === "poster"
    ? ["poster.jpg", "poster.png", "folder.jpg", "folder.png", "cover.jpg", "cover.png"]
    : ["backdrop.jpg", "backdrop.png", "fanart.jpg", "fanart.png", "background.jpg", "background.png"];
  try {
    const entries = await readdir(directory);
    const byLowerName = new Map(entries.map((entry) => [entry.toLocaleLowerCase("en"), entry]));
    for (const candidate of preferred) {
      const actual = byLowerName.get(candidate);
      if (actual) return path.join(directory, actual);
    }
  } catch {
    // Une image locale est facultative; TMDB prendra le relais.
  }
  return null;
}

export function getArtworkAsset(id: string): { localPath: string; mimeType: string } | null {
  const row = db.prepare("SELECT local_path, mime_type FROM artwork_assets WHERE id = ?").get(id) as
    | { local_path: string; mime_type: string }
    | undefined;
  return row ? { localPath: row.local_path, mimeType: row.mime_type } : null;
}
