/**
 * Reposer une position de défilement sur une page qui n'a pas fini de grandir.
 *
 * Un seul `scrollTo` ne suffit pas, et c'est mesuré : au retour d'une chaîne, une grille laissée à
 * 1 500 pixels revenait à 421. Au moment où l'effet s'exécute, les cartes ne sont pas encore posées
 * et les logos pas encore arrivés — la page est trop courte pour qu'on puisse descendre si bas, et le
 * navigateur ramène simplement au maximum du moment.
 *
 * On redemande donc à chaque image tant qu'on n'y est pas, et vingt images plus tard on renonce : si
 * la page n'a pas grandi en un tiers de seconde, c'est qu'elle ne le fera plus, et insister volerait
 * le défilement à qui s'en sert déjà.
 *
 * `instant` est explicite parce que la feuille de style demande un défilement doux : sans lui, chaque
 * essai relance une animation que le suivant interrompt.
 */
const ESSAIS_MAX = 20;

export function reposerDefilement(cible: number): void {
  if (cible <= 0) return;
  let essais = 0;
  const poser = () => {
    window.scrollTo({ top: cible, behavior: "instant" });
    if (window.scrollY < cible - 2 && essais++ < ESSAIS_MAX) window.requestAnimationFrame(poser);
  };
  window.requestAnimationFrame(poser);
}
