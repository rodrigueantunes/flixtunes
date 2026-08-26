import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./database.js";

declare module "fastify" {
  interface FastifyRequest {
    compteDistantId?: string;
  }
}

export const ENTETE_COMPTE_DISTANT = "x-flixtunes-remote-token";
export const COOKIE_COMPTE_DISTANT = "flixtunes_remote";
export const DUREE_APPAREIL_JOURS = 365;

export interface CompteDistantPublic {
  id: string;
  username: string;
  createdAt: string;
  devices: number;
}

function empreinte(valeur: string): string {
  return createHash("sha256").update(valeur).digest("hex");
}

function hacherMotDePasse(secret: string): string {
  const sel = randomBytes(16);
  return `${sel.toString("hex")}:${scryptSync(secret, sel, 32).toString("hex")}`;
}

function verifierMotDePasse(secret: string, stocke: string): boolean {
  try {
    const [sel, attendu] = stocke.split(":");
    if (!sel || !attendu) return false;
    const a = Buffer.from(attendu, "hex");
    const b = scryptSync(secret, Buffer.from(sel, "hex"), 32);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

export function identifiantCompteValide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(valeur);
}

export function motDePasseCompteValide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && valeur.length >= 12 && valeur.length <= 128;
}

export function listerComptesDistants(): CompteDistantPublic[] {
  return (db.prepare(`SELECT a.id, a.username, a.created_at, COUNT(s.token_hash) AS devices
    FROM remote_accounts a LEFT JOIN remote_device_sessions s
      ON s.account_id = a.id AND s.expires_at > ?
    GROUP BY a.id ORDER BY a.username COLLATE NOCASE`).all(new Date().toISOString()) as Array<{
      id: string; username: string; created_at: string; devices: number;
    }>).map((ligne) => ({ id: ligne.id, username: ligne.username, createdAt: ligne.created_at,
      devices: Number(ligne.devices) }));
}

export function creerCompteDistant(username: string, password: string): CompteDistantPublic {
  const identifiant = username.trim().toLowerCase();
  if (!identifiantCompteValide(identifiant)) {
    throw new Error("Identifiant invalide : 3 à 64 caractères, lettres, chiffres, point, tiret ou soulignement");
  }
  if (!motDePasseCompteValide(password)) throw new Error("Le mot de passe doit contenir au moins 12 caractères");
  if (db.prepare("SELECT 1 FROM remote_accounts WHERE username = ? COLLATE NOCASE").get(identifiant)) {
    throw new Error("Ce compte existe déjà");
  }
  const id = randomUUID();
  db.prepare("INSERT INTO remote_accounts (id, username, password_hash) VALUES (?, ?, ?)")
    .run(id, identifiant, hacherMotDePasse(password));
  return listerComptesDistants().find((compte) => compte.id === id)!;
}

export function supprimerCompteDistant(id: string): boolean {
  // ON DELETE CASCADE révoque en même temps tous les appareils qui dépendaient du compte.
  return Number(db.prepare("DELETE FROM remote_accounts WHERE id = ?").run(id).changes) > 0;
}

function delaiApresEchecs(essais: number): number {
  if (essais < 5) return 0;
  return Math.min(60 * 60_000, 60_000 * 2 ** (essais - 5));
}

function blocage(source: string): number {
  const ligne = db.prepare("SELECT attempts, last_attempt FROM remote_login_failures WHERE source = ?")
    .get(source) as { attempts: number; last_attempt: string } | undefined;
  if (!ligne) return 0;
  return Math.max(0, delaiApresEchecs(ligne.attempts) - (Date.now() - Date.parse(ligne.last_attempt)));
}

function echec(source: string): void {
  db.prepare(`INSERT INTO remote_login_failures (source, attempts, last_attempt) VALUES (?, 1, ?)
    ON CONFLICT(source) DO UPDATE SET attempts = attempts + 1, last_attempt = excluded.last_attempt`)
    .run(source, new Date().toISOString());
}

export function ouvrirCompteDistant(entree: { username: string; password: string; source: string; device?: string | null }):
{ token: string; expiresAt: string; account: CompteDistantPublic } {
  const attente = blocage(entree.source);
  if (attente > 0) throw new Error(`Trop de tentatives. Réessayez dans ${Math.ceil(attente / 60_000)} minute(s).`);
  const ligne = db.prepare("SELECT id, password_hash FROM remote_accounts WHERE username = ? COLLATE NOCASE")
    .get(entree.username.trim()) as { id: string; password_hash: string } | undefined;
  // Même travail scrypt pour un compte absent : la durée ne révèle pas quels identifiants existent.
  const leurre = "00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
  if (!verifierMotDePasse(entree.password, ligne?.password_hash ?? leurre) || !ligne) {
    echec(entree.source);
    throw new Error("Identifiant ou mot de passe incorrect");
  }
  db.prepare("DELETE FROM remote_login_failures WHERE source = ?").run(entree.source);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + DUREE_APPAREIL_JOURS * 86_400_000).toISOString();
  db.prepare(`INSERT INTO remote_device_sessions (token_hash, account_id, device_name, expires_at)
    VALUES (?, ?, ?, ?)`).run(empreinte(token), ligne.id, entree.device?.slice(0, 120) ?? null, expiresAt);
  return { token, expiresAt, account: listerComptesDistants().find((compte) => compte.id === ligne.id)! };
}

function cookie(request: FastifyRequest, nom: string): string | null {
  const brut = request.headers.cookie;
  if (!brut) return null;
  for (const morceau of brut.split(";")) {
    const [cle, ...reste] = morceau.trim().split("=");
    if (cle === nom) return decodeURIComponent(reste.join("="));
  }
  return null;
}

export function jetonCompteDeLaRequete(request: FastifyRequest): string | null {
  const entete = request.headers[ENTETE_COMPTE_DISTANT];
  return typeof entete === "string" ? entete : cookie(request, COOKIE_COMPTE_DISTANT);
}

export function compteDuJeton(token: string | null | undefined): { id: string; username: string } | null {
  if (typeof token !== "string" || token.length !== 64) return null;
  const hash = empreinte(token);
  const ligne = db.prepare(`SELECT a.id, a.username, s.expires_at, s.last_seen_at
    FROM remote_device_sessions s JOIN remote_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ?`).get(hash) as
    | { id: string; username: string; expires_at: string; last_seen_at: string | null } | undefined;
  if (!ligne) return null;
  if (Date.parse(ligne.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM remote_device_sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  const dernier = ligne.last_seen_at ? Date.parse(ligne.last_seen_at) : 0;
  if (Date.now() - dernier > 10 * 60_000) {
    db.prepare("UPDATE remote_device_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(new Date().toISOString(), hash);
  }
  return { id: ligne.id, username: ligne.username };
}

export function poserCookieCompte(reply: FastifyReply, token: string): void {
  reply.header("Set-Cookie", `${COOKIE_COMPTE_DISTANT}=${encodeURIComponent(token)}; Path=/; Max-Age=${DUREE_APPAREIL_JOURS * 86400}; HttpOnly; Secure; SameSite=Strict`);
}
