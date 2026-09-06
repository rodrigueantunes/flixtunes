// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CatalogPage, CatalogQuery, HomeResponse, MediaDetails, MediaItem, Profile } from "@flixtunes/contracts";

type AnchoredCatalogPage = CatalogPage & { anchor?: number };

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null };
const protectedProfile: Profile = { ...profile, id: "profile-2", name: "Enfant", avatarColor: "#10b981", protected: true };
const movie: MediaItem = {
  id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie", title: "Voyage Azur",
  sortTitle: "voyage azur", year: 2026, overview: "Une aventure locale.", posterUrl: null, backdropUrl: null,
  addedAt: "2026-08-12T12:00:00.000Z",
  showTitle: null, seasonNumber: null, episodeNumber: null, runtimeSeconds: 3600, progressPercent: 0, completed: false,
};
const alphaMovie: MediaItem = { ...movie, id: "media-2", catalogId: "catalog-2", playableMediaId: "media-2", title: "Alpha", sortTitle: "alpha", year: 2024, addedAt: "2026-08-13T12:00:00.000Z" };
const show: MediaItem & { seasonCount: number } = { ...movie, id: "show-1", catalogId: "show-1", playableMediaId: "episode-1", kind: "show", title: "Les Veilleurs", sortTitle: "les veilleurs", year: 2025, addedAt: "2026-08-11T12:00:00.000Z", overview: "Une série locale.", posterUrl: "/show.jpg", showTitle: "Les Veilleurs", runtimeSeconds: null, seasonCount: 2 };
const episodeOne: MediaItem = { ...movie, id: "episode-1", catalogId: "episode-catalog-1", playableMediaId: "episode-1", kind: "episode", title: "Premier signal", sortTitle: "0001", year: 2025, showTitle: "Les Veilleurs", seasonNumber: 1, episodeNumber: 1 };
const episodeTwo: MediaItem = { ...episodeOne, id: "episode-2", catalogId: "episode-catalog-2", playableMediaId: "episode-2", title: "La relève", seasonNumber: 2 };
const home: HomeResponse = { profile, featured: movie, continueWatching: [], recentlyAdded: [alphaMovie, movie], movies: [movie, alphaMovie], shows: [show], movieTotal: 2, showTotal: 1, completed: [], watchedRecently: [] };
const details: MediaDetails = { item: movie, source: { kind: "file", name: "Voyage Azur (2026) REMUX.mkv" },
  versions: [
    { mediaId: "media-1", name: "Voyage Azur (2026) REMUX.mkv", quality: "4K · HDR10 · HEVC/H.265", fileSizeBytes: 21_474_836_480 },
    { mediaId: "media-1-1080", name: "Voyage Azur (2026) 1080p.mkv", quality: "1080p · SDR · H.264", fileSizeBytes: 4_294_967_296 },
  ], qualities: ["4K · HDR10 · HEVC/H.265", "1080p · SDR · H.264"], seasons: [], related: [] };
const showDetails: MediaDetails = { item: show, seasons: [
  { id: "season-1", number: 1, title: "Saison 1", overview: "Le commencement.", posterUrl: null, completed: false, episodes: [episodeOne] },
  { id: "season-2", number: 2, title: "Saison 2", overview: "La suite.", posterUrl: "/season-2.jpg", completed: false, episodes: [episodeTwo] },
], source: { kind: "folder", name: "Les Veilleurs (2025)" }, qualities: ["1080p · SDR · H.264"], related: [] };

/**
 * Serveur de catalogue simulé. Il applique tri, filtre, recherche puis découpage dans cet ordre, comme
 * le vrai : un double qui rendrait toujours la même liste ne prouverait rien des critères transmis.
 */
function fakeCatalog(query: CatalogQuery): AnchoredCatalogPage {
  let items: MediaItem[] = query.kind === "movies" ? [movie, alphaMovie] : [show];
  const needle = query.query?.trim().toLocaleLowerCase("fr");
  if (needle) items = items.filter((item) => item.title.toLocaleLowerCase("fr").includes(needle));
  if (query.filter === "watched") items = items.filter((item) => item.completed);
  if (query.filter === "progress") items = items.filter((item) => item.progressPercent > 0 && !item.completed);
  if (query.filter === "unwatched") items = items.filter((item) => !item.completed && item.progressPercent === 0);
  const byTitle = (left: MediaItem, right: MediaItem) => (left.sortTitle || left.title).localeCompare(right.sortTitle || right.title, "fr");
  items = [...items].sort((left, right) => {
    if (query.sort === "release") return (right.year ?? -Infinity) - (left.year ?? -Infinity) || byTitle(left, right);
    if (query.sort === "added") return (Date.parse(right.addedAt ?? "") || 0) - (Date.parse(left.addedAt ?? "") || 0) || byTitle(left, right);
    return byTitle(left, right);
  });
  let offset = query.offset ?? 0; const limit = query.limit ?? 60; let anchor: number | undefined;
  if (query.letter && query.sort !== "release" && query.sort !== "added" && offset === 0) {
    const target = query.letter.toLocaleLowerCase("fr");
    const exact = items.findIndex((item) => item.title.charAt(0).toLocaleLowerCase("fr") === target);
    const following = items.findIndex((item) => item.title.charAt(0).toLocaleLowerCase("fr") > target);
    anchor = exact >= 0 ? exact : following >= 0 ? following : Math.max(0, items.length - 1);
    offset = Math.max(0, Math.min(anchor - Math.floor(limit / 3), Math.max(0, items.length - limit)));
  }
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, anchor };
}

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

