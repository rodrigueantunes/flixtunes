// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChaineDirect } from "@flixtunes/contracts";

const chaines: ChaineDirect[] = [
  { id: "c1", nom: "TF1", numero: 1, logo: "http://logo/tf1.png", groupe: "Généralistes", pays: "fr", etat: "bonne", adresses: 3, favori: false },
  { id: "c2", nom: "Arte", numero: 2, logo: null, groupe: "Généralistes", pays: "fr", etat: "inconnue", adresses: 1, favori: true },
];

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  chainesLive: vi.fn(), listesLiveClient: vi.fn(), paysLive: vi.fn(), fiabilitesLive: vi.fn(),
  favoriLive: vi.fn(), derniereChaineLive: vi.fn(), verifierChainesLive: vi.fn(), etatVerificationLive: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));

const { LiveTv } = await import("./LiveTv");
const { lireSouvenirDirect, oublierSouvenirDirect } = await import("./memoire-direct");

beforeEach(() => {
  vi.clearAllMocks();
  // Le souvenir de session survit au démontage : chaque cas doit partir d'une grille neuve.
  oublierSouvenirDirect();
  apiMock.chainesLive.mockResolvedValue({ items: chaines, total: 2, offset: 0, limit: 60 });
  apiMock.paysLive.mockResolvedValue([
    { code: "fr", nom: "France", chaines: 1543 },
    { code: "br", nom: "Brésil", chaines: 820 },
  ]);
  apiMock.listesLiveClient.mockResolvedValue([
    { id: "l1", nom: "iptv-org France", classement: "bonne", chaines: 193 },
    { id: "l2", nom: "ParaTV", classement: "moyenne", chaines: 88 },
  ]);
  apiMock.favoriLive.mockResolvedValue(undefined);
  apiMock.derniereChaineLive.mockResolvedValue({ chaine: null });
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
    expect(screen.getByLabelText("❌ moins de 25 % (76)")).toBeInTheDocument();
  });

  it("garde une chaîne d'un clic, et repeint l'étoile sans attendre le serveur", async () => {
    // Attendre le serveur pour repeindre une étoile ferait clignoter la grille sur un geste qui ne
    // peut presque pas échouer.
    render(<LiveTv onPlay={() => undefined} />);
    const etoile = await screen.findByLabelText("Garder TF1");
    fireEvent.click(etoile);
    expect(await screen.findByLabelText("Retirer TF1 de mes chaînes")).toBeInTheDocument();
    expect(apiMock.favoriLive).toHaveBeenCalledWith("c1", true);
  });

  it("remet l'étoile comme elle était si le serveur refuse", async () => {
    apiMock.favoriLive.mockRejectedValue(new Error("refus"));
    render(<LiveTv onPlay={() => undefined} />);
    fireEvent.click(await screen.findByLabelText("Garder TF1"));
    // Un état inventé qui resterait faux serait pire que l'attente qu'on a évitée.
    expect(await screen.findByLabelText("Garder TF1")).toBeInTheDocument();
  });

  it("n'affiche que les chaînes retenues quand on le demande", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    fireEvent.click(await screen.findByLabelText("★ Mes chaînes"));
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ favoris: true })));
  });

  it("propose de reprendre la dernière chaîne, et pas au milieu d'une recherche", async () => {
    apiMock.derniereChaineLive.mockResolvedValue({ chaine: { ...chaines[0]!, nom: "M6", numero: 6 } });
    const joue = vi.fn();
    render(<LiveTv onPlay={joue} />);
    fireEvent.click(await screen.findByText("Reprendre"));
    expect(joue).toHaveBeenCalledWith(expect.objectContaining({ nom: "M6" }));

    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "arte" } });
    await waitFor(() => expect(screen.queryByText("Reprendre")).not.toBeInTheDocument());
  });

  it("rend la chaîne choisie à l'appelant", async () => {
    const joue = vi.fn();
    render(<LiveTv onPlay={joue} />);
    fireEvent.click((await screen.findByText("TF1")).closest("button.live-carte")!);
    expect(joue).toHaveBeenCalledWith(expect.objectContaining({ id: "c1", nom: "TF1" }));
  });

  it("dit quoi faire quand il n'y a rien à montrer", async () => {
    apiMock.chainesLive.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 60 });
    render(<LiveTv onPlay={() => undefined} />);
    expect(await screen.findByText("Aucune chaîne")).toBeInTheDocument();
    expect(screen.getByText(/Réglez une source de listes/)).toBeInTheDocument();
  });
});

