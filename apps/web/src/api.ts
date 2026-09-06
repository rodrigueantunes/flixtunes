import type {
  CatalogItem,
  CatalogPage,
  CatalogQuery,
  DirectoryBrowserListing,
  HomeResponse,
  LibraryFolder,
  LibraryInput,
  LibraryLocalizationInput,
  MediaItem,
  MediaDetails,
  PersonDetails,
  PlaybackCapabilities,
  PlaybackCompatibilityMatrix,
  PlaybackInfo,
  PlaybackNeighbors,
  PlaybackSession,
  MetadataSearchCandidate,
  MetadataProviderStatus,
  MetadataProviderConfigurationInput,
  ManualMetadataInput,
  ConversionPreferences,
  ServerCapacityReport,
  SetupInput,
  SetupStatus,
  SubtitlePreference,
  Profile,
  ProfileGroup,
  ProfileGroupInput,
  ProfileInput,
  ScanJob,
  ScanRequest,
  ChaineDirect,
  ChaineDirectDetaillee,
  ClassementListe,
  EtatDirect,
  ListeDirect,
  PageChaines,
  ParametresDirect,
  SourceDirect,
} from "@flixtunes/contracts";

/** La cible A–Z peut vivre au milieu de la page afin de conserver les jaquettes précédentes. */
export type AnchoredCatalogPage = CatalogPage & { anchor?: number };

export interface ParametresWan {
  domaine: string | null;
  portHttp: number;
  portHttps: number;
  portInterne: number;
  dureeSessionHeures: number;
}

export interface ControleWan {
  id: string;
  libelle: string;
  etat: "ok" | "attention" | "echec" | "inconnu";
  constat: string;
  action: string | null;
}

export interface DiagnosticWan {
  genereLe: string;
  domaine: string | null;
  pret: boolean;
  controles: ControleWan[];
}

export interface SessionDistante {
  required: boolean;
  authenticated: boolean;
  account: string | null;
}

export interface CompteDistant {
  id: string;
  username: string;
  createdAt: string;
  devices: number;
}

const apiRoot = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";
const profileTokenKey = (profileId: string) => `flixtunes.profile-token.${profileId}`;

function profileToken(profileId: string): string | null {
  try { return sessionStorage.getItem(profileTokenKey(profileId)); } catch { return null; }
}

function clearProfileToken(profileId: string): void {
  try { sessionStorage.removeItem(profileTokenKey(profileId)); } catch { /* private browsing can disable storage */ }
}

function profileIdFromPath(path: string): string | null {
  try { return new URL(path, "http://flixtunes.local").searchParams.get("profileId"); } catch { return null; }
}

function serverUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (/^https?:\/\//.test(apiRoot)) return new URL(path, new URL(apiRoot).origin).toString();
  return path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const profileId = profileIdFromPath(path);
  const token = profileId ? profileToken(profileId) : null;
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-FlixTunes-Profile-Token", token);
  const response = await fetch(`${apiRoot}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    if (profileId && token && [401, 403, 404].includes(response.status)) clearProfileToken(profileId);
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Erreur du serveur (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** L'état du repérage des génériques : l'interrupteur, l'avancement global, et la passe en cours. */
export interface EtatGeneriques {
  actif: boolean;
  enCours: boolean;
  saisonsFaites: number;
  saisonsTotal: number;
  episodesEcoutes: number;
  trouves: number;
  saisonCourante: string | null;
  debuteLe: string | null;
  passe: { saisonsFaites: number; trouves: number } | null;
}

/** Ce qui pèse sur une facette : les autres filtres déjà cochés. */
export interface CriteresFacette { listes?: string[]; pays?: string[]; fiabilites?: string[]; q?: string }

function queteFacette(criteres: CriteresFacette): string {
  const parametres = new URLSearchParams();
  if (criteres.listes?.length) parametres.set("listes", criteres.listes.join(","));
  if (criteres.pays?.length) parametres.set("pays", criteres.pays.join(","));
  if (criteres.fiabilites?.length) parametres.set("fiabilites", criteres.fiabilites.join(","));
  if (criteres.q?.trim()) parametres.set("q", criteres.q);
  const quete = parametres.toString();
  return quete ? `?${quete}` : "";
}

/** Une fiche web à corriger, telle que le serveur la nomme — « chaine » ou « video ». */
export interface CorrespondanceWeb {
  id: string;
  genre: "chaine" | "video";
  titre: string;
  chaine: string | null;
  /** La fiche de chaîne dont dépend la ligne — la sienne pour une chaîne. */
  chaineId: string | null;
  posterUrl: string | null;
  publieeLe: string | null;
  identifiant: string | null;
  statut: string;
  verrouillee: boolean;
}

/** Ce qu'il reste à dépenser aujourd'hui sur l'API de la plateforme. */
export interface BudgetWeb { depense: number; plafond: number; reste: number }

/** Un candidat de plateforme. Jamais un film ni une série : les deux mondes ne se croisent pas. */
export interface CandidatWeb {
  titre: string | null;
  chaine: string | null;
  identifiant: string | null;
  url: string | null;
  publieeLe: string | null;
  vignette: string | null;
}

export const api = {
  remoteSession: () => request<SessionDistante>("/remote/session"),
  remoteLogin: (username: string, password: string) => request<{ token: string; account: string; expiresAt: string }>(
    "/remote/login", { method: "POST", body: JSON.stringify({ username, password }) },
  ),
  profileGroups: () => request<ProfileGroup[]>("/profile-groups"),
  addProfileGroup: (input: ProfileGroupInput) => request<ProfileGroup>("/profile-groups", { method: "POST", body: JSON.stringify(input) }),
  updateProfileGroup: (id: string, input: ProfileGroupInput) => request<ProfileGroup>(`/profile-groups/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  removeProfileGroup: (id: string) => request<void>(`/profile-groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  profiles: (groupId?: string) => request<Profile[]>(`/profiles${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ""}`),
  addProfile: (input: ProfileInput) => request<Profile>("/profiles", { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (id: string, input: Partial<ProfileInput> & { ancienPin?: string }) => request<Profile>(`/profiles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  /**
   * Ouvre une session de profil. Le code est facultatif : un profil qui n'en a pas en obtient une
   * quand même, ce dont l'accès distant a besoin — là-bas, chaque lecture réclame une session.
   */
  unlockProfile: async (id: string, pin?: string) => {
    const result = await request<{ unlocked: boolean; token: string; expiresAt: string }>(`/profiles/${encodeURIComponent(id)}/unlock`, { method: "POST", body: JSON.stringify(pin ? { pin } : {}) });
    try { sessionStorage.setItem(profileTokenKey(id), result.token); } catch { /* private browsing can disable storage */ }
    return result;
  },
  hasProfileAccess: (id: string) => Boolean(profileToken(id)),
  clearProfileAccess: clearProfileToken,
  removeProfile: (id: string) => request<void>(`/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  home: (profileId: string) => request<HomeResponse>(`/home?profileId=${encodeURIComponent(profileId)}`),
  // Nom distinct de `catalog`, qui sert déjà le centre de correspondances. Deux clés homonymes dans
  // le même objet ne lèvent aucune erreur : la seconde écrase silencieusement la première, et tout
  // appel part vers la mauvaise route. C'est ce qui vidait les pages Films et Séries.
  catalogPage: (profileId: string, query: Omit<CatalogQuery, "kind"> & { kind: "movies" | "shows" | "web" }) => {
    const search = new URLSearchParams({ profileId, kind: query.kind });
    if (query.sort) search.set("sort", query.sort);
    if (query.filter) search.set("filter", query.filter);
    if (query.query) search.set("q", query.query);
    if (query.minYear != null) search.set("minYear", String(query.minYear));
    if (query.maxYear != null) search.set("maxYear", String(query.maxYear));
    // Le nom d'un genre TMDB ne contient jamais de virgule : elle sert donc de séparateur sans risque.
    if (query.genres?.length) search.set("genres", query.genres.join(","));
    if (query.letter) search.set("letter", query.letter);
    if (query.offset != null) search.set("offset", String(query.offset));
    if (query.limit != null) search.set("limit", String(query.limit));
    return request<AnchoredCatalogPage>(`/catalog/browse?${search.toString()}`);
  },
  /**
   * Signale qu'un codec annoncé ne s'est pas lu sur cet appareil.
   *
   * Le serveur ne peut pas le constater seul : en lecture directe, il sert le fichier et l'échec se
   * produit dans le décodeur du navigateur. Sans ce retour, il repropose le même codec à chaque fois.
   *
   * L'échec du signalement est sans conséquence : c'est une information de confort, jamais une
   * condition pour lire. On ne va pas empêcher une lecture parce qu'un diagnostic n'est pas parti.
   */
  reportCodecFailure: (deviceId: string, codec: string, reason?: string) =>
    request<{ codec: string; failures: number; quarantined: boolean }>("/playback/codec-failure", {
      method: "POST", body: JSON.stringify({ deviceId, codec, reason }),
    }).catch(() => undefined),

  /** Une lecture directe réussie vaut démenti : le codec fonctionne, quoi qu'on ait cru. */
  reportCodecSuccess: (deviceId: string, codec: string) =>
    request<void>("/playback/codec-success", {
      method: "POST", body: JSON.stringify({ deviceId, codec }),
    }).catch(() => undefined),

  media: (id: string, profileId: string) => request<MediaItem>(`/media/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`),
  playbackNeighbors: (id: string, profileId: string) => request<PlaybackNeighbors>(
    `/media/${encodeURIComponent(id)}/neighbors?profileId=${encodeURIComponent(profileId)}`,
  ),
  details: (id: string, profileId: string) => request<MediaDetails>(`/catalog/${encodeURIComponent(id)}/details?profileId=${encodeURIComponent(profileId)}`),
  person: (id: string, profileId: string) => request<PersonDetails>(`/people/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`),
  search: (query: string, profileId: string) => request<Array<MediaItem & { seasonCount?: number }>>(`/search?q=${encodeURIComponent(query)}&profileId=${encodeURIComponent(profileId)}`),
  streamUrl: (id: string, profileId: string) => `${apiRoot}/media/${encodeURIComponent(id)}/stream?profileId=${encodeURIComponent(profileId)}`,
  playbackInfo: (id: string, profileId: string) => request<PlaybackInfo>(`/media/${encodeURIComponent(id)}/playback-info?profileId=${encodeURIComponent(profileId)}`),
  timelineSheetUrl: (id: string, planche: number, profileId: string) => `${apiRoot}/media/${encodeURIComponent(id)}/timeline-sheet?sheet=${Math.max(0, Math.floor(planche))}&profileId=${encodeURIComponent(profileId)}`,
  startPlayback: (id: string, capabilities: PlaybackCapabilities, profileId: string) => request<PlaybackSession>(
    `/media/${encodeURIComponent(id)}/playback?profileId=${encodeURIComponent(profileId)}`, { method: "POST", body: JSON.stringify(capabilities) },
  ),
  playbackSession: (id: string) => request<PlaybackSession>(`/playback/${encodeURIComponent(id)}`),
  stopPlayback: (id: string) => request<void>(`/playback/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /**
   * Arrêt annoncé au moment où la page disparaît.
   *
   * Le nettoyage de React ne s'exécute pas quand un onglet se ferme : la session restait alors
   * vivante côté NAS, FFmpeg convertissant un film que plus personne ne regardait. `keepalive` confie
   * la requête au navigateur, qui la mène à bien après la page. `sendBeacon` ne conviendrait pas — il
   * ne sait envoyer qu'un POST. Le serveur reprend de toute façon ses sessions inactives ; ceci ne
   * fait que lui éviter d'attendre.
   */
  stopPlaybackOnUnload: (id: string) => {
    try { void fetch(`${apiRoot}/playback/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }); }
    catch { /* la reprise des sessions inactives couvre déjà ce cas */ }
  },
  playbackUrl: serverUrl,
  subtitleUrl: (id: string, index: number, profileId: string, offsetSeconds = 0) => `${apiRoot}/media/${encodeURIComponent(id)}/subtitles/${index}.vtt?offset=${encodeURIComponent(offsetSeconds)}&profileId=${encodeURIComponent(profileId)}`,
  externalSubtitleUrl: (id: string, index: number, profileId: string, offsetSeconds = 0, encoding = "auto") => `${apiRoot}/media/${encodeURIComponent(id)}/subtitles/external/${index}.vtt?offset=${encodeURIComponent(offsetSeconds)}&encoding=${encodeURIComponent(encoding)}&profileId=${encodeURIComponent(profileId)}`,
  subtitlePreference: (id: string, profileId: string) => request<SubtitlePreference | null>(
    `/media/${encodeURIComponent(id)}/subtitle-preference?profileId=${encodeURIComponent(profileId)}`,
  ),
  saveSubtitlePreference: (id: string, profileId: string, preference: SubtitlePreference) => request<void>(
    `/media/${encodeURIComponent(id)}/subtitle-preference?profileId=${encodeURIComponent(profileId)}`,
    { method: "PUT", body: JSON.stringify(preference) },
  ),
  saveProgress: (id: string, profileId: string, positionSeconds: number, durationSeconds: number, completed?: boolean) =>
    request<void>(`/media/${encodeURIComponent(id)}/progress?profileId=${encodeURIComponent(profileId)}`, {
      method: "PUT",
      body: JSON.stringify({ positionSeconds, durationSeconds, completed }),
    }),
  clearProgress: (id: string, profileId: string) => request<void>(
    `/media/${encodeURIComponent(id)}/progress?profileId=${encodeURIComponent(profileId)}`, { method: "DELETE" },
  ),
  setCatalogWatched: (id: string, profileId: string, completed: boolean) => request<{ completed: boolean; count: number }>(
    `/catalog/${encodeURIComponent(id)}/watched?profileId=${encodeURIComponent(profileId)}`,
    { method: "PUT", body: JSON.stringify({ completed }) },
  ),
  setupStatus: () => request<SetupStatus>("/setup"),
  completeSetup: (input: SetupInput) => request<SetupStatus>("/setup", { method: "POST", body: JSON.stringify(input) }),
  browseDirectories: (path?: string, fichiers?: string[]) => {
    const parametres = new URLSearchParams();
    if (path) parametres.set("path", path);
    // Les extensions ne sont demandées que lorsqu'on choisit un fichier : sans elles, le serveur ne
    // liste que des dossiers, ce qui reste le cas des bibliothèques.
    if (fichiers?.length) parametres.set("fichiers", fichiers.join(","));
    const requete = parametres.toString();
    return request<DirectoryBrowserListing>(`/filesystem/directories${requete ? `?${requete}` : ""}`);
  },
  libraries: () => request<LibraryFolder[]>("/libraries"),
  scans: (limit = 100) => request<ScanJob[]>(`/scans?limit=${limit}`),
  /** Où en est le repérage des génériques de séries. Voir `marqueurs-passe` côté serveur. */
  activerGeneriques: (actif: boolean) => request<EtatGeneriques>("/system/generiques", { method: "POST", body: JSON.stringify({ actif }) }),
  arreterGeneriques: () => request<EtatGeneriques>("/system/generiques/arret", { method: "POST" }),
  /** Reprendre le repérage sur les saisons restantes, sans relancer la moindre analyse. */
  reprendreGeneriques: () => request<EtatGeneriques>("/system/generiques/passe", { method: "POST" }),
  generiques: () => request<EtatGeneriques>("/system/generiques"),

  /*
   * La télévision en direct.
   *
   * Les quatre premières sont des réglages du serveur : elles ne sont pas offertes à l'accès distant,
   * et la liste blanche de `wan-exposition.ts` les refuse d'office. La grille, elle, rejoindra les
   * lectures autorisées quand son écran existera.
   */
  live: () => request<{ parametres: ParametresDirect; etat: EtatDirect }>("/system/live"),
  enregistrerLive: (parametres: Partial<ParametresDirect>) => request<{ parametres: ParametresDirect; etat: EtatDirect }>(
    "/system/live", { method: "PUT", body: JSON.stringify(parametres) },
  ),
  rafraichirLive: () => request<EtatDirect>("/system/live/rafraichir", { method: "POST" }),
  arreterLive: () => request<EtatDirect>("/system/live/arret", { method: "POST" }),
  listesLive: () => request<ListeDirect[]>("/system/live/listes"),
  sourcesLive: () => request<SourceDirect[]>("/system/live/sources"),
  ajouterXtream: (hote: string, utilisateur: string, motDePasse: string, libelle?: string) =>
    request<{ source: SourceDirect }>("/system/live/sources",
      { method: "POST", body: JSON.stringify({ type: "xtream", hote, utilisateur, motDePasse, libelle }) }),
  activerFast: () => request<{ source: SourceDirect | null }>("/system/live/sources",
    { method: "POST", body: JSON.stringify({ type: "fast" }) }),
  retirerSourceLive: (id: string) => request<void>(`/system/live/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
  favoriLive: (id: string, favori: boolean) => request<void>(
    `/live/channels/${encodeURIComponent(id)}/favori`, { method: favori ? "PUT" : "DELETE" },
  ),
  derniereChaineLive: () => request<{ chaine: ChaineDirect | null }>("/live/derniere"),
  chainesLive: (requete: { q?: string; listes?: string[]; pays?: string[]; fiabilites?: string[];
    favoris?: boolean; masquerMortes?: boolean; offset?: number; limit?: number } = {}) => {
    const parametres = new URLSearchParams();
    if (requete.q) parametres.set("q", requete.q);
    if (requete.listes?.length) parametres.set("listes", requete.listes.join(","));
    if (requete.pays?.length) parametres.set("pays", requete.pays.join(","));
    if (requete.fiabilites?.length) parametres.set("fiabilites", requete.fiabilites.join(","));
    if (requete.favoris) parametres.set("favoris", "1");
    if (requete.masquerMortes) parametres.set("masquerMortes", "1");
    if (requete.offset) parametres.set("offset", String(requete.offset));
    if (requete.limit) parametres.set("limit", String(requete.limit));
    return request<PageChaines>(`/live/channels?${parametres.toString()}`);
  },
  /*
   * Ce qu'un client demande avant d'afficher quoi que ce soit : l'entrée « Direct » doit-elle
   * exister ? Elle n'existe que si la fonction est activée et qu'une source a rendu des chaînes.
   */
  etatLive: () => request<{ disponible: boolean; chaines: number; rafraichieLe: string | null }>("/live"),
  /** Le rayon Web existe-t-il ? Même règle que le direct : pas d'entrée vers une page vide. */
  etatWeb: () => request<{ disponible: boolean; bibliotheques: number; chaines: number }>("/web"),
  /**
   * Les correspondances des bibliothèques web.
   *
   * Chemin distinct de celui du catalogue, et c'est le sujet : le centre de correspondances des films
   * est plafonné à 250 lignes, qu'une bibliothèque web remplirait à elle seule.
   */
  correspondancesWeb: (profileId: string, options: { libraryId?: string; toutes?: boolean } = {}) => {
    const search = new URLSearchParams({ profileId });
    if (options.libraryId) search.set("libraryId", options.libraryId);
    if (options.toutes) search.set("toutes", "1");
    return request<{ budget: BudgetWeb; lignes: CorrespondanceWeb[] }>(
      `/web/correspondances?${search.toString()}`);
  },
  candidatsWeb: (profileId: string, id: string, q?: string) => {
    const search = new URLSearchParams({ profileId });
    if (q) search.set("q", q);
    return request<{ candidats: CandidatWeb[]; motif: string | null }>(
      `/web/correspondances/${encodeURIComponent(id)}/candidats?${search.toString()}`);
  },
  corrigerWeb: (profileId: string, id: string, identifiant: string) =>
    request<{ applique: boolean; message: string }>(
      `/web/correspondances/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`,
      { method: "POST", body: JSON.stringify({ identifiant }) }),
  listesLiveClient: (criteres: CriteresFacette = {}) =>
    request<Array<{ id: string; nom: string; classement: ClassementListe; chaines: number }>>(`/live/listes${queteFacette(criteres)}`),
  fiabilitesLive: () => request<Array<{ classement: ClassementListe; listes: number }>>("/live/fiabilites"),
  /*
   * Les facettes prennent les critères déjà cochés : elles comptent ce qu'on obtiendrait en cochant
   * celle-ci **en plus**. Chacune ignore le sien, sinon cocher France ne laisserait voir que la France.
   */
  paysLive: (criteres: CriteresFacette = {}) =>
    request<Array<{ code: string; nom: string; chaines: number }>>(`/live/pays${queteFacette(criteres)}`),
  /*
   * Les adresses d'une chaîne, dans l'ordre où il faut les essayer : celles qui ont déjà marché
   * d'abord, celles qui ont échoué en dernier. C'est ce qui rend le repli utile plutôt qu'aléatoire.
   */
  chaineLive: (id: string) => request<ChaineDirectDetaillee>(
    `/live/channels/${encodeURIComponent(id)}`,
  ),
  resultatChaineLive: (id: string, url: string, ok: boolean) => request<void>(
    `/live/channels/${encodeURIComponent(id)}/resultat`, { method: "POST", body: JSON.stringify({ url, ok }) },
  ),
  startScan: (input: ScanRequest) => request<{ jobs: ScanJob[] }>("/scans", { method: "POST", body: JSON.stringify(input) }),
  cancelScan: (id: string) => request<ScanJob>(`/scans/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  retryScan: (id: string) => request<ScanJob>(`/scans/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  addLibrary: (input: LibraryInput) => request<LibraryFolder>("/libraries", { method: "POST", body: JSON.stringify(input) }),
  removeLibrary: (id: string) => request<void>(`/libraries/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateLibraryLocalization: (id: string, input: LibraryLocalizationInput) => request<{ library: LibraryFolder; queued: boolean; job: ScanJob }>(
    `/libraries/${encodeURIComponent(id)}/localization`, { method: "PATCH", body: JSON.stringify(input) },
  ),
  scanLibrary: (id: string) => request<{ queued: boolean }>(`/libraries/${encodeURIComponent(id)}/scan`, { method: "POST" }),
  refreshLibraryMetadata: (id: string) => request<{ queued: boolean }>(`/libraries/${encodeURIComponent(id)}/refresh-metadata`, { method: "POST" }),
  /**
   * `focusId` garantit la présence d'une fiche précise dans la réponse.
   *
   * La liste est plafonnée à 250 titres : sans cette garantie, arriver depuis une fiche située plus
   * loin dans l'alphabet ouvrait l'écran de correction sur un tout autre titre, sans rien signaler.
   */
  catalog: (libraryId: string, query = "", focusId?: string | null) => request<CatalogItem[]>(
    `/catalog?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(query)}`
    + (focusId ? `&focusId=${encodeURIComponent(focusId)}` : ""),
  ),
  reviewQueue: (libraryId?: string) => request<CatalogItem[]>(`/metadata/review${libraryId ? `?libraryId=${encodeURIComponent(libraryId)}` : ""}`),
  searchMetadata: (kind: "movie" | "tv", query: string, language: "fr-FR" | "en-US", year?: number | null,
    minYear?: number | null) => {
    const params = new URLSearchParams({ kind, query, language });
    if (year) params.set("year", String(year));
    // Seuil et année exacte sont deux choses distinctes : le premier est saisi lors d'une correction,
    // la seconde sert à l'analyse automatique.
    if (minYear) params.set("minYear", String(minYear));
    return request<MetadataSearchCandidate[]>(`/metadata/search?${params}`);
  },
  metadataProviders: () => request<MetadataProviderStatus[]>("/metadata/providers"),
  configureMetadataProviders: (input: MetadataProviderConfigurationInput) => request<{ providers: MetadataProviderStatus[]; jobs: ScanJob[] }>(
    "/metadata/providers", { method: "PATCH", body: JSON.stringify(input) },
  ),
  /**
   * Épingle une correspondance et rend la fiche **déjà rafraîchie**.
   *
   * Le serveur ne se contente plus d'accuser réception : il va chercher la fiche choisie avant de
   * répondre. C'est ce qui permet de montrer le bon titre et la bonne jaquette dans la seconde, au
   * lieu d'annoncer une actualisation dont on ne voyait jamais l'effet.
   *
   * `refreshError` est renseigné quand la correspondance est bien enregistrée mais que le fournisseur
   * n'a rien rendu — un réseau coupé, une clé d'API expirée. Le dire vaut mieux que laisser croire à
   * une réussite.
   */
  matchCatalog: (id: string, externalId: string, provider: MetadataSearchCandidate["provider"] = "tmdb",
    title?: string, year?: number | null) =>
    request<{
      catalogId: string; matchStatus: "manual"; refreshError: string | null;
      item: { title: string; year: number | null; overview: string | null; poster_url: string | null } | null;
    }>(
      `/catalog/${encodeURIComponent(id)}/match`,
      { method: "POST", body: JSON.stringify({ provider, externalId, title, year }) },
    ),
  unlockCatalogMatch: (id: string) => request<void>(`/catalog/${encodeURIComponent(id)}/match`, { method: "DELETE" }),
  updateCatalogMetadata: (id: string, input: ManualMetadataInput) => request(`/catalog/${encodeURIComponent(id)}/metadata`, {
    method: "PATCH", body: JSON.stringify(input),
  }),
  setWatchlist: (id: string, profileId: string, enabled: boolean) => request<void>(
    `/catalog/${encodeURIComponent(id)}/watchlist?profileId=${encodeURIComponent(profileId)}`, { method: enabled ? "PUT" : "DELETE" }),
  recommendationFeedback: (catalogId: string, profileId: string, value: "like" | "dislike" | "dismissed") => request<void>(
    `/recommendations/feedback?profileId=${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify({ catalogId, value }) }),
  systemStatus: () => request<{ version: string; packageRevision?: string | null; step?: number; phase?: number; uptimeSeconds: number; memory: { rss: number };
    schema?: { version: number; enAttente: number[] };
    database: { integrity: string }; playback: { ffmpegAvailable: boolean; encoders?: string[]; decoders?: string[]; hardwareAccelerators?: string[]; compatibility?: PlaybackCompatibilityMatrix; selectedVideoEncoder: string | null; activeTranscodes: number; maximumTranscodes: number; recentFailures: Array<{ at: string; message: string }> };
    scans: { active: number; queued: number; concurrency: number; effective?: number; pausedByPlayback?: boolean } }>("/system/status"),
  systemCapacity: () => request<ServerCapacityReport>("/system/capacity"),
  recalibrate: () => request<{ relance: boolean }>("/system/capacity/recalibrate", { method: "POST" }),
  wanParametres: () => request<{ parametres: ParametresWan; minimumPin: number }>("/system/wan"),
  enregistrerWan: (body: Partial<ParametresWan>) =>
    request<{ parametres: ParametresWan; redemarrageRequis: boolean }>("/system/wan", { method: "PUT", body: JSON.stringify(body) }),
  verifierWan: () => request<DiagnosticWan>("/system/wan/verifier", { method: "POST" }),
  remoteAccounts: () => request<CompteDistant[]>("/system/remote-accounts"),
  createRemoteAccount: (username: string, password: string) => request<CompteDistant>("/system/remote-accounts", {
    method: "POST", body: JSON.stringify({ username, password }),
  }),
  removeRemoteAccount: (id: string) => request<void>(`/system/remote-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  conversionPreferences: () => request<ConversionPreferences>("/system/conversion-preferences"),
  saveConversionPreferences: (body: Partial<ConversionPreferences>) =>
    request<ConversionPreferences>("/system/conversion-preferences", { method: "PUT", body: JSON.stringify(body) }),
  createBackup: () => request<{ name: string; createdAt: string }>("/system/backups", { method: "POST" }),
};
