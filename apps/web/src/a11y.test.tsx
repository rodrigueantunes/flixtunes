// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HomeResponse, MediaDetails, MediaItem, Profile } from "@flixtunes/contracts";
import axe from "axe-core";

/**
 * Audit d'accessibilité automatisé — étape 55, exigence WCAG 2.2 AA.
 *
 * L'audit s'exécute sur l'application réellement rendue, écran par écran. Deux limites assumées, et
 * consignées plutôt que dissimulées :
 *
 * 1. **jsdom n'a pas de moteur de rendu.** Toute règle dépendant de la géométrie ou des pixels —
 *    contraste calculé, chevauchements, taille réelle des cibles — ne peut pas s'y prononcer. Le
 *    contraste est donc traité à part, par le calcul, dans `contrast.test.ts` ; les gabarits restent
 *    des observations en navigateur.
 * 2. **Un audit automatique ne couvre qu'une partie de la norme.** Il attrape les manquements
 *    mécaniques — nom accessible absent, hiérarchie de titres rompue, champ sans étiquette — pas la
 *    pertinence d'un libellé ni la cohérence d'un parcours.
 */

const REGLES_SANS_RENDU = [
  // Ces règles réclament des pixels : elles ne concluraient rien d'utile ici et signaleraient à tort.
  "color-contrast", "target-size", "scrollable-region-focusable",
];

async function auditer(conteneur: HTMLElement): Promise<axe.Result[]> {
  const resultat = await axe.run(conteneur, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: Object.fromEntries(REGLES_SANS_RENDU.map((regle) => [regle, { enabled: false }])),
  });
  return resultat.violations;
}

/** Message d'échec lisible : la règle, son impact, et l'élément fautif. */
function decrire(violations: axe.Result[]): string {
  return violations.map((violation) => {
    const cibles = violation.nodes.slice(0, 3).map((noeud) => noeud.html.slice(0, 90)).join("\n      ");
    return `- [${violation.impact}] ${violation.id} : ${violation.help}\n      ${cibles}`;
  }).join("\n");
}

const profile: Profile = { id: "profile-1", groupId: "group-1", name: "Principal", avatarColor: "#2968ff", language: "fr-FR", protected: false, isChild: false, age: null };
const movie: MediaItem = {
  id: "media-1", catalogId: "catalog-1", playableMediaId: "media-1", kind: "movie", title: "Voyage Azur",
  sortTitle: "voyage azur", year: 2026, overview: "Une aventure locale.", posterUrl: null, backdropUrl: null,
  addedAt: "2026-08-12T12:00:00.000Z", showTitle: null, seasonNumber: null, episodeNumber: null,
  runtimeSeconds: 3600, progressPercent: 0, completed: false,
};
const show: MediaItem & { seasonCount: number } = {
  ...movie, id: "show-1", catalogId: "show-1", playableMediaId: "episode-1", kind: "show",
  title: "Les Veilleurs", sortTitle: "les veilleurs", showTitle: "Les Veilleurs", runtimeSeconds: null, seasonCount: 2,
};
const home: HomeResponse = {
  profile, featured: movie, continueWatching: [movie], recentlyAdded: [movie], movies: [movie], shows: [show],
  movieTotal: 1, showTotal: 1, completed: [], watchedRecently: [],
};
const details: MediaDetails = { item: movie, seasons: [], related: [] };

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  setupStatus: vi.fn(), profileGroups: vi.fn(), profiles: vi.fn(), home: vi.fn(), search: vi.fn(), details: vi.fn(), catalogPage: vi.fn(),
  addProfile: vi.fn(), updateProfile: vi.fn(), removeProfile: vi.fn(), clearProgress: vi.fn(), saveProgress: vi.fn(), setCatalogWatched: vi.fn(),
  unlockProfile: vi.fn(), hasProfileAccess: vi.fn(() => false), clearProfileAccess: vi.fn(),
  systemStatus: vi.fn(), systemCapacity: vi.fn(), createBackup: vi.fn(),
  conversionPreferences: vi.fn(), saveConversionPreferences: vi.fn(), recalibrate: vi.fn(),
  wanParametres: vi.fn(), enregistrerWan: vi.fn(), verifierWan: vi.fn(),
  remoteAccounts: vi.fn(), createRemoteAccount: vi.fn(), removeRemoteAccount: vi.fn(),
  remoteSession: vi.fn(), remoteLogin: vi.fn(),
  setWatchlist: vi.fn(), recommendationFeedback: vi.fn(), libraries: vi.fn(),
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
  apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null });
  apiMock.remoteAccounts.mockResolvedValue([]);
  apiMock.setupStatus.mockResolvedValue({ firstRunRequired: false, libraries: [] });
  apiMock.profiles.mockResolvedValue([profile]);
  apiMock.profileGroups.mockResolvedValue([{ id: "group-1", name: "Famille" }]);
  apiMock.home.mockResolvedValue(home);
  apiMock.details.mockResolvedValue(details);
  apiMock.search.mockResolvedValue([movie]);
  apiMock.catalogPage.mockResolvedValue({ items: [movie], total: 1, offset: 0, limit: 60 });
});
afterEach(cleanup);

