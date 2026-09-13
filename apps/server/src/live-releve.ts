/**
 * Le relevé des sondes : ce que l'outil qui écrit le fichier de listes a mesuré de chaque adresse.
 *
 * Le fichier de listes dit quelles listes existent et ce qu'elles valent ; il ne dit rien des adresses
 * une à une. C'est pourtant là que se joue le choix des premières sources d'une chaîne — une chaîne
 * regroupée en porte jusqu'à quatre-vingts. Le relevé, écrit à côté, apporte cette mesure sans
 * alourdir `m3u.json`, que le serveur plafonne à deux mégaoctets.
 *
 * Format, version 1 :
 *
 * ```json
 * { "version": 1, "genere_le": "2026-09-14T07:05:00+00:00", "joignables": ["http://…"], "muettes": ["http://…"] }
 * ```
 *
 * Absent, illisible ou vieux de plus d'un jour, il ne compte pas : le classement d'avant s'applique. Un
 * relevé périmé dirait « morte » d'une adresse revenue depuis, et la rangerait en fin de liste pour
 * rien.
 */

export const FICHIER_RELEVE = "sondes.json";

/** Cent trente mille adresses font une douzaine de mégaoctets : le plafond laisse large, sans être infini. */
export const RELEVE_MAX_OCTETS = 64 * 1024 * 1024;

const FRAICHEUR_MS = 24 * 60 * 60 * 1000;

/** `1` : joignable au relevé ; `0` : muette. Une adresse absente du relevé n'y figure pas. */
export type Releve = ReadonlyMap<string, 0 | 1>;

export function lireLeReleve(json: string, maintenant = Date.now()): Releve | null {
  let lu: unknown;
  try { lu = JSON.parse(json); } catch { return null; }
  if (!lu || typeof lu !== "object" || Array.isArray(lu)) return null;
  const { version, genere_le: genereLe, joignables, muettes } = lu as Record<string, unknown>;
  if (version !== 1 || typeof genereLe !== "string") return null;
  const date = Date.parse(genereLe);
  // Une date à venir de plus d'un jour est une horloge fausse, pas un relevé frais.
  if (!Number.isFinite(date) || Math.abs(maintenant - date) > FRAICHEUR_MS) return null;

  const releve = new Map<string, 0 | 1>();
  for (const url of Array.isArray(muettes) ? muettes : []) if (typeof url === "string") releve.set(url, 0);
  // Une adresse muette dans une liste et joignable dans une autre a répondu au moins une fois : elle compte.
  for (const url of Array.isArray(joignables) ? joignables : []) if (typeof url === "string") releve.set(url, 1);
  return releve;
}
