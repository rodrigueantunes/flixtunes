// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LibraryFolder, ScanJob } from "@flixtunes/contracts";

const library: LibraryFolder = {
  id: "library-1", name: "Médiathèque", path: "\\\\nas\\Médias", kind: "auto", resolvedKind: "movie",
  language: "fr-FR", organizeSeasons: false, enabled: true, itemCount: 12,
  scan: { mode: "files", status: "completed", discovered: 12, imported: 12, enriched: 10, removed: 0,
    startedAt: "2026-08-13T08:00:00Z", finishedAt: "2026-08-13T08:01:00Z", error: null },
};
const jobs: ScanJob[] = [{ id: "job-running", libraryId: library.id, libraryName: library.name, scope: "all", mode: "files",
  status: "running", priority: 60, discovered: 4, imported: 3, enriched: 2, removed: 0, errorCount: 0, error: null,
  createdAt: "2026-08-13T08:00:00Z", startedAt: "2026-08-13T08:00:01Z", finishedAt: null, cancellable: true, retryable: false },
{ id: "job-failed", libraryId: library.id, libraryName: library.name, scope: "library", mode: "metadata",
  status: "failed", priority: 50, discovered: 12, imported: 0, enriched: 0, removed: 0, errorCount: 1, error: "Hors ligne",
  createdAt: "2026-08-12T08:00:00Z", startedAt: "2026-08-12T08:00:01Z", finishedAt: "2026-08-12T08:00:02Z", cancellable: false, retryable: true }];

