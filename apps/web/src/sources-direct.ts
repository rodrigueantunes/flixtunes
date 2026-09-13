/**
 * Les règles des sources d'une chaîne : dans quel ordre le repli les essaie, et comment le menu les
 * montre.
 *
 * Elles vivent à part du lecteur pour pouvoir être éprouvées sans lui, et Android les reprend à
 * l'identique dans `SourcesDirect.kt`.
 *
 * **Décidé le 13 septembre 2026.** Une chaîne regroupée porte jusqu'à quatre-vingts sources. Le repli
 * s'arrêtait à la huitième et le menu cachait le reste derrière « voir les autres » : les deux bornes
 * tombent. Toutes les sources entrent dans le repli et toutes se choisissent. Ce qui en sort, ce sont
 * celles que le serveur n'a pas pu joindre une fois qu'une autre jouait — du repli seulement, jamais
 * du menu.
 */

/**
 * Combien d'adresses une course sonde à la fois, à l'ouverture comme à chaque vague suivante.
 *
 * Toutes d'un coup, c'était une mauvaise idée : 356 chaînes du corpus en portent plus de vingt, et
 * lancer autant de requêtes pour en choisir une est un coût que personne n'a demandé. Douze suffisent
 * à écarter les mortes ; quand elles ont toutes échoué, la vague suivante court à son tour, plutôt
 * qu'un essai de douze secondes après l'autre.
 */
export const COURSE_MAX = 12;

/** Le premier rang de la vague de course qui contient ce rang. */
export function debutDeVague(index: number): number {
  return index - (index % COURSE_MAX);
}

/**
 * Le rang que le repli automatique essaie après `depuis`, ou `null` s'il n'y en a plus.
 *
 * Toutes les adresses y passent, dans l'ordre du serveur et de la course — sauf celles que le serveur
 * a trouvées muettes : les essayer ferait attendre douze secondes chacune devant un écran noir.
 */
export function prochaineAdresse(urls: readonly string[], depuis: number, muettes: ReadonlySet<string>): number | null {
  for (let index = depuis + 1; index < urls.length; index += 1) {
    if (!muettes.has(urls[index]!)) return index;
  }
  return null;
}

/**
 * Le rang où reprendre quand tout a échoué : la mieux classée de celles qui répondent.
 *
 * Si toutes se taisent, il faut bien essayer quelque chose, et la première reste la meilleure qu'on
 * connaisse.
 */
export function premiereAdresse(urls: readonly string[], muettes: ReadonlySet<string>): number {
  const trouvee = urls.findIndex((url) => !muettes.has(url));
  return trouvee === -1 ? 0 : trouvee;
}

export interface GroupeDeSources<T> {
  /** Le rang qu'on ouvre en choisissant ce groupe : son meilleur membre qui répond. */
  index: number;
  source: T;
  doublons: number;
  /** Aucun membre n'a répondu à la sonde du serveur. */
  muette: boolean;
}

/**
 * Le menu regroupe ce qui se ressemble, et range à la fin ce qui ne répond pas.
 *
 * Mesuré sur le corpus : 7 559 adresses de 1 976 chaînes ne diffèrent de leur voisine que par un jeton
 * dans la requête. Le menu en listait quatre visiblement identiques. Chaque groupe ouvre **son
 * meilleur membre qui répond** — celui que le serveur a classé le plus haut parmi les vivants —, et le
 * repli, lui, continue de parcourir chaque adresse : deux jetons ne se valent pas.
 *
 * Un groupe dont aucun membre n'a répondu passe en fin de liste, choisissable comme les autres : le
 * NAS ne voit pas forcément ce que voit le client.
 */
export function regrouperLesSources<T extends { url: string; empreinte: string }>(
  adresses: readonly T[], muettes: ReadonlySet<string> = new Set(),
): Array<GroupeDeSources<T>> {
  const membres = new Map<string, number[]>();
  adresses.forEach((source, index) => {
    const cle = source.empreinte || source.url;
    const connus = membres.get(cle);
    if (connus) connus.push(index); else membres.set(cle, [index]);
  });
  const groupes = [...membres.values()].map((indices) => {
    const vivant = indices.find((index) => !muettes.has(adresses[index]!.url));
    const index = vivant ?? indices[0]!;
    return { index, source: adresses[index]!, doublons: indices.length, muette: vivant === undefined };
  });
  return [...groupes.filter((groupe) => !groupe.muette), ...groupes.filter((groupe) => groupe.muette)];
}
