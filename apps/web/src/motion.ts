/**
 * Respect de la préférence système « moins d'animation » (WCAG 2.2 — 2.3.3 Animation depuis les
 * interactions).
 *
 * La feuille de style déclare déjà `@media (prefers-reduced-motion: reduce)`, mais cette règle est
 * **sans effet sur un défilement demandé en JavaScript** : quand un appel passe explicitement
 * `behavior: "smooth"` dans ses options, cette valeur l'emporte sur la propriété `scroll-behavior`
 * calculée. Un utilisateur ayant désactivé les animations subissait donc quand même le défilement
 * animé à chaque changement de page et à chaque flèche de carrousel.
 *
 * La préférence est relue à chaque appel, et non mise en cache : elle peut changer pendant la
 * session — c'est un réglage du système, pas de l'application.
 */

/** Vrai si le système demande de limiter les animations. Faux si la question ne peut être posée. */
export function prefersReducedMotion(): boolean {
  // `matchMedia` manque dans certains environnements de test ; l'absence de réponse n'est pas un refus.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Le comportement de défilement à passer aux options : animé, sauf si l'utilisateur s'y oppose. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
