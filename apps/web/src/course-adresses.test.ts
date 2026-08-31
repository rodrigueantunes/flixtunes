import { describe, expect, it, vi } from "vitest";
import { courirLesAdresses, type AdresseCourue } from "./course-adresses";

/**
 * La course décide dans quel ordre on essaie les adresses d'une chaîne. Elle a deux devoirs et un
 * interdit : mettre devant ce qui répond, garder ce qui se tait, et ne jamais perdre une adresse.
 */

const adresse = (url: string): AdresseCourue => ({ url, relais: `/relais?u=${url}` });

/** Une sonde qui répond après le délai indiqué, ou qui échoue si `delai` est `null`. */
function sondeSimulee(delais: Record<string, number | null>) {
  return (url: string, signal: AbortSignal) => new Promise((resoudre, rejeter) => {
    const delai = delais[url];
    if (delai == null) { rejeter(new Error("injoignable")); return; }
    const minuteur = setTimeout(() => resoudre(url), delai);
    signal.addEventListener("abort", () => { clearTimeout(minuteur); rejeter(new Error("abandon")); });
  });
}

describe("la course des adresses", () => {
  it("met devant celle qui a répondu la première", async () => {
    // C'est tout l'objet : le lecteur essayait la première déclarée et attendait douze secondes.
    const adresses = [adresse("a"), adresse("b"), adresse("c")];
    const ordonnees = await courirLesAdresses(adresses, sondeSimulee({ a: 200, b: 20, c: 100 }), 1_000);
    expect(ordonnees.map((entree) => entree.url)).toEqual(["b", "c", "a"]);
  });

  it("ne perd jamais une adresse silencieuse : elle passe derrière", async () => {
    // Une réponse opaque ne prouve pas grand-chose, et son absence ne prouve pas davantage. Un
    // hébergeur lent reste jouable, et si tout se tait il faut bien essayer quelque chose.
    const adresses = [adresse("morte"), adresse("vivante"), adresse("lente")];
    const ordonnees = await courirLesAdresses(adresses, sondeSimulee({ morte: null, vivante: 10, lente: null }), 200);
    expect(ordonnees.map((entree) => entree.url)).toEqual(["vivante", "morte", "lente"]);
    expect(ordonnees).toHaveLength(3);
  });

  it("rend l'ordre reçu quand personne ne répond", async () => {
    const adresses = [adresse("x"), adresse("y")];
    const ordonnees = await courirLesAdresses(adresses, sondeSimulee({ x: null, y: null }), 100);
    expect(ordonnees.map((entree) => entree.url)).toEqual(["x", "y"]);
  });

  it("ne sonde rien quand il n'y a qu'une adresse", async () => {
    // Cinq chaînes sur six sont dans ce cas : les faire courir contre elles-mêmes coûterait une
    // requête et une attente pour un résultat connu d'avance.
    const sonde = vi.fn();
    const ordonnees = await courirLesAdresses([adresse("seule")], sonde, 100);
    expect(ordonnees.map((entree) => entree.url)).toEqual(["seule"]);
    expect(sonde).not.toHaveBeenCalled();
  });

  it("n'attend pas plus que son délai", async () => {
    // Sans cette borne, une adresse qui ne répond jamais retiendrait l'ouverture de la chaîne aussi
    // longtemps que le navigateur veut bien attendre.
    const depart = Date.now();
    const ordonnees = await courirLesAdresses([adresse("lente1"), adresse("lente2")],
      sondeSimulee({ lente1: 5_000, lente2: 5_000 }), 150);
    expect(Date.now() - depart).toBeLessThan(1_500);
    expect(ordonnees).toHaveLength(2);
  });
});
