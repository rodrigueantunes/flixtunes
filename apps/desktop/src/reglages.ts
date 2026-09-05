import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
  /*
   * **On écrit à côté, puis on renomme.**
   *
   * L'écriture allait droit sur le fichier définitif. Une coupure de courant, une fermeture de
   * session ou un arrêt brutal pendant ces quelques millisecondes laissait un JSON tronqué. La
   * lecture le tolère — elle ne bloque pas le démarrage —, mais l'adresse du serveur était
   * perdue, et il fallait la ressaisir sans jamais comprendre pourquoi.
   *
   * Un renommage sur le même volume est atomique sur les trois systèmes : à tout instant le
   * fichier est soit l'ancien complet, soit le nouveau complet, jamais un mélange des deux.
   */
  const contenu = `${JSON.stringify(reglages, null, 2)}\n`;
  const definitif = path.join(dossierDonnees, "reglages.json");
  const provisoire = path.join(dossierDonnees, `reglages.json.${process.pid}.tmp`);
  writeFileSync(provisoire, contenu, "utf8");
  try {
    renameSync(provisoire, definitif);
  } catch {
    /*
     * Windows refuse parfois de renommer sur un fichier qu'un antivirus tient ouvert. Perdre le
     * réglage pour cela serait absurde : on retombe sur l'écriture directe, moins sûre mais pas
     * pire que ce qui existait avant.
     */
    writeFileSync(definitif, contenu, "utf8");
    try { unlinkSync(provisoire); } catch { /* déjà parti */ }
  }
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

/**
 * Le flux qu'on s'apprête à confier à VLC vient-il bien du serveur auquel la coque est connectée ?
 *
 * La question n'est pas de principe. Le pont est offert à une page **chargée depuis le réseau**, et
 * « ouvre ceci dans VLC » est le genre de pouvoir qu'on n'accorde pas sans le borner : sans cette
 * vérification, n'importe quel script de cette page pourrait faire ouvrir un fichier du disque, ou
 * une adresse quelconque d'Internet. Le serveur du foyer, et rien d'autre.
 *
 * Seuls `http` et `https` passent — pas de `file:`, pas de `smb:`, pas de protocole exotique dont
 * VLC connaît la liste bien mieux que nous.
 */
export function memeServeur(uri: string, serveur: string | null): boolean {
  if (!serveur) return false;
  try {
    const flux = new URL(uri);
    if (flux.protocol !== "http:" && flux.protocol !== "https:") return false;
    return flux.origin === new URL(serveur).origin;
  } catch {
    return false;
  }
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
