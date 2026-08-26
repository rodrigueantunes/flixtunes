/**
 * Forme normalisée d'un titre, utilisée pour la recherche.
 *
 * `sort_title` ne fait qu'abaisser la casse : les accents y restent. Sur une médiathèque française,
 * chercher « amelie » ne trouvait donc pas « Amélie », et « coeur » ne trouvait pas « Cœur ». C'est
 * la gêne la plus quotidienne qu'on puisse avoir sur un catalogue de plusieurs milliers de titres,
 * parce qu'elle frappe précisément les titres qu'on tape le plus vite.
 *
 * La normalisation est **stockée** dans une colonne indexée plutôt que calculée à chaque requête :
 * une fonction appliquée à la volée sur chaque ligne interdirait l'usage de l'index et ramènerait la
 * recherche à un parcours complet de la table.
 *
 * Ce qui est retiré, et pourquoi :
 *   - les **accents**, par décomposition Unicode puis suppression des diacritiques ;
 *   - les **ligatures** œ et æ, que la décomposition ne défait pas — elles sont des lettres à part
 *     entière en Unicode, pas des lettres accentuées ;
 *   - la **ponctuation**, pour que « Spider-Man » réponde à « spider man », et l'inverse ;
 *   - les **espaces multiples**, réduits à un seul.
 *
 * La casse est abaissée sans locale : un abaissement localisé donnerait des résultats différents
 * selon la langue de la bibliothèque, alors que cette colonne sert d'index commun à tout le
 * catalogue. Le cas turc du « i » sans point est le piège classique de cette erreur.
 */
export function normaliseForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}
