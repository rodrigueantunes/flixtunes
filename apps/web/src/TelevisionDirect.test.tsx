// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EtatDirect, ListeDirect, ParametresDirect } from "@flixtunes/contracts";

const parametresEteints: ParametresDirect = { actif: false, dossier: null, fichier: "m3u.json", cadenceHeures: 12 };
const etatVierge: EtatDirect = {
  actif: false, configure: false, enCours: false, listes: 0, listesRetenues: 0, chaines: 0, adresses: 0,
  fusionnees: 0, ecartees: 0, rafraichieLe: null, dernierMessage: null, progression: null, dureeSecondes: null,
};

const listes: ListeDirect[] = [
  { id: "l1", nom: "iptv-org France", url: "https://exemple.test/a.m3u", classement: "bonne", cochee: true,
    entrees: 193, ecartees: 0, rafraichieLe: "2026-08-30T20:00:00Z", dernierMessage: null },
  { id: "l2", nom: "Liste morte", url: "https://exemple.test/b.m3u", classement: "faible", cochee: false,
    entrees: 0, ecartees: 0, rafraichieLe: "2026-08-30T20:00:00Z", dernierMessage: "HTTP 404" },
];

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  live: vi.fn(), listesLive: vi.fn(), sourcesLive: vi.fn(), ajouterXtream: vi.fn(), activerFast: vi.fn(), retirerSourceLive: vi.fn(), enregistrerLive: vi.fn(), rafraichirLive: vi.fn(),
  arreterLive: vi.fn(), browseDirectories: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));

const { TelevisionDirect } = await import("./TelevisionDirect");

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.live.mockResolvedValue({ parametres: parametresEteints, etat: etatVierge });
  apiMock.listesLive.mockResolvedValue([]);
  apiMock.sourcesLive.mockResolvedValue([]);
  apiMock.ajouterXtream.mockResolvedValue({ source: null });
  apiMock.activerFast.mockResolvedValue({ source: null });
  apiMock.enregistrerLive.mockResolvedValue({ parametres: parametresEteints, etat: etatVierge });
  apiMock.rafraichirLive.mockResolvedValue(etatVierge);
});
afterEach(cleanup);

describe("le réglage de la télévision en direct", () => {
  it("s'affiche éteint, et le dit dans le libellé", async () => {
    render(<TelevisionDirect />);
    // Le libellé porte l'état et non l'action : au milieu de boutons qui lancent des travaux,
    // « activer » ne se distinguerait pas d'« exécuter ».
    const interrupteur = await screen.findByRole("button", { name: /Direct : désactivé/ });
    expect(interrupteur).toHaveAttribute("aria-pressed", "false");
    // Rien n'a encore été relu : aucun bilan à montrer.
    expect(screen.queryByText("Doublons fusionnés")).not.toBeInTheDocument();
  });

  it("ne propose pas de relire tant que la fonction est éteinte", async () => {
    render(<TelevisionDirect />);
    expect(await screen.findByRole("button", { name: /Relire les listes/ })).toBeDisabled();
  });

  it("allume la fonction depuis l'écran", async () => {
    render(<TelevisionDirect />);
    fireEvent.click(await screen.findByRole("button", { name: /Direct : désactivé/ }));
    await waitFor(() => expect(apiMock.enregistrerLive).toHaveBeenCalledWith({ actif: true }));
  });

  it("enregistre un chemin de fichier, découpé pour le serveur", async () => {
    // Un seul champ à l'écran — le chemin complet — parce qu'on choisit un fichier comme on choisit
    // un dossier de films. Le serveur, lui, garde le dossier et le nom séparés.
    render(<TelevisionDirect />);
    fireEvent.change(await screen.findByPlaceholderText("/volume1/Multimédia/TV/m3u.json"),
      { target: { value: "/volume1/TV/mes-listes.json" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer l’emplacement/ }));
    await waitFor(() => expect(apiMock.enregistrerLive)
      .toHaveBeenCalledWith({ dossier: "/volume1/TV", fichier: "mes-listes.json" }));
    expect(await screen.findByText("Emplacement enregistré.")).toBeInTheDocument();
  });

  it("montre les chiffres d'un rafraîchissement, doublons fusionnés compris", async () => {
    apiMock.live.mockResolvedValue({
      parametres: { ...parametresEteints, actif: true, dossier: "/volume1/TV" },
      etat: { ...etatVierge, actif: true, configure: true, listes: 535, listesRetenues: 535, chaines: 78_741,
        adresses: 117_863, fusionnees: 104_565, ecartees: 1_585, rafraichieLe: "2026-08-30T20:00:00Z",
        dernierMessage: "535 liste(s) relues", dureeSecondes: 18.3 },
    });
    render(<TelevisionDirect />);
    // C'est le chiffre qui surprend, donc celui qu'il faut montrer : chaque doublon est une adresse
    // de secours et non une ligne perdue.
    expect(await screen.findByText("Doublons fusionnés")).toBeInTheDocument();
    expect(screen.getByText("104 565")).toBeInTheDocument();
    expect(screen.getByText("78 741")).toBeInTheDocument();
    expect(screen.getByText("18,3 s")).toBeInTheDocument();
  });

  it("ne montre que les listes qui n'ont pas répondu, et ne propose plus de les choisir", async () => {
    // Le choix des listes a quitté la configuration : il est devenu un filtre de l'écran Live TV.
    // Ce qui reste ici est un diagnostic — une liste morte se dit, sinon on la cherche sans la trouver.
    apiMock.listesLive.mockResolvedValue(listes);
    render(<TelevisionDirect />);
    expect(await screen.findByText("Liste morte")).toBeInTheDocument();
    expect(screen.getByText("HTTP 404")).toBeInTheDocument();
    expect(screen.queryByText("iptv-org France")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("enregistre un portail Xtream, et n'en réaffiche jamais le mot de passe", async () => {
    // Le mot de passe part chiffré au repos, par le même mécanisme que les jetons TMDB. Le champ se
    // vide dès l'enregistrement : le laisser rempli inviterait à croire qu'il est relu quelque part.
    render(<TelevisionDirect />);
    fireEvent.change(await screen.findByPlaceholderText("http://portail.exemple:8080"), { target: { value: "http://portail.test:8080" } });
    const champs = screen.getAllByRole("textbox");
    fireEvent.change(champs[champs.length - 1]!, { target: { value: "moi" } });
    const motDePasse = document.querySelector("input[type=password]") as HTMLInputElement;
    fireEvent.change(motDePasse, { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un portail" }));
    await waitFor(() => expect(apiMock.ajouterXtream).toHaveBeenCalledWith("http://portail.test:8080", "moi", "secret"));
    await waitFor(() => expect((document.querySelector("input[type=password]") as HTMLInputElement).value).toBe(""));
  });

  it("propose des chaînes qui ne demandent aucun réglage", async () => {
    render(<TelevisionDirect />);
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter les chaînes" }));
    await waitFor(() => expect(apiMock.activerFast).toHaveBeenCalled());
  });

  it("montre l'avancement pendant une passe, et le bouton qui l'arrête", async () => {
    apiMock.live.mockResolvedValue({
      parametres: { ...parametresEteints, actif: true, dossier: "/volume1/TV" },
      etat: { ...etatVierge, actif: true, configure: true, enCours: true, listes: 535, listesRetenues: 535,
        progression: { faites: 120, total: 535, liste: "iptv-org France", entrees: 42_000 } },
    });
    render(<TelevisionDirect />);
    expect(await screen.findByText(/120 listes sur 535/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arrêter" })).toBeInTheDocument();
  });
});
