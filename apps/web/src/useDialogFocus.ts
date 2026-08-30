import { useEffect, useRef } from "react";

/**
 * Sélecteur des éléments qu'on peut atteindre au clavier.
 *
 * `tabindex="-1"` est exclu : ces éléments se reçoivent le focus par programme mais ne participent
 * pas au parcours de tabulation, et les inclure ferait boucler le piège sur des éléments inatteignables.
 */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(", ");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    // Filtrage par attributs, jamais par mise en page. `offsetParent` paraît désigner la visibilité,
    // mais il vaut `null` pour tout élément en `position: fixed` — ce qu'une fenêtre modale est
    // presque toujours : le filtre écartait alors les commandes de la fenêtre elle-même. Le sélecteur
    // exclut déjà les éléments désactivés ; restent ceux explicitement retirés de l'arbre.
    .filter((element) => !element.hasAttribute("hidden") && !element.closest("[hidden], [aria-hidden='true']"));
}

/**
 * Gestion du focus d'une fenêtre modale.
 *
 * Trois comportements que le balisage `role="dialog" aria-modal="true"` promet sans les fournir :
 *
 * 1. **Entrée** — le focus se place dans la fenêtre à son ouverture. Sans cela, une personne au
 *    clavier ou au lecteur d'écran reste dans la page de fond : la fenêtre s'est ouverte pour elle
 *    sans qu'elle en soit informée ni puisse l'atteindre autrement qu'en tabulant à l'aveugle.
 * 2. **Enfermement** — la tabulation boucle à l'intérieur. `aria-modal` retire bien le fond de
 *    l'arbre d'accessibilité, mais n'empêche pas la tabulation d'y descendre.
 * 3. **Retour** — à la fermeture, le focus revient exactement sur l'élément qui a ouvert la fenêtre.
 *    Sans ce retour, il repart au début du document et le parcours est perdu.
 *
 * @param active Faux lorsque la fenêtre n'est pas affichée : rien n'est alors installé.
 */
export function useDialogFocus<T extends HTMLElement>(active = true) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    // Mémorisé avant tout déplacement, sinon on retiendrait la fenêtre elle-même.
    const opener = document.activeElement as HTMLElement | null;

    /*
     * Une fenêtre s'ouvre à son début, comme un écran.
     *
     * React réutilise volontiers un même nœud d'une fenêtre à l'autre — les profils après les
     * groupes, une fiche après une autre — et le défilement intérieur, lui, ne se remet pas à zéro.
     * On rouvrait donc au milieu de la précédente. Remis ici plutôt que dans chaque fenêtre : c'est
     * le seul endroit que toutes traversent.
     */
    container.scrollTop = 0;

    const first = focusableWithin(container)[0];
    if (first) first.focus();
    else {
      // Une fenêtre sans commande atteignable reçoit tout de même le focus, afin que son libellé
      // soit annoncé et que la touche d'échappement lui parvienne.
      container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(container);
      if (!focusable.length) { event.preventDefault(); return; }
      const start = focusable[0]!;
      const end = focusable.at(-1)!;
      const current = document.activeElement;
      // Le focus peut avoir quitté la fenêtre par un clic dans le fond : on le ramène plutôt que de
      // laisser la tabulation continuer sa route en dehors.
      if (!container.contains(current)) { event.preventDefault(); start.focus(); return; }
      if (event.shiftKey && current === start) { event.preventDefault(); end.focus(); }
      else if (!event.shiftKey && current === end) { event.preventDefault(); start.focus(); }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Le déclencheur peut avoir disparu du document entre-temps — profil supprimé, fiche retirée
      // par une analyse. Lui rendre le focus n'aurait alors aucun effet observable.
      if (opener?.isConnected) opener.focus();
    };
  }, [active]);

  return containerRef;
}
