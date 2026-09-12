// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  catalogPage: vi.fn(), details: vi.fn(), candidatsWeb: vi.fn(), corrigerWeb: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./App", () => ({ Icon: () => null }));

import { oublierSouvenirWeb } from "./memoire-web";
import { RayonWeb } from "./RayonWeb";

const chaine = {
  id: "m-c1", catalogId: "c1", title: "Greg Guillotin", showTitle: "Greg Guillotin",
  posterUrl: null, backdropUrl: null, airDate: null, progressPercent: 0, playableMediaId: null,
} as never;

const video = (id: string, titre: string) => ({
  id, catalogId: id, title: titre, showTitle: "Greg Guillotin", posterUrl: null, backdropUrl: null,
  airDate: "2024-05-01", progressPercent: 0, playableMediaId: id, episodeNumber: 1, runtimeSeconds: 754,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Le rayon retient sa position — en mémoire, pour la retrouver après une lecture. Sans remise à
  // zéro, un cas s'ouvrirait là où le précédent s'est arrêté : dans la chaîne, pas sur la liste.
  oublierSouvenirWeb();
  apiMock.catalogPage.mockResolvedValue({ items: [chaine], total: 1 });
  apiMock.details.mockResolvedValue({
    seasons: [
      { title: "Pranks", episodes: [video("v1", "Le Pire Stagiaire")] },
      { title: "Pranks / 2024", episodes: [video("v2", "Le Pire Gendre")] },
    ],
  });
});
afterEach(cleanup);

/**
 * Ressortir d'une chaîne, depuis la grille.
 *
 * Le fil d'Ariane est en haut de page ; au bas d'une liste de quarante vidéos, y revenir demande de
 * remonter tout l'écran. La carte de retour est là où se trouve déjà le regard — et elle doit l'être
 * **à tous les niveaux** : à la racine d'une chaîne elle manquait, si bien qu'on remontait de dossier
 * en dossier et qu'arrivé en haut, elle disparaissait.
 */
describe("la carte de retour", () => {
  const ouvrirLaChaine = async () => {
    render(<RayonWeb profileId="p" onPlay={() => {}} />);
    fireEvent.click(await screen.findByText("Greg Guillotin"));
    return screen.findByText("Pranks");
  };

  it("ramène aux chaînes depuis la racine d'une chaîne", async () => {
    await ouvrirLaChaine();
    fireEvent.click(screen.getByText("Retour aux chaînes"));
    // La grille des chaines est revenue : son en-tete la nomme, et les dossiers ont disparu.
    expect(await screen.findByText("Vos chaînes")).toBeInTheDocument();
    expect(screen.queryByText("Pranks")).toBeNull();
  });

  it("remonte d'un dossier quand on est dedans, et nomme celui qu'on quitte", async () => {
    await ouvrirLaChaine();
    fireEvent.click(screen.getByText("Pranks"));
    expect(await screen.findByText("Dossier parent")).toBeInTheDocument();
    expect(screen.queryByText("Retour aux chaînes")).toBeNull();

    fireEvent.click(screen.getByText("Dossier parent"));
    expect(await screen.findByText("Retour aux chaînes")).toBeInTheDocument();
  });
});

describe("la carte d'une vidéo", () => {
  it("montre la date à gauche et la durée du fichier à droite, sans libellé", async () => {
    render(<RayonWeb profileId="p" onPlay={() => {}} />);
    fireEvent.click(await screen.findByText("Greg Guillotin"));
    fireEvent.click(await screen.findByText("Pranks"));

    const carte = (await screen.findByText("Le Pire Stagiaire")).closest("button")!;
    const date = carte.querySelector(".web-date");
    const duree = carte.querySelector(".web-duree");
    expect(date).toHaveTextContent("1 mai 2024");
    expect(duree).toHaveTextContent(/^00:12:34$/);
    // La durée suit la date dans la même ligne : c'est ce qui la place à droite.
    expect(date?.nextElementSibling).toBe(duree);
  });
});
