/**
 * Ce que le lecteur sait du débit réellement disponible, et ce qu'il en fait.
 *
 * Le serveur décide de remultiplexer ou de convertir en comparant le débit du fichier à ce que
 * l'appareil annonce pouvoir recevoir. Sans annonce, il suppose une bande passante **illimitée** et
 * sert le fichier tel quel. Relevé sur une lecture réelle : source à 26,5 Mb/s, chemin mesuré à
 * 29,4 Mb/s, soit onze pour cent de marge — le moindre creux coupe.
 *
 * Le lecteur mesurait pourtant ce chemin depuis toujours, segment après segment, mais s'en servait
 * seulement pour l'afficher. Trois manques s'enchaînaient : la mesure n'était pas conservée d'une
 * lecture à l'autre, elle n'était jamais renvoyée, et un rebuffer ne déclenchait rien.
 *
 * Ce module ne fait aucun appel réseau et ne touche pas au lecteur : il décide, et se vérifie sans
 * navigateur.
 */

/** Ce qu'un navigateur rapporte de la connexion, quand il le rapporte. */
export interface ConnexionAnnoncee {
  downlink?: number;
  type?: string;
  effectiveType?: string;
}

const CLE_DEBIT = "flixtunes.debit";

/**
 * Le débit à annoncer au serveur, en mégabits par seconde, ou `null` s'il n'y a rien à en dire.
 *
 * La mesure prime sur la déclaration du navigateur, et de loin : `downlink` rapporte la vitesse du
 * lien **local** — cent mégabits sur un Wi-Fi domestique — qui ne dit rien du chemin jusqu'au NAS.
 * C'est pourquoi elle n'était retenue qu'en cellulaire, où le lien local *est* le goulot. Ce
 * raisonnement tenait ; ce qu'il ignorait, c'est qu'un VPN ou un réseau chargé rend le chemin bien
 * plus lent que le lien, sans qu'aucune déclaration ne le dise.
 *
 * Une mesure vaut donc mieux que tout, quel que soit le type de connexion.
 */
export function debitAnnonce(mesureMbps: number | null, connexion: ConnexionAnnoncee | null): number | null {
  if (mesureMbps != null && mesureMbps > 0) return Math.round(mesureMbps * 10) / 10;
  const cellulaire = connexion?.type === "cellular"
    || (connexion?.effectiveType != null && connexion.type == null && /^[23]g$/.test(connexion.effectiveType));
  if (cellulaire && connexion?.downlink) return connexion.downlink;
  return null;
}

/**
 * Conserve la **meilleure** mesure observée, et non la dernière.
 *
 * Retenir la dernière était un défaut sérieux : l'estimation de hls.js s'effondre pendant un
 * démarrage difficile ou un blocage, précisément quand on la relève. Une seule mauvaise valeur était
 * alors enregistrée puis renvoyée au serveur à chaque lecture suivante, qui bridait en conséquence —
 * relevé sur une source 4K à 26,5 Mb/s servie en 1280×720 à 4 Mb/s, alors que la lecture directe
 * tenait le débit d'origine sans peine. Le remède était devenu la maladie.
 *
 * Le maximum décrit ce que le chemin **sait faire** ; les creux décrivent un incident. C'est la
 * capacité qu'on veut annoncer, pas le pire moment d'une séance.
 *
 * Une valeur trop basse pour être crédible est ignorée : sous un mégabit, il s'agit d'un blocage, pas
 * d'un réseau.
 */
export const DEBIT_PLANCHER_MBPS = 1;

export function memoriserDebit(serveur: string, mesureMbps: number | null, stockage: Storage | null = null): void {
  if (mesureMbps == null || !(mesureMbps >= DEBIT_PLANCHER_MBPS)) return;
  const magasin = stockage ?? (typeof localStorage === "undefined" ? null : localStorage);
  const connu = debitMemorise(serveur, magasin);
  if (connu != null && connu >= mesureMbps) return;
  try { magasin?.setItem(`${CLE_DEBIT}:${serveur}`, String(Math.round(mesureMbps * 10) / 10)); }
  catch { /* stockage indisponible : on repart sans mémoire, ce qui n'est pas pire qu'avant */ }
}

/**
 * La mesure de la dernière lecture sur ce serveur.
 *
 * Sans elle, la première négociation d'une séance se fait toujours à l'aveugle — et c'est justement
 * celle qui décide de remultiplexer ou non.
 */
export function debitMemorise(serveur: string, stockage: Storage | null = null): number | null {
  const magasin = stockage ?? (typeof localStorage === "undefined" ? null : localStorage);
  try {
    const brut = magasin?.getItem(`${CLE_DEBIT}:${serveur}`);
    const valeur = brut == null ? Number.NaN : Number.parseFloat(brut);
    return Number.isFinite(valeur) && valeur > 0 ? valeur : null;
  } catch { return null; }
}

/** Au-delà de ce nombre de coupures, insister sur le même débit ne sert plus à rien. */
export const REBUFFERS_AVANT_REPLI = 2;

/**
 * Le plafond de débit à imposer après des coupures répétées, ou `null` s'il n'y a pas lieu.
 *
 * Une coupure isolée arrive — un creux passager, une autre machine qui télécharge. Deux coupures
 * disent autre chose : le débit demandé ne passe pas. Plutôt que de laisser la lecture hoqueter
 * indéfiniment, on redemande une session en annonçant un plafond, ce qui fait convertir le serveur au
 * lieu de servir le fichier tel quel.
 *
 * Le plafond vaut soixante-dix pour cent du chemin mesuré : la marge couvre les variations qui ont
 * causé les coupures, et descendre davantage dégraderait l'image sans nécessité.
 */
export function plafondApresCoupures(mesureMbps: number | null, coupures: number): number | null {
  if (coupures < REBUFFERS_AVANT_REPLI || mesureMbps == null || !(mesureMbps > 0)) return null;
  return Math.max(1_000_000, Math.round(mesureMbps * 1_000_000 * 0.7));
}
