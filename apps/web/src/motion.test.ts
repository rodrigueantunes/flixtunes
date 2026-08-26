// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior } from "./motion";

/**
 * Ces tests protègent une subtilité facile à défaire par inadvertance : réécrire `behavior: "smooth"`
 * en dur dans un appel de défilement redonnerait une animation à qui l'a refusée, sans qu'aucune
 * règle CSS ne s'y oppose.
 */

/** Installe une réponse de `matchMedia` pour la requête de réduction de mouvement. */
function repondreAuSysteme(reduit: boolean) {
  vi.stubGlobal("matchMedia", (requete: string) => ({
    matches: requete.includes("prefers-reduced-motion: reduce") && reduit,
    media: requete, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("préférence de réduction de mouvement", () => {
  it("supprime l'animation de défilement quand le système la refuse", () => {
    repondreAuSysteme(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("conserve le défilement animé par défaut", () => {
    repondreAuSysteme(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("relit la préférence à chaque appel plutôt que de la figer au démarrage", () => {
    // Le réglage appartient au système : il peut changer pendant que l'application tourne.
    repondreAuSysteme(false);
    expect(scrollBehavior()).toBe("smooth");
    repondreAuSysteme(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("ne traite pas une absence de réponse comme un refus", () => {
    // Un environnement sans `matchMedia` ne dit pas « l'utilisateur veut moins d'animation » : il ne
    // dit rien. Supposer le refus dégraderait l'interface pour tout le monde.
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe("smooth");
  });
});
