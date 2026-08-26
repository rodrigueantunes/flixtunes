import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import type { MetadataProviderConfigurationInput } from "@flixtunes/contracts";
import { config } from "./config.js";
import { db } from "./database.js";

export interface ProviderConfiguration {
  tmdbToken: string | null;
  tvdbApiKey: string | null;
  tvdbPin?: string | null;
  fanartApiKey: string | null;
  imdbApiUrl: string | null;
  imdbApiToken: string | null;
  allocineApiUrl: string | null;
  allocineApiToken: string | null;
}

const settingPrefix = "provider_secret_";
const keyPath = path.join(config.dataDir, "provider-secrets.key");

function encryptionKey(): Buffer {
  if (existsSync(keyPath)) {
    const key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("Clé de chiffrement des fournisseurs invalide");
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { chmodSync(keyPath, 0o600); } catch { /* Windows ne gère pas les permissions POSIX. */ }
  return key;
}

export function encryptProviderSecret(value: string, key = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptProviderSecret(value: string, key = encryptionKey()): string {
  const [version, encodedIv, encodedTag, encodedPayload] = value.split(":");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedPayload) throw new Error("Secret fournisseur illisible");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encodedPayload, "base64")), decipher.final()]).toString("utf8");
}

function stored(name: keyof ProviderConfiguration): string | null {
  const row = db.prepare("SELECT value FROM server_settings WHERE key = ?").get(`${settingPrefix}${name}`) as { value: string } | undefined;
  if (!row) return null;
  try { return decryptProviderSecret(row.value); } catch { return null; }
}

export function getProviderConfiguration(): ProviderConfiguration {
  return {
    tmdbToken: stored("tmdbToken") ?? config.tmdbToken,
    tvdbApiKey: stored("tvdbApiKey") ?? config.tvdbApiKey,
    tvdbPin: stored("tvdbPin") ?? config.tvdbPin,
    fanartApiKey: stored("fanartApiKey") ?? config.fanartApiKey,
    imdbApiUrl: stored("imdbApiUrl") ?? config.imdbApiUrl,
    imdbApiToken: stored("imdbApiToken") ?? config.imdbApiToken,
    allocineApiUrl: stored("allocineApiUrl") ?? config.allocineApiUrl,
    allocineApiToken: stored("allocineApiToken") ?? config.allocineApiToken,
  };
}

export function saveProviderConfiguration(input: MetadataProviderConfigurationInput): void {
  const upsert = db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
  const remove = db.prepare("DELETE FROM server_settings WHERE key = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [name, value] of Object.entries(input) as Array<[keyof ProviderConfiguration, string | null | undefined]>) {
      if (value === undefined) continue;
      if (value === null || value.trim() === "") remove.run(`${settingPrefix}${name}`);
      else upsert.run(`${settingPrefix}${name}`, encryptProviderSecret(value.trim()));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
