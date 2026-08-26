import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./database.js";

/**
 * Les sessions de profil, et ce qui empêche de les deviner.
 *
 * Un déverrouillage par code PIN ouvre une session ; cette session est ensuite le seul titre d'accès
 * présenté par un client. Sur le réseau local elle n'était qu'un confort — tout était lisible sans
 * elle. Depuis l'accès distant, elle est le rempart, et ce module la traite comme tel.
 *
 * Trois choix gouvernent ce fichier.
 *
 * **Le jeton n'est jamais enregistré, seule son empreinte l'est.** Une sauvegarde de la base peut
 * sortir de la maison ; si elle contenait les jetons eux-mêmes, elle donnerait accès à tous les
 * profils ouverts, longtemps après. Une empreinte SHA-256 ne se rejoue pas.
 *
 * **Le cookie est lu et écrit à la main.** `<video>`, `<img>` et `<track>` ne peuvent porter aucun
 * en-tête : sans cookie, le flux vidéo et les jaquettes resteraient ouverts alors que l'API serait
 * gardée — c'est-à-dire l'essentiel du problème non résolu. Un seul cookie, de format connu, ne
 * justifie pas d'ajouter une dépendance à installer sur un partage réseau réputé fragile.
 *
 * **Le compteur d'échecs est persisté.** Gardé en mémoire, il serait remis à zéro par un
 * redémarrage — que l'on peut provoquer. Un million de combinaisons ne tient que si le
 * ralentissement survit au redémarrage.
 */

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Profil imposé par la session distante.
     *
     * Sur l'écoute WAN, le profil ne peut pas être choisi par la requête : sans cela, un jeton
     * valide pour un profil permettrait de lire la progression, la liste et les recommandations de
     * n'importe quel autre en changeant simplement `profileId` dans la chaîne de requête. Le
     * paramètre reste accepté sur le réseau local, où il n'a jamais protégé quoi que ce soit.
     */
    profilImpose?: string;
    /**
     * Vrai lorsque la requête est arrivée par l'écoute distante.
     *
     * Posé par le garde de `app.ts` avant tout contrôle, y compris pour les routes ouvertes sans
     * session : le déverrouillage doit savoir d'où on l'appelle pour exiger un PIN plus long et
     * poser un cookie.
     */
    expositionWan?: boolean;
  }
}

export const NOM_COOKIE_SESSION = "flixtunes_session";
export const ENTETE_SESSION = "x-flixtunes-profile-token";

/** Longueur minimale d'un PIN pour qu'un profil soit joignable depuis Internet. */
export const PIN_MINIMUM_DISTANT = 6;

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

export interface Session {
  profileId: string;
  origine: "lan" | "wan";
  expiresAt: string;
}

