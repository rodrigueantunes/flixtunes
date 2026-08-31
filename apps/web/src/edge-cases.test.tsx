// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HomeResponse, MediaDetails, MediaItem, Profile } from "@flixtunes/contracts";

/**
 * Cas limites du dossier de l'étape 55 : catalogue vide, affiche absente, texte long, et retour
 * depuis le lecteur.
 *
 * Ce sont les états qu'on ne voit jamais en développement — on a toujours des données propres — et
 * qui sont pourtant le quotidien d'une médiathèque réelle : un film sans affiche, un titre à
 * rallonge, une bibliothèque encore en cours d'analyse.
 */

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null };
const base: MediaItem = {
  id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie", title: "Voyage Azur",
  sortTitle: "voyage azur", year: 2026, overview: "Une aventure locale.", posterUrl: null, backdropUrl: null,
  addedAt: "2026-08-12T12:00:00.000Z", showTitle: null, seasonNumber: null, episodeNumber: null,
  runtimeSeconds: 3600, progressPercent: 0, completed: false,
};
const home = (items: MediaItem[]): HomeResponse => ({
  profile, featured: items[0] ?? null, continueWatching: items, recentlyAdded: items, movies: items, shows: [],
  movieTotal: items.length, showTotal: 0, completed: [], watchedRecently: [],
} as unknown as HomeResponse);

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  setupStatus: vi.fn(), profileGroups: vi.fn(), profiles: vi.fn(), home: vi.fn(), search: vi.fn(), details: vi.fn(), catalogPage: vi.fn(),
  addProfile: vi.fn(), updateProfile: vi.fn(), removeProfile: vi.fn(), clearProgress: vi.fn(), saveProgress: vi.fn(), setCatalogWatched: vi.fn(),
  unlockProfile: vi.fn(), hasProfileAccess: vi.fn(() => false), clearProfileAccess: vi.fn(),
  setWatchlist: vi.fn(), recommendationFeedback: vi.fn(), libraries: vi.fn(),
  // Surface d'administration et de connexion distante. Un double incomplet ne produit pas un échec
  // net : l'appel lève de façon synchrone, le `catch` de démarrage conclut « serveur injoignable »,
  // et des dizaines de tests sans rapport tombent sur des éléments introuvables.
  systemStatus: vi.fn(), systemCapacity: vi.fn(), createBackup: vi.fn(),
  conversionPreferences: vi.fn(), saveConversionPreferences: vi.fn(), recalibrate: vi.fn(),
  wanParametres: vi.fn(), enregistrerWan: vi.fn(), verifierWan: vi.fn(),
  remoteAccounts: vi.fn(), createRemoteAccount: vi.fn(), removeRemoteAccount: vi.fn(),
  remoteSession: vi.fn(), remoteLogin: vi.fn(),
  // La télévision en direct : l'écran de configuration l'interroge dès son montage. Une valeur par
  // défaut suffit — éteinte et sans source, c'est l'état d'une installation qui ne s'en sert pas.
  live: vi.fn(async () => ({
    parametres: { actif: false, dossier: null as string | null, fichier: "m3u.json", cadenceHeures: 12 },
    etat: { actif: false, configure: false, enCours: false, listes: 0, listesRetenues: 0, chaines: 0, adresses: 0,
      fusionnees: 0, ecartees: 0, rafraichieLe: null as string | null, dernierMessage: null as string | null,
      progression: null, dureeSecondes: null as number | null },
  })),
  listesLive: vi.fn(async () => []),
  sourcesLive: vi.fn(async () => []),
  ajouterXtream: vi.fn(), activerFast: vi.fn(), retirerSourceLive: vi.fn(),
  enregistrerLive: vi.fn(), rafraichirLive: vi.fn(), arreterLive: vi.fn(),
  chainesLive: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 60 })),
  // Vu d'un client : la fonction est éteinte, donc l'entrée « Live TV » n'existe pas dans le menu.
  etatLive: vi.fn(async () => ({ disponible: false, chaines: 0, rafraichieLe: null as string | null })),
  listesLiveClient: vi.fn(async () => []),
  paysLive: vi.fn(async () => []),
  favoriLive: vi.fn(),
  derniereChaineLive: vi.fn(async () => ({ chaine: null })),
  fiabilitesLive: vi.fn(async () => []),
  chaineLive: vi.fn(), resultatChaineLive: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));
// Le lecteur est réduit à sa seule surface utile ici : le moyen d'en sortir.
vi.mock("./Player", () => ({
  Player: ({ onClose }: { onClose: () => void }) =>
    <button onClick={onClose}>Quitter le lecteur</button>,
}));
vi.mock("./LibraryManager", () => ({ LibraryManager: () => <div>Bibliothèques</div> }));
vi.mock("./MetadataManager", () => ({ MetadataManager: () => <div>Correspondances</div> }));
vi.mock("./SetupWizard", () => ({ SetupWizard: () => <div>Configuration</div> }));
import { App } from "./App";

