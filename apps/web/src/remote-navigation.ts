import { useEffect } from "react";
import { scrollBehavior } from "./motion";

/**
 * Navigation directionnelle — au clavier fléché et à la télécommande.
 *
 * Sur un téléviseur, il n'y a pas de touche de tabulation : une télécommande n'émet que quatre
 * directions, une validation et un retour. Une interface qui ne se parcourt qu'à la tabulation est
 * donc inutilisable à trois mètres, quelle que soit la qualité du reste.
 *
 * Le choix de la cible est ici une fonction **pure de géométrie** : elle reçoit des rectangles et
 * rend un index. C'est la partie qui contient toute la difficulté, et c'est celle qu'on peut
 * éprouver sans navigateur. La couche qui lit les positions réelles reste volontairement mince.
 *
 * La règle retenue est celle des téléviseurs : parmi les éléments situés dans la direction demandée,
 * on prend le plus proche, en pénalisant l'écart latéral. Un simple « le plus proche à vol d'oiseau »
 * ferait sauter en diagonale d'une jaquette à l'autre, ce qui donne une impression de désordre.
 */

export type Direction = "up" | "down" | "left" | "right";

export interface Boite { left: number; top: number; right: number; bottom: number; }

const centreX = (boite: Boite) => (boite.left + boite.right) / 2;
const centreY = (boite: Boite) => (boite.top + boite.bottom) / 2;

/** Tolérance, en pixels, avant de considérer qu'un élément est réellement décalé. */
const MARGE = 4;

/** Vrai si `candidat` se trouve du côté demandé, franchement et pas d'un cheveu. */
function estDansLaDirection(origine: Boite, candidat: Boite, direction: Direction): boolean {
  switch (direction) {
    case "left": return candidat.right <= origine.left + MARGE;
    case "right": return candidat.left >= origine.right - MARGE;
    case "up": return candidat.bottom <= origine.top + MARGE;
    case "down": return candidat.top >= origine.bottom - MARGE;
  }
}

/**
 * Distance retenue pour classer les candidats.
 *
 * L'écart le long de l'axe demandé compte pour lui-même ; l'écart perpendiculaire est multiplié,
 * pour qu'une jaquette bien alignée l'emporte toujours sur une jaquette plus proche mais de travers.
 */
function distance(origine: Boite, candidat: Boite, direction: Direction): number {
  const horizontal = direction === "left" || direction === "right";
  const suivantAxe = horizontal
    ? Math.abs(centreX(candidat) - centreX(origine))
    : Math.abs(centreY(candidat) - centreY(origine));
  const perpendiculaire = horizontal
    ? Math.abs(centreY(candidat) - centreY(origine))
    : Math.abs(centreX(candidat) - centreX(origine));
  return suivantAxe + perpendiculaire * 3;
}

/** Vrai si aucun rectangle n'a de dimension : c'est le cas hors navigateur, faute de mise en page. */
export function sansGeometrie(boites: Boite[]): boolean {
  return boites.every((boite) => boite.right - boite.left === 0 && boite.bottom - boite.top === 0);
}

/**
 * L'index de l'élément à atteindre depuis `origine`, ou `null` s'il n'y a rien de ce côté.
 *
 * Quand la géométrie est absente — hors navigateur — on retombe sur l'ordre du document : « droite »
 * et « bas » avancent, « gauche » et « haut » reculent. Ce repli ne prétend pas remplacer la
 * géométrie ; il garantit seulement que la navigation ne s'immobilise jamais.
 */
export function choisirCible(origineIndex: number, boites: Boite[], direction: Direction): number | null {
  const origine = boites[origineIndex];
  if (!origine) return null;

  if (sansGeometrie(boites)) {
    const pas = direction === "right" || direction === "down" ? 1 : -1;
    const cible = origineIndex + pas;
    return cible >= 0 && cible < boites.length ? cible : null;
  }

  let meilleur: number | null = null;
  let meilleureDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < boites.length; index += 1) {
    if (index === origineIndex) continue;
    const candidat = boites[index]!;
    if (!estDansLaDirection(origine, candidat, direction)) continue;
    const ecart = distance(origine, candidat, direction);
    if (ecart < meilleureDistance) { meilleureDistance = ecart; meilleur = index; }
  }
  return meilleur;
}

/**
 * Vrai si la touche fléchée doit être laissée à l'élément qui a le focus.
 *
 * Dans un champ de saisie, les flèches déplacent le curseur ; dans une liste déroulante, elles
 * changent la valeur ; dans un curseur, elles règlent la position. Les détourner rendrait ces
 * commandes inutilisables — et la barre de progression du lecteur en fait partie.
 */
export function laisserAuChamp(element: Element | null): boolean {
  if (!element) return false;
  const balise = element.tagName.toLowerCase();
  if (balise === "select" || balise === "textarea") return true;
  if (balise === "input") {
    const type = (element as HTMLInputElement).type;
    return !["button", "submit", "reset", "checkbox", "radio"].includes(type);
  }
  // `isContentEditable` est typé booléen mais n'existe pas partout — jsdom, notamment, le laisse
  // indéfini. Rendre `undefined` là où la signature promet `false` suffirait à fausser un appelant
  // qui compare strictement.
  return Boolean((element as HTMLElement).isContentEditable);
}

/** Sélecteur des commandes atteignables. `-1` en est exclu : ce sont des cibles de focus, pas des étapes. */
const FOCALISABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Les commandes réellement atteignables, dans l'ordre du document.
 *
 * Quand une fenêtre modale est ouverte, la recherche s'y limite : sans cela, les flèches
 * emmèneraient le focus derrière la fenêtre, sur un contenu que la personne ne voit même pas.
 */
export function commandesAtteignables(document: Document): HTMLElement[] {
  const dialogue = document.querySelector<HTMLElement>('[role="dialog"]:not([hidden])');
  const racine: ParentNode = dialogue ?? document;
  return [...racine.querySelectorAll<HTMLElement>(FOCALISABLES)]
    .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

/**
 * Rend l'application parcourable aux quatre flèches, donc à la télécommande.
 *
 * Une télécommande n'a pas de touche de tabulation. Sans ce branchement, l'application reste
 * inutilisable sur un téléviseur, quelle que soit la qualité du reste — et Android TV est une cible
 * annoncée du projet.
 */
export function useRemoteNavigation(): void {
  useEffect(() => {
    const surTouche = (evenement: KeyboardEvent) => {
      const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[
        evenement.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"];
      if (!direction || evenement.altKey || evenement.ctrlKey || evenement.metaKey || evenement.shiftKey) return;

      const actif = document.activeElement as HTMLElement | null;
      if (laisserAuChamp(actif)) return;

      const commandes = commandesAtteignables(document);
      const depuis = actif ? commandes.indexOf(actif) : -1;
      // Rien de focalisé — au premier appui, par exemple : on entre par la première commande plutôt
      // que de ne rien faire, sinon la télécommande semble inerte au démarrage.
      if (depuis < 0) {
        const premiere = commandes.find((element) => !element.classList.contains("skip-link"));
        if (!premiere) return;
        evenement.preventDefault();
        premiere.focus();
        return;
      }

      const cible = choisirCible(depuis, commandes.map((element) => element.getBoundingClientRect()), direction);
      if (cible == null) return;
      evenement.preventDefault();
      const suivante = commandes[cible]!;
      suivante.focus();
      suivante.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: scrollBehavior() });
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);
}
