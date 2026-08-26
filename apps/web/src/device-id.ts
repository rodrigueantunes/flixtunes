/**
 * Identifiant stable de cet appareil.
 *
 * Il ne sert qu'à une chose : permettre au serveur de retenir ce qui a échoué **ici**. Un navigateur
 * annonce les codecs qu'il déclare savoir décoder, et le serveur le croit — c'est ce qui permet la
 * lecture directe, sans conversion. Mais la déclaration ment parfois : le décodeur refuse un profil
 * particulier, et la lecture s'arrête. Sans mémoire attachée à l'appareil, la même erreur se
 * reproduit à chaque lecture.
 *
 * **Ce n'est pas une identification de personne.** La valeur est tirée au hasard, ne quitte pas ce
 * navigateur, et n'est reliée à aucun profil : deux personnes partageant le même ordinateur
 * partagent le même identifiant, et c'est voulu — c'est le décodeur qu'on décrit, pas l'utilisateur.
 *
 * Elle vit dans `localStorage` parce qu'elle doit survivre au rechargement : conservée en mémoire,
 * elle changerait à chaque visite et le serveur n'apprendrait jamais rien.
 */

const CLE = "flixtunes.device-id";

/** L'identifiant de cet appareil, créé au premier appel. */
export function deviceId(): string {
  if (typeof localStorage === "undefined") return "";
  const existant = localStorage.getItem(CLE);
  if (existant && existant.length >= 6) return existant;
  // `randomUUID` manque encore sur quelques navigateurs anciens et hors contexte sécurisé ; le repli
  // n'a pas besoin d'être cryptographique, seulement d'être stable et peu susceptible de collision.
  const nouveau = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(CLE, nouveau);
  return nouveau;
}
