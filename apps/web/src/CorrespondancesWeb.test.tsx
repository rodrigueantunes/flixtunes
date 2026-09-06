// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LibraryFolder } from "@flixtunes/contracts";

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  correspondancesWeb: vi.fn(), candidatsWeb: vi.fn(), corrigerWeb: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));

import { CorrespondancesWeb } from "./CorrespondancesWeb";

const bibliotheque = { id: "lib-web", name: "Web", path: "/web", kind: "web", language: "fr-FR" } as unknown as LibraryFolder;

const ligne = (extra: Record<string, unknown>) => ({
  id: "x", genre: "video", titre: "Sans titre", chaine: null, chaineId: null, posterUrl: null,
  publieeLe: null, identifiant: null, statut: "unmatched", verrouillee: false, ...extra,
});

/**
 * L'écran de correction d'une bibliothèque web.
 *
 * Deux règles y tiennent tout : on ne montre que les vidéos de la chaîne choisie, et on ne dépense
 * rien sans un geste explicite. La première parce qu'une vidéo ne peut être cherchée que **dans sa
 * chaîne** — c'est la règle de l'analyse, et la correction manuelle ne s'en écarte pas.
 */
beforeEach(() => {
  vi.clearAllMocks();
  apiMock.correspondancesWeb.mockResolvedValue({
    budget: { depense: 0, plafond: 9000, reste: 9000 },
    lignes: [
      ligne({ id: "c1", genre: "chaine", titre: "Greg Guillotin", chaineId: "c1" }),
      ligne({ id: "c2", genre: "chaine", titre: "Actualités", chaineId: "c2" }),
      ligne({ id: "v1", titre: "Le Pire Stagiaire", chaine: "Greg Guillotin", chaineId: "c1" }),
      ligne({ id: "v2", titre: "Journal du soir", chaine: "Actualités", chaineId: "c2" }),
    ],
  });
});
afterEach(cleanup);

describe("les vidéos suivent la chaîne choisie", () => {
  it("ne montre aucune vidéo tant qu'aucune chaîne n'est choisie", async () => {
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Greg Guillotin");
    expect(screen.queryByText("Le Pire Stagiaire")).toBeNull();
    expect(screen.queryByText("Journal du soir")).toBeNull();
    expect(screen.getByText(/Choisissez une chaîne pour voir ses vidéos/)).toBeInTheDocument();
  });

  it("ne montre que les vidéos de cette chaîne-là", async () => {
    // Toutes les videos defilaient ensemble, chaines melangees. Corriger une video suppose de savoir
    // de quelle chaine elle vient : c'est meme la condition pour qu'on puisse la chercher.
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText("Greg Guillotin"));
    await screen.findByText("Le Pire Stagiaire");
    expect(screen.queryByText("Journal du soir")).toBeNull();
    expect(screen.getByText("Vidéos de Greg Guillotin")).toBeInTheDocument();
  });

  it("suit la chaîne quand on passe à l'autre", async () => {
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText("Greg Guillotin"));
    await screen.findByText("Le Pire Stagiaire");
    fireEvent.click(screen.getByText("Actualités"));
    await screen.findByText("Journal du soir");
    expect(screen.queryByText("Le Pire Stagiaire")).toBeNull();
  });
});

describe("ce que l'écran demande au serveur", () => {
  it("ouvre sur ce qui reste à identifier, la case décochée", async () => {
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByLabelText(/déjà identifié/)).not.toBeChecked();
    await waitFor(() => expect(apiMock.correspondancesWeb)
      .toHaveBeenCalledWith("p", { libraryId: "lib-web", toutes: false }));
  });

  it("redemande la liste entière une fois la case cochée", async () => {
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByLabelText(/déjà identifié/));
    await waitFor(() => expect(apiMock.correspondancesWeb)
      .toHaveBeenCalledWith("p", { libraryId: "lib-web", toutes: true }));
  });

  it("ne dépense rien à la sélection : chercher reste un geste", async () => {
    /*
     * Une recherche coute cent unites sur les 9 000 d'une journee. Lancer une recherche a chaque
     * selection viderait le budget en parcourant la liste — une seule analyse d'une centaine de
     * videos en a deja consomme 8 901.
     */
    render(<CorrespondancesWeb library={bibliotheque} profileId="p" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText("Greg Guillotin"));
    await screen.findByText("Le Pire Stagiaire");
    expect(apiMock.candidatsWeb).not.toHaveBeenCalled();
  });
});
