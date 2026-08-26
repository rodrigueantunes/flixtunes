import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import mime from "mime-types";
import { config } from "./config.js";
import { db } from "./database.js";
import { fetchWithTimeout } from "./resilience.js";

export type ArtworkRole = "poster" | "backdrop" | "still";

const artworkDirectory = path.join(config.dataDir, "artwork");
const execFileAsync = promisify(execFile);

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
  source: "local" | "tmdb" | "tvmaze" | "wikidata";
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
  source: "tmdb" | "tvmaze" | "wikidata" = "tmdb",
): Promise<string | null> {
  if (!sourceUrl) return null;
  const sourceKey = createHash("sha256").update(sourceUrl).digest("hex");
  const existing = await existingAsset(catalogId, role, sourceKey);
  if (existing) return existing;

  const response = await fetchWithTimeout(sourceUrl, { headers: { Accept: "image/*" } }, 20_000);
  if (!response.ok) throw new Error(`Téléchargement de jaquette impossible (${response.status})`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > 20 * 1024 * 1024) throw new Error("Image distante trop volumineuse");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Image distante trop volumineuse");
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const id = randomUUID();
  const localPath = path.join(artworkDirectory, `${id}${extensionFor(contentType, sourceUrl)}`);
  await mkdir(artworkDirectory, { recursive: true });
  await writeFile(localPath, bytes);
  return registerAsset({ id, catalogId, role, language, source, sourceKey, localPath, mimeType: contentType });
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
