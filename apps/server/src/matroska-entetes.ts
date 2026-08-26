import { open } from "node:fs/promises";

/**
 * Où un Matroska range la définition de ses pistes.
 *
 * Matroska autorise l'élément `Tracks` — celui qui dit « piste 1 : HEVC, piste 2 : AAC » — à se
 * trouver **après** les données vidéo, tout à la fin du fichier. Le `SeekHead` posé en tête y
 * renvoie, et un démultiplexeur qui sait se déplacer dans le fichier suit ce renvoi sans y penser :
 * c'est ce que fait FFmpeg, donc le serveur, donc le navigateur.
 *
 * Media3 analyse le flux **linéairement**. Il rencontre les premiers Clusters avant d'avoir vu la
 * moindre définition de piste, et n'a alors ni vidéo, ni audio, ni table de positions. À l'écran :
 * une image noire, aucun son, aucune avance rapide. Et surtout **aucune erreur** — rien n'est
 * malformé de son point de vue — donc aucun repli automatique ne se déclenche et aucun codec n'est
 * mis en cause. C'est le seul mode de panne de la lecture directe qu'aucun signal ne rattrape.
 *
 * Constaté le 25 août 2026 sur deux séries dont les pistes tiennent dans les 329 derniers octets du
 * fichier, quand un fichier ordinaire les place vers l'octet 4 000.
 *
 * Le remède ne coûte rien : un remux réécrit l'en-tête en tête de flux, sans toucher à l'image.
 * Encore faut-il savoir qu'il est nécessaire, et c'est ce que mesure ce module.
 */

/** Identifiants EBML de premier niveau, tels qu'ils apparaissent dans le fichier, marqueur compris. */
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const SEGMENT = 0x18538067;

/** Ce qu'il faut lire pour trancher : quelques en-têtes, jamais les données. */
const FENETRE = 4096;

/** Une lecture positionnée, pour que l'analyse se vérifie sans fichier. */
export type LecteurOctets = (position: number, longueur: number) => Promise<Uint8Array>;

/** Un identifiant EBML et sa longueur, ou `null` si les octets ne forment pas un identifiant. */
function lireIdentifiant(octets: Uint8Array, debut: number): { valeur: number; taille: number } | null {
  const premier = octets[debut];
  if (premier == null || premier === 0) return null;
  let taille = 1;
  for (let masque = 0x80; masque > 0 && (premier & masque) === 0; masque >>= 1) taille += 1;
  if (taille > 4 || debut + taille > octets.length) return null;
  let valeur = 0;
  for (let index = 0; index < taille; index += 1) valeur = valeur * 256 + (octets[debut + index] ?? 0);
  return { valeur, taille };
}

/**
 * La taille d'un élément, ou `null` quand elle est inconnue.
 *
 * Une taille dont tous les bits utiles valent 1 signifie « je ne sais pas encore » : les fichiers
 * écrits en direct s'en servent pour le Segment. On ne peut alors plus sauter d'élément en élément.
 */
function lireTaille(octets: Uint8Array, debut: number): { valeur: number | null; taille: number } | null {
  const premier = octets[debut];
  if (premier == null || premier === 0) return null;
  let taille = 1;
  for (let masque = 0x80; masque > 0 && (premier & masque) === 0; masque >>= 1) taille += 1;
  if (taille > 8 || debut + taille > octets.length) return null;
  let valeur = premier & (0xff >> taille);
  let inconnue = valeur === (0xff >> taille);
  for (let index = 1; index < taille; index += 1) {
    const octet = octets[debut + index] ?? 0;
    if (octet !== 0xff) inconnue = false;
    valeur = valeur * 256 + octet;
  }
  return { valeur: inconnue ? null : valeur, taille };
}

/**
 * Les pistes de ce Matroska sont-elles définies après les données ?
 *
 * Parcourt les éléments de premier niveau en ne lisant que leurs en-têtes, et s'arrête au premier des
 * deux qui se présente. `Tracks` d'abord : le fichier se lit d'un bout à l'autre, tout va bien.
 * `Cluster` d'abord : un lecteur linéaire arrivera aux données sans savoir quoi en faire.
 *
 * **Le doute profite au fichier.** Toute difficulté d'analyse — taille inconnue, identifiant
 * inattendu, lecture trop courte — renvoie `false`. Se tromper dans ce sens coûte le défaut qu'on
 * connaît déjà ; se tromper dans l'autre imposerait un remux à des fichiers parfaitement sains.
 */
export async function pistesApresLesDonnees(lire: LecteurOctets): Promise<boolean> {
  let position = 0;
  // Deux niveaux seulement : les éléments de tête, puis les enfants du Segment.
  for (let elements = 0; elements < 64; elements += 1) {
    const octets = await lire(position, 16);
    if (octets.length < 2) return false;
    const identifiant = lireIdentifiant(octets, 0);
    if (!identifiant) return false;
    const taille = lireTaille(octets, identifiant.taille);
    if (!taille) return false;
    const entete = identifiant.taille + taille.taille;

    if (identifiant.valeur === TRACKS) return false;
    if (identifiant.valeur === CLUSTER) return true;
    // On entre dans le Segment plutôt que de le sauter : c'est lui qui contient tout le reste.
    if (identifiant.valeur === SEGMENT) { position += entete; continue; }
    if (taille.valeur == null) return false;
    position += entete + taille.valeur;
  }
  return false;
}

/** La même question, posée à un fichier. */
export async function pistesApresLesDonneesDuFichier(chemin: string): Promise<boolean> {
  const fichier = await open(chemin, "r").catch(() => null);
  if (!fichier) return false;
  try {
    return await pistesApresLesDonnees(async (position, longueur) => {
      const tampon = Buffer.alloc(Math.min(longueur, FENETRE));
      const { bytesRead } = await fichier.read(tampon, 0, tampon.length, position);
      return tampon.subarray(0, bytesRead);
    });
  } catch {
    return false;
  } finally {
    await fichier.close().catch(() => undefined);
  }
}
