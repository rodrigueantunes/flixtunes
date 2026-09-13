import { createHash, randomBytes } from "node:crypto";
import { db, getSetting, setSetting } from "./database.js";
import { secureSecretEqual } from "./security.js";

/**
 * La demande de relecture du direct, et le jeton qui l'autorise.
 *
 * Le fichier de listes est réécrit par un outil extérieur, qui sait mieux que personne quand il a
 * fini. Relire à heure fixe relisait trop tôt l'ancien fichier, ou faisait attendre le nouveau pour
 * rien : décidé le 13 septembre 2026, FlixTunes attend désormais qu'on le lui demande.
 *
 * La demande vient d'un programme, pas d'une personne : elle ne peut pas passer par une session. Elle
 * a donc un jeton à elle, créé à l'écran du direct et montré **une seule fois**. Seule son empreinte
 * est gardée en base — une copie de la base ne donne pas le jeton —, et le révoquer suffit à fermer la
 * porte.
 */
const CLE = "live.jeton_demande";

function empreinte(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

/** Crée un jeton et remplace le précédent : un jeton égaré se remplace sans avoir à le retrouver. */
export function genererJetonDemande(): string {
  const jeton = randomBytes(32).toString("base64url");
  setSetting(CLE, empreinte(jeton));
  return jeton;
}

export function revoquerJetonDemande(): void {
  db.prepare("DELETE FROM server_settings WHERE key = ?").run(CLE);
}

export function jetonDemandeConfigure(): boolean {
  return getSetting(CLE) !== null;
}

export function jetonDemandeValide(candidat: unknown): boolean {
  const attendue = getSetting(CLE);
  if (!attendue || typeof candidat !== "string" || !candidat) return false;
  return secureSecretEqual(empreinte(candidat), attendue);
}
