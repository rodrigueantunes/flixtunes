import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogPerson, ChaineDirect, HomeResponse, LibraryFolder, MediaDetails, MediaItem, PersonDetails, Profile, ProfileGroup } from "@flixtunes/contracts";
import { api } from "./api";
import { ecrireCache, lireCache, oublierCache } from "./server-cache";
import { oublierSouvenirDirect } from "./memoire-direct";
import { oublierSouvenirWeb } from "./memoire-web";
import { lireSouvenirCatalogue, oublierSouvenirsCatalogue, retenirSouvenirCatalogue } from "./memoire-catalogue";
import { reposerDefilement } from "./defilement";
import { scrollBehavior } from "./motion";
import { useRemoteNavigation } from "./remote-navigation";
import { useDialogFocus } from "./useDialogFocus";
/**
 * Le lecteur n'est chargé qu'au moment où l'on veut regarder.
 *
 * Il était importé d'emblée, et c'est le plus gros module de l'application : la page d'accueil payait
 * donc le lecteur entier — sa barre de commandes, sa sonde de décodage, sa mesure de débit, ses
 * planches de vignettes — pour afficher une grille de jaquettes. Le budget de poids l'a fini par
 * dire : cent onze kilooctets de JavaScript au premier affichage pour un plafond de cent.
 *
 * L'intention était déjà inscrite dans les contrôles, qui vérifient que `hls.js` reste dans un
 * fichier séparé « sinon l'accueil paierait le coût du lecteur sans l'utiliser ». La bibliothèque
 * l'était ; le composant qui l'entoure ne l'était pas.
 *
 * On ne peut pas lire avant d'avoir parcouru : le chargement se fait pendant que la personne choisit,
 * et l'attente n'existe pas en pratique.
 */
const Player = lazy(() => import("./Player").then((module) => ({ default: module.Player })));
/*
 * La télévision en direct suit la même règle que le lecteur, et pour la même raison : une
 * installation qui ne s'en sert pas — c'est le cas par défaut, la fonction étant éteinte — ne doit
 * pas payer son poids au premier affichage. Le lecteur du direct emporte en plus `hls.js`.
 */
const LiveTv = lazy(() => import("./LiveTv").then((module) => ({ default: module.LiveTv })));
// Meme raison que pour le direct : un rayon que tout le monde n'a pas ne doit pas peser sur le
// premier affichage de ceux qui ne l'ont pas.
const RayonWeb = lazy(() => import("./RayonWeb").then((module) => ({ default: module.RayonWeb })));
const LecteurDirect = lazy(() => import("./LecteurDirect").then((module) => ({ default: module.LecteurDirect })));
import { LibraryManager } from "./LibraryManager";
import { MetadataManager } from "./MetadataManager";
import { SetupWizard } from "./SetupWizard";

type CardItem = MediaItem & { seasonCount?: number };
type AppView = "home" | "movies" | "shows" | "web" | "live" | "history";
type CatalogSort = "title" | "release" | "added";
const profileColors = ["#2968ff", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4"];
const isTestDom = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");

/**
 * Identifiant du média en cours de lecture, lu dans l'adresse.
 *
 * Le lecteur ne dépendant plus du catalogue, il suffit d'un identifiant pour le rouvrir : une
 * lecture survit désormais à un rechargement de page, là où elle renvoyait à l'accueil.
 */
function playingFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const trouve = /^#lecture\/(.+)$/.exec(window.location.hash);
  return trouve ? decodeURIComponent(trouve[1]!) : null;
}

/**
 * L'ancre de chaque section, déclarée une fois.
 *
 * Elle était écrite trois fois en ternaires parallèles — dans la lecture de l'adresse, dans la
 * navigation et à la fermeture du lecteur. Ajouter une section obligeait à modifier les trois, et
 * l'oubli de l'une ne se serait vu que par un retour au mauvais endroit.
 */
const ANCRES: Record<AppView, string> = {
  home: "top", movies: "films", shows: "series", web: "web", live: "direct", history: "historique",
};

/**
 * La vue que désigne l'ancre, ou `null` si l'ancre n'en désigne aucune.
 *
 * L'ouverture du lecteur écrit `#lecture/<id>`, qui n'est la vue de personne. Cette fonction rendait
 * alors « accueil », et l'écouteur de changement d'ancre écrasait la vue courante : à la fermeture du
 * lecteur, on retombait sur l'accueil au lieu de l'écran d'où l'on venait. Le défaut valait pour
 * Films et Séries TV autant que pour le rayon Web.
 *
 * Rendre `null` laisse l'appelant décider — et ne rien décider est ici la bonne réponse.
 */
