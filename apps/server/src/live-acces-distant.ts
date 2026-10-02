import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const cle = randomBytes(32);
const cache = new Map<string, { adresse: string; expire: number }>();
interface Acces { url: string; profil: string; chaine: string; usage: "flux" | "image"; expire: number }

/** Les URL des fournisseurs, parfois porteuses d'identifiants, ne sortent pas du serveur. */
export function adresseLiveDistante(url: string, profil: string, chaine: string, usage: Acces["usage"] = "flux"): string {
  const identite = JSON.stringify([url, profil, chaine, usage]);
  const connue = cache.get(identite);
  if (connue && connue.expire > Date.now() + 30 * 60_000) return connue.adresse;
  const acces: Acces = { url, profil, chaine, usage, expire: Date.now() + 6 * 60 * 60_000 };
  const iv = randomBytes(12);
  const chiffre = createCipheriv("aes-256-gcm", cle, iv);
  const octets = Buffer.concat([chiffre.update(JSON.stringify(acces), "utf8"), chiffre.final()]);
  const t = Buffer.concat([iv, chiffre.getAuthTag(), octets]).toString("base64url");
  const extension = /\.(m3u8|mpd|ts|m4s|mp4|aac|m4a)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const adresse = `/api/live/relais?t=${t}${extension ? `&f=${extension}` : ""}`;
  if (cache.size >= 5_000) cache.delete(cache.keys().next().value!);
  cache.set(identite, { adresse, expire: acces.expire });
  return adresse;
}

export function lireAccesLiveDistant(t: string | undefined, profil: string): Acces | null {
  if (!t || t.length > 16_384) return null;
  try {
    const octets = Buffer.from(t, "base64url");
    const dechiffre = createDecipheriv("aes-256-gcm", cle, octets.subarray(0, 12));
    dechiffre.setAuthTag(octets.subarray(12, 28));
    const acces = JSON.parse(Buffer.concat([dechiffre.update(octets.subarray(28)), dechiffre.final()]).toString("utf8")) as Acces;
    if (acces.profil !== profil || acces.expire <= Date.now() || !/^https?:\/\//i.test(acces.url)) return null;
    return acces;
  } catch { return null; }
}

export function sourceLiveDistante(adresse: string, profil: string, chaine: string): string | null {
  try {
    const url = new URL(adresse, "https://flixtunes.invalid");
    if (url.pathname !== "/api/live/relais") return null;
    const acces = lireAccesLiveDistant(url.searchParams.get("t") ?? undefined, profil);
    return acces?.chaine === chaine && acces.usage === "flux" ? acces.url : null;
  } catch { return null; }
}

export const empreinteLiveDistante = (empreinte: string) => createHash("sha256").update(empreinte).digest("hex");
