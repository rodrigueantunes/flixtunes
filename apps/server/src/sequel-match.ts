/**
 * Reconnaissance des suites, dont le titre officiel n'affiche presque jamais le numéro.
 *
 * Une médiathèque nomme ses fichiers par commodité : `Dune 2`, `Ant-Man 2`. Les fournisseurs, eux,
 * emploient le titre de sortie — *Dune : Deuxième partie*, *Ant-Man et la Guêpe*. Rien ne relie
 * littéralement les deux, et le calcul de similarité les rapproche mal : mesuré sur la médiathèque
 * réelle, le bon film ressortait à 0,615 et 0,731, sous le seuil d'acceptation. Le moteur ne se
 * trompait pas — il n'osait pas trancher, et il fallait corriger à la main.
 *
 * Le danger est de l'autre côté : en retirant le « 2 », la recherche tombe **exactement** sur le
 * premier volet, qui obtient alors un score parfait. C'est pourquoi la reconnaissance ne se contente
 * jamais du titre de base : il faut une confirmation, soit le rang exprimé dans le titre, soit l'année.
 */

/** Le titre sans son numéro de suite, et ce numéro — ou `null` si le titre n'en porte pas. */
export function separerRangSuite(titre: string): { base: string; rang: number } | null {
  const trouve = /^(.*?)[\s._-]+(\d{1,2}|[ivxlcdm]{1,6})\s*$/i.exec(titre.trim());
  if (!trouve) return null;
  const romain = (valeur: string): number => {
    const poids: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const lettres = valeur.toUpperCase().split("");
    return lettres.reduce((total, lettre, index) => {
      const courant = poids[lettre] ?? 0;
      const suivant = poids[lettres[index + 1] ?? ""] ?? 0;
      return total + (courant < suivant ? -courant : courant);
    }, 0);
  };
  const rang = /^\d+$/.test(trouve[2]!) ? Number(trouve[2]) : romain(trouve[2]!);
  const base = (trouve[1] ?? "").trim();
  // Un rang de 1 ne se dit pas, et au-delà de 20 il s'agit plus vraisemblablement d'une année
  // tronquée ou d'un numéro d'épisode que d'une suite.
  return base.length >= 2 && rang >= 2 && rang <= 20 ? { base, rang } : null;
}

const CHIFFRES_ROMAINS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

/**
 * Les façons dont un titre peut exprimer le rang [rang].
 *
 * Le chiffre, le chiffre romain, et les ordinaux des deux langues du catalogue. Les fournisseurs
 * passent de l'un à l'autre sans règle : *Dune : Deuxième partie* en français, *Dune: Part Two* en
 * anglais, *Rocky II* en chiffres romains.
 */
export function marqueursDeRang(rang: number): string[] {
  const ordinauxFr = ["", "", "deuxieme", "troisieme", "quatrieme", "cinquieme", "sixieme", "septieme", "huitieme", "neuvieme", "dixieme"];
  const ordinauxEn = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const second = rang === 2 ? ["second", "seconde"] : [];
  return [
    String(rang),
    CHIFFRES_ROMAINS[rang] ?? "",
    ordinauxFr[rang] ?? "",
    ordinauxEn[rang] ?? "",
    ...second,
  ].filter(Boolean).map((marqueur) => marqueur.toLowerCase());
}

/** Réduit un titre à ses mots comparables : sans accents, sans ponctuation, en minuscules. */
function normaliser(valeur: string): string {
  return valeur.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Le score à accorder à [candidat] pour un fichier nommé comme une suite, ou `null` si la règle ne
 * s'applique pas.
 *
 * Deux niveaux, et jamais de troisième. Le titre qui **exprime** le rang emporte la décision : rien
 * d'autre ne s'appelle « Dune » suivi de « deuxième partie ». À défaut, l'année exacte suffit à
 * confirmer — un fichier daté 2018 face à une suite sortie en 2018 ne laisse guère de place au doute.
 *
 * Sans l'un ni l'autre, aucun score n'est rendu : le premier volet porte le même titre de base, et le
 * favoriser reviendrait à commettre précisément l'erreur qu'on cherche à éviter.
 */
export function scoreSuite(
  titreFichier: string,
  candidat: { title: string; originalTitle?: string | null; alternativeTitles?: string[]; year?: number | null },
  anneeFichier?: number | null,
): number | null {
  const suite = separerRangSuite(titreFichier);
  if (!suite) return null;
  const base = normaliser(suite.base);
  if (!base) return null;

  for (const titre of [candidat.title, candidat.originalTitle ?? "", ...(candidat.alternativeTitles ?? [])]) {
    const candidatNormalise = normaliser(titre);
    // Le titre de franchise peut suivre le sous-titre dans le titre officiel :
    // `Jurassic Park II` devient `The Lost World: Jurassic Park`.
    if (!(` ${candidatNormalise} `.includes(` ${base} `))) continue;
    // Le titre doit apporter quelque chose de plus : un candidat identique à la base est le premier
    // volet, pas la suite.
    const reste = candidatNormalise.replace(base, "").trim();
    if (!reste) continue;
    const mots = reste.split(" ");
    if (marqueursDeRang(suite.rang).some((marqueur) => mots.includes(marqueur))) return 0.97;
    if (anneeFichier && candidat.year && anneeFichier === candidat.year) return 0.9;
  }
  return null;
}
