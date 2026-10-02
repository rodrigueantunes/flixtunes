import { db } from "./database.js";

const SEMAINE = 7 * 24 * 60 * 60_000;

const LECTEURS_WEB = new Set(["web-chromium", "web-firefox", "web-safari", "web-autre", "bureau-vlc"]);
export function lecteurWeb(valeur: unknown): string | null {
  return typeof valeur === "string" && LECTEURS_WEB.has(valeur) ? valeur : null;
}

/** Une incompatibilité du navigateur ne dégrade pas les résultats des autres clients. */
export function classerPourLecteur<T extends { url: string }>(chaine: string, sources: T[], contexte: string,
  lecteur: string | null, maintenant = Date.now()): Array<T & { cheminPrefere?: "relais" }> {
  if (!lecteur) return classerParStabilite(chaine, sources, contexte, maintenant);
  const mesures = db.prepare(`SELECT url,contexte,secondes,incidents,repos_jusqua FROM live_stabilite
    WHERE chaine=? AND contexte IN (?,?) AND mesure_le>=?`).all(chaine,
    `${contexte}:${lecteur}:direct`, `${contexte}:${lecteur}:relais`, maintenant - SEMAINE) as
    Array<{ url: string; contexte: string; secondes: number; incidents: number; repos_jusqua: number }>;
  const score = (m: typeof mesures[number] | undefined) => !m ? 0
    : (m.repos_jusqua > maintenant ? -10_000 : 0) + m.secondes / (1 + m.incidents);
  const resultat = sources.map((source) => {
    const directe = mesures.find((m) => m.url === source.url && m.contexte.endsWith(":direct"));
    const relais = mesures.find((m) => m.url === source.url && m.contexte.endsWith(":relais"));
    const prefererRelais = score(relais) > score(directe) && relais && relais.secondes > 0;
    return { source: { ...source, ...(prefererRelais ? { cheminPrefere: "relais" as const } : {}) },
      score: Math.max(score(directe), score(relais)) };
  });
  return resultat.sort((a, b) => b.score - a.score).map((r) => r.source);
}

/** Mesures de lecture, séparées entre le LAN et chaque profil distant. */
export function noterStabilite(chaine: string, url: string, contexte: string,
  secondes: number, incident: boolean, maintenant = Date.now()): void {
  if (!db.prepare("SELECT 1 FROM live_channel_urls WHERE channel_id = ? AND url = ?").get(chaine, url)) return;
  db.prepare("DELETE FROM live_stabilite WHERE mesure_le < ?").run(maintenant - SEMAINE);
  const avant = db.prepare("SELECT mesure_le FROM live_stabilite WHERE chaine = ? AND url = ? AND contexte = ?")
    .get(chaine, url, contexte) as { mesure_le: number } | undefined;
  // Un client qui répète son rapport ne gonfle pas le classement.
  if (avant && maintenant - avant.mesure_le < 30_000) return;
  db.prepare(`INSERT INTO live_stabilite (chaine,url,contexte,secondes,incidents,repos_jusqua,mesure_le)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(chaine,url,contexte) DO UPDATE SET
    secondes = MIN(3600, live_stabilite.secondes + excluded.secondes),
    incidents = MIN(30, live_stabilite.incidents + excluded.incidents),
    repos_jusqua = excluded.repos_jusqua, mesure_le = excluded.mesure_le`)
    .run(chaine, url, contexte, Math.max(0, Math.min(120, Math.floor(secondes))), incident ? 1 : 0,
      incident ? maintenant + 120_000 : 0, maintenant);
}

export function classerParStabilite<T extends { url: string }>(chaine: string, sources: T[],
  contexte = "lan", maintenant = Date.now()): T[] {
  const mesures = db.prepare(`SELECT url,secondes,incidents,repos_jusqua FROM live_stabilite
    WHERE chaine = ? AND contexte = ? AND mesure_le >= ?`).all(chaine, contexte, maintenant - SEMAINE) as
    Array<{ url: string; secondes: number; incidents: number; repos_jusqua: number }>;
  const index = new Map(mesures.map((m) => [m.url, m]));
  const score = (url: string) => {
    const m = index.get(url);
    return m ? (m.repos_jusqua > maintenant ? -10_000 : 0) + m.secondes / (1 + m.incidents) : 0;
  };
  // Le tri stable conserve le classement existant lorsque rien n'a encore été mesuré.
  return [...sources].sort((a, b) => score(b.url) - score(a.url));
}
