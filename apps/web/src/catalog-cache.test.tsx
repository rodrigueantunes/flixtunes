// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomeResponse, MediaItem, Profile } from "@flixtunes/contracts";
import { oublierCache } from "./server-cache";

/**
 * Ce que le cache doit produire, vu de la personne qui utilise l'application : revenir sur Films
 * après un détour par l'accueil affiche le catalogue **immédiatement**, sans écran de chargement et
 * sans repartir de la première page.
 *
 * Ce test s'exécute sur l'application réellement rendue : vérifier le cache isolément prouverait
 * qu'il retient des valeurs, pas que la page s'en sert.
 */

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null };
const film = (index: number): MediaItem => ({
  id: `media-${index}`, catalogId: `catalog-${index}`, playableMediaId: `media-${index}`, kind: "movie",
  title: `Film ${index}`, sortTitle: `film ${index}`, year: 2020 + index, overview: null,
  posterUrl: null, backdropUrl: null, addedAt: "2026-08-12T12:00:00.000Z", showTitle: null,
  seasonNumber: null, episodeNumber: null, runtimeSeconds: 3600, progressPercent: 0, completed: false,
});
const vedette = { ...film(0), title: "Vedette", sortTitle: "vedette" };
const films = [film(1), film(2), film(3)];
const home = {
  profile, featured: vedette, continueWatching: [], recentlyAdded: [vedette], movies: [vedette], shows: [],
  movieTotal: 3, showTotal: 0, completed: [], watchedRecently: [],
} as unknown as HomeResponse;

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
  fiabilitesLive: vi.fn(async () => []),
  chaineLive: vi.fn(), resultatChaineLive: vi.fn(),
} }));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./Player", () => ({ Player: () => <div>Lecteur</div> }));
vi.mock("./LibraryManager", () => ({ LibraryManager: () => <div>Bibliothèques</div> }));
vi.mock("./MetadataManager", () => ({ MetadataManager: () => <div>Correspondances</div> }));
vi.mock("./SetupWizard", () => ({ SetupWizard: () => <div>Configuration</div> }));
import { App } from "./App";

beforeEach(() => {
  localStorage.clear(); window.location.hash = ""; vi.clearAllMocks();
  apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null }); oublierCache();
  apiMock.setupStatus.mockResolvedValue({ firstRunRequired: false, libraries: [] });
  apiMock.profiles.mockResolvedValue([profile]);
  apiMock.profileGroups.mockResolvedValue([{ id: "group-1", name: "Famille" }]);
  apiMock.home.mockResolvedValue(home);
  apiMock.search.mockResolvedValue([]);
  apiMock.catalogPage.mockResolvedValue({ items: films, total: 3, offset: 0, limit: 60 });
});
afterEach(cleanup);

/** Va sur une vue par son lien de navigation. */
function allerA(nom: string) {
  fireEvent.click(screen.getByRole("link", { name: nom }));
}

describe("catalogue affiché depuis le cache puis réconcilié", () => {
  it("réaffiche les titres sans attendre au retour sur Films", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Vedette", level: 1 });

    allerA("Films");
    await screen.findByRole("button", { name: "Voir Film 3" });
    const appelsInitiaux = apiMock.catalogPage.mock.calls.length;

    allerA("Accueil");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voir Film 3" })).not.toBeInTheDocument());

    allerA("Films");
    // Sans cache, la grille repartait vide le temps d'un aller-retour au serveur. Ici, le titre est
    // là dès le rendu — sans `findBy`, donc sans laisser le temps à une requête d'aboutir.
    expect(screen.getByRole("button", { name: "Voir Film 3" })).toBeInTheDocument();

    // La vérification part quand même : un catalogue analysé entre-temps doit finir par apparaître.
    await waitFor(() => expect(apiMock.catalogPage.mock.calls.length).toBeGreaterThan(appelsInitiaux));
  });

  it("montre le catalogue réconcilié quand le serveur a changé d'avis", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Vedette", level: 1 });
    allerA("Films");
    await screen.findByRole("button", { name: "Voir Film 3" });

    allerA("Accueil");
    // Une analyse est passée : un titre a disparu du serveur.
    apiMock.catalogPage.mockResolvedValue({ items: [films[0]!, films[1]!], total: 2, offset: 0, limit: 60 });
    allerA("Films");

    // L'affichage immédiat vient du cache, mais il ne fige rien : la réconciliation le corrige.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voir Film 3" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Voir Film 1" })).toBeInTheDocument();
  });

  it("oublie le catalogue quand une modification a eu lieu", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Vedette", level: 1 });
    allerA("Films");
    await screen.findByRole("button", { name: "Voir Film 3" });

    // Gérer les bibliothèques recharge l'accueil : ce que le cache croyait savoir n'a plus cours.
    allerA("Accueil");
    fireEvent.click(screen.getAllByRole("button", { name: /bibliothèques/i })[0]!);
    apiMock.catalogPage.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 60 });
    allerA("Films");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Voir Film 1" })).not.toBeInTheDocument());
  });
});
