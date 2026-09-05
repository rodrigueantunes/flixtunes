// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomeResponse, MediaItem, Profile } from "@flixtunes/contracts";

/**
 * États dégradés de l'interface — étape 55.
 *
 * Le dossier impose de tenir des situations que personne ne rencontre en développement : catalogue
 * vide, chargement lent, serveur en erreur, session de profil expirée. Ce sont pourtant elles qui
 * décident de l'impression laissée par l'application, parce qu'elles surviennent au pire moment.
 *
 * Ces cas s'éprouvent sans moteur de mise en page, contrairement aux mesures de gabarit : ils portent
 * sur ce qui est affiché et annoncé, non sur la géométrie.
 */

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null };
const movie: MediaItem = {
  id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie", title: "Voyage Azur",
  sortTitle: "voyage azur", year: 2026, overview: "Une aventure locale.", posterUrl: null, backdropUrl: null,
  addedAt: "2026-08-12T12:00:00.000Z", showTitle: null, seasonNumber: null, episodeNumber: null,
  runtimeSeconds: 3600, progressPercent: 0, completed: false,
};

const videHome: HomeResponse = {
  profile, featured: null, continueWatching: [], recentlyAdded: [], movies: [], shows: [],
  movieTotal: 0, showTotal: 0, completed: [], watchedRecently: [],
};
const pleinHome: HomeResponse = { ...videHome, featured: movie, movies: [movie], movieTotal: 1, recentlyAdded: [movie] };

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  setupStatus: vi.fn(), profileGroups: vi.fn(), profiles: vi.fn(), home: vi.fn(), search: vi.fn(), details: vi.fn(), catalogPage: vi.fn(),
  addProfile: vi.fn(), updateProfile: vi.fn(), removeProfile: vi.fn(), clearProgress: vi.fn(), saveProgress: vi.fn(), setCatalogWatched: vi.fn(),
  unlockProfile: vi.fn(), hasProfileAccess: vi.fn(() => false), clearProfileAccess: vi.fn(),
  // Surface d'administration atteinte par le panneau de diagnostic. Un double incomplet ne se
  // manifeste pas par un test rouge et net, mais par des dizaines d'échecs sans rapport apparent :
  // l'appel lève de façon synchrone, avant tout `.catch()`, et emporte le rendu entier.
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
  etatWeb: vi.fn(async () => ({ disponible: false, bibliotheques: 0, chaines: 0 })),
  listesLiveClient: vi.fn(async () => []),
  paysLive: vi.fn(async () => []),
  favoriLive: vi.fn(),
  derniereChaineLive: vi.fn(async () => ({ chaine: null })),
  fiabilitesLive: vi.fn(async () => []),
  chaineLive: vi.fn(), resultatChaineLive: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./Player", () => ({ Player: () => <div>Lecteur</div> }));
vi.mock("./LibraryManager", () => ({ LibraryManager: () => <div>Bibliothèques</div> }));
vi.mock("./SetupWizard", () => ({ SetupWizard: () => <div>Configuration</div> }));
import { App } from "./App";

beforeEach(() => {
  localStorage.clear(); window.location.hash = ""; vi.clearAllMocks();
  // En local, aucune connexion distante n'est réclamée : c'est l'état par défaut du serveur.
  apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null });
  apiMock.setupStatus.mockResolvedValue({ firstRunRequired: false, libraries: [] });
  apiMock.profiles.mockResolvedValue([profile]);
  apiMock.profileGroups.mockResolvedValue([{ id: "group-1", name: "Famille" }]);
  apiMock.hasProfileAccess.mockReturnValue(false);
});
afterEach(cleanup);

describe("catalogue vide", () => {
  it("explique l'absence de contenu au lieu de laisser une page nue", async () => {
    apiMock.home.mockResolvedValue(videHome);
    apiMock.catalogPage.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 60 });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Films" }));
    // Un catalogue vide sans explication laisse croire à une panne. Le message doit orienter.
    expect(await screen.findByRole("heading", { name: "Aucun résultat" })).toBeInTheDocument();
    expect(screen.getByText(/analyse de la bibliothèque/i)).toBeInTheDocument();
  });

  it("distingue « rien dans la médiathèque » de « rien ne correspond au filtre »", async () => {
    // Les deux situations demandent des gestes opposés : lancer une analyse, ou élargir la recherche.
    apiMock.home.mockResolvedValue(pleinHome);
    apiMock.catalogPage.mockImplementation((_id: string, query: { filter?: string }) =>
      Promise.resolve(query.filter === "watched"
        ? { items: [], total: 0, offset: 0, limit: 60 }
        : { items: [movie], total: 1, offset: 0, limit: 60 }));
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Films" }));
    await screen.findByRole("button", { name: "Voir Voyage Azur" });
    fireEvent.change(screen.getByLabelText("Filtrer les films"), { target: { value: "watched" } });
    expect(await screen.findByRole("heading", { name: "Aucun résultat" })).toBeInTheDocument();
    expect(screen.getByText(/Modifiez la recherche ou le filtre/i)).toBeInTheDocument();
  });
});