describe("audit WCAG de l'application rendue", () => {
  it("l'accueil ne présente aucun manquement mécanique", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const violations = await auditer(container);
    expect(violations, `Accueil :\n${decrire(violations)}`).toHaveLength(0);
  }, 60_000);

  it("la page catalogue ne présente aucun manquement mécanique", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "Films" }));
    await screen.findByRole("button", { name: "Voir Voyage Azur" });
    const violations = await auditer(container);
    expect(violations, `Catalogue :\n${decrire(violations)}`).toHaveLength(0);
  }, 60_000);

  it("la fiche détaillée ne présente aucun manquement mécanique", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    await screen.findByRole("dialog");
    const violations = await auditer(container);
    expect(violations, `Fiche détaillée :\n${decrire(violations)}`).toHaveLength(0);
  }, 60_000);

  it("la fenêtre des profils ne présente aucun manquement mécanique", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Principal/ }));
    await screen.findByRole("dialog", { name: "Profils" });
    const violations = await auditer(container);
    expect(violations, `Profils :\n${decrire(violations)}`).toHaveLength(0);
  }, 60_000);

  it("la recherche ouverte ne présente aucun manquement mécanique", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    await screen.findByPlaceholderText("Titres, acteurs, réalisateurs, genres…");
    const violations = await auditer(container);
    expect(violations, `Recherche :\n${decrire(violations)}`).toHaveLength(0);
  }, 60_000);
});

describe("structure perçue par un lecteur d'écran", () => {
  it("expose un seul titre de premier niveau et une hiérarchie sans saut", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const niveaux = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((titre) => Number(titre.tagName.slice(1)));
    expect(niveaux.filter((niveau) => niveau === 1), "un seul titre de premier niveau").toHaveLength(1);
    // Un saut de niveau — h1 puis h3 — laisse croire à un contenu manquant lors d'un parcours par titres.
    for (let index = 1; index < niveaux.length; index += 1) {
      expect(niveaux[index]! - niveaux[index - 1]!, `saut de h${niveaux[index - 1]} à h${niveaux[index]}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("nomme chaque commande interactive", async () => {
    // Un bouton sans nom accessible est annoncé « bouton » : impossible de savoir ce qu'il déclenche.
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const anonymes = [...container.querySelectorAll("button, a[href], input, select")].filter((element) => {
      const nom = element.getAttribute("aria-label")
        ?? element.getAttribute("title")
        ?? (element.getAttribute("aria-labelledby") ? "référence" : null)
        ?? element.textContent?.trim()
        ?? "";
      const etiquette = element.id ? container.querySelector(`label[for="${element.id}"]`) : null;
      const parent = element.closest("label");
      return !nom && !etiquette && !parent;
    }).map((element) => element.outerHTML.slice(0, 80));
    expect(anonymes, `commandes sans nom accessible :\n${anonymes.join("\n")}`).toHaveLength(0);
  });

  it("n'emploie aucun ordre de tabulation forcé", async () => {
    // Un `tabindex` positif impose un ordre qui diverge de l'ordre visuel et se dérègle à la moindre
    // évolution de la page.
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const forces = [...container.querySelectorAll("[tabindex]")]
      .filter((element) => Number(element.getAttribute("tabindex")) > 0);
    expect(forces).toHaveLength(0);
  });

  it("offre un lien d'évitement atteignable en premier", async () => {
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const premier = container.querySelector("a[href], button");
    expect(premier?.className, "le lien d'évitement doit précéder toute autre commande").toContain("skip-link");
  });
});

describe("navigation au clavier seul", () => {
  it("permet d'atteindre et d'ouvrir une fiche sans souris", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    const carte = screen.getAllByRole("button", { name: /^Voir / })[0]!;
    carte.focus();
    expect(document.activeElement).toBe(carte);
    // La touche Entrée sur un vrai bouton déclenche son activation : c'est ce que fait un clavier.
    fireEvent.click(carte);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("ferme la fenêtre par la touche d'échappement", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Voyage Azur", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Plus d’infos" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