describe("le retour d'une chaîne", () => {
  it("retrouve la grille et la recherche, sans redemander au serveur", async () => {
    const premier = render(<LiveTv onPlay={() => undefined} />);
    await screen.findByText("TF1");
    const champ = screen.getByPlaceholderText("Rechercher une chaîne");
    fireEvent.change(champ, { target: { value: "canal +" } });
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ q: "canal +" })));
    apiMock.chainesLive.mockClear();

    // Ouvrir une chaîne démonte cet écran : c'est exactement ce que fait `unmount`.
    premier.unmount();
    render(<LiveTv onPlay={() => undefined} />);

    // La grille est là **avant** toute réponse du serveur, et la recherche avec elle.
    expect(screen.getByText("TF1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Rechercher une chaîne")).toHaveValue("canal +");
    await waitFor(() => expect(apiMock.listesLiveClient).toHaveBeenCalled());
    // Les critères n'ont pas changé : rien à redemander. Vingt secondes de recherche restent acquises.
    expect(apiMock.chainesLive).not.toHaveBeenCalled();
  });

  it("repart du serveur dès qu'un critère change", async () => {
    render(<LiveTv onPlay={() => undefined} />);
    await screen.findByText("TF1");
    apiMock.chainesLive.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "arte" } });
    // Une autre grille est une autre demande : la mémoire ne sert qu'à revenir, jamais à figer.
    await waitFor(() => expect(apiMock.chainesLive).toHaveBeenCalledWith(expect.objectContaining({ q: "arte" })));
  });
});

describe("ne garder que les chaînes qui marchent (r12)", () => {
  it("n'apparaît que pendant une recherche, montre la progression, filtre, puis s'efface à la recherche suivante", async () => {
    apiMock.verifierChainesLive.mockResolvedValue({ id: "v1", total: 2 });
    apiMock.etatVerificationLive
      .mockResolvedValueOnce({ total: 2, faites: 1, fini: false, mortes: ["c2"] })
      .mockResolvedValueOnce({ total: 2, faites: 2, fini: true, sourcesFinies: true, mortes: ["c2"], chaines: [chaines[0]] });
    render(<LiveTv onPlay={() => {}} />);
    await screen.findByText("TF1");
    expect(screen.queryByRole("button", { name: "Ne garder que les chaînes qui marchent" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "fr" } });
    const bouton = await screen.findByRole("button", { name: "Ne garder que les chaînes qui marchent" });
    fireEvent.click(bouton);
    expect(await screen.findByText(/Test en cours… 1 chaîne sur 2/)).toBeInTheDocument();
    expect(await screen.findByText("1 chaîne sur 2 joue en ce moment")).toBeInTheDocument();
    expect(apiMock.verifierChainesLive).toHaveBeenCalledWith(expect.objectContaining({ q: "fr" }));
    expect(screen.queryByText("Arte")).toBeNull();
    expect(screen.getByText("TF1")).toBeInTheDocument();

    // Une nouvelle recherche fait tomber le filtrage : toutes les chaînes reviennent.
    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "fra" } });
    expect(await screen.findByRole("button", { name: "Ne garder que les chaînes qui marchent" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Arte")).toBeInTheDocument());
  });
});

describe("le filtrage « qui marchent » tient jusqu'à la recherche suivante (r13)", () => {
  it("survit au retour d'une chaîne, suit les sources vérifiées en fond, et tombe quand la recherche change", async () => {
    apiMock.verifierChainesLive.mockResolvedValue({ id: "v1", total: 2 });
    apiMock.etatVerificationLive
      .mockResolvedValueOnce({ total: 2, faites: 2, fini: true, sourcesFinies: false, mortes: ["c2"], chaines: [chaines[0]] })
      .mockResolvedValueOnce({ total: 2, faites: 2, fini: true, sourcesFinies: true, mortes: ["c2"], chaines: [{ ...chaines[0]!, adresses: 2 }] });
    const premier = render(<LiveTv onPlay={() => {}} />);
    await screen.findByText("TF1");
    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "fr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Ne garder que les chaînes qui marchent" }));
    expect(await screen.findByText("1 chaîne sur 2 joue en ce moment")).toBeInTheDocument();
    // Le suivi des sources continue en silence, et le nombre d'adresses retenu suit.
    await waitFor(() => expect(lireSouvenirDirect().verification?.chaines[0]?.adresses).toBe(2), { timeout: 3000 });
    expect(lireSouvenirDirect().verification?.id).toBe("v1");

    // Ouvrir une chaîne démonte l'écran ; au retour, le filtrage est toujours là.
    premier.unmount();
    render(<LiveTv onPlay={() => {}} />);
    expect(screen.getByText("1 chaîne sur 2 joue en ce moment")).toBeInTheDocument();
    expect(screen.queryByText("Arte")).toBeNull();
    expect(apiMock.verifierChainesLive).toHaveBeenCalledTimes(1);

    // Une recherche modifiée le fait tomber, et le lecteur ne citera plus la vérification.
    fireEvent.change(screen.getByPlaceholderText("Rechercher une chaîne"), { target: { value: "f" } });
    expect(await screen.findByRole("button", { name: "Ne garder que les chaînes qui marchent" })).toBeInTheDocument();
    expect(lireSouvenirDirect().verification).toBeNull();
  });
});
