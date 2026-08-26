// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { ecrireCache, lireCache, oublierCache, useEtatServeur } from "./server-cache";

/**
 * Ce qui compte ici n'est pas qu'une valeur soit mise de côté, mais **ce qui s'affiche pendant qu'on
 * vérifie**. Un cache qui ferait quand même patienter n'apporterait rien ; un cache qui n'irait
 * jamais revérifier montrerait un catalogue périmé après une analyse.
 */

beforeEach(() => { oublierCache(); vi.useRealTimers(); });
afterEach(cleanup);

describe("mémoire des réponses serveur", () => {
  it("rend une valeur retenue", () => {
    ecrireCache("films:profil-1", [{ id: "a" }]);
    expect(lireCache("films:profil-1")).toEqual([{ id: "a" }]);
  });

  it("oublie une valeur trop ancienne plutôt que de la servir", () => {
    ecrireCache("films:profil-1", ["ancien"]);
    // Cinq minutes et une seconde plus tard, cette réponse n'a plus à être affichée sans contrôle.
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
    expect(lireCache("films:profil-1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("oublie par préfixe, pour ne cibler qu'un profil", () => {
    // Deux profils ne voient pas les mêmes progressions : effacer l'un ne doit pas effacer l'autre.
    ecrireCache("films:profil-1", ["a"]);
    ecrireCache("films:profil-2", ["b"]);
    oublierCache("films:profil-1");
    expect(lireCache("films:profil-1")).toBeUndefined();
    expect(lireCache("films:profil-2")).toEqual(["b"]);
  });
});

describe("affichage immédiat puis réconciliation", () => {
  it("fait patienter seulement quand rien n'est connu", async () => {
    const charger = vi.fn().mockResolvedValue(["frais"]);
    const { result } = renderHook(() => useEtatServeur("films:profil-1", charger));

    expect(result.current.chargement, "aucune valeur connue : l'attente est légitime").toBe(true);
    await waitFor(() => expect(result.current.donnees).toEqual(["frais"]));
    expect(result.current.chargement).toBe(false);
  });

  it("affiche sans attendre une valeur déjà connue, puis la vérifie", async () => {
    ecrireCache("films:profil-1", ["connu"]);
    const charger = vi.fn().mockResolvedValue(["frais"]);
    const { result } = renderHook(() => useEtatServeur("films:profil-1", charger));

    // C'est tout l'enjeu : revenir sur une page déjà visitée ne doit pas rendre l'écran vide.
    expect(result.current.donnees).toEqual(["connu"]);
    expect(result.current.chargement).toBe(false);
    expect(result.current.reconciliation, "la vérification part quand même").toBe(true);

    await waitFor(() => expect(result.current.donnees).toEqual(["frais"]));
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it("conserve la valeur affichée quand le serveur ne répond pas", async () => {
    ecrireCache("films:profil-1", ["connu"]);
    const charger = vi.fn().mockRejectedValue(new Error("Serveur injoignable"));
    const { result } = renderHook(() => useEtatServeur("films:profil-1", charger));

    // Une valeur périmée vaut mieux qu'un écran vide : la personne garde son catalogue sous les yeux,
    // et l'échec est signalé à côté plutôt que d'effacer ce qu'elle regardait.
    await waitFor(() => expect(result.current.erreur).toBe("Serveur injoignable"));
    expect(result.current.donnees).toEqual(["connu"]);
  });

  it("n'affiche jamais la valeur d'une autre clé pendant le changement", async () => {
    ecrireCache("films:profil-1", ["films"]);
    const charger = vi.fn().mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ cle }) => useEtatServeur(cle, charger),
      { initialProps: { cle: "films:profil-1" } });

    expect(result.current.donnees).toEqual(["films"]);
    rerender({ cle: "series:profil-1" });
    // Montrer les films sous l'onglet des séries serait pire que de faire patienter un instant.
    expect(result.current.donnees).toBeUndefined();
  });

  it("relance la requête à la demande sans vider l'écran", async () => {
    const charger = vi.fn()
      .mockResolvedValueOnce(["premier"])
      .mockResolvedValueOnce(["second"]);
    const { result } = renderHook(() => useEtatServeur("films:profil-1", charger));
    await waitFor(() => expect(result.current.donnees).toEqual(["premier"]));

    act(() => result.current.rafraichir());
    // Pendant la relance, ce qui est affiché reste affiché.
    expect(result.current.donnees).toEqual(["premier"]);
    await waitFor(() => expect(result.current.donnees).toEqual(["second"]));
  });

  it("ignore une réponse arrivée après un changement de clé", async () => {
    // Une réponse lente à la question précédente ne doit pas écraser la nouvelle : c'est la course
    // classique qui fait apparaître le contenu d'un onglet dans un autre.
    let repondrePremier: ((valeur: string[]) => void) | null = null;
    const charger = vi.fn()
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { repondrePremier = resolve; }))
      .mockResolvedValueOnce(["series"]);
    const { result, rerender } = renderHook(({ cle }) => useEtatServeur(cle, charger),
      { initialProps: { cle: "films:profil-1" } });

    rerender({ cle: "series:profil-1" });
    await waitFor(() => expect(result.current.donnees).toEqual(["series"]));

    act(() => repondrePremier?.(["films-en-retard"]));
    expect(result.current.donnees).toEqual(["series"]);
  });
});