const { apiMock } = vi.hoisted(() => ({ apiMock: {
  libraries: vi.fn(), scans: vi.fn(), addLibrary: vi.fn(), removeLibrary: vi.fn(), scanLibrary: vi.fn(),
  // Le repérage des génériques : le composant l'interroge à chaque chargement, et son absence ferait
  // échouer le rendu entier — l'appel d'une fonction manquante lève avant tout `.catch()`.
  generiques: vi.fn(async () => ({ actif: false, enCours: false, saisonsFaites: 0, saisonsTotal: 0, episodesEcoutes: 0, trouves: 0, saisonCourante: null as string | null, debuteLe: null as string | null,
    passe: null as { saisonsFaites: number; trouves: number } | null })),
  activerGeneriques: vi.fn(async (actif: boolean) => ({ actif, enCours: false, saisonsFaites: 3, saisonsTotal: 12, episodesEcoutes: 9, trouves: 2, saisonCourante: null as string | null, debuteLe: null as string | null,
    passe: null as { saisonsFaites: number; trouves: number } | null })),
  arreterGeneriques: vi.fn(async () => ({ actif: true, enCours: false, saisonsFaites: 4, saisonsTotal: 12, episodesEcoutes: 12, trouves: 3, saisonCourante: null as string | null, debuteLe: null as string | null,
    passe: null as { saisonsFaites: number; trouves: number } | null })),
  reprendreGeneriques: vi.fn(async () => ({ actif: true, enCours: true, saisonsFaites: 3, saisonsTotal: 12, episodesEcoutes: 9, trouves: 2, saisonCourante: null as string | null, debuteLe: null as string | null,
    passe: { saisonsFaites: 0, trouves: 0 } as { saisonsFaites: number; trouves: number } | null })),
  refreshLibraryMetadata: vi.fn(), startScan: vi.fn(), cancelScan: vi.fn(), retryScan: vi.fn(),
  metadataProviders: vi.fn(), configureMetadataProviders: vi.fn(),
  updateLibraryLocalization: vi.fn(),
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
vi.mock("./MetadataManager", () => ({ MetadataManager: () => <div>Correspondances</div> }));
import { LibraryManager } from "./LibraryManager";

describe("centre d'analyse et bibliothèques", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.libraries.mockResolvedValue([library]); apiMock.scans.mockResolvedValue(jobs);
    apiMock.startScan.mockResolvedValue({ jobs: [] }); apiMock.addLibrary.mockResolvedValue(library);
    apiMock.cancelScan.mockResolvedValue(jobs[0]); apiMock.retryScan.mockResolvedValue(jobs[1]);
    apiMock.metadataProviders.mockResolvedValue([{ id: "local", name: "Métadonnées locales", enabled: true, configured: true, official: true, priority: 0, message: "Toujours actif" },
      { id: "tmdb", name: "TMDB", enabled: false, configured: false, official: true, priority: 10, message: "Jeton requis" }]);
    apiMock.configureMetadataProviders.mockResolvedValue({ providers: [], jobs: [] });
    apiMock.updateLibraryLocalization.mockResolvedValue({ library, queued: true, job: jobs[0] });
    apiMock.systemStatus.mockResolvedValue({ version: "0.4.3", phase: 43, uptimeSeconds: 120, memory: { rss: 104857600 }, database: { integrity: "ok" }, playback: { ffmpegAvailable: true,
      encoders: ["h264_vaapi"], decoders: ["h264", "eac3"], hardwareAccelerators: ["vaapi"], selectedVideoEncoder: "h264_vaapi", activeTranscodes: 0, maximumTranscodes: 2, recentFailures: [],
      compatibility: { generatedAt: "2026-08-14T00:00:00Z", engineVersion: "ffmpeg 8.1", healthy: true, missingCritical: [], video: [], containers: [], subtitles: [], processing: [],
        audio: [{ id: "eac3", label: "Dolby Digital Plus / E-AC-3", available: true, component: "decoder", fallback: "AAC" }] } }, scans: { active: 0, queued: 0, concurrency: 2 } });
    apiMock.systemCapacity.mockResolvedValue({ generatedAt: "2026-08-14T00:00:00Z",
      calibration: { signature: "ffmpeg 8.1|vaapi|h264_vaapi|x64", measuredAt: "2026-08-14T00:00:00Z", source: "mesure" },
      architecture: "x64", cpuModel: "Celeron N5105", cpuCores: 4, totalMemoryBytes: 8e9, freeMemoryBytes: 4e9,
      loadAverage1: 0.4, temperatureCelsius: 52, selectedEncoder: "libx264", budgetUnits: 2.4, usedUnits: 1,
      headroomRatio: 0.6, simultaneous: [{ label: "1080p H.264", sessions: 2 }],
      accelerators: [{ id: "software", label: "Encodage logiciel x264", vendor: "cpu", encoder: "libx264", compiled: true,
        usable: true, framesPerSecond: 96, relativeToSoftware: 1, selected: true, error: null }],
      toneMapping: [{ id: "zscale", label: "Tone mapping logiciel zscale", hardware: false, compiled: true,
        usable: true, framesPerSecond: 42, relativeToSoftware: 1, selected: true, error: null }],
      scans: { configured: 2, effective: 1, pausedByPlayback: true }, activeSessions: [], alerts: [] });
    apiMock.createBackup.mockResolvedValue({ name: "backup.sqlite", createdAt: "2026-08-13" });
    apiMock.conversionPreferences.mockResolvedValue({ expert: false, accelerateur: "auto", toneMapping: "auto", codecSortie: "auto", resolutionMax: "auto", conversionsSimultanees: "auto" });
    apiMock.saveConversionPreferences.mockResolvedValue({ expert: true, accelerateur: "auto", toneMapping: "auto", codecSortie: "auto", resolutionMax: "auto", conversionsSimultanees: "auto" });
    apiMock.recalibrate.mockResolvedValue({ relance: true });
    apiMock.remoteAccounts.mockResolvedValue([]);
    apiMock.remoteSession.mockResolvedValue({ required: false, authenticated: true, account: null });
    apiMock.wanParametres.mockResolvedValue({
      parametres: { domaine: null, portHttp: 8080, portHttps: 8444, portInterne: 4001, dureeSessionHeures: 12 },
      minimumPin: 6,
    });
  });
  afterEach(cleanup);

  it("lance séparément les analyses globales, films, séries et métadonnées", async () => {
    render(<LibraryManager onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByRole("heading", { name: "Bibliothèques" });
    fireEvent.click(screen.getByRole("button", { name: /Tout analyser/ }));
    fireEvent.click(screen.getByRole("button", { name: "Films uniquement" }));
    fireEvent.click(screen.getByRole("button", { name: "Séries uniquement" }));
    fireEvent.click(screen.getByRole("button", { name: /Métadonnées/ }));
    await waitFor(() => expect(apiMock.startScan).toHaveBeenCalledTimes(4));
    expect(apiMock.startScan.mock.calls.map(([input]) => input)).toEqual([
      { scope: "all", mode: "files", priority: 60 }, { scope: "movie", mode: "files", priority: 60 },
      { scope: "tv", mode: "files", priority: 60 }, { scope: "all", mode: "metadata", priority: 60 },
    ]);
  });

  it("annule, relance et ajoute un dossier choisi par l'utilisateur", async () => {
    const changed = vi.fn();
    render(<LibraryManager onClose={vi.fn()} onChanged={changed} />);
    expect((await screen.findAllByText("Médiathèque")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    fireEvent.click(screen.getByRole("button", { name: "Relancer" }));
    fireEvent.change(screen.getByPlaceholderText("Films familiaux"), { target: { value: "Séries salon" } });
    fireEvent.change(screen.getByLabelText("Type de contenu"), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("Chemin réseau ou local"), { target: { value: "\\\\nas\\Multimédia\\Serie Tv" } });
    fireEvent.change(screen.getByLabelText("Langue de la nouvelle bibliothèque"), { target: { value: "en-US" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter et scanner" }));
    await waitFor(() => expect(apiMock.addLibrary).toHaveBeenCalledWith({ name: "Séries salon",
      path: "\\\\nas\\Multimédia\\Serie Tv", kind: "auto", language: "en-US", organizeSeasons: false }));
    expect(apiMock.cancelScan).toHaveBeenCalledWith("job-running");
    expect(apiMock.retryScan).toHaveBeenCalledWith("job-failed");
    expect(changed).toHaveBeenCalled();
  });

  it("configure TMDB sans réafficher le secret", async () => {
    render(<LibraryManager onClose={vi.fn()} onChanged={vi.fn()} />);
    const token = "eyJhbGciOiJIUzI1NiJ9.jeton-de-test-tmdb";
    const field = await screen.findByLabelText("Jeton d’accès TMDB");
    fireEvent.change(field, { target: { value: token } });
    fireEvent.click(screen.getByRole("button", { name: "Activer TMDB" }));
    await waitFor(() => expect(apiMock.configureMetadataProviders).toHaveBeenCalledWith({ tmdbToken: token }));
    expect(field).toHaveValue("");
  });

  it("change la langue d'une bibliothèque et demande sa réindexation", async () => {
    render(<LibraryManager onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Langue de Médiathèque"), { target: { value: "en-US" } });
    await waitFor(() => expect(apiMock.updateLibraryLocalization).toHaveBeenCalledWith("library-1", { language: "en-US" }));
  });

  it("affiche le diagnostic et crée une sauvegarde", async () => {
    render(<LibraryManager onClose={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Afficher le diagnostic/ }));
    expect(await screen.findByText("h264_vaapi")).toBeInTheDocument();
    expect(screen.getByText(/Compatibilité multimédia/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Créer une sauvegarde maintenant" }));
    expect(await screen.findByText(/backup.sqlite/)).toBeInTheDocument();
  });

  /*
   * L'interrupteur du repérage.
   *
   * Il est éteint tant qu'on ne l'a pas demandé : la passe sonore décode des heures durant, et une
   * fonction qui coûte cela s'allume au lieu de s'imposer.
   */
  it("le repérage des génériques s'allume depuis l'écran, et s'affiche éteint par défaut", async () => {
    apiMock.generiques.mockResolvedValue({ actif: false, enCours: false, saisonsFaites: 3, saisonsTotal: 12,
      episodesEcoutes: 9, trouves: 2, saisonCourante: null, debuteLe: null, passe: null });
    render(<LibraryManager onClose={() => {}} onChanged={() => {}} />);

    const bouton = await screen.findByRole("button", { name: "♪ Génériques : désactivé" });
    expect(screen.getByText(/Repérage désactivé/)).toBeInTheDocument();

    fireEvent.click(bouton);

    await waitFor(() => expect(apiMock.activerGeneriques).toHaveBeenCalledWith(true));
    expect(await screen.findByRole("button", { name: "♪ Génériques : activé" })).toBeInTheDocument();
  });

  /*
   * Arrêter n'est pas éteindre : la première commande ne concerne que la passe en cours, la seconde
   * la fonction entière. Le bouton d'arrêt n'apparaît donc que pendant une passe.
   */
  it("une passe en cours s'arrête sans éteindre le repérage", async () => {
    apiMock.generiques.mockResolvedValue({ actif: true, enCours: true, saisonsFaites: 3, saisonsTotal: 12,
      episodesEcoutes: 9, trouves: 2, saisonCourante: "Silo — saison 2", debuteLe: "2026-08-26T10:35:45Z",
      passe: { saisonsFaites: 1, trouves: 1 } });
    render(<LibraryManager onClose={() => {}} onChanged={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Arrêter" }));

    await waitFor(() => expect(apiMock.arreterGeneriques).toHaveBeenCalled());
    expect(apiMock.activerGeneriques, "l'arrêt ne touche pas au réglage").not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "♪ Génériques : activé" }),
      "le repérage reste allumé").toBeInTheDocument();
  });

  /*
   * Reprendre le repérage sur ce qui manque, sans passer par une analyse de bibliothèque.
   *
   * Sans ce bouton, relancer une passe demandait d'éteindre puis rallumer le réglage — un geste de
   * configuration détourné en geste d'action — ou de réanalyser des milliers de fichiers pour
   * quelques saisons.
   */
  it("reprend les génériques restants, en annonçant leur nombre", async () => {
    apiMock.generiques.mockResolvedValue({ actif: true, enCours: false, saisonsFaites: 3, saisonsTotal: 12,
      episodesEcoutes: 9, trouves: 2, saisonCourante: null, debuteLe: null, passe: null });
    render(<LibraryManager onClose={() => {}} onChanged={() => {}} />);

    // Le chiffre est celui du travail restant, pas du total : neuf saisons sur douze.
    fireEvent.click(await screen.findByRole("button", { name: "Reprendre (9 saisons)" }));

    await waitFor(() => expect(apiMock.reprendreGeneriques).toHaveBeenCalled());
    expect(apiMock.activerGeneriques, "reprendre ne touche pas au réglage").not.toHaveBeenCalled();
    expect(apiMock.startScan, "et ne relance aucune analyse de bibliothèque").not.toHaveBeenCalled();
  });

  it("n'offre pas de reprise quand tout est traité", async () => {
    apiMock.generiques.mockResolvedValue({ actif: true, enCours: false, saisonsFaites: 12, saisonsTotal: 12,
      episodesEcoutes: 40, trouves: 11, saisonCourante: null, debuteLe: null, passe: null });
    render(<LibraryManager onClose={() => {}} onChanged={() => {}} />);

    expect(await screen.findByText(/Toutes les saisons sont traitées/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reprendre/ })).not.toBeInTheDocument();
  });

  /* Une passe déjà lancée s'arrête ; elle ne se relance pas par-dessus elle-même. */
  it("offre d'arrêter, et non de reprendre, pendant une passe", async () => {
    apiMock.generiques.mockResolvedValue({ actif: true, enCours: true, saisonsFaites: 3, saisonsTotal: 12,
      episodesEcoutes: 9, trouves: 2, saisonCourante: "Silo — saison 3", debuteLe: "2026-08-30T10:35:45Z",
      passe: { saisonsFaites: 1, trouves: 1 } });
    render(<LibraryManager onClose={() => {}} onChanged={() => {}} />);

    expect(await screen.findByRole("button", { name: "Arrêter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reprendre/ })).not.toBeInTheDocument();
  });
});
