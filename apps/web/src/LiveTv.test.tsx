// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChaineDirect } from "@flixtunes/contracts";

const chaines: ChaineDirect[] = [
  { id: "c1", nom: "TF1", numero: 1, logo: "http://logo/tf1.png", groupe: "Généralistes", pays: "fr", etat: "bonne", adresses: 3 },
  { id: "c2", nom: "Arte", numero: 2, logo: null, groupe: "Généralistes", pays: "fr", etat: "inconnue", adresses: 1 },
];

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  chainesLive: vi.fn(), listesLiveClient: vi.fn(), paysLive: vi.fn(), fiabilitesLive: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));

const { LiveTv } = await import("./LiveTv");

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.chainesLive.mockResolvedValue({ items: chaines, total: 2, offset: 0, limit: 60 });
  apiMock.paysLive.mockResolvedValue([
    { code: "fr", nom: "France", chaines: 1543 },
    { code: "br", nom: "Brésil", chaines: 820 },
  ]);
  apiMock.listesLiveClient.mockResolvedValue([
    { id: "l1", nom: "iptv-org France", classement: "bonne", chaines: 193 },
    { id: "l2", nom: "ParaTV", classement: "moyenne", chaines: 88 },
  ]);
  apiMock.fiabilitesLive.mockResolvedValue([
    { classement: "bonne", listes: 260 },
    { classement: "faible", listes: 76 },
  ]);
});
afterEach(cleanup);

describe("la grille des chaînes", () => {
  it("affiche le numéro avant le nom — c'est par lui qu'on choisit à la télécommande", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    expect(await screen.findByText("TF1")).toBeInTheDocument();
    const carte = screen.getByText("TF1").closest("button")!;
    expect(carte).toHaveTextContent("1");
    // La profondeur du repli se voit : trois adresses, c'est une chaîne qui a du secours.
    expect(carte).toHaveTextContent("3 sources");
  });

  it("remplace un logo absent par l'initiale plutôt que par une image cassée", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    await screen.findByText("Arte");
    // Le logo vient d'un hébergeur quelconque : il manque une fois sur trois.
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("cherche après une pause, et pas à chaque frappe", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    await screen.findByText("TF1");
    apiMock.chainesLive.mockClear();

    const champ = screen.getByPlaceholderText("Rechercher une chaîne");
    // Trois frappes coup sur coup, comme on tape « can ».
    fireEvent.change(champ, { target: { value: "c" } });
    fireEvent.change(champ, { target: { value: "ca" } });
    fireEvent.change(champ, { target: { value: "can" } });
    // Rien n'est parti tout de suite : sans ce délai, chaque lettre coûterait une requête.
    expect(apiMock.chainesLive).not.toHaveBeenCalled();

    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ q: "can" })));
    // Et une seule est partie pour les trois lettres.
    expect(apiMock.chainesLive).toHaveBeenCalledTimes(1);
  });

  it("filtre par liste de lecture, comme le catalogue filtre par genre", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    const liste = await screen.findByLabelText("iptv-org France (193)");
    fireEvent.click(liste);
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ listes: ["l1"] })));
  });

  it("filtre par pays — le seul filtre qui règle « canal »", async () => {
    // Le mot est espagnol et portugais : mille résultats justes, dont aucun n'est celui qu'on veut.
    render(<LiveTv onPlay={() => undefined} />);
    fireEvent.click(await screen.findByLabelText("France (1 543)"));
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ pays: ["fr"] })));
  });

  it("filtre sur la fiabilité des listes, en disant ce que la pastille mesure", async () => {
    // La pastille n'est pas un avis : c'est la part des flux qui répondent, mesurée par le script qui
    // produit le fichier. Le seuil est écrit à l'écran, parce qu'un ❌ ne veut pas dire « morte ».
    render(<LiveTv onPlay={() => undefined} />);
    fireEvent.click(await screen.findByLabelText("✅ 75 % et plus (260)"));
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ fiabilites: ["bonne"] })));
    expect(screen.getByLabelText("❌ 25 à 49 % (76)")).toBeInTheDocument();
  });

  it("rend la chaîne choisie à l'appelant", async () => {
    const joue = vi.fn();
    render(<LiveTv onPlay={joue} />);
    fireEvent.click((await screen.findByText("TF1")).closest("button")!);
    expect(joue).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", nom: "TF1" }));
  });

  it("dit quoi faire quand il n'y a rien à montrer", async () => {
    apiMock.chainesLive.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 60 });
    render(<LiveTv onPlay={() => undefined} />);
    expect(await screen.findByText("Aucune chaîne")).toBeInTheDocument();
    expect(screen.getByText(/Réglez une source de listes/)).toBeInTheDocument();
  });
});