function vueDeLAncre(): AppView | null {
  if (typeof window === "undefined") return null;
  const ancre = window.location.hash.replace(/^#/, "");
  return (Object.keys(ANCRES) as AppView[]).find((vue) => ANCRES[vue] === ancre) ?? null;
}

function viewFromHash(): AppView {
  return vueDeLAncre() ?? "home";
}

export function Icon({ name }: {
  name: "home" | "movie" | "tv" | "search" | "settings" | "play" | "info" | "history" | "web" | "folder";
}) {
  const paths = {
    home: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z", movie: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4m8 0h4M4 15h4m8 0h4",
    tv: "M4 7h16v11H4zM9 22h6M12 18v4M9 3l3 4 3-4", search: "m20 20-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0", play: "M8 5v14l11-7z",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 10v7m0-10v.01", history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2",
    // Un globe pour le rayon Web, un dossier pour ses paliers : deux formes distinctes de l'écran
    // du direct, qui porte déjà le poste de télévision.
    web: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
    folder: "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function MediaCard({ item, onOpen, onContext }: {
  item: CardItem; onOpen: (item: CardItem) => void; onContext?: (item: CardItem, x: number, y: number) => void;
}) {
  const [posterState, setPosterState] = useState<"loading" | "ready" | "failed">(item.posterUrl ? "loading" : "failed");
  // Une video de plateforme n'a ni saison ni numero : elle se presente par sa date de publication,
  // qui est aussi ce sur quoi son rayon la trie.
  const meta = item.kind === "video"
    ? (item.airDate ? new Date(`${item.airDate}T00:00:00Z`).toLocaleDateString("fr-FR",
      { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "Vidéo")
    : item.kind === "episode" ? `S${item.seasonNumber} · E${item.episodeNumber}`
    : item.seasonCount != null ? `${item.seasonCount} saison${item.seasonCount > 1 ? "s" : ""}`
      : item.year ?? "Film";
  return <button className="media-card" data-media-id={item.catalogId} onClick={() => onOpen(item)}
    onContextMenu={(event) => { if (!onContext) return; event.preventDefault(); onContext(item, event.clientX, event.clientY); }}
    aria-label={`Voir ${item.title}`}>
    <div className={`poster${posterState === "loading" ? " poster-loading" : ""}`}>
      {item.posterUrl && posterState !== "failed"
        // L'affiche est chargée paresseusement : un long catalogue ne déclenche plus des centaines de requêtes au NAS.
        ? <img className={`poster-image${posterState === "ready" ? " ready" : ""}`} src={item.posterUrl} alt=""
          loading="lazy" decoding="async" onLoad={() => setPosterState("ready")} onError={() => setPosterState("failed")} />
        : <span className="poster-letter">{item.title.slice(0, 1)}</span>}
      <span className="card-play"><Icon name="play" /></span>
      {item.completed && <span className="watched">✓ Vu</span>}
      {item.progressPercent > 0 && !item.completed && <span className="progress"><i style={{ width: `${item.progressPercent}%` }} /></span>}
    </div><span className="card-title" title={item.title}>{item.title}</span><span className="card-meta">{meta}</span>
  </button>;
}

function Rail({ title, items, onOpen, onContext }: {
  title: string; items: CardItem[]; onOpen: (item: CardItem) => void;
  onContext?: (item: CardItem, x: number, y: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setScrollable({ start: track.scrollLeft > 8, end: track.scrollLeft + track.clientWidth < track.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { track.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [items.length, measure]);
  const slide = (direction: 1 | -1) => trackRef.current?.scrollBy({ left: direction * trackRef.current.clientWidth * 0.82, behavior: scrollBehavior() });
  if (!items.length) return null;
  return <section className="rail-section"><div className="rail-heading"><h2>{title}</h2><span>{items.length}</span></div>
    <div className="rail-viewport">
      <button className="rail-arrow start" hidden={!scrollable.start} tabIndex={scrollable.start ? 0 : -1}
        aria-label={`Faire défiler « ${title} » vers la gauche`} onClick={() => slide(-1)}>‹</button>
      <div className="rail" ref={trackRef}>{items.map((item) => <MediaCard key={item.id} item={item} onOpen={onOpen} onContext={onContext} />)}</div>
      <button className="rail-arrow end" hidden={!scrollable.end} tabIndex={scrollable.end ? 0 : -1}
        aria-label={`Faire défiler « ${title} » vers la droite`} onClick={() => slide(1)}>›</button>
    </div></section>;
}

/** Occupe l'espace exact des rails pendant le chargement pour éviter tout saut de mise en page. */
function HomeSkeleton() {
  return <div className="content" aria-hidden="true">{[0, 1, 2].map((rail) => <section className="rail-section" key={rail}>
    <div className="rail-heading"><span className="skeleton skeleton-heading" /></div>
    <div className="rail-viewport"><div className="rail">{[0, 1, 2, 3, 4, 5, 6].map((card) => <div className="media-card" key={card}>
      <div className="poster skeleton" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" />
    </div>)}</div></div>
  </section>)}</div>;
}

function RecommendationRail({ recommendations, profile, onOpen, onChanged, onContext }: { recommendations: NonNullable<HomeResponse["recommendations"]>;
  profile: Profile; onOpen: (item: CardItem) => void; onChanged: () => void;
  onContext?: (item: CardItem, x: number, y: number) => void }) {
  if (!recommendations.length) return null;
  const feedback = async (catalogId: string, value: "like" | "dislike") => { await api.recommendationFeedback(catalogId, profile.id, value); onChanged(); };
  return <section className="rail-section recommendations"><div className="rail-heading"><h2>Sélection pour {profile.name}</h2><span>100 % local</span></div><div className="rail">
    {recommendations.map(({ item, reason, score }) => <div className="recommendation-card" key={item.id}><MediaCard item={item} onOpen={onOpen} onContext={onContext} />
      <small>{reason} · {Math.round(score * 100)} %</small><div><button aria-label={`J'aime ${item.title}`} onClick={() => void feedback(item.catalogId ?? item.id, "like")}>♡</button><button aria-label={`Je n'aime pas ${item.title}`} onClick={() => void feedback(item.catalogId ?? item.id, "dislike")}>×</button></div></div>)}</div></section>;
}

const CATALOG_PAGE_SIZE = 60;
const CATALOG_ALPHABET = ["#", ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))];
/**
 * Décennies proposées, de la plus récente à 1920.
 *
 * Dérivées de l'année courante plutôt qu'écrites en dur : une liste figée cesserait silencieusement
 * de proposer la décennie en cours au premier changement de décennie.
 */
const DECADES = (() => {
  const courante = Math.floor(new Date().getFullYear() / 10) * 10;
  const decennies: number[] = [];
  for (let debut = courante; debut >= 1920; debut -= 10) decennies.push(debut);
  return decennies;
})();

/**
 * Catalogue paginé.
 *
 * Le tri, le filtre et la recherche s'appliquent désormais côté serveur, sur la totalité des fiches :
 * les appliquer sur les seules cartes déjà chargées donnerait un classement et un décompte faux dès la
 * deuxième page. Le composant ne conserve donc que ce qu'il a reçu, et redemande la suite au défilement.
 */
function CatalogPage({ kind, profileId, total, onOpen, onContext }: {
  kind: "movies" | "shows"; profileId: string; total: number; onOpen: (item: CardItem) => void;
  onContext?: (item: CardItem, x: number, y: number) => void;
}) {
  /*
   * Tout repart de ce que la session a retenu.
   *
   * Ouvrir un film démonte cet écran : sans cela, le retour repartait du haut d'une liste sans filtre,
   * après qu'on avait mis vingt secondes à arriver là où on en était. C'est le même défaut que le
   * direct avait, et il se répare de la même façon.
   */
  const souvenir = lireSouvenirCatalogue(kind);
  const [sort, setSort] = useState<CatalogSort>(souvenir.sort);
  const [filter, setFilter] = useState<"all" | "progress" | "watched" | "unwatched">(souvenir.filter);
  const [catalogQuery, setCatalogQuery] = useState(souvenir.query);
  const [debouncedQuery, setDebouncedQuery] = useState(souvenir.query);
  /** Décennie retenue, ou « toutes ». Une décennie parle mieux qu'un couple d'années à saisir. */
  const [decade, setDecade] = useState<"all" | number>(souvenir.decade);
  const [genres, setGenres] = useState<string[]>(souvenir.genres);
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  /** Point de départ absolu de la fenêtre reçue, non nul après un saut par l'index A–Z. */
  const [initialOffset, setInitialOffset] = useState(souvenir.initialOffset);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(souvenir.selectedLetter);
  // Pas d'amorçage avec la page reçue par l'accueil : elle est classée par date d'ajout alors que le
  // catalogue s'ouvre en ordre alphabétique, et la grille se réordonnerait sous les yeux de la personne.
  const [items, setItems] = useState<CardItem[]>([]);
  const [matching, setMatching] = useState(total);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);
  const alphabetScrollPending = useRef(false);
  const alphabetTargetIndex = useRef<number | null>(null);

  // La recherche part au serveur, pas à chaque frappe : sans ce délai, saisir « aventure » lancerait
  // huit requêtes dont sept seraient jetées.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(catalogQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [catalogQuery]);

  const criteria = useMemo(() => ({
    kind, sort, filter, query: debouncedQuery,
    minYear: decade === "all" ? undefined : decade,
    maxYear: decade === "all" ? undefined : decade + 9,
    genres,
    letter: selectedLetter?.toLocaleLowerCase("fr"),
  }), [debouncedQuery, decade, filter, genres, kind, selectedLetter, sort]);
  // La clé décrit exactement ce qui est demandé, profil compris : deux profils n'ont pas les mêmes
  // progressions, et partager leur cache mélangerait « En cours » et « Non vus ».
  const cacheKey = `catalogue:${profileId}:${kind}:${sort}:${filter}:${debouncedQuery}:${decade}:${genres.join("+")}:${selectedLetter ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    // Ce qu'on sait déjà s'affiche sans délai : revenir sur Films après un détour par l'accueil ne
    // doit pas vider l'écran ni faire repartir le défilement du haut.
    const connu = lireCache<{ items: CardItem[]; total: number; offset?: number }>(cacheKey);
    if (connu) { setItems(connu.items); setMatching(connu.total); setInitialOffset(connu.offset ?? 0); setLoading(false); }
    else { setItems([]); setInitialOffset(0); setLoading(true); }
    setError(null);

    api.catalogPage(profileId, { ...criteria, offset: 0, limit: CATALOG_PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        setMatching(page.total);
        setInitialOffset(page.offset);
        alphabetTargetIndex.current = page.anchor == null ? null : page.anchor - page.offset;
        // L'inventaire couvre le catalogue entier, pas la page : il ne doit donc pas se réduire quand
        // un filtre restreint le résultat, sinon on ne pourrait plus revenir en arrière.
        if (page.availableGenres?.length) setAvailableGenres(page.availableGenres);
        setItems((affiches) => {
          // Les pages accumulées par le défilement ne sont conservées que si la première page n'a pas
          // bougé. Si elle a changé, l'ordre a changé aussi : garder la suite afficherait des trous
          // ou des doublons. On repart alors de la seule page dont on soit sûr.
          const tete = affiches.slice(0, page.items.length);
          const identique = connu != null && connu.total === page.total
            && tete.length === page.items.length
            && tete.every((item, index) => item.id === page.items[index]!.id);
          const suivants = identique ? [...page.items, ...affiches.slice(page.items.length)] : page.items;
          ecrireCache(cacheKey, { items: suivants, total: page.total, offset: page.offset });
          return suivants;
        });
      })
      .catch((cause: Error) => {
        // Une valeur déjà affichée n'est pas retirée : périmée vaut mieux que vide, et l'échec est
        // signalé à côté.
        if (!cancelled) setError(cause.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cacheKey, criteria, profileId]);

  const loadMore = useCallback(async () => {
    if (loading || initialOffset + items.length >= matching) return;
    setLoading(true);
    try {
      const page = await api.catalogPage(profileId, {
        ...criteria,
        // La lettre calcule seulement l'ancre de la première page. La renvoyer avec un décalage
        // absolu brouillerait les deux notions et ferait à nouveau ressembler l'index à un filtre.
        letter: undefined,
        offset: initialOffset + items.length,
        limit: CATALOG_PAGE_SIZE,
      });
      // Une analyse en cours peut décaler les rangs entre deux pages : on écarte les doublons plutôt
      // que d'afficher deux fois la même affiche.
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        const suivants = [...previous, ...page.items.filter((item) => !seen.has(item.id))];
        // Sans cette écriture, les pages parcourues seraient reperdues au premier changement de vue :
        // le cache ne connaîtrait que la première.
        ecrireCache(cacheKey, { items: suivants, total: page.total, offset: initialOffset });
        return suivants;
      });
      setMatching(page.total);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, criteria, initialOffset, items.length, loading, matching, profileId]);

  const loadPrevious = useCallback(async () => {
    if (loading || initialOffset <= 0) return;
    setLoading(true);
    const limit = Math.min(CATALOG_PAGE_SIZE, initialOffset);
    const offset = initialOffset - limit;
    try {
      const page = await api.catalogPage(profileId, { ...criteria, letter: undefined, offset, limit });
      setItems((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        const preceding = page.items.filter((item) => !seen.has(item.id));
        const next = [...preceding, ...previous];
        ecrireCache(cacheKey, { items: next, total: page.total, offset: page.offset });
        return next;
      });
      setInitialOffset(page.offset);
      setMatching(page.total);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, criteria, initialOffset, loading, profileId]);

  useEffect(() => {
    const target = sentinel.current;
    // Le bouton « Afficher … de plus » reste la commande de référence : là où l'observateur manque, le
    // chargement à l'approche du bas disparaît, pas la possibilité de voir la suite du catalogue.
    if (!target || initialOffset + items.length >= matching || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [initialOffset, items.length, loadMore, matching]);

  useEffect(() => {
    if (!alphabetScrollPending.current || loading || !items.length) return;
    alphabetScrollPending.current = false;
    const index = alphabetTargetIndex.current;
    const target = index == null ? grid.current : grid.current?.children.item(index) as HTMLElement | null;
    target?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
  }, [items, loading]);

  const jumpToLetter = (letter: string) => {
    alphabetScrollPending.current = true;
    if (sort !== "title") setSort("title");
    if (selectedLetter !== letter) setSelectedLetter(letter);
    else {
      const index = alphabetTargetIndex.current;
      const target = index == null ? grid.current : grid.current?.children.item(index) as HTMLElement | null;
      target?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
    }
  };

  /*
   * Ce qu'on retient, et quand.
   *
   * À chaque changement plutôt qu'au démontage : un composant démonté par une navigation n'a pas
   * toujours l'occasion de faire ses adieux, et un souvenir qui manque une fois sur dix est pire
   * qu'aucun souvenir.
   */
  useEffect(() => {
    retenirSouvenirCatalogue(kind, {
      sort, filter, query: debouncedQuery, decade, genres, initialOffset, selectedLetter,
    });
  }, [decade, debouncedQuery, filter, genres, initialOffset, kind, selectedLetter, sort]);

  /**
   * Ouvrir une fiche, en notant d'abord où l'on en était.
   *
   * Au clic, et non au démontage : ouvrir un film raccourcit la page d'un coup, le navigateur ramène
   * le défilement au nouveau maximum, et une position lue à ce moment-là ne vaut plus rien — mesuré
   * sur le direct, 282 pixels au lieu de 1 500. Le clic, lui, a lieu avant que rien ne bouge.
   */
  const ouvrir = useCallback((item: CardItem) => {
    retenirSouvenirCatalogue(kind, { defilement: window.scrollY });
    onOpen(item);
  }, [kind, onOpen]);

  const defilementRepose = useRef(false);
  useEffect(() => {
    if (defilementRepose.current || !items.length) return;
    defilementRepose.current = true;
    reposerDefilement(souvenir.defilement);
  }, [items.length, souvenir.defilement]);

  const title = kind === "movies" ? "Films" : "Séries TV";
  const remainingBefore = Math.max(0, initialOffset);
  const remaining = Math.max(0, matching - initialOffset - items.length);
  return <section className="catalog-page" aria-labelledby="catalog-title">
    <header className="catalog-header"><div><span className="eyebrow">Bibliothèque</span><h1 id="catalog-title">{title}</h1><p>{matching} {matching > 1 ? "titres" : "titre"}{remaining > 0 && ` · ${items.length} affichés`}</p></div>
      <div className="catalog-controls"><label><span>Rechercher</span><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={`Rechercher dans les ${title.toLowerCase()}`} /></label><label><span>État</span><select aria-label={`Filtrer les ${title.toLowerCase()}`} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Tous</option><option value="progress">En cours</option><option value="watched">Vus</option><option value="unwatched">Non vus</option></select></label><label className="sort-control"><span>Trier par</span><select value={sort} onChange={(event) => { setSort(event.target.value as CatalogSort); setSelectedLetter(null); }} aria-label={`Trier les ${title.toLowerCase()}`}>
        <option value="title">Ordre alphabétique</option><option value="release">Date de sortie</option><option value="added">Date d’ajout</option>
      </select></label>
      <label><span>Décennie</span><select aria-label={`Filtrer les ${title.toLowerCase()} par décennie`}
        value={String(decade)} onChange={(event) => setDecade(event.target.value === "all" ? "all" : Number(event.target.value))}>
        <option value="all">Toutes</option>
        {DECADES.map((debut) => <option key={debut} value={debut}>{debut}s</option>)}
      </select></label>
      {availableGenres.length > 0 && <fieldset className="genre-filter">
        <legend>Genres</legend>
        {/* Cocher deux genres cherche une comédie d'action, pas la réunion des deux rayons : le
            résultat se rétrécit, ce qui est le sens qu'on donne spontanément à deux cases cochées. */}
        {availableGenres.map((genre) => <label key={genre} className="genre-choice">
          <input type="checkbox" checked={genres.includes(genre)}
            onChange={(event) => setGenres((choisis) => event.target.checked
              ? [...choisis, genre] : choisis.filter((autre) => autre !== genre))} />
          <span>{genre}</span>
        </label>)}
        {genres.length > 0 && <button type="button" className="genre-reset" onClick={() => setGenres([])}>Tout effacer</button>}
      </fieldset>}
      </div></header>
    <nav className="catalog-alphabet" aria-label={`Index alphabétique des ${title.toLowerCase()}`}>
      {CATALOG_ALPHABET.map((letter) => <button type="button" key={letter}
        className={selectedLetter === letter ? "active" : undefined}
        aria-label={`Aller à la lettre ${letter}`} aria-current={selectedLetter === letter ? "true" : undefined}
        onClick={() => jumpToLetter(letter)}>{letter}</button>)}
    </nav>
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {items.length ? <>{remainingBefore > 0 && <div className="catalog-more catalog-before">
        <button type="button" onClick={() => void loadPrevious()} disabled={loading}>
          {loading ? "Chargement…" : `Afficher ${Math.min(CATALOG_PAGE_SIZE, remainingBefore)} titres précédents`}
        </button>
      </div>}<div className="catalog-grid" ref={grid}>{items.map((item) => <MediaCard key={item.id} item={item} onOpen={ouvrir} onContext={onContext} />)}</div>
      {remaining > 0 && <div className="catalog-more" ref={sentinel}>
        <button type="button" onClick={() => void loadMore()} disabled={loading}>
          {loading ? "Chargement…" : `Afficher ${Math.min(CATALOG_PAGE_SIZE, remaining)} titres de plus`}
        </button>
        <small>{remaining} {remaining > 1 ? "titres restants" : "titre restant"}</small>
      </div>}</>
      : loading ? <div className="catalog-grid" aria-busy="true" aria-label="Chargement du catalogue">
          {Array.from({ length: Math.min(CATALOG_PAGE_SIZE, Math.max(12, matching)) }, (_, index) => <div className="catalog-skeleton" key={index} />)}
        </div>
      : <div className="catalog-empty"><Icon name={kind === "movies" ? "movie" : "tv"} /><h2>Aucun résultat</h2><p>{debouncedQuery || filter !== "all" ? "Modifiez la recherche ou le filtre." : "Les contenus apparaîtront ici après l’analyse de la bibliothèque correspondante."}</p></div>}
  </section>;
}

function RemoteLoginPanel({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true); setError(null);
    try { await api.remoteLogin(username.trim(), password); await onAuthenticated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Connexion refusée"); }
    finally { setBusy(false); }
  };
  return <main className="group-gate remote-login-gate"><img src="/brand/flixtunes-logo.png" alt="" />
    <span className="eyebrow">Accès privé</span><h1>Connexion à FlixTunes</h1>
    <p>Ce compte protège l’accès Internet. Il est indépendant du groupe et du profil que vous choisirez ensuite.</p>
    <form className="group-create" onSubmit={(event) => { event.preventDefault(); void login(); }}>
      <input autoFocus autoComplete="username" maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Compte de connexion" />
      <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mot de passe" />
      <button className="primary" disabled={!username.trim() || !password || busy}>{busy ? "Connexion…" : "Se connecter"}</button>
    </form>{error && <p className="inline-error" role="alert">{error}</p>}
    <small>Une fois validé, cet appareil restera autorisé pendant un an.</small>
  </main>;
}

function GroupPanel({ groups, onSelect, onChanged }: {
  groups: ProfileGroup[]; onSelect: (group: ProfileGroup) => void; onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(""); const [editing, setEditing] = useState<ProfileGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { if (!name.trim()) return; setError(null); try {
    if (editing) await api.updateProfileGroup(editing.id, { name }); else await api.addProfileGroup({ name });
    setName(""); setEditing(null); await onChanged();
  } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible"); } };
  return <main className="group-gate"><img src="/brand/flixtunes-logo.png" alt="" /><span className="eyebrow">Bienvenue</span>
    <h1>Choisissez votre groupe</h1><p>Les profils et leurs historiques restent séparés dans chaque espace.</p>
    <div className="group-grid">{groups.map((group) => <article key={group.id}>
      <button className="group-choice" onClick={() => onSelect(group)}><span>{group.name.slice(0, 1).toUpperCase()}</span><b>{group.name}</b></button>
      <div><button onClick={() => { setEditing(group); setName(group.name); }}>Renommer</button>
      {groups.length > 1 && <button className="profile-delete" onClick={async () => { setError(null); try { await api.removeProfileGroup(group.id); await onChanged(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Suppression impossible"); } }}>Supprimer</button>}</div>
    </article>)}</div>
    <form className="group-create" onSubmit={(event) => { event.preventDefault(); void save(); }}><input maxLength={32} value={name}
      onChange={(event) => setName(event.target.value)} placeholder={editing ? "Nom du groupe" : "Nouveau groupe"} />
      <button className="primary" disabled={!name.trim()}>{editing ? "Enregistrer" : "Ajouter"}</button>
      {editing && <button type="button" onClick={() => { setEditing(null); setName(""); }}>Annuler</button>}</form>
    {error && <p className="inline-error" role="alert">{error}</p>}</main>;
}

function ProfilePanel({ group, profiles, selected, onSelect, onChanged, onBackGroup, onClose }: {
  group: ProfileGroup; profiles: Profile[]; selected: Profile | null; onSelect: (profile: Profile) => void;
  onChanged: () => Promise<void>; onBackGroup: () => void; onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [name, setName] = useState(""); const [language, setLanguage] = useState<"fr-FR" | "en-US">("fr-FR"); const [pin, setPin] = useState("");
  const [color, setColor] = useState(profileColors[profiles.length % profileColors.length] ?? "#2968ff"); const [error, setError] = useState<string | null>(null);
  const [subtitleMode, setSubtitleMode] = useState<"off" | "forced" | "always">(selected?.subtitleMode ?? "forced");
  const [audioOrder, setAudioOrder] = useState<"original-fr-en" | "fr-en-original" | "en-original-fr">("fr-en-original");
  const [audioOutputMode, setAudioOutputMode] = useState<NonNullable<Profile["audioOutputMode"]>>(selected?.audioOutputMode ?? "auto");
  const [audioNormalization, setAudioNormalization] = useState(selected?.audioNormalization ?? false);
  const [nightMode, setNightMode] = useState(selected?.nightMode ?? false);
  const [dynamicRangePriority, setDynamicRangePriority] = useState<NonNullable<Profile["dynamicRangePriority"]>>(selected?.dynamicRangePriority ?? "auto");
  const [resumeMode, setResumeMode] = useState<NonNullable<Profile["resumeMode"]>>(selected?.resumeMode ?? "continue");
  const [resumeRewindSeconds, setResumeRewindSeconds] = useState(selected?.resumeRewindSeconds ?? 5);
  const [defaultPlaybackRate, setDefaultPlaybackRate] = useState(selected?.defaultPlaybackRate ?? 1);
  const [autoplayNext, setAutoplayNext] = useState(selected?.autoplayNext ?? true);
  const [autoplayLimit, setAutoplayLimit] = useState(selected?.autoplayLimit ?? 3);
  // Identité du profil sélectionné : le serveur accepte ces champs depuis toujours, l'interface ne les exposait pas.
  const [editName, setEditName] = useState(selected?.name ?? "");
  const [editColor, setEditColor] = useState(selected?.avatarColor ?? profileColors[0]!);
  const [editLanguage, setEditLanguage] = useState<"fr-FR" | "en-US">(selected?.language ?? "fr-FR");
  const [editPin, setEditPin] = useState("");
  const [editCurrentPin, setEditCurrentPin] = useState("");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false); const [age, setAge] = useState(10);
  const [editIsChild, setEditIsChild] = useState(selected?.isChild ?? false); const [editAge, setEditAge] = useState(selected?.age ?? 10);
  useEffect(() => { setEditName(selected?.name ?? ""); setEditColor(selected?.avatarColor ?? profileColors[0]!);
    setEditLanguage(selected?.language ?? "fr-FR"); setEditPin(""); setEditCurrentPin("");
    setSubtitleMode(selected?.subtitleMode ?? "forced"); setAudioOutputMode(selected?.audioOutputMode ?? "auto");
    const firstAudio = selected?.preferredAudioLanguages?.[0]?.toLowerCase();
    setAudioOrder(firstAudio === "original" ? "original-fr-en" : ["en", "eng"].includes(firstAudio ?? "") ? "en-original-fr" : "fr-en-original");
    setAudioNormalization(selected?.audioNormalization ?? false); setNightMode(selected?.nightMode ?? false);
    setDynamicRangePriority(selected?.dynamicRangePriority ?? "auto");
    setResumeMode(selected?.resumeMode ?? "continue"); setResumeRewindSeconds(selected?.resumeRewindSeconds ?? 5);
    setDefaultPlaybackRate(selected?.defaultPlaybackRate ?? 1); setAutoplayNext(selected?.autoplayNext ?? true);
    setAutoplayLimit(selected?.autoplayLimit ?? 3); setEditIsChild(selected?.isChild ?? false); setEditAge(selected?.age ?? 10); }, [selected]);
  const savePreferences = async () => { if (!selected) return; setError(null);
    try {
      const updated = await api.updateProfile(selected.id, {
        name: editName.trim() || selected.name, avatarColor: editColor, language: editLanguage,
        preferredAudioLanguages: audioOrder === "original-fr-en" ? ["original", "fr", "en"] : audioOrder === "en-original-fr" ? ["en", "original", "fr"] : ["fr", "en", "original"],
        preferredSubtitleLanguages: editLanguage === "fr-FR" ? ["fr", "en"] : ["en", "fr"], subtitleMode,
        audioOutputMode, audioNormalization, nightMode, dynamicRangePriority, resumeMode, resumeRewindSeconds, defaultPlaybackRate, autoplayNext, autoplayLimit,
        isChild: editIsChild, age: editIsChild ? editAge : null,
        // Un champ PIN laissé vide ne touche pas au code existant : seul le bouton dédié le retire.
        ...(editPin.length >= 4 ? { pin: editPin, ...(selected.protected ? { ancienPin: editCurrentPin } : {}) } : {}),
      });
      setEditPin(""); setEditCurrentPin(""); await onChanged(); onSelect(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); } };
  /**
   * Retrait du code PIN.
   *
   * Le bouton était désactivé tant que le code actuel n'était pas saisi, et le message d'échec ne
   * s'affichait qu'au bas du panneau, à côté du formulaire de création. Un clic sans effet et une
   * explication hors du regard : de l'extérieur, le bouton « ne marchait pas ». Il reste donc
   * actionnable, et dit lui-même ce qui lui manque.
   */
  const removePin = async () => { if (!selected) return; setError(null); setEditMessage(null);
    if (editCurrentPin.length < 4) {
      setError("Saisissez d’abord votre code PIN actuel, juste au-dessus.");
      return;
    }
    try { const updated = await api.updateProfile(selected.id, { pin: null, ancienPin: editCurrentPin }); setEditPin(""); setEditCurrentPin(""); setEditMessage("Code PIN retiré."); await onChanged(); onSelect(updated); }
    catch (e) { setError(e instanceof Error ? e.message : "Retrait du code impossible"); } };
  const create = async () => { if (!name.trim()) return; try { const profile = await api.addProfile({ groupId: group.id, name, avatarColor: color, language,
    preferredAudioLanguages: language === "fr-FR" ? ["fra", "fre", "fr", "eng", "en"] : ["eng", "en", "fra", "fr"],
    preferredSubtitleLanguages: language === "fr-FR" ? ["fra", "fre", "fr"] : ["eng", "en"], subtitleMode: "forced",
    audioOutputMode: "auto", audioNormalization: false, nightMode: false, dynamicRangePriority: "auto", resumeMode: "continue", resumeRewindSeconds: 5,
    defaultPlaybackRate: 1, autoplayNext: true, autoplayLimit: 3, isChild, age: isChild ? age : null,
    pin: pin || undefined }); await onChanged(); onSelect(profile); } catch (e) { setError(e instanceof Error ? e.message : "Création impossible"); } };
  return <div className="modal-backdrop profile-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="profile-panel" role="dialog" aria-modal="true" aria-label="Profils" ref={dialogRef}><div className="panel-header"><div><span className="eyebrow">Qui regarde dans {group.name} ?</span><h2>Vos profils</h2></div><div><button onClick={onBackGroup}>Changer de groupe</button><button onClick={onClose} aria-label="Fermer">×</button></div></div>
      <div className="profile-grid">{profiles.map((profile) => <article key={profile.id} className={selected?.id === profile.id ? "selected" : ""}>
        <button className="profile-choice" onClick={() => onSelect(profile)}><span style={{ background: profile.avatarColor }}>{profile.name[0]}</span><b>{profile.protected ? "🔒 " : ""}{profile.name}</b><small>{profile.isChild ? `Enfant · ${profile.age} ans` : profile.language === "fr-FR" ? "Français" : "English"}</small></button>
        {profiles.length > 1 && <button className="profile-delete" onClick={async () => { await api.removeProfile(profile.id); await onChanged(); }} aria-label={`Supprimer ${profile.name}`}>Supprimer</button>}
      </article>)}</div>
      {selected && <div className="profile-preferences"><h3>Profil de {selected.name}</h3>
        <label><span>Nom</span><input maxLength={32} value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
        <label><span>Langue du profil</span><select value={editLanguage} onChange={(event) => setEditLanguage(event.target.value as "fr-FR" | "en-US")}><option value="fr-FR">Français</option><option value="en-US">English</option></select></label>
        <label><span>Couleur</span><div className="color-picker">{profileColors.map((value) => <button key={value} aria-label={`Couleur ${value}`} className={editColor === value ? "active" : ""} style={{ background: value }} onClick={() => setEditColor(value)} />)}</div></label>
        {selected.protected && <label><span>Code PIN actuel</span><input type="password" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} value={editCurrentPin} placeholder="Nécessaire pour modifier ou retirer" onChange={(event) => setEditCurrentPin(event.target.value.replace(/\D/g, ""))} /></label>}
        <label><span>{selected.protected ? "Changer le code PIN" : "Ajouter un code PIN"}</span><span className="profile-pin-actions"><input inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} value={editPin} placeholder={selected.protected ? "Inchangé" : "Aucun"} onChange={(event) => setEditPin(event.target.value.replace(/\D/g, ""))} />{selected.protected && <button type="button" className="profile-delete" onClick={() => void removePin()}>Retirer le PIN</button>}</span></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {editMessage && <p className="inline-success" role="status">{editMessage}</p>}
        <label><span>Compte enfant</span><input type="checkbox" checked={editIsChild} onChange={(event) => setEditIsChild(event.target.checked)} /></label>
        {editIsChild && <label><span>Âge de l’enfant</span><input type="number" min="0" max="17" value={editAge} onChange={(event) => setEditAge(Math.max(0, Math.min(17, Number(event.target.value))))} /></label>}
        <h3>Lecture pour {selected.name}</h3>
        <label><span>Ordre des langues audio</span><select value={audioOrder} onChange={(event) => setAudioOrder(event.target.value as typeof audioOrder)}><option value="fr-en-original">Français → anglais → originale</option><option value="original-fr-en">Originale → français → anglais</option><option value="en-original-fr">Anglais → originale → français</option></select></label>
        <label><span>Sortie audio</span><select value={audioOutputMode} onChange={(event) => setAudioOutputMode(event.target.value as typeof audioOutputMode)}><option value="auto">Automatique / passthrough</option><option value="copy">Conserver si compatible</option><option value="aac">AAC universel</option><option value="ac3">Dolby Digital / AC-3</option><option value="opus">Opus</option></select></label>
        <label><span>Priorité HDR</span><select value={dynamicRangePriority} onChange={(event) => setDynamicRangePriority(event.target.value as typeof dynamicRangePriority)}><option value="auto">Automatique · DV → HDR10+ → HDR10 → HLG → SDR</option><option value="dolbyvision">Dolby Vision</option><option value="hdr10plus">HDR10+</option><option value="hdr10">HDR10</option><option value="hlg">HLG</option><option value="sdr">SDR</option></select></label>
        <label><span>Sous-titres automatiques</span><select value={subtitleMode} onChange={(event) => setSubtitleMode(event.target.value as typeof subtitleMode)}><option value="forced">Forcés uniquement</option><option value="always">Toujours</option><option value="off">Désactivés</option></select></label>
        <label><span>Normalisation EBU R128</span><input type="checkbox" checked={audioNormalization} onChange={(event) => setAudioNormalization(event.target.checked)} /></label>
        <label><span>Mode nuit</span><input type="checkbox" checked={nightMode} onChange={(event) => setNightMode(event.target.checked)} /></label>
        <label><span>Reprise</span><select value={resumeMode} onChange={(event) => setResumeMode(event.target.value as typeof resumeMode)}><option value="continue">Reprendre automatiquement</option><option value="ask">Demander</option><option value="restart">Toujours recommencer</option></select></label>
        <label><span>Retour avant reprise</span><select value={resumeRewindSeconds} onChange={(event) => setResumeRewindSeconds(Number(event.target.value))}><option value="0">Aucun</option><option value="5">5 secondes</option><option value="10">10 secondes</option><option value="20">20 secondes</option></select></label>
        <label><span>Vitesse par défaut</span><select value={defaultPlaybackRate} onChange={(event) => setDefaultPlaybackRate(Number(event.target.value))}><option value="0.75">0,75×</option><option value="1">1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label>
        <label><span>Épisode suivant automatique</span><input type="checkbox" checked={autoplayNext} onChange={(event) => setAutoplayNext(event.target.checked)} /></label>
        <label><span>Limite sans interaction</span><select value={autoplayLimit} onChange={(event) => setAutoplayLimit(Number(event.target.value))}>{[1, 2, 3, 5, 10].map((value) => <option key={value} value={value}>{value} épisode{value > 1 ? "s" : ""}</option>)}</select></label>
        <button onClick={() => void savePreferences()}>Enregistrer</button></div>}
      <div className="profile-create"><h3>Ajouter un profil</h3><div className="profile-form"><input maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Prénom ou pseudo" />
        <select aria-label="Langue du nouveau profil" value={language} onChange={(e) => setLanguage(e.target.value as "fr-FR" | "en-US")}><option value="fr-FR">Français</option><option value="en-US">English</option></select><input inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN optionnel (4 à 8 chiffres)" />
        <label><input type="checkbox" checked={isChild} onChange={(event) => setIsChild(event.target.checked)} /> Compte enfant</label>
        {isChild && <label>Âge <input type="number" min="0" max="17" value={age} onChange={(event) => setAge(Math.max(0, Math.min(17, Number(event.target.value))))} /></label>}
        <div className="color-picker">{profileColors.map((value) => <button key={value} aria-label={`Couleur ${value}`} className={color === value ? "active" : ""} style={{ background: value }} onClick={() => setColor(value)} />)}</div>
        <button className="primary" onClick={() => void create()}>Créer</button></div>{error && <p className="inline-error">{error}</p>}</div>
    </section></div>;
}

function ProfileUnlockDialog({ profile, onUnlocked, onClose }: { profile: Profile; onUnlocked: () => void; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLFormElement>();
  const [pin, setPin] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const unlock = async () => { if (pin.length < 4 || busy) return; setBusy(true); setError(null); try { await api.unlockProfile(profile.id, pin); onUnlocked(); }
    catch { setError("Code PIN incorrect"); setPin(""); } finally { setBusy(false); } };
  return <div className="modal-backdrop pin-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="profile-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-pin-title" ref={dialogRef} onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
      <button type="button" className="details-close" onClick={onClose} aria-label="Fermer">×</button><span className="profile-pin-avatar" style={{ background: profile.avatarColor }}>{profile.name[0]}</span>
      <span className="eyebrow">Profil protégé</span><h2 id="profile-pin-title">Code PIN de {profile.name}</h2><p>Saisissez votre code à 4–8 chiffres.</p>
      <label><span>Code PIN</span><input autoFocus aria-label="Code PIN" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,8}" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}<div><button type="button" className="secondary" onClick={onClose}>Annuler</button><button className="primary" disabled={pin.length < 4 || busy}>{busy ? "Vérification…" : "Déverrouiller"}</button></div>
    </form></div>;
}

const roleLabel: Record<CatalogPerson["role"], string> = {
  actor: "Interprète", director: "Réalisation", creator: "Création", writer: "Scénario", composer: "Musique",
};

function PersonModal({ details, onOpen, onClose, onContext }: {
  details: PersonDetails; onOpen: (item: CardItem) => void; onClose: () => void;
  onContext?: (item: CardItem, x: number, y: number) => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const roles = new Set(details.roles.map((entry) => roleLabel[entry.role]));
  return <div className="modal-backdrop person-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="person-modal" role="dialog" aria-modal="true" aria-labelledby="person-title" ref={dialogRef}>
      <button className="details-close" onClick={onClose} aria-label="Fermer">×</button>
      <header>{details.person.profileUrl
        ? <img src={details.person.profileUrl} alt="" loading="lazy" decoding="async" />
        : <span aria-hidden="true">{details.person.name.slice(0, 1)}</span>}
        <div><span className="eyebrow">Dans votre bibliothèque</span><h1 id="person-title">{details.person.name}</h1>
          <p>{[...roles].join(" · ")}</p></div></header>
      <div className="person-body"><Rail title={`${details.items.length} titre${details.items.length > 1 ? "s" : ""}`} items={details.items}
        onOpen={onOpen} onContext={onContext} /></div>
    </div>
  </div>;
}

function QuickMenu({ item, x, y, onPlay, onOpen, onWatched, onWatchlist, onClose }: {
  item: CardItem; x: number; y: number; onPlay: () => void; onOpen: () => void;
  onWatched: () => void; onWatchlist: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); };
  }, [onClose]);
  return <div className="quick-menu" ref={ref} role="menu" aria-label={`Actions pour ${item.title}`}
    style={{ left: Math.min(x, window.innerWidth - 250), top: Math.min(y, window.innerHeight - 260) }}>
    <strong>{item.title}</strong>
    <button role="menuitem" autoFocus onClick={onPlay}>▶ {item.progressPercent > 0 ? "Reprendre" : "Lecture"}</button>
    <button role="menuitem" onClick={onOpen}>ⓘ Ouvrir la fiche</button>
    <button role="menuitem" onClick={onWatched}>{item.completed ? "Retirer la marque Vu" : "✓ Marquer comme vu"}</button>
    {item.kind !== "episode" && <button role="menuitem" onClick={onWatchlist}>{item.inWatchlist ? "− Retirer de Ma liste" : "+ Ajouter à Ma liste"}</button>}
  </div>;
}

function DetailsModal({ details, demande, profile, onPlay, onOpen, onOpenPerson, onExplore, onChanged, onClose, onCorrectMatch, onContext }: {
  details: MediaDetails; demande?: CardItem | null;
  profile: Profile; onPlay: (media: MediaItem) => void; onOpen: (media: CardItem) => void; onChanged: () => void;
  onOpenPerson: (person: CatalogPerson) => void; onExplore: (query: string) => void;
  onCorrectMatch: (libraryId: string, catalogId: string) => void; onClose: () => void;
  onContext?: (item: CardItem, x: number, y: number) => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  /**
   * **La saison ouverte est celle qui nous concerne, et non la première.**
   *
   * La fiche s'ouvrait toujours sur la saison 1. Cliquer un épisode depuis « Continuer à regarder »
   * amenait donc une série au complet, positionnée sur son début — et le bouton « Reprendre », qui
   * joue le premier épisode de la saison affichée, ramenait à S01E01. Deux symptômes, une seule cause.
   *
   * Trois réponses, de la plus précise à la plus générale : l'épisode qu'on vient de cliquer, sinon
   * celui que le serveur désigne comme point de reprise, sinon la première saison — le cas d'une série
   * qu'on ouvre sans l'avoir jamais commencée.
   */
  const saisonDe = (mediaId: string | null | undefined): number | null => {
    if (!mediaId) return null;
    const trouvee = details.seasons.find((saison) =>
      saison.episodes.some((episode) => episode.id === mediaId || episode.playableMediaId === mediaId));
    return trouvee?.number ?? null;
  };
  const saisonInitiale = (demande?.kind === "episode" ? saisonDe(demande.playableMediaId ?? demande.id) : null)
    ?? saisonDe(details.item.playableMediaId)
    ?? details.seasons[0]?.number ?? 1;
  const [season, setSeason] = useState(saisonInitiale);
  const [inWatchlist, setInWatchlist] = useState(Boolean(details.item.inWatchlist));
  const [watchedState, setWatchedState] = useState<Record<string, boolean>>({});
  const [clearedProgress, setClearedProgress] = useState<Record<string, boolean>>({});
  const [sourceVisible, setSourceVisible] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(details.versions?.[0]?.mediaId ?? details.item.id);
  const activeSeason = details.seasons.find((entry) => entry.number === season);
  const episodes = activeSeason?.episodes ?? [];
  /**
   * Ce qu'on lance quand on appuie sur « Lecture » ou « Reprendre ».
   *
   * Pour une série, on prenait `episodes[0]` — le premier épisode de la saison **affichée**. Le
   * serveur désigne pourtant l'épisode de reprise dans `playableMediaId` ; on le suit, et l'on ne
   * retombe sur le premier de la saison que s'il ne dit rien.
   */
  const episodeDeReprise = (): MediaItem | null => {
    const vise = details.item.playableMediaId;
    if (!vise) return episodes[0] ?? null;
    const trouve = details.seasons.flatMap((saison) => saison.episodes)
      .find((episode) => episode.id === vise || episode.playableMediaId === vise);
    return trouve ?? episodes[0] ?? null;
  };
  const play = (item: MediaItem = details.item) => { const media = item.kind === "show" ? episodeDeReprise() : item;
    const id = item === details.item && item.kind === "movie" ? selectedVersion : media?.playableMediaId ?? media?.id;
    if (id && media) onPlay({ ...media, id }); };
  const isWatched = (entry: MediaItem) => watchedState[entry.id] ?? entry.completed;
  const updateWatchedScope = (ids: string[], completed: boolean) => setWatchedState((current) => {
    const next = { ...current }; ids.forEach((id) => { next[id] = completed; });
    if (details.item.kind === "show") {
      const allEpisodes = details.seasons.flatMap((entry) => entry.episodes);
      next[details.item.id] = allEpisodes.length > 0 && allEpisodes.every((episode) => next[episode.id] ?? episode.completed);
    }
    return next;
  });
  const toggleWatched = async (entry: MediaItem) => {
    const completed = isWatched(entry); const next = !completed;
    if (entry.catalogId || entry.kind !== "episode") await api.setCatalogWatched(entry.catalogId ?? entry.id, profile.id, next);
    else if (completed) await api.clearProgress(entry.id, profile.id); else await api.saveProgress(entry.id, profile.id, 1, 1, true);
    const ids = entry.kind === "show" ? [entry.id, ...details.seasons.flatMap((value) => value.episodes.map((episode) => episode.id))] : [entry.id];
    updateWatchedScope(ids, next); if (completed) setClearedProgress((current) => ({ ...current, [entry.id]: true })); onChanged();
  };
  const toggleSeasonWatched = async () => {
    if (!activeSeason) return;
    const completed = activeSeason.episodes.length > 0 && activeSeason.episodes.every(isWatched); const next = !completed;
    await api.setCatalogWatched(activeSeason.id, profile.id, next);
    updateWatchedScope(activeSeason.episodes.map((episode) => episode.id), next); onChanged();
  };
  const item = details.item;
  const toggleWatchlist = async () => { const next = !inWatchlist; await api.setWatchlist(item.catalogId ?? item.id, profile.id, next); setInWatchlist(next); onChanged(); };
  return <div className="modal-backdrop details-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="details-modal" role="dialog" aria-modal="true" aria-labelledby="details-title" ref={dialogRef}>
    <div className="details-hero" style={item.backdropUrl ? { backgroundImage: `linear-gradient(0deg,#10141d 2%,transparent 75%),linear-gradient(90deg,#10141ddd,transparent),url(${item.backdropUrl})` } : undefined}>
      <button className="details-close" onClick={onClose} aria-label="Fermer">×</button><div><span className="eyebrow">{item.kind === "show" ? "Série" : item.kind === "episode" ? "Épisode" : item.kind === "video" ? "Vidéo" : "Film"}</span><h1 id="details-title">{item.showTitle ?? item.title}</h1>
      <p>{[item.year, item.runtimeSeconds ? `${Math.round(item.runtimeSeconds / 60)} min` : null, "Dans votre médiathèque"].filter(Boolean).join(" · ")}</p>
      {Boolean(details.qualities?.length) && <div className="quality-badges" aria-label="Qualités disponibles">
        {details.qualities!.map((quality) => <span key={quality}>{quality}</span>)}
      </div>}
      <div className="hero-buttons"><button className="primary" disabled={!item.playableMediaId && item.kind === "show"} onClick={() => play()}><Icon name="play" />{item.progressPercent && !clearedProgress[item.id] ? "Reprendre" : "Lecture"}</button>
      <button className="secondary" onClick={() => void toggleWatchlist()}>{inWatchlist ? "✓ Ma liste" : "+ Ma liste"}</button>
      {item.libraryId && item.catalogId && <button className="secondary"
        onClick={() => onCorrectMatch(item.libraryId!, item.catalogId!)}
        title="Choisir une autre fiche pour ce titre">✎ Corriger la correspondance</button>}
      {details.source && <button className="secondary" onClick={() => setSourceVisible((visible) => !visible)}
        aria-expanded={sourceVisible} aria-controls="source-details">
        {details.source.kind === "folder" ? "▣ Détails du dossier" : "▤ Détails du fichier"}
      </button>}
      <button className="secondary" onClick={() => void toggleWatched(item)}>{isWatched(item) ? "Marquer non vu" : "✓ Marquer vu"}</button></div></div></div>
    <div className="details-body">
      {sourceVisible && details.source && <aside className="source-details" id="source-details">
        <span>{details.source.kind === "folder" ? "Dossier racine d’origine" : "Fichier d’origine"}</span>
        {details.versions?.length ? <div className="source-versions">{details.versions.map((version) => <button
          key={version.mediaId} className={selectedVersion === version.mediaId ? "active" : ""}
          aria-pressed={selectedVersion === version.mediaId} onClick={() => setSelectedVersion(version.mediaId)}>
          <code>{version.name}</code><small>{[version.quality,
            version.fileSizeBytes ? `${(version.fileSizeBytes / 1_073_741_824).toFixed(1)} Go` : null].filter(Boolean).join(" · ")}</small>
        </button>)}</div> : <code>{details.source.name}</code>}
      </aside>}
      <p className="details-overview">{item.overview ?? "Aucun résumé n’est disponible pour ce contenu."}</p>
      {Boolean(details.genres?.length) && <div className="details-genres" aria-label="Genres">
        {details.genres!.map((genre) => <button key={genre} onClick={() => onExplore(genre)}>{genre}</button>)}
      </div>}
      {Boolean(details.people?.length) && <section className="credits"><header><span className="eyebrow">Distribution et équipe</span><h2>Talents</h2></header>
        <div>{details.people!.map((person) => <button key={`${person.role}:${person.id}:${person.character ?? ""}`}
          className="person-card" onClick={() => onOpenPerson(person)}>
          {person.profileUrl ? <img src={person.profileUrl} alt="" loading="lazy" decoding="async" />
            : <span aria-hidden="true">{person.name.slice(0, 1)}</span>}
          <strong>{person.name}</strong><small>{person.character || roleLabel[person.role]}</small>
        </button>)}</div>
      </section>}
      {details.seasons.length > 0 && <section className="season-browser"><header><div><span className="eyebrow">Toutes les saisons</span><h2>Saisons</h2></div><span>{details.seasons.length} saison{details.seasons.length > 1 ? "s" : ""}</span></header>
        <div className="season-grid">{details.seasons.map((entry) => { const poster = entry.posterUrl ?? item.posterUrl; return <button key={entry.id} className={season === entry.number ? "season-card active" : "season-card"} aria-pressed={season === entry.number} onClick={() => setSeason(entry.number)}>
          <span className="season-poster" style={poster ? { backgroundImage: `url(${poster})` } : undefined}>{!poster && <b>{entry.number}</b>}<i>{entry.episodes.length} épisode{entry.episodes.length > 1 ? "s" : ""}</i></span>
          <strong>{entry.title || `Saison ${entry.number}`}</strong><small>{entry.overview ?? `Voir les épisodes de la saison ${entry.number}`}</small>
        </button>; })}</div>
      </section>}
      {details.seasons.length > 0 && <section className="episodes"><header><div><span className="eyebrow">Saison {season}</span><h2>Épisodes</h2></div><div><span>{episodes.length} épisode{episodes.length > 1 ? "s" : ""}</span>{activeSeason && <button className="watched-toggle" onClick={() => void toggleSeasonWatched()}>{activeSeason.episodes.length > 0 && activeSeason.episodes.every(isWatched) ? "Marquer la saison non vue" : "✓ Marquer la saison vue"}</button>}</div></header>
        <div>{episodes.map((episode) => <article key={episode.id}><button className="episode-play" onClick={() => play(episode)}><span>{episode.episodeNumber}</span><Icon name="play" /></button><div><b>{episode.title}</b><small>{episode.runtimeSeconds ? `${Math.round(episode.runtimeSeconds / 60)} min` : "Durée inconnue"}</small><p>{episode.overview ?? "Description non disponible."}</p><span className="episode-progress"><i style={{ width: `${episode.progressPercent}%` }} /></span></div><button className="watched-toggle" onClick={() => void toggleWatched(episode)}>{isWatched(episode) ? "Vu ✓" : "Marquer vu"}</button></article>)}</div>
      </section>}
      {details.related.length > 0 && <Rail title="Vous aimerez peut-être" items={details.related} onOpen={onOpen} onContext={onContext} />}
      {details.collection && <Rail title={details.collection.name} items={details.collection.items} onOpen={onOpen} onContext={onContext} />}
    </div></div></div>;
}

export function App() {
  const [introComplete, setIntroComplete] = useState(isTestDom);
  const [groups, setGroups] = useState<ProfileGroup[]>([]); const [group, setGroup] = useState<ProfileGroup | null>(null);
  const [groupOpen, setGroupOpen] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]); const [profile, setProfile] = useState<Profile | null>(null);
  const [home, setHome] = useState<HomeResponse | null>(null); const [error, setError] = useState<string | null>(null);
  const [firstRunRequired, setFirstRunRequired] = useState<boolean | null>(null); const [librariesOpen, setLibrariesOpen] = useState(false);
  const [remoteLoginRequired, setRemoteLoginRequired] = useState<boolean | null>(null);
  const [profileOpen, setProfileOpen] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState("");
  const [profileToUnlock, setProfileToUnlock] = useState<Profile | null>(null);
  // Correction de correspondance demandée depuis une fiche : on retient la bibliothèque et le titre,
  // et on charge la bibliothèque à la demande — l'accueil n'en a pas besoin le reste du temps.
  const [matchTarget, setMatchTarget] = useState<{ library: LibraryFolder; catalogId: string } | null>(null);
  useRemoteNavigation();
  const [results, setResults] = useState<CardItem[]>([]); const [details, setDetails] = useState<MediaDetails | null>(null);
  /** Ce qu'on a cliqué pour ouvrir la fiche : c'est lui qui dit quelle saison montrer. */
  const [demandeFiche, setDemandeFiche] = useState<CardItem | null>(null);
  const [personDetails, setPersonDetails] = useState<PersonDetails | null>(null);
  const [quickMenu, setQuickMenu] = useState<{ item: CardItem; x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState<string | null>(playingFromHash);
  const [view, setView] = useState<AppView>(viewFromHash);
  /**
   * La télévision en direct est-elle offerte ?
   *
   * `false` tant que le serveur n'a pas répondu, et tant qu'aucune source n'a rendu de chaîne :
   * l'entrée de menu n'apparaît donc jamais « en attendant de voir ». C'est exactement ce qui était
   * demandé — « le Live TV apparaît après Série TV **seulement si paramétré** ».
   */
  const [directDisponible, setDirectDisponible] = useState(false);
  /** Le rayon Web n'existe que si un dossier a ete declare. Meme regle que le direct. */
  const [webDisponible, setWebDisponible] = useState(false);
  const [chaineDirect, setChaineDirect] = useState<ChaineDirect | null>(null);
  /**
   * La chaîne quittée, pour y revenir sans repasser par la grille.
   *
   * C'est le second geste d'un téléviseur, après le numéro : l'aller-retour entre deux chaînes. Elle
   * vit ici et non dans le lecteur, qui est démonté à chaque changement de chaîne — il perdrait la
   * mémoire au moment précis où elle sert.
   */
  const [chainePrecedente, setChainePrecedente] = useState<ChaineDirect | null>(null);
  /**
   * La dernière chaîne **ouverte**, que le lecteur soit encore là ou non.
   *
   * Elle était prise du lecteur en cours, si bien que fermer celui-ci effaçait la mémoire : on
   * regardait A, on revenait à la grille, on ouvrait B — et « précédente » ne renvoyait nulle part,
   * alors que c'est exactement le moment où l'on en a besoin.
   */
  const derniereOuverte = useRef<ChaineDirect | null>(null);
  const ouvrirChaine = (chaine: ChaineDirect) => {
    const quittee = derniereOuverte.current;
    if (quittee && quittee.id !== chaine.id) setChainePrecedente(quittee);
    derniereOuverte.current = chaine;
    setChaineDirect(chaine);
  };

  const refreshGroups = async () => { const next = await api.profileGroups(); setGroups(next); return next; };
  const refreshProfiles = async (activeGroup = group) => {
    if (!activeGroup) { setProfiles([]); return; }
    const next = await api.profiles(activeGroup.id); setProfiles(next);
    setProfile((current) => current ? next.find((candidate) => candidate.id === current.id) ?? null : null);
  };
  const selectGroup = async (next: ProfileGroup, automateForTests = false) => {
    setGroup(next); setGroupOpen(false); setProfile(null); setHome(null); setError(null);
    const nextProfiles = await api.profiles(next.id); setProfiles(nextProfiles);
    if (automateForTests) {
      const candidate = nextProfiles.find((entry) => !entry.protected) ?? nextProfiles[0] ?? null;
      if (candidate) setProfile(candidate);
    } else setProfileOpen(true);
  };
  /**
   * Recharge l'accueil, et oublie ce que le cache croyait savoir du catalogue de ce profil.
   *
   * Cette fonction n'est appelée que lorsque le serveur a effectivement changé d'avis : bibliothèque
   * ajoutée, correspondance corrigée, lecture terminée. Elle ne l'est pas au simple changement de vue
   * — c'est précisément ce qui laisse au cache son intérêt.
   */
  /**
   * Ouvre une session de profil si elle manque, avant toute lecture.
   *
   * Placée à la sélection seulement, cette demande laissait dehors le cas le plus courant : un profil
   * **restauré au démarrage** depuis le stockage local n'est jamais « sélectionné », et partait donc
   * lire sans session. Sur le réseau local cela n'a aucune importance — rien n'en réclame. Depuis
   * Internet, chaque lecture en exige une, et l'écran affichait « Impossible de joindre le serveur »
   * pour un profil parfaitement légitime.
   *
   * Ici, toutes les voies passent : sélection, restauration, changement de groupe.
   */
  const assurerSessionProfil = async (active: Profile) => {
    if (active.protected || api.hasProfileAccess(active.id)) return;
    // Un échec ne doit pas empêcher d'essayer de lire : en local la session est inutile, et à distance
    // c'est la lecture elle-même qui dira ce qui manque.
    try { await api.unlockProfile(active.id); } catch { /* le refus viendra de la lecture */ }
  };
  /**
   * Le souvenir de l'écran des chaînes appartient au profil.
   *
   * Ses favorites sont à lui : rouvrir la grille filtrée sur les chaînes de quelqu'un d'autre serait
   * un souvenir qui ment. Il part donc en même temps que le cache du catalogue, au même endroit.
   */
  const profilPrecedent = useRef<string | null>(null);
  useEffect(() => {
    if (profile?.id === profilPrecedent.current) return;
    profilPrecedent.current = profile?.id ?? null;
    oublierSouvenirDirect();
    // Un profil enfant ne voit pas les mêmes chaînes : rouvrir celle d'un autre serait un souvenir
    // qui ment, exactement comme pour la grille du direct.
    oublierSouvenirWeb();
    oublierSouvenirsCatalogue();
  }, [profile?.id]);

  const loadHome = async (active = profile) => { if (!active) return; oublierCache(`catalogue:${active.id}`);
    await assurerSessionProfil(active);
    /*
     * L'état de la télévision en direct se demande **après** la médiathèque, jamais avant : c'est
     * l'accueil qui doit s'afficher en premier, et cette réponse ne sert qu'à décider d'une entrée de
     * menu. Un serveur qui ne la connaît pas — client à jour, serveur non — laisse simplement
     * l'entrée absente, ce qui est le comportement voulu par défaut.
     */
    void api.etatLive().then((direct) => setDirectDisponible(direct.disponible)).catch(() => setDirectDisponible(false));
    void api.etatWeb().then((web) => setWebDisponible(web.disponible)).catch(() => setWebDisponible(false));
    try { setHome(await api.home(active.id)); setError(null); } catch {
    if (active.protected && !api.hasProfileAccess(active.id)) { setHome(null); setProfile(null); setProfileToUnlock(active); setError(null); return; }
    setError("Impossible de joindre le serveur FlixTunes."); } };
  const bootstrap = async () => { try {
    const remote = await api.remoteSession();
    setRemoteLoginRequired(remote.required && !remote.authenticated);
    if (remote.required && !remote.authenticated) { setFirstRunRequired(false); return; }
    const setup = await api.setupStatus(); setFirstRunRequired(setup.firstRunRequired); if (!setup.firstRunRequired) {
    const nextGroups = await refreshGroups();
    if (isTestDom && nextGroups[0]) await selectGroup(nextGroups[0], true);
  } } catch { setError("Impossible de joindre le serveur FlixTunes."); setFirstRunRequired(false); setRemoteLoginRequired(false); } };
  useEffect(() => {
    void bootstrap();
    if (isTestDom) return;
    const timer = window.setTimeout(() => setIntroComplete(true), 1450);
    const sound = new Audio("/brand/flixtunes-startup.m4a"); sound.volume = .46;
    let played = sessionStorage.getItem("flixtunes.intro-sound") === "1";
    const play = () => { if (played) return; const playback = sound.play(); if (!playback) return; void playback.then(() => { played = true; sessionStorage.setItem("flixtunes.intro-sound", "1"); }).catch(() => undefined); };
    play(); window.addEventListener("pointerdown", play, { once: true }); window.addEventListener("keydown", play, { once: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("pointerdown", play); window.removeEventListener("keydown", play); sound.pause(); };
  }, []);
  useEffect(() => { if (profile) { localStorage.setItem("flixtunes.profile", profile.id); void loadHome(profile); } }, [profile?.id]);
  useEffect(() => { const timer = window.setTimeout(() => { if (query.trim() && profile) void api.search(query, profile.id).then(setResults).catch(() => setResults([])); else setResults([]); }, 250); return () => window.clearTimeout(timer); }, [query, profile?.id]);
  useEffect(() => {
    const onHashChange = () => {
      setPlaying(playingFromHash());
      // L'ancre du lecteur ne designe aucune vue : on garde celle d'ou l'on vient, pour y revenir.
      const vue = vueDeLAncre();
      if (vue) setView(vue);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  useEffect(() => { const onKey = (event: KeyboardEvent) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    if (event.key === "Escape") { setSearchOpen(false); setProfileOpen(false); setProfileToUnlock(null); setLibrariesOpen(false); setDetails(null); setPersonDetails(null); setQuickMenu(null); return; }
    if (typing) return;
    if (event.key === "/") { event.preventDefault(); setSearchOpen(true); return; }
    if (event.altKey && event.key.toLowerCase() === "h") window.location.hash = "top";
    if (event.altKey && event.key.toLowerCase() === "m") window.location.hash = "films";
    if (event.altKey && event.key.toLowerCase() === "s") window.location.hash = "series";
  };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);

  /*
   * On retient **ce qui a été cliqué**, et pas seulement la fiche qu'on va chercher.
   *
   * Un clic sur un épisode ouvre la fiche de sa série — c'est le bon comportement, on veut voir la
   * saison et les voisins. Mais l'épisode demandé était perdu en route, et la fiche s'ouvrait sur la
   * saison 1 comme si l'on partait de zéro.
   */
  const openDetails = async (item: CardItem) => { if (!profile) return; setQuickMenu(null); setPersonDetails(null);
    setDemandeFiche(item);
    try { setDetails(await api.details(item.catalogId ?? item.id, profile.id)); } catch (e) { setError(e instanceof Error ? e.message : "Fiche indisponible"); } };
  const openPerson = async (person: CatalogPerson) => { if (!profile) return; setDetails(null); setQuickMenu(null);
    try { setPersonDetails(await api.person(person.id, profile.id)); } catch (e) { setError(e instanceof Error ? e.message : "Filmographie indisponible"); } };
  const openContext = useCallback((item: CardItem, x: number, y: number) => setQuickMenu({ item, x, y }), []);
  const explore = (value: string) => { setDetails(null); setPersonDetails(null); setSearchOpen(true); setQuery(value); };
  const openMatchCorrection = async (libraryId: string, catalogId: string) => {
    try {
      const libraries = await api.libraries();
      const library = libraries.find((entry) => entry.id === libraryId);
      if (!library) { setError("Bibliothèque introuvable pour cette fiche."); return; }
      setDetails(null);
      setMatchTarget({ library, catalogId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bibliothèque inaccessible.");
    }
  };

  const activateProfile = (next: Profile) => { setProfile(next); setProfileOpen(false); setProfileToUnlock(null); setDetails(null); setPersonDetails(null); setQuickMenu(null); setQuery(""); };
  /**
   * Un profil sans code ouvre quand même une session.
   *
   * Sur le réseau local, aucune lecture n'en réclame : le profil s'activait donc sans en demander,
   * et cela suffisait. Sur Internet, **chaque** lecture en exige une — un profil sans code se
   * retrouvait alors dans une impasse : il lui fallait une session, et le seul moyen d'en obtenir une
   * réclamait un code qu'il n'avait pas. L'écran annonçait « Impossible de joindre le serveur »,
   * ce qui envoyait chercher du côté du réseau.
   *
   * La demande est silencieuse et sans conséquence en local, où la session est simplement inutilisée.
   */
  const selectProfile = async (next: Profile) => {
    if (next.protected && !api.hasProfileAccess(next.id)) { setProfileToUnlock(next); return; }
    await assurerSessionProfil(next);
    activateProfile(next);
  };
  /**
   * Retour depuis le lecteur (cas limite de l'étape 55, et WCAG 2.4.3 — ordre du focus).
   *
   * Le lecteur remplace toute l'application : au retour, le bouton d'où la lecture est partie a été
   * démonté puis reconstruit, donc en garder une référence ne sert à rien. Le repère conservé est
   * l'**identité** de la fiche regardée ; on la retrouve dans la page reconstruite.
   */
  const retourApresLecteur = useRef<string | null>(null);
  const startPlayback = (media: MediaItem) => { retourApresLecteur.current = media.catalogId; ouvrirLecteur(media.id); };
  /** Enchaînement depuis le lecteur : l'épisode suivant n'est connu que par son identifiant. */
  const playById = (mediaId: string) => ouvrirLecteur(mediaId);
  /** Ouvre le lecteur et inscrit la lecture dans l'adresse, pour qu'elle survive à un rechargement. */
  const ouvrirLecteur = (mediaId: string) => { setPlaying(mediaId); window.location.hash = `lecture/${encodeURIComponent(mediaId)}`; };
  /** Quitte le lecteur et rend l'adresse à la vue courante. */
  const fermerLecteur = () => { setPlaying(null); window.location.hash = ANCRES[view]; };
  /** Enchaînement depuis le lecteur : l'épisode suivant n'est connu que par son identifiant. */

  useEffect(() => {
    const cible = retourApresLecteur.current;
    if (playing || !cible) return;
    retourApresLecteur.current = null;
    // La fiche détaillée, si elle réapparaît, réclame le focus elle-même : ne pas le lui reprendre.
    if (details) return;
    // Laisser passer un rendu : la page d'accueil n'est pas encore reconstruite à cet instant.
    const minuteur = setTimeout(() => {
      // Si quoi que ce soit a déjà pris le focus, c'est que l'utilisateur est reparti ailleurs.
      if (document.activeElement && document.activeElement !== document.body) return;
      const carte = document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(cible)}"]`);
      (carte ?? document.getElementById("main-content"))?.focus();
    }, 0);
    return () => clearTimeout(minuteur);
  }, [playing, details]);

  const navigate = (next: AppView) => { setView(next); setSearchOpen(false); setQuery(""); window.location.hash = ANCRES[next]; };

  /**
   * Un écran s'ouvre en haut. Tous les écrans, et par toutes les voies.
   *
   * `navigate` remettait bien la page en haut, mais c'est la navigation principale : elle ne voit ni
   * le retour au choix du groupe, ni l'écran des profils, ni la sortie du lecteur. On arrivait donc
   * sur « Choisissez votre groupe » à la hauteur où la page précédente avait été laissée.
   *
   * Recopier un `scrollTo` à chaque endroit était la mauvaise réponse : c'est ainsi qu'un des cas
   * finit toujours par être oublié — celui-là l'avait été. On nomme donc l'écran courant, et **un
   * seul** effet observe ce nom. Un nouvel écran, quel qu'il soit, hérite du comportement sans que
   * personne ait à y penser.
   */
  const ecranCourant = playing ? `lecteur:${playing}`
    : !introComplete || firstRunRequired === null || remoteLoginRequired === null ? "chargement"
      : remoteLoginRequired ? "connexion"
        : firstRunRequired ? "installation"
          : (groupOpen || !group) ? "groupe"
            : profileOpen ? "profils"
              : `principal:${view}`;
  useEffect(() => {
    if (isTestDom) return;
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }, [ecranCourant]);
  // Le fond noir plutôt qu'un indicateur : le lecteur arrive en quelques dizaines de millisecondes
  // depuis le cache du navigateur, et une roue qui clignote au passage se remarque bien davantage que
  // l'attente qu'elle prétend meubler. Le rôle et le libellé restent, pour qui n'a que la voix.
  if (playing && profile) return (
    <Suspense fallback={<div className="player-page" role="status" aria-label="Ouverture du lecteur" />}>
      <Player mediaId={playing} profile={profile} onPlayMedia={playById} onClose={() => { fermerLecteur(); void loadHome(); }} />
    </Suspense>
  );
  if (chaineDirect && profile) return (
    <Suspense fallback={<div className="player-page" role="status" aria-label="Ouverture de la chaîne" />}>
      <LecteurDirect chaine={chaineDirect} precedente={chainePrecedente}
        onChaine={ouvrirChaine} onClose={() => setChaineDirect(null)} />
    </Suspense>
  );
  if (!introComplete || firstRunRequired === null || remoteLoginRequired === null) return <div className="app-loading brand-intro"><div className="intro-orbit"/><img src="/brand/flixtunes-logo.png" alt="FlixTunes" /><strong>Flix<span>Tunes</span></strong><span>{firstRunRequired === null || remoteLoginRequired === null ? "Connexion au serveur…" : "Votre cinéma prend vie"}</span></div>;
  if (remoteLoginRequired) return <RemoteLoginPanel onAuthenticated={bootstrap} />;
  if (firstRunRequired) return <SetupWizard onComplete={() => { setFirstRunRequired(false); void refreshGroups(); }} />;
  if (groupOpen || !group) return <GroupPanel groups={groups} onSelect={(next) => void selectGroup(next)} onChanged={async () => { await refreshGroups(); }} />;

  const featured = home?.featured; const empty = home && !home.recentlyAdded.length;
  return <div className="app-shell"><a className="skip-link" href="#main-content">Aller au contenu</a><header className="topbar"><a className="brand" href="#top" onClick={(event) => { event.preventDefault(); navigate("home"); }}><img src="/brand/flixtunes-logo.png" alt="" /><span>Flix<span>Tunes</span></span></a>
    <nav aria-label="Menu principal"><a className={view === "home" ? "active" : ""} href="#top" onClick={(event) => { event.preventDefault(); navigate("home"); }}><Icon name="home" />Accueil</a><a className={view === "movies" ? "active" : ""} href="#films" onClick={(event) => { event.preventDefault(); navigate("movies"); }}><Icon name="movie" />Films</a><a className={view === "shows" ? "active" : ""} href="#series" onClick={(event) => { event.preventDefault(); navigate("shows"); }}><Icon name="tv" />Séries TV</a>{webDisponible && <a className={view === "web" ? "active" : ""} href="#web" onClick={(event) => { event.preventDefault(); navigate("web"); }}><Icon name="web" />Web</a>}{directDisponible && <a className={view === "live" ? "active" : ""} href="#direct" onClick={(event) => { event.preventDefault(); navigate("live"); }}><Icon name="tv" />Live TV</a>}<a className={view === "history" ? "active" : ""} href="#historique" onClick={(event) => { event.preventDefault(); navigate("history"); }}><Icon name="history" />Historique</a></nav>
    <div className="top-actions"><button className="icon-button" onClick={() => setLibrariesOpen(true)} aria-label="Gérer les dossiers"><Icon name="settings" /></button><button className="icon-button" onClick={() => setSearchOpen((v) => !v)} aria-label="Rechercher"><Icon name="search" /></button>
    {profile && <button className="profile" onClick={() => setProfileOpen(true)}><span style={{ background: profile.avatarColor }}>{profile.name[0]}</span><b>{profile.name}</b></button>}</div></header>
    {searchOpen && <div className="search-panel"><Icon name="search" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titres, acteurs, réalisateurs, genres…" />{query && <div className="search-results">{results.length ? results.map((item) => <MediaCard key={item.id} item={item} onOpen={openDetails} onContext={openContext} />) : <p>Aucun résultat.</p>}</div>}</div>}
    <main id="main-content" tabIndex={-1}>{error && <div className="server-error"><b>Un problème est survenu</b><span>{error}</span><button onClick={() => void loadHome()}>Réessayer</button></div>}
      {!home && !error && <HomeSkeleton />}
      {view === "home" && featured && <section className="hero" style={featured.backdropUrl ? { backgroundImage: `linear-gradient(90deg,rgba(7,10,17,.98) 5%,rgba(7,10,17,.6) 50%,rgba(7,10,17,.08)),linear-gradient(0deg,#080b12 0%,transparent 48%),url(${featured.backdropUrl})` } : undefined}><div className="hero-copy"><span className="eyebrow">{featured.progressPercent ? "À reprendre" : "À découvrir"}</span><h1>{featured.showTitle ?? featured.title}</h1><p className="hero-meta">{featured.kind === "episode" ? `Saison ${featured.seasonNumber} · Épisode ${featured.episodeNumber}` : featured.kind === "video" ? "Vidéo" : featured.year ?? (featured.kind === "show" ? "Série" : "Film")} <span>•</span> {featured.runtimeSeconds ? `${Math.round(featured.runtimeSeconds / 60)} min` : "Dans votre médiathèque"}</p><p className="hero-overview">{featured.overview ?? "Votre contenu est prêt sur le réseau local."}</p><div className="hero-buttons"><button className="primary" data-media-id={featured.catalogId} disabled={!featured.playableMediaId} onClick={() => featured.playableMediaId && startPlayback({ ...featured, id: featured.playableMediaId })}><Icon name="play" />Lecture</button><button className="secondary" onClick={() => void openDetails(featured)}><Icon name="info" />Plus d’infos</button></div></div></section>}
      {view === "home" && empty && <section className="empty-state"><img src="/brand/flixtunes-logo.png" alt="" /><span className="eyebrow">Le serveur est prêt</span><h1>Votre médiathèque se prépare</h1><p>Ajoutez vos dossiers ou suivez leur analyse.</p><button className="primary" onClick={() => setLibrariesOpen(true)}><Icon name="settings" />Voir les bibliothèques</button></section>}
      {view === "home" && !empty && home && <div className="content"><Rail title="Continuer à regarder" items={home.continueWatching} onOpen={openDetails} onContext={openContext} />{profile && <RecommendationRail recommendations={home.recommendations ?? []} profile={profile} onOpen={openDetails} onChanged={() => void loadHome()} onContext={openContext} />}<Rail title="Ma liste" items={home.watchlist ?? []} onOpen={openDetails} onContext={openContext} /><Rail title="Ajouts récents" items={home.recentlyAdded} onOpen={openDetails} onContext={openContext} /><Rail title="Films" items={home.movies} onOpen={openDetails} onContext={openContext} /><Rail title="Séries" items={home.shows} onOpen={openDetails} onContext={openContext} /><Rail title="Déjà vus" items={home.completed} onOpen={openDetails} onContext={openContext} /><Rail title="Historique récent" items={home.watchedRecently} onOpen={openDetails} onContext={openContext} /></div>}
      {home && profile && view === "movies" && <CatalogPage kind="movies" profileId={profile.id} total={home.movieTotal ?? home.movies.length} onOpen={openDetails} onContext={openContext} />}
      {home && profile && view === "shows" && <CatalogPage kind="shows" profileId={profile.id} total={home.showTotal ?? home.shows.length} onOpen={openDetails} onContext={openContext} />}
      {view === "web" && webDisponible && profile
        && <Suspense fallback={<HomeSkeleton />}><RayonWeb profileId={profile.id} onPlay={startPlayback} /></Suspense>}
      {view === "live" && directDisponible && <Suspense fallback={<HomeSkeleton />}><LiveTv onPlay={ouvrirChaine} /></Suspense>}
      {home && view === "history" && <section className="catalog-page"><header className="catalog-header"><div><span className="eyebrow">Votre activité</span><h1>Historique</h1></div></header><Rail title="Déjà vus" items={home.completed} onOpen={openDetails} onContext={openContext} /><Rail title="Historique récent" items={home.watchedRecently} onOpen={openDetails} onContext={openContext} /></section>}
    </main><footer><span>FlixTunes</span><button onClick={() => setLibrariesOpen(true)}>Gérer les bibliothèques</button><small>Votre cinéma. Votre réseau.</small></footer>
    {librariesOpen && <LibraryManager onClose={() => { setLibrariesOpen(false); void loadHome(); }} onChanged={() => void loadHome()} />}
    {profileOpen && <ProfilePanel group={group} profiles={profiles} selected={profile} onSelect={selectProfile}
      onChanged={() => refreshProfiles(group)} onBackGroup={() => { setProfileOpen(false); setProfile(null); setHome(null); setGroupOpen(true); }}
      onClose={() => { if (profile) setProfileOpen(false); else setGroupOpen(true); }} />}
    {profileToUnlock && <ProfileUnlockDialog profile={profileToUnlock} onUnlocked={() => activateProfile(profileToUnlock)} onClose={() => setProfileToUnlock(null)} />}
    {details && profile && <DetailsModal details={details} demande={demandeFiche} profile={profile} onPlay={startPlayback} onOpen={(item) => void openDetails(item)}
      onOpenPerson={(person) => void openPerson(person)} onExplore={explore} onContext={openContext}
      onChanged={() => void loadHome()} onCorrectMatch={(libraryId, catalogId) => void openMatchCorrection(libraryId, catalogId)}
      onClose={() => { setDetails(null); setDemandeFiche(null); }} />}
    {personDetails && <PersonModal details={personDetails} onOpen={(item) => void openDetails(item)} onClose={() => setPersonDetails(null)} onContext={openContext} />}
    {quickMenu && profile && <QuickMenu item={quickMenu.item} x={quickMenu.x} y={quickMenu.y} onClose={() => setQuickMenu(null)}
      onPlay={() => { const mediaId = quickMenu.item.playableMediaId ?? (quickMenu.item.kind === "show" ? null : quickMenu.item.id);
        setQuickMenu(null); if (mediaId) startPlayback({ ...quickMenu.item, id: mediaId }); }}
      onOpen={() => void openDetails(quickMenu.item)}
      onWatched={() => { const item = quickMenu.item; setQuickMenu(null); void (async () => {
        if (item.kind === "episode" && !item.catalogId) {
          if (item.completed) await api.clearProgress(item.id, profile.id); else await api.saveProgress(item.id, profile.id, 1, 1, true);
        } else await api.setCatalogWatched(item.catalogId ?? item.id, profile.id, !item.completed);
        await loadHome();
      })().catch((cause: Error) => setError(cause.message)); }}
      onWatchlist={() => { const item = quickMenu.item; setQuickMenu(null); void api.setWatchlist(item.catalogId ?? item.id, profile.id, !item.inWatchlist)
        .then(() => loadHome()).catch((cause: Error) => setError(cause.message)); }} />}
    {matchTarget && <div className="modal-backdrop"><MetadataManager library={matchTarget.library} focusCatalogId={matchTarget.catalogId}
      onClose={() => setMatchTarget(null)} onChanged={() => void loadHome()} /></div>}
  </div>;
}