describe("chargement lent", () => {
  it("occupe la place du contenu au lieu de sauter une fois chargé", async () => {
    apiMock.home.mockResolvedValue(pleinHome);
    // Requête qui ne se résout jamais : c'est l'état intermédiaire qu'on veut observer.
    apiMock.catalogPage.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Films" }));
    // La grille de substitution évite que la page se réorganise brutalement à l'arrivée des fiches.
    const squelette = await waitFor(() => {
      const grille = container.querySelector('.catalog-grid[aria-busy="true"]');
      expect(grille).not.toBeNull();
      return grille!;
    });
    expect(squelette.querySelectorAll(".catalog-skeleton").length).toBeGreaterThan(0);
    expect(squelette).toHaveAttribute("aria-label", "Chargement du catalogue");
    // Rien ne doit annoncer une absence de résultat tant que la réponse n'est pas arrivée.
    expect(screen.queryByRole("heading", { name: "Aucun résultat" })).not.toBeInTheDocument();
  });
});

describe("serveur en erreur", () => {
  it("annonce l'échec sans vider l'écran", async () => {
    apiMock.home.mockResolvedValue(pleinHome);
    apiMock.catalogPage.mockRejectedValue(new Error("Le serveur ne répond pas"));
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Films" }));
    const alerte = await screen.findByRole("alert");
    expect(alerte).toHaveTextContent("Le serveur ne répond pas");
    // Les commandes restent utilisables : on doit pouvoir réessayer autrement.
    expect(screen.getByLabelText("Trier les films")).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Films", level: 1 })).toBeInTheDocument();
  });
});

describe("profil sans code, accès distant", () => {
  /**
   * Le défaut du 25 août 2026 : un profil restauré au démarrage n'est jamais « sélectionné », et
   * partait donc lire sans session. Sans conséquence en local, où rien n'en réclame ; depuis Internet
   * chaque lecture en exige une, et l'écran affichait « Impossible de joindre le serveur » pour un
   * profil parfaitement légitime.
   */
  it("ouvre une session avant de lire, y compris pour un profil restauré", async () => {
    localStorage.setItem("flixtunes.profile", profile.id);
    apiMock.hasProfileAccess.mockReturnValue(false);
    apiMock.unlockProfile.mockResolvedValue({ unlocked: true, token: "j".repeat(64), expiresAt: "2027-01-01T00:00:00.000Z" });
    render(<App />);
    await waitFor(() => expect(apiMock.unlockProfile).toHaveBeenCalledWith(profile.id));
  });

  it("n'ouvre pas de session à la place de quelqu'un : un profil protégé passe par son code", async () => {
    apiMock.profiles.mockResolvedValue([{ ...profile, protected: true }]);
    apiMock.hasProfileAccess.mockReturnValue(false);
    render(<App />);
    await waitFor(() => expect(apiMock.home).not.toHaveBeenCalled());
    expect(apiMock.unlockProfile, "aucune session ne doit s'ouvrir sans le code").not.toHaveBeenCalled();
  });
});

describe("session de profil expirée", () => {
  it("redemande le code PIN plutôt que d'échouer en silence", async () => {
    // Le serveur redémarre : le jeton n'est plus valide et l'accueil est refusé.
    const protege: Profile = { ...profile, id: "profile-2", name: "Enfant", protected: true };
    apiMock.profiles.mockResolvedValue([protege]);
    apiMock.hasProfileAccess.mockReturnValue(false);
    apiMock.home.mockRejectedValue(new Error("Profil introuvable"));
    render(<App />);
    // Un profil protégé sans accès valide doit conduire à la saisie du code, pas à un écran mort.
    expect(await screen.findByRole("dialog", { name: /Code PIN/ })).toBeInTheDocument();
  });
});
