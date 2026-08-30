// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LibraryFolder } from "@flixtunes/contracts";

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  catalog: vi.fn(), reviewQueue: vi.fn(), metadataProviders: vi.fn(),
  searchMetadata: vi.fn(), matchCatalog: vi.fn(), unlockMatch: vi.fn(), updateMetadata: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));

import { MetadataManager } from "./MetadataManager";

const bibliotheque = { id: "lib-1", name: "Films", path: "/films", kind: "movie", language: "fr-FR" } as unknown as LibraryFolder;

const fiche = {
  id: "cat-1", libraryId: "lib-1", parentId: null, kind: "movie" as const,
  title: "A Star Is Born", year: 2018, seasonNumber: null, episodeNumber: null,
  posterUrl: null, externalProvider: "tmdb", externalId: "332562",
  matchStatus: "review" as const, metadataLocked: false, matchConfidence: 0.6, needsReview: true,
  matchProposal: null, overview: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.reviewQueue.mockResolvedValue([fiche]);
  apiMock.catalog.mockResolvedValue([fiche]);
  apiMock.metadataProviders.mockResolvedValue([]);
  apiMock.searchMetadata.mockResolvedValue([]);
  apiMock.matchCatalog.mockResolvedValue({
    catalogId: "cat-1", matchStatus: "manual", refreshError: null,
    item: { title: "Une étoile est née", year: 1976, overview: "Un résumé.", poster_url: "/p.jpg" },
  });
});
afterEach(cleanup);

/**
 * La correction par identifiant, et pourquoi elle vaut mieux qu'une recherche de titre.
 *
 * Un titre se compare ; un identifiant **désigne**. Sur une œuvre à homonymes — « A Star Is Born »
 * en compte quatre versions —, c'est la seule voie qui ne laisse aucune place au score.
 */
describe("correspondance par identifiant IMDb", () => {
  // `focusCatalogId` sélectionne la fiche d'emblée : c'est le chemin réel, celui qu'on emprunte
  // depuis la fiche détaillée d'un titre. Le titre apparaît alors deux fois — dans la liste et en
  // titre du panneau —, d'où la sélection par le champ plutôt que par le texte.
  const selectionner = async () => {
    render(<MetadataManager library={bibliotheque} onClose={() => {}} onChanged={() => {}} focusCatalogId="cat-1" />);
    return screen.findByLabelText("Identifiant IMDb");
  };

  it("applique un identifiant collé tel quel", async () => {
    const champ = await selectionner();
    fireEvent.change(champ, { target: { value: "tt0075029" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer l'identifiant" }));

    await waitFor(() => expect(apiMock.matchCatalog).toHaveBeenCalled());
    const [id, identifiant, fournisseur] = apiMock.matchCatalog.mock.calls[0]!;
    expect(id).toBe("cat-1");
    expect(identifiant).toBe("tt0075029");
    expect(fournisseur, "c'est au serveur de le résoudre chez TMDB").toBe("imdb");
  });

  /*
   * En pratique on copie l'adresse de la page, pas l'identifiant : l'exiger nu ferait échouer le
   * geste le plus naturel, pour une différence que le code peut absorber en une expression.
   */
  it("accepte l'adresse d'une page IMDb, et n'en garde que l'identifiant", async () => {
    const champ = await selectionner();
    fireEvent.change(champ, { target: { value: "https://www.imdb.com/title/tt0075029/?ref_=nv_sr_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer l'identifiant" }));

    await waitFor(() => expect(apiMock.matchCatalog).toHaveBeenCalled());
    expect(apiMock.matchCatalog.mock.calls[0]![1]).toBe("tt0075029");
  });

  /*
   * Le titre affiché vient de la réponse, jamais de la saisie : l'identifiant ne dit pas comment
   * l'œuvre s'appelle. Et la fiche elle-même change à l'écran — sans quoi on annoncerait une
   * correction dont rien ne viendrait, et on la referait.
   */
  it("annonce le titre obtenu, et met la fiche à jour sur place", async () => {
    const champ = await selectionner();
    fireEvent.change(champ, { target: { value: "tt0075029" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer l'identifiant" }));

    expect(await screen.findByText("Correspondance appliquée : Une étoile est née.")).toBeInTheDocument();
    // Le panneau porte désormais le nouveau titre, et la liste aussi.
    expect(screen.getAllByText(/Une étoile est née/).length).toBeGreaterThan(1);
  });

  it("n'appelle rien tant que la saisie ne porte pas d'identifiant", async () => {
    const champ = await selectionner();
    fireEvent.change(champ, { target: { value: "une étoile est née" } });

    expect(screen.getByRole("button", { name: "Appliquer l'identifiant" })).toBeDisabled();
    expect(apiMock.matchCatalog).not.toHaveBeenCalled();
  });

  it("remonte le refus du serveur au lieu de laisser croire à une réussite", async () => {
    apiMock.matchCatalog.mockRejectedValue(new Error("TMDB ne connaît aucun film portant l'identifiant IMDb tt9999999."));
    const champ = await selectionner();
    fireEvent.change(champ, { target: { value: "tt9999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer l'identifiant" }));

    expect(await screen.findByText(/ne connaît aucun film/)).toBeInTheDocument();
  });
});