export function ouvrirSession(entree: {
  profileId: string; origine: "lan" | "wan"; appareil?: string | null; dureeHeures: number;
}): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + entree.dureeHeures * 3_600_000).toISOString();
  db.prepare(`INSERT INTO profile_sessions (token_hash, profile_id, origine, appareil, expires_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run(empreinte(token), entree.profileId, entree.origine, entree.appareil ?? null, expiresAt);
  return { token, expiresAt };
}

/**
 * Rend la session d'un jeton, ou `null`.
 *
 * La date de dernier usage n'est rafraîchie qu'au-delà d'une minute : un lecteur vidéo réclame un
 * segment toutes les quelques secondes, et une écriture par segment ferait de cette table le point
 * chaud de la base pendant chaque film.
 */
export function sessionDuJeton(token: string | null | undefined): Session | null {
  if (typeof token !== "string" || token.length !== 64) return null;
  const ligne = db.prepare(`SELECT profile_id, origine, expires_at, last_seen_at
    FROM profile_sessions WHERE token_hash = ?`).get(empreinte(token)) as
    | { profile_id: string; origine: string; expires_at: string; last_seen_at: string | null }
    | undefined;
  if (!ligne) return null;
  if (Date.parse(ligne.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM profile_sessions WHERE token_hash = ?").run(empreinte(token));
    return null;
  }
  const vu = ligne.last_seen_at ? Date.parse(ligne.last_seen_at) : 0;
  if (Date.now() - vu > 60_000) {
    db.prepare("UPDATE profile_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(new Date().toISOString(), empreinte(token));
  }
  return {
    profileId: ligne.profile_id,
    origine: ligne.origine === "wan" ? "wan" : "lan",
    expiresAt: ligne.expires_at,
  };
}

export function revoquerSession(token: string): void {
  db.prepare("DELETE FROM profile_sessions WHERE token_hash = ?").run(empreinte(token));
}

/** Utilisée quand le PIN change : les sessions ouvertes avec l'ancien code ne valent plus rien. */
export function revoquerSessionsDuProfil(profileId: string): number {
  return Number(db.prepare("DELETE FROM profile_sessions WHERE profile_id = ?").run(profileId).changes);
}

export function purgerSessionsExpirees(): number {
  return Number(db.prepare("DELETE FROM profile_sessions WHERE expires_at <= ?")
    .run(new Date().toISOString()).changes);
}

export function sessionsDuProfil(profileId: string): Array<{
  appareil: string | null; origine: string; createdAt: string; lastSeenAt: string | null; expiresAt: string;
}> {
  return (db.prepare(`SELECT appareil, origine, created_at, last_seen_at, expires_at
    FROM profile_sessions WHERE profile_id = ? ORDER BY created_at DESC`).all(profileId) as Array<{
      appareil: string | null; origine: string; created_at: string;
      last_seen_at: string | null; expires_at: string;
    }>).map((ligne) => ({
      appareil: ligne.appareil, origine: ligne.origine, createdAt: ligne.created_at,
      lastSeenAt: ligne.last_seen_at, expiresAt: ligne.expires_at,
    }));
}

// --- Jeton porté par une requête -----------------------------------------------------------------

/**
 * Extrait un cookie sans dépendance.
 *
 * Le format est une liste `nom=valeur` séparée par `; `. On ne décode pas la valeur : le jeton est
 * fait de chiffres hexadécimaux, qu'aucun encodage ne modifie.
 */
export function cookieDeLaRequete(entete: string | undefined, nom: string): string | null {
  if (!entete) return null;
  for (const morceau of entete.split(";")) {
    const separateur = morceau.indexOf("=");
    if (separateur < 0) continue;
    if (morceau.slice(0, separateur).trim() !== nom) continue;
    return morceau.slice(separateur + 1).trim() || null;
  }
  return null;
}

/**
 * Le jeton présenté par une requête, quel que soit son moyen de transport.
 *
 * L'en-tête sert aux clients qui savent en poser un — Android, et les appels d'API du navigateur.
 * Le cookie sert à ce qui ne le peut pas : la balise vidéo, les images, les pistes de sous-titres.
 * Les deux mènent au même contrôle.
 */
export function jetonDeLaRequete(request: FastifyRequest): string | null {
  const entete = request.headers[ENTETE_SESSION];
  if (typeof entete === "string" && entete) return entete;
  return cookieDeLaRequete(request.headers.cookie, NOM_COOKIE_SESSION);
}

/**
 * Pose le cookie de session.
 *
 * `HttpOnly` met le jeton hors de portée de tout script, donc d'une éventuelle injection dans
 * l'interface. `Secure` interdit qu'il parte en clair. `SameSite=Strict` fait qu'aucun site tiers ne
 * peut déclencher de requête authentifiée vers le serveur — la médiathèque ne se pilote pas depuis
 * une page ouverte ailleurs.
 */
export function poserCookieSession(reply: FastifyReply, token: string, dureeHeures: number): void {
  const secondes = Math.round(dureeHeures * 3600);
  reply.header("Set-Cookie",
    `${NOM_COOKIE_SESSION}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${secondes}`);
}

export function effacerCookieSession(reply: FastifyReply): void {
  reply.header("Set-Cookie", `${NOM_COOKIE_SESSION}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

// --- Ralentissement des essais de PIN -------------------------------------------------------------

/** Au-delà de ce nombre d'échecs, chaque essai supplémentaire doit attendre. */
const ESSAIS_LIBRES = 5;
/** Plafond du délai imposé. Au-delà, inutile d'aller plus loin : le rythme est déjà dérisoire. */
const ATTENTE_MAXIMALE_MS = 3_600_000;

/**
 * Délai imposé après `essais` échecs : rien jusqu'à cinq, puis doublement à partir d'une minute.
 *
 * Au dixième échec l'attente est de trente-deux minutes, et le plafond d'une heure tombe au onzième :
 * moins de vingt-cinq essais par jour depuis une même source, soit plus d'un siècle pour parcourir un
 * million de combinaisons. Le calcul n'a pas besoin d'être plus sévère, il a besoin d'être certain.
 */
export function attenteApresEchecs(essais: number): number {
  if (essais < ESSAIS_LIBRES) return 0;
  return Math.min(ATTENTE_MAXIMALE_MS, 60_000 * 2 ** (essais - ESSAIS_LIBRES));
}

/**
 * Le blocage s'applique par **source** — l'adresse du demandeur —, non par profil.
 *
 * Bloquer par profil laisserait un attaquant parcourir les profils l'un après l'autre sans jamais
 * ralentir, et permettrait surtout de verrouiller le profil de quelqu'un d'autre depuis n'importe
 * où : une attaque par déni de service triviale contre une personne précise.
 */
export function blocageDeverrouillage(source: string): { bloque: boolean; attenteMs: number } {
  const ligne = db.prepare("SELECT essais, dernier_essai FROM profile_unlock_failures WHERE source = ?")
    .get(source) as { essais: number; dernier_essai: string } | undefined;
  if (!ligne) return { bloque: false, attenteMs: 0 };
  const attendu = attenteApresEchecs(ligne.essais);
  const ecoule = Date.now() - Date.parse(ligne.dernier_essai);
  const reste = attendu - ecoule;
  return reste > 0 ? { bloque: true, attenteMs: reste } : { bloque: false, attenteMs: 0 };
}

export function enregistrerEchec(source: string): number {
  db.prepare(`INSERT INTO profile_unlock_failures (source, essais, dernier_essai)
    VALUES (?, 1, ?)
    ON CONFLICT(source) DO UPDATE SET essais = essais + 1, dernier_essai = excluded.dernier_essai`)
    .run(source, new Date().toISOString());
  const ligne = db.prepare("SELECT essais FROM profile_unlock_failures WHERE source = ?")
    .get(source) as { essais: number };
  return ligne.essais;
}

export function oublierEchecs(source: string): void {
  db.prepare("DELETE FROM profile_unlock_failures WHERE source = ?").run(source);
}

/** Comparaison à temps constant, pour ne pas renseigner sur un préfixe correct. */
export function jetonsEgaux(gauche: string, droite: string): boolean {
  const a = Buffer.from(gauche);
  const b = Buffer.from(droite);
  return a.length === b.length && timingSafeEqual(a, b);
}