beforeEach(() => {
  localStorage.clear(); window.location.hash = ""; vi.clearAllMocks();
  apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null });
  apiMock.setupStatus.mockResolvedValue({ firstRunRequired: false, libraries: [] });
  apiMock.profiles.mockResolvedValue([profile]);
  apiMock.profileGroups.mockResolvedValue([{ id: "group-1", name: "Famille" }]);
  apiMock.home.mockResolvedValue(home([base]));
  apiMock.details.mockResolvedValue({ item: base, seasons: [], related: [] } as MediaDetails);
  apiMock.search.mockResolvedValue([]);
  apiMock.catalogPage.mockResolvedValue({ items: [base], total: 1, offset: 0, limit: 60 });
});
afterEach(cleanup);

describe("cas limites d'affichage", () => {
  it("propose une issue quand la médiathèque est encore vide", async () => {
    apiMock.home.mockResolvedValue(home([]));
    render(<App />);
    // Un catalogue vide ne doit pas produire une page nue : l'utilisateur doit savoir quoi faire.
    await screen.findByText(/médiathèque se prépare/i);
    expect(screen.getAllByRole("button", { name: /bibliothèques/i }).length).toBeGreaterThan(0);
  });

  it("remplace une affiche absente sans casser la carte", async () => {
    render(<App />);
    const carte = (await screen.findAllByRole("button", { name: "Voir Voyage Azur" }))[0]!;
    // Aucune image cassée : l'initiale du titre tient la place, et la carte reste actionnable.
    expect(carte.querySelector("img")).toBeNull();
    expect(carte.querySelector(".poster-letter")?.textContent).toBe("V");
  });

  it("bascule sur l'initiale quand l'affiche annoncée ne se charge pas", async () => {
    apiMock.home.mockResolvedValue(home([{ ...base, posterUrl: "http://192.0.2.10/absent.jpg" }]));
    render(<App />);
    const carte = (await screen.findAllByRole("button", { name: "Voir Voyage Azur" }))[0]!;
    const image = carte.querySelector("img");
    expect(image).not.toBeNull();
    // Une affiche référencée mais introuvable sur le NAS est un cas courant après un déplacement.
    fireEvent.error(image!);
    await waitFor(() => expect(carte.querySelector(".poster-letter")?.textContent).toBe("V"));
  });

  it("conserve le titre complet accessible quand il est tronqué à l'écran", async () => {
    const long = "Le Très Long Titre Qui Ne Tient Absolument Pas Sur Deux Lignes De Carte";
    apiMock.home.mockResolvedValue(home([{ ...base, title: long }]));
    render(<App />);
    const carte = (await screen.findAllByRole("button", { name: `Voir ${long}` }))[0]!;
    // L'abrègement est visuel ; le titre entier reste lisible au survol et par un lecteur d'écran.
    expect(carte.querySelector(".card-title")).toHaveAttribute("title", long);
  });
});

describe("adresse de lecture", () => {
  it("rouvre le lecteur quand l'adresse en désigne un", async () => {
    // Le lecteur ne dépend plus du catalogue : un identifiant suffit à le rouvrir. C'est ce qui fait
    // qu'un rechargement en plein film ne renvoie plus à l'accueil.
    window.location.hash = `lecture/${base.id}`;
    render(<App />);
    expect(await screen.findByRole("button", { name: "Quitter le lecteur" })).toBeInTheDocument();
  });

  it("inscrit la lecture dans l'adresse quand elle démarre", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Lecture/ }));
    await screen.findByRole("button", { name: "Quitter le lecteur" });
    expect(window.location.hash).toBe(`#lecture/${base.id}`);
  });

  it("rend l'adresse à la vue courante en quittant", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Lecture/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitter le lecteur" }));
    // Sans cela, l'adresse resterait sur la lecture et un rechargement rouvrirait le film qu'on
    // vient précisément de quitter.
    await waitFor(() => expect(window.location.hash).not.toContain("lecture/"));
  });
});

describe("retour depuis le lecteur", () => {
  it("ramène le focus sur la fiche qu'on vient de regarder", async () => {
    render(<App />);
    const lecture = await screen.findByRole("button", { name: /Lecture/ });
    fireEvent.click(lecture);

    const quitter = await screen.findByRole("button", { name: "Quitter le lecteur" });
    fireEvent.click(quitter);

    // Sans cette restitution, quitter le lecteur renvoie sur `<body>` : un utilisateur au clavier
    // se retrouve en haut du document, sans savoir où il en était.
    await waitFor(() => {
      expect(document.activeElement).toHaveAttribute("data-media-id", base.catalogId);
    });
  });

  it("ne reprend pas le focus si la fiche détaillée le réclame déjà", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    const dialogue = await screen.findByRole("dialog");

    fireEvent.click(within(dialogue).getByRole("button", { name: /Lecture|Reprendre/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitter le lecteur" }));

    // La fiche réapparaît et gère son propre focus : le lui reprendre le ferait passer derrière elle.
    // Elle est reconstruite au retour, donc c'est le nouveau dialogue qu'il faut interroger.
    const revenu = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(revenu.contains(document.activeElement)).toBe(true);
    });
  });
});
