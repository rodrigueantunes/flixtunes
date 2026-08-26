import type { CommandeAppareil, AppareilConnecte } from "@flixtunes/contracts";

/**
 * Le registre des appareils pilotables, et les ordres qui leur sont adressés.
 *
 * L'étape 56 demande qu'un téléphone puisse commander le lecteur d'un téléviseur. La difficulté n'est
 * pas d'envoyer un ordre : c'est de savoir à qui, et de ne pas fabriquer un état qui survivrait à
 * l'appareil qu'il décrit.
 *
 * Deux choix gouvernent ce module.
 *
 * **Rien n'est persisté.** Un appareil éteint n'existe plus, et le redémarrage du serveur remet le
 * registre à zéro — ce qui est correct : la liste décrit ce qui écoute maintenant, pas ce qui a écouté
 * un jour. Une liste conservée en base afficherait un téléviseur débranché depuis trois semaines comme
 * une cible valide, et l'ordre envoyé se perdrait sans que rien ne le dise.
 *
 * **Le contrôleur ne relaie jamais la vidéo.** Il dépose un ordre, la cible le retire et négocie
 * elle-même sa lecture avec le serveur. C'est la règle que l'étape 58 reprendra pour le transfert de
 * session et le multiroom ; la poser ici évite d'avoir à défaire un raccourci plus tard.
 *
 * L'authentification et la propriété transférable de session appartiennent à l'étape 58. Ce module
 * s'en tient à ce que l'étape 56 demande, sans préempter la suite.
 */

/** Au-delà de ce silence, un appareil est considéré comme parti. */
export const DELAI_PRESENCE_MS = 30_000;

/** Ce qu'une cible peut accumuler avant qu'on cesse d'empiler. */
const ORDRES_MAX = 20;

interface Inscription {
  appareil: AppareilConnecte;
  ordres: CommandeAppareil[];
}

const registre = new Map<string, Inscription>();

/**
 * Annonce ou renouvelle la présence d'un appareil.
 *
 * Le même appel sert à s'inscrire et à battre : distinguer les deux obligerait la cible à savoir si
 * elle est déjà connue, ce qu'elle ne peut pas garantir après un redémarrage du serveur.
 */
export function annoncerAppareil(appareil: Omit<AppareilConnecte, "vuA">, maintenant = Date.now()): AppareilConnecte {
  const existant = registre.get(appareil.id);
  const inscrit: AppareilConnecte = { ...appareil, vuA: maintenant };
  if (existant) existant.appareil = inscrit;
  else registre.set(appareil.id, { appareil: inscrit, ordres: [] });
  return inscrit;
}

/** Les appareils qui ont donné signe de vie récemment, du plus récemment vu au plus ancien. */
export function appareilsActifs(maintenant = Date.now()): AppareilConnecte[] {
  const actifs: AppareilConnecte[] = [];
  for (const [id, inscription] of registre) {
    if (maintenant - inscription.appareil.vuA > DELAI_PRESENCE_MS) {
      // Un appareil parti emporte ses ordres en attente. Les garder ferait qu'un téléviseur rallumé
      // une heure plus tard exécuterait un ordre donné pour une autre soirée.
      registre.delete(id);
      continue;
    }
    actifs.push(inscription.appareil);
  }
  return actifs.sort((a, b) => b.vuA - a.vuA);
}

/**
 * Dépose un ordre pour une cible.
 *
 * Rend `false` si la cible est inconnue ou silencieuse : l'appelant doit pouvoir le dire à la personne
 * plutôt que de laisser croire que l'ordre est parti. C'est le défaut le plus déroutant d'une
 * télécommande — appuyer sans rien voir se produire, et sans savoir si l'appareil a reçu ou refusé.
 */
export function envoyerCommande(id: string, commande: CommandeAppareil, maintenant = Date.now()): boolean {
  const inscription = registre.get(id);
  if (!inscription || maintenant - inscription.appareil.vuA > DELAI_PRESENCE_MS) return false;
  // Une cible qui ne retire plus ses ordres est une cible qui ne répond plus : on cesse d'empiler
  // plutôt que de laisser la file croître sans fin, et le plus ancien cède la place au plus récent.
  if (inscription.ordres.length >= ORDRES_MAX) inscription.ordres.shift();
  inscription.ordres.push(commande);
  return true;
}

/**
 * Retire les ordres en attente pour une cible, et renouvelle sa présence au passage.
 *
 * Le retrait vaut battement : une cible qui vient chercher ses ordres est vivante par définition, et
 * exiger un appel séparé doublerait le trafic pour ne rien apprendre de plus.
 */
export function retirerCommandes(id: string, maintenant = Date.now()): CommandeAppareil[] {
  const inscription = registre.get(id);
  if (!inscription) return [];
  inscription.appareil = { ...inscription.appareil, vuA: maintenant };
  const ordres = inscription.ordres;
  inscription.ordres = [];
  return ordres;
}

/** Uniquement pour les tests : vide le registre sans toucher à rien d'autre. */
export function oublierAppareils(): void {
  registre.clear();
}
