import { db } from "./database.js";

/**
 * Mémoire des codecs annoncés mais défaillants, par appareil.
 *
 * Un appareil déclare ce qu'il sait décoder, et le serveur le croit — c'est la base de la lecture
 * directe, celle qui évite toute conversion. Mais la déclaration ment parfois : un téléviseur annonce
 * HEVC que son décodeur refuse au-delà d'un certain profil, une box annonce AV1 sans matériel pour
 * l'assurer. La lecture démarre, puis échoue.
 *
 * Sans mémoire, la même erreur se reproduit **à chaque lecture** : le serveur repropose le codec, le
 * client échoue à nouveau, et la personne conclut que l'application est cassée. C'est un cas limite
 * nommé au dossier de l'étape 56 — « codec annoncé mais défaillant » — et c'est aussi celui qui use
 * le plus vite la patience, parce qu'il se répète.
 *
 * Trois décisions portent ce module :
 *
 * **Deux échecs avant de retenir la leçon.** Un échec isolé peut venir d'un fichier abîmé, d'un
 * réseau qui a lâché, d'un appareil en veille. Punir dès le premier priverait de lecture directe pour
 * un accident ; attendre le second distingue l'accident du défaut.
 *
 * **L'oubli au bout de trente jours.** Une mise à jour du micrologiciel corrige les décodeurs, et une
 * mise en quarantaine définitive condamnerait l'appareil à convertir pour toujours. Le compteur
 * s'efface donc de lui-même, et la vérité est réapprise.
 *
 * **La quarantaine porte sur un couple appareil + codec.** Le même codec peut être parfait sur le
 * téléviseur du salon et défaillant sur la tablette : une mémoire globale ferait payer à tous le
 * défaut d'un seul.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS device_codec_failures (
    device_id TEXT NOT NULL,
    codec TEXT NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    last_failure_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_reason TEXT,
    PRIMARY KEY(device_id, codec)
  );
  CREATE INDEX IF NOT EXISTS idx_device_codec_failures_device ON device_codec_failures(device_id);
`);

/** Nombre d'échecs à partir duquel un codec cesse d'être proposé à cet appareil. */
export const SEUIL_QUARANTAINE = 2;

/** Durée au-delà de laquelle un échec ne compte plus, en jours. */
export const OUBLI_JOURS = 30;

/** Enregistre l'échec d'un codec sur un appareil, et rend le nombre d'échecs retenus. */
export function recordCodecFailure(deviceId: string, codec: string, reason: string | null = null): number {
  const appareil = deviceId.trim();
  const nom = codec.trim().toLowerCase();
  if (!appareil || !nom) return 0;

  // Un échec plus ancien que l'oubli ne doit pas s'additionner au nouveau : le compteur repart de un,
  // sinon deux pannes séparées de plusieurs mois vaudraient un défaut permanent.
  db.prepare(`
    INSERT INTO device_codec_failures (device_id, codec, failures, last_failure_at, last_reason)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(device_id, codec) DO UPDATE SET
      failures = CASE
        WHEN device_codec_failures.last_failure_at < datetime('now', ?) THEN 1
        ELSE device_codec_failures.failures + 1 END,
      last_failure_at = CURRENT_TIMESTAMP,
      last_reason = excluded.last_reason
  `).run(appareil, nom, reason?.slice(0, 500) ?? null, `-${OUBLI_JOURS} days`);

  return Number((db.prepare("SELECT failures FROM device_codec_failures WHERE device_id = ? AND codec = ?")
    .get(appareil, nom) as { failures: number } | undefined)?.failures ?? 0);
}

/** Les codecs qu'on cesse de proposer à cet appareil. */
export function quarantinedCodecs(deviceId: string | null | undefined): string[] {
  const appareil = deviceId?.trim();
  if (!appareil) return [];
  const rows = db.prepare(`SELECT codec FROM device_codec_failures
    WHERE device_id = ? AND failures >= ? AND last_failure_at >= datetime('now', ?)`)
    .all(appareil, SEUIL_QUARANTAINE, `-${OUBLI_JOURS} days`) as Array<{ codec: string }>;
  return rows.map((row) => row.codec);
}

/**
 * Lève la quarantaine, pour un codec ou pour tout l'appareil.
 *
 * Une lecture directe qui réussit vaut démenti : le codec fonctionne, quoi qu'on ait cru. C'est ce
 * qui permet à un appareil mis à jour de retrouver la lecture directe sans attendre l'oubli.
 */
export function clearCodecQuarantine(deviceId: string, codec?: string): void {
  const appareil = deviceId.trim();
  if (!appareil) return;
  if (codec) db.prepare("DELETE FROM device_codec_failures WHERE device_id = ? AND codec = ?").run(appareil, codec.trim().toLowerCase());
  else db.prepare("DELETE FROM device_codec_failures WHERE device_id = ?").run(appareil);
}

/** État lisible, pour l'écran de diagnostic. */
export function listCodecQuarantine(): Array<{ deviceId: string; codec: string; failures: number; lastFailureAt: string; reason: string | null }> {
  const rows = db.prepare(`SELECT device_id, codec, failures, last_failure_at, last_reason
    FROM device_codec_failures ORDER BY last_failure_at DESC LIMIT 100`).all() as Array<{
      device_id: string; codec: string; failures: number; last_failure_at: string; last_reason: string | null;
    }>;
  return rows.map((row) => ({
    deviceId: row.device_id, codec: row.codec, failures: row.failures,
    lastFailureAt: row.last_failure_at, reason: row.last_reason,
  }));
}

/**
 * Retire d'une liste de codecs ceux que cet appareil a échoué à décoder.
 *
 * La liste n'est jamais vidée complètement : un appareil sans aucun codec ne pourrait plus rien lire,
 * et le serveur convertirait vers un format qu'il vient lui-même de déclarer impossible. Quand tout
 * est en quarantaine, on rend la liste d'origine — mieux vaut réessayer que garantir l'échec.
 */
export function withoutQuarantined(codecs: string[], deviceId: string | null | undefined): string[] {
  const exclus = new Set(quarantinedCodecs(deviceId));
  if (!exclus.size) return codecs;
  const restants = codecs.filter((codec) => !exclus.has(codec.toLowerCase()));
  return restants.length ? restants : codecs;
}
