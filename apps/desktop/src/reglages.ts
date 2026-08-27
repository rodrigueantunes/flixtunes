import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Ce que la coque retient d'une session à l'autre.
 *
 * Une seule valeur pour l'instant : l'adresse du serveur. Le reste — profil, jeton distant — vit dans
 * le client Web, qui a déjà tout ce qu'il faut pour les garder ; la coque n'a pas à les connaître, et
 * moins elle en sait, moins elle a de raisons de diverger.
 *
 * Le fichier vit dans le répertoire de données de l'application, jamais à côté du programme : sous
 * Windows comme sous Linux, le programme peut être installé dans un dossier où l'on n'écrit pas.
 */
export interface ReglagesBureau {
  serveur: string | null;
}

const VIDE: ReglagesBureau = { serveur: null };

export function lireReglages(dossierDonnees: string): ReglagesBureau {
  try {
    const brut = readFileSync(path.join(dossierDonnees, "reglages.json"), "utf8");
    const lu = JSON.parse(brut) as Partial<ReglagesBureau>;
    return { serveur: typeof lu.serveur === "string" && lu.serveur.trim() ? lu.serveur.trim() : null };
  } catch {
    // Premier démarrage, fichier effacé, contenu illisible : dans les trois cas, on repart de zéro
    // plutôt que d'empêcher l'application de s'ouvrir.
    return { ...VIDE };
  }
}

export function ecrireReglages(dossierDonnees: string, reglages: ReglagesBureau): void {
  mkdirSync(dossierDonnees, { recursive: true });
  writeFileSync(path.join(dossierDonnees, "reglages.json"), `${JSON.stringify(reglages, null, 2)}\n`, "utf8");
}

/**
 * Normalise ce que la personne a tapé en une adresse utilisable.
 *
 * On accepte `192.168.1.50`, `192.168.1.50:4000`, `nas.local`, `http://…`, `https://…`, avec ou sans
 * barre finale. Sans schéma, on choisit `http` pour une adresse locale et `https` sinon : c'est la
 * même règle que le client Android, et elle interdit qu'un accès distant retombe en clair.
 */
export function normaliserAdresse(saisie: string): string | null {
  const texte = saisie.trim();
  if (!texte) return null;
  const avecSchema = /^https?:\/\//i.test(texte) ? texte : null;
  const hote = (avecSchema ?? `http://${texte}`).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(hote);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  if (!avecSchema) {
    url.protocol = estLocale(url.hostname) ? "http:" : "https:";
    if (!/:\d+$/.test(texte) && estLocale(url.hostname)) url.port = "4000";
  }
  return `${url.protocol}//${url.host}`;
}

/** Une adresse du réseau domestique, par opposition à un nom public. */
export function estLocale(hote: string): boolean {
  if (hote === "localhost" || hote.endsWith(".local")) return true;
  const octets = hote.split(".");
  if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) return false;
  const [a, b] = octets.map(Number) as [number, number, number, number];
  return a === 10
    || a === 127
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31);
}