describe("expérience Web FlixTunes", () => {
  beforeEach(() => {
    localStorage.clear(); window.location.hash = ""; vi.clearAllMocks();
    apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null });
    apiMock.setupStatus.mockResolvedValue({ firstRunRequired: false, libraries: [] });
    apiMock.profileGroups.mockResolvedValue([{ id: "group-1", name: "Famille" }]);
    apiMock.profiles.mockResolvedValue([profile]); apiMock.home.mockResolvedValue(home);
    apiMock.search.mockResolvedValue([movie]); apiMock.details.mockResolvedValue(details);
    apiMock.catalogPage.mockImplementation((_profileId: string, query: CatalogQuery) => Promise.resolve(fakeCatalog(query)));
  });
  afterEach(cleanup);

  it("charge le profil, l'accueil et une fiche détaillée", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Voyage Azur", level: 1 })).toBeInTheDocument();
    expect(apiMock.home).toHaveBeenCalledWith("profile-1");
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Une aventure locale");
    expect(apiMock.details).toHaveBeenCalledWith("catalog-1", "profile-1");
  });

  it("révèle le nom complet du fichier source à la demande", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    fireEvent.click(await screen.findByRole("button", { name: "▤ Détails du fichier" }));
    expect(screen.getByText("Fichier d’origine")).toBeInTheDocument();
    expect(screen.getByText("Voyage Azur (2026) REMUX.mkv")).toBeInTheDocument();
  });

  it("affiche la qualité avant lecture et permet de choisir entre plusieurs fichiers", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("4K · HDR10 · HEVC/H.265");
    expect(dialog).toHaveTextContent("1080p · SDR · H.264");
    fireEvent.click(screen.getByRole("button", { name: "▤ Détails du fichier" }));
    const second = screen.getByRole("button", { name: /Voyage Azur \(2026\) 1080p\.mkv/ });
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("actualise immédiatement l'état vu dans une fiche", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    const markWatched = await screen.findByRole("button", { name: "✓ Marquer vu" });
    fireEvent.click(markWatched);
    expect(await screen.findByRole("button", { name: "Marquer non vu" })).toBeInTheDocument();
    expect(apiMock.setCatalogWatched).toHaveBeenCalledWith("catalog-1", "profile-1", true);
  });

  it("déverrouille un profil protégé dans une fenêtre intégrée", async () => {
    apiMock.profiles.mockResolvedValue([profile, protectedProfile]);
    apiMock.unlockProfile.mockResolvedValue({ unlocked: true, token: "token", expiresAt: new Date().toISOString() });
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Principal/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Enfant Français/ }));
    expect(await screen.findByRole("dialog", { name: "Code PIN de Enfant" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Code PIN"), { target: { value: "2468" } });
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    await waitFor(() => expect(apiMock.unlockProfile).toHaveBeenCalledWith("profile-2", "2468"));
  });

  it("recherche côté serveur et ouvre le gestionnaire de profils", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    fireEvent.change(screen.getByPlaceholderText("Titres, acteurs, réalisateurs, genres…"), { target: { value: "Azur" } });
    await waitFor(() => expect(apiMock.search).toHaveBeenCalledWith("Azur", "profile-1"));
    fireEvent.click(screen.getByRole("button", { name: /Principal/ }));
    expect(screen.getByRole("dialog", { name: "Profils" })).toHaveTextContent("Qui regarde dans Famille ?");
  });

  it("ouvre la recherche au clavier et navigue avec les raccourcis", async () => {
    render(<App />); await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.keyDown(window, { key: "/" });
    expect(screen.getByPlaceholderText("Titres, acteurs, réalisateurs, genres…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "m", altKey: true });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Films", level: 1 })).toBeInTheDocument());
  });

  it("sépare les films et les séries avec les trois tris demandés", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    expect(screen.getByRole("heading", { name: "Films", level: 1 })).toBeInTheDocument();
    const titles = () => Array.from(container.querySelectorAll(".catalog-grid .card-title")).map((node) => node.textContent);
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Voyage Azur"]));
    expect(screen.queryByRole("button", { name: "Voir Les Veilleurs" })).not.toBeInTheDocument();

    // Le tri est demandé au serveur : c'est lui qui classe la totalité du catalogue. Vérifier ici
    // l'ordre rendu sans vérifier le critère transmis laisserait passer un tri appliqué à la seule
    // page déjà chargée, qui donne le bon résultat sur deux films et un résultat faux sur deux mille.
    fireEvent.change(screen.getByLabelText("Trier les films"), { target: { value: "release" } });
    await waitFor(() => expect(apiMock.catalogPage).toHaveBeenCalledWith("profile-1", expect.objectContaining({ kind: "movies", sort: "release" })));
    await waitFor(() => expect(titles()).toEqual(["Voyage Azur", "Alpha"]));
    fireEvent.change(screen.getByLabelText("Trier les films"), { target: { value: "added" } });
    await waitFor(() => expect(apiMock.catalogPage).toHaveBeenCalledWith("profile-1", expect.objectContaining({ kind: "movies", sort: "added" })));
    await waitFor(() => expect(titles()).toEqual(["Alpha", "Voyage Azur"]));

    fireEvent.click(screen.getByRole("link", { name: "Séries TV" }));
    expect(await screen.findByRole("button", { name: "Voir Les Veilleurs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voir Voyage Azur" })).not.toBeInTheDocument();
  });

  it("charge la suite du catalogue à la demande sans réclamer deux fois la même page", async () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      ...movie, id: `many-${index}`, catalogId: `many-catalog-${index}`,
      title: `Titre ${String(index).padStart(3, "0")}`, sortTitle: `titre ${String(index).padStart(3, "0")}`,
    }));
    apiMock.catalogPage.mockImplementation((_profileId: string, query: { offset?: number; limit?: number }) => {
      const offset = query.offset ?? 0; const limit = query.limit ?? 60;
      return Promise.resolve({ items: many.slice(offset, offset + limit), total: many.length, offset, limit });
    });
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    const cards = () => container.querySelectorAll(".catalog-grid .card-title").length;
    await waitFor(() => expect(cards()).toBe(60));
    expect(screen.getByText("90 titres restants")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Afficher 60 titres de plus" }));
    await waitFor(() => expect(cards()).toBe(120));
    fireEvent.click(screen.getByRole("button", { name: "Afficher 30 titres de plus" }));
    await waitFor(() => expect(cards()).toBe(150));
    // Une fois le catalogue entier affiché, plus rien à demander ni à proposer.
    expect(screen.queryByText(/titres restants/)).not.toBeInTheDocument();
    expect(new Set(Array.from(container.querySelectorAll(".catalog-grid .card-title")).map((node) => node.textContent)).size).toBe(150);
  });

  it("saute par l'index Web A-Z sans filtrer les lettres suivantes", async () => {
    const zeta = { ...movie, id: "media-z", catalogId: "catalog-z", title: "Zeta", sortTitle: "zeta" };
    const alphabet = [alphaMovie, movie, zeta];
    apiMock.catalogPage.mockImplementation((_profileId: string, query: CatalogQuery) => {
      const target = query.letter?.toLocaleUpperCase("fr");
      const anchor = target ? Math.max(0, alphabet.findIndex((item) => item.title.startsWith(target))) : undefined;
      const limit = query.limit ?? 60;
      const offset = anchor == null ? (query.offset ?? 0)
        : Math.max(0, Math.min(anchor - Math.floor(limit / 3), Math.max(0, alphabet.length - limit)));
      return Promise.resolve({ items: alphabet.slice(offset, offset + limit), total: alphabet.length, offset, limit, anchor });
    });
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    await waitFor(() => expect(container.querySelectorAll(".catalog-grid .card-title")).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Aller à la lettre V" }));
    await waitFor(() => expect(apiMock.catalogPage).toHaveBeenCalledWith("profile-1",
      expect.objectContaining({ kind: "movies", sort: "title", letter: "v", offset: 0 })));
    await waitFor(() => expect(Array.from(container.querySelectorAll(".catalog-grid .card-title")).map((node) => node.textContent))
      .toEqual(["Alpha", "Voyage Azur", "Zeta"]));
    expect(screen.getByText("3 titres")).toBeInTheDocument();
    expect(screen.queryByText(/titres restants/)).not.toBeInTheDocument();
  });

  it("ouvre une série, affiche ses saisons et navigue vers leurs épisodes", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    apiMock.details.mockResolvedValueOnce(showDetails);
    fireEvent.click(screen.getByRole("link", { name: "Séries TV" }));
    fireEvent.click(await screen.findByRole("button", { name: "Voir Les Veilleurs" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Une série locale.");
    expect(dialog).toHaveTextContent("Premier signal");
    fireEvent.click(screen.getByRole("button", { name: "▣ Détails du dossier" }));
    expect(dialog).toHaveTextContent("Dossier racine d’origine");
    expect(dialog).toHaveTextContent("Les Veilleurs (2025)");
    const firstSeasonPoster = container.querySelector(".season-card .season-poster");
    expect(firstSeasonPoster).toHaveStyle({ backgroundImage: "url(/show.jpg)" });
    fireEvent.click(screen.getByRole("button", { name: /Saison 2/ }));
    expect(dialog).toHaveTextContent("La relève");
    expect(dialog).not.toHaveTextContent("Premier signal");
  });

  it("annonce une chaîne web en dossiers et en vidéos, jamais en saisons", async () => {
    /*
     * Cette fiche s'atteint depuis la recherche : une vidéo trouvee ouvre la fiche de sa chaine. Elle
     * s'annoncait alors « SÉRIE · Toutes les saisons · 4 saisons · Saison 1 · Épisodes », parce
     * qu'une chaine est **rangee** comme une serie et que rien dans sa forme ne l'en distingue.
     *
     * Le rayon vient maintenant du serveur, avec la fiche. C'est ce champ que ce cas surveille : s'il
     * disparaissait, aucune erreur ne serait levee — la fiche redeviendrait simplement une serie.
     */
    const chaine: MediaItem = { ...show, id: "chaine-1", catalogId: "chaine-1", title: "Chaine documentaire" };
    apiMock.details.mockResolvedValueOnce({
      item: { ...chaine, libraryKind: "web" },
      seasons: [{ id: "dossier-1", number: 1, title: "Grands formats", overview: null, posterUrl: null,
        completed: false, episodes: [{ ...episodeOne, kind: "video", title: "Les routes du sel", airDate: "2024-11-12" }] }],
      related: [],
    } as unknown as MediaDetails);

    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Séries TV" }));
    fireEvent.click(await screen.findByRole("button", { name: "Voir Les Veilleurs" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Chaîne");
    expect(dialog).toHaveTextContent("Dossiers");
    expect(dialog).toHaveTextContent("Vidéos");
    expect(dialog).toHaveTextContent("12 novembre 2024");
    expect(dialog).not.toHaveTextContent("Saison");
    expect(dialog).not.toHaveTextContent("Épisodes");
  });

  it("déplace le focus dans une fenêtre, l'y enferme, puis le rend à son déclencheur", async () => {
    // Le balisage « role=dialog aria-modal » promet ces trois comportements sans les fournir. Sans
    // eux, une personne au clavier ou au lecteur d'écran reste dans la page de fond : la fenêtre
    // s'est ouverte pour elle sans qu'elle en soit informée ni puisse l'atteindre.
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const opener = screen.getByRole("button", { name: "Plus d’infos" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // La tabulation boucle : depuis le dernier élément, elle revient au premier au lieu de filer
    // dans la page de fond, que « aria-modal » masque au lecteur d'écran sans la rendre inatteignable.
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])"));
    expect(focusable.length).toBeGreaterThan(1);
    focusable.at(-1)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable.at(-1));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Sans ce retour, le focus repart au début du document et le parcours est perdu. La comparaison
    // porte sur le nom accessible et non sur le nœud : React peut avoir remplacé le bouton par un
    // nœud équivalent en re-rendant l'accueil, ce qui n'a aucune incidence pour la personne.
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Plus d’infos"));
  });

  it("ramène le focus égaré dans la fenêtre plutôt que de le laisser filer", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Un clic dans le fond peut sortir le focus de la fenêtre : la tabulation suivante l'y ramène.
    document.body.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("recherche et filtre dans une page catalogue", async () => {
    render(<App />); await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    await screen.findByRole("button", { name: "Voir Alpha" });
    fireEvent.change(screen.getByPlaceholderText("Rechercher dans les films"), { target: { value: "Alpha" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Voir Voyage Azur" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Voir Alpha" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrer les films"), { target: { value: "watched" } });
    expect(await screen.findByRole("heading", { name: "Aucun résultat" })).toBeInTheDocument();
  });

  it("ne lance qu'une recherche serveur pour une saisie continue", async () => {
    render(<App />); await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    await screen.findByRole("button", { name: "Voir Alpha" });
    apiMock.catalogPage.mockClear();
    const field = screen.getByPlaceholderText("Rechercher dans les films");
    for (const value of ["A", "Al", "Alp", "Alph", "Alpha"]) fireEvent.change(field, { target: { value } });
    // Sans temporisation, chaque frappe partirait au serveur : cinq requêtes pour un seul résultat utile.
    await waitFor(() => expect(apiMock.catalogPage).toHaveBeenCalledWith("profile-1", expect.objectContaining({ query: "Alpha" })));
    expect(apiMock.catalogPage).toHaveBeenCalledTimes(1);
  });
});
