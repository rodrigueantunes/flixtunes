import { useEffect, useMemo, useState } from "react";
import type { MediaDetails, MediaItem, SeasonDetails } from "@flixtunes/contracts";
import { api, type CandidatWeb } from "./api";
import { Icon } from "./App";
import { dureeLisible } from "./duree";
import { lireSouvenirWeb, retenirSouvenirWeb } from "./memoire-web";

/**
 * Le rayon Web : des chaînes, leurs dossiers, leurs vidéos.
 *
 * Trois niveaux, et le deuxième est celui qui compte : **on voit les dossiers tels qu'ils sont sur le
 * disque** et on y entre. Ils ne sont pas une classification déduite — ils sont le rangement de la
 * personne, et l'écran n'a pas à le réinterpréter.
 *
 * Le catalogue ne connaît que trois niveaux, alors qu'une arborescence peut en compter plus. Le
 * serveur range donc le chemin relatif entier dans le titre d'un palier — `Documentaires / 2024 /
 * Asie` —, et c'est ici qu'il est redécoupé pour redevenir un arbre parcourable. Rien n'est stocké
 * pour cela : la profondeur voyage dans le libellé.
 */

/** Le libellé que le serveur donne aux vidéos posées à la racine d'une chaîne. */
const HORS_DOSSIER = "Hors dossier";

export type TriWeb = "recent" | "ancien" | "titre";

/** Les segments d'un palier, vides pour les vidéos qui ne sont dans aucun dossier. */
function segmentsDuPalier(saison: SeasonDetails): string[] {
  return saison.title === HORS_DOSSIER ? [] : saison.title.split(" / ").map((part) => part.trim()).filter(Boolean);
}

function commencePar(segments: string[], prefixe: string[]): boolean {
  return prefixe.every((attendu, rang) => segments[rang] === attendu);
}

/**
 * La date, telle qu'elle se lit sous un titre.
 *
 * Une date absente ne devient pas une date approchée : la ligne reste vide. Une vidéo dont on ignore
 * la date de publication est une vidéo dont on ignore la date, et l'afficher au jour de l'analyse
 * mentirait sur la seule information que cet écran trie.
 */
function dateLisible(item: MediaItem): string {
  if (!item.airDate) return "";
  const instant = new Date(`${item.airDate}T00:00:00Z`);
  if (Number.isNaN(instant.getTime())) return "";
  return instant.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Le tri des vidéos.
 *
 * Le plus récent d'abord par défaut, comme les plateformes le font et comme on l'attend en ouvrant une
 * chaîne. Le rang stocké, lui, reste croissant : c'est un nombre de jours, une grandeur qui a un sens
 * propre, et l'inverser en base aurait demandé une constante de soustraction qui dérive avec le temps.
 */
function trier(videos: MediaItem[], tri: TriWeb): MediaItem[] {
  const rang = (item: MediaItem) => item.airDate ?? "";
  const copie = [...videos];
  if (tri === "titre") return copie.sort((a, b) => a.title.localeCompare(b.title, "fr"));
  copie.sort((a, b) => {
    // Une vidéo sans date ne s'intercale pas au hasard : elle passe en fin de liste dans les deux
    // sens, parce qu'on ne sait pas où elle irait.
    if (!rang(a) && !rang(b)) return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
    if (!rang(a)) return 1;
    if (!rang(b)) return -1;
    return tri === "recent" ? rang(b).localeCompare(rang(a)) : rang(a).localeCompare(rang(b));
  });
  return copie;
}

/** Une vignette, ou l'initiale à sa place : une image cassée vaut moins qu'une lettre. */
function Vignette({ url, nom, classe }: { url: string | null; nom: string; classe: string }) {
  const [echouee, setEchouee] = useState<string | null>(null);
  if (!url || echouee === url) {
    return <span className={`${classe} web-initiale`} aria-hidden="true">{nom.charAt(0).toUpperCase()}</span>;
  }
  return <img className={classe} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
    onError={() => setEchouee(url)} />;
}

/**
 * Corriger la correspondance d'une chaîne ou d'une vidéo.
 *
 * Volontairement à part du centre de correspondances des films : celui-ci est plafonné à 250 lignes
 * triées par confiance, qu'une bibliothèque web remplirait à elle seule. Ici, on corrige la fiche
 * qu'on a sous les yeux, sans passer par une liste.
 *
 * Deux façons de faire, parce qu'on n'a pas toujours la même chose sous la main : chercher un
 * candidat par son titre, ou coller l'adresse trouvée dans un navigateur. La seconde est souvent la
 * plus rapide quand on vient précisément de vérifier de quelle vidéo il s'agit.
 */
function CorrectionWeb({ profileId, item, genre, onCorrige }: {
  profileId: string;
  item: MediaItem;
  genre: "chaine" | "video";
  onCorrige: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [candidats, setCandidats] = useState<CandidatWeb[]>([]);
  const [motif, setMotif] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  const [occupe, setOccupe] = useState(false);
  const cible = item.catalogId ?? item.id;

  async function chercher() {
    setOccupe(true);
    try {
      const reponse = await api.candidatsWeb(profileId, cible, recherche || undefined);
      setCandidats(reponse.candidats);
      setMotif(reponse.motif);
    } catch (cause) {
      setMotif(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setOccupe(false);
    }
  }

  async function appliquer(identifiant: string) {
    setOccupe(true);
    try {
      const reponse = await api.corrigerWeb(profileId, cible, identifiant);
      setMotif(reponse.message);
      setCandidats([]);
      setSaisie("");
      onCorrige();
    } catch (cause) {
      setMotif(cause instanceof Error ? cause.message : "Correction refusée.");
    } finally {
      setOccupe(false);
    }
  }

  if (!ouvert) {
    // Ouvrir ne cherche pas : une recherche coute cent unites de quota, et on n'ouvre pas toujours
    // pour chercher. Le terme est pre-rempli, le geste reste explicite.
    return <button type="button" className="web-corriger"
      onClick={() => { setOuvert(true); setRecherche(item.showTitle ?? item.title); }}>
      Corriger la correspondance
    </button>;
  }

  return <div className="web-correction">
    <div className="web-correction-ligne">
      <input value={recherche} onChange={(event) => setRecherche(event.target.value)}
        placeholder={genre === "chaine" ? "Nom de la chaîne" : "Titre de la vidéo"}
        aria-label={genre === "chaine" ? "Chercher une chaîne" : "Chercher une vidéo"} />
      <button type="button" className="secondary" disabled={occupe} onClick={() => void chercher()}>Chercher</button>
    </div>
    {candidats.map((candidat) => <button key={candidat.identifiant ?? candidat.url} type="button"
      className="web-candidat" disabled={occupe || !candidat.identifiant}
      onClick={() => candidat.identifiant && void appliquer(candidat.identifiant)}>
      <b>{candidat.titre ?? candidat.identifiant}</b>
      <small>{[candidat.chaine, candidat.publieeLe].filter(Boolean).join(" · ")}</small>
    </button>)}
    <div className="web-correction-ligne">
      {/* Coller l'adresse est souvent le plus rapide : on vient de la vérifier dans un navigateur. */}
      <input value={saisie} onChange={(event) => setSaisie(event.target.value)}
        placeholder="…ou coller l'adresse ou l'identifiant" aria-label="Identifiant ou adresse" />
      <button type="button" className="primary" disabled={occupe || !saisie.trim()}
        onClick={() => void appliquer(saisie.trim())}>Appliquer</button>
    </div>
    {motif && <p className="web-correction-motif" role="status">{motif}</p>}
    <button type="button" className="web-corriger" onClick={() => setOuvert(false)}>Fermer</button>
  </div>;
}

export function RayonWeb({ profileId, onPlay, modifiable = true }: { profileId: string; onPlay: (item: MediaItem) => void; modifiable?: boolean }) {
  const [chaines, setChaines] = useState<MediaItem[]>([]);
  /*
   * La position se relit au montage, et se réécrit à chaque pas.
   *
   * Lire une vidéo remplace tout l'écran par le lecteur : ce composant est démonté, et la chaîne
   * ouverte comme le dossier où l'on était partiraient avec lui. On revenait donc à la liste des
   * chaînes après être descendu de trois dossiers pour trouver celle-là.
   */
  const souvenir = lireSouvenirWeb();
  const [chaine, setChaine] = useState<MediaItem | null>(souvenir.chaine);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [chemin, setChemin] = useState<string[]>(souvenir.chemin);
  const [tri, setTri] = useState<TriWeb>(souvenir.tri as TriWeb);

  useEffect(() => { retenirSouvenirWeb({ chaine, chemin, tri }); }, [chaine, chemin, tri]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rechercheChaine, setRechercheChaine] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [revision, setRevision] = useState(0);
  const taillePage = 60;

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    const timer = window.setTimeout(() => { void api.catalogPage(profileId,
      { kind: "web", limit: taillePage, offset, query: rechercheChaine.trim() || undefined })
      .then((page) => { if (vivant) { setChaines(page.items); setTotal(page.total); setErreur(null); } })
      .catch(() => { if (vivant) setErreur("Le rayon Web n'a pas pu être chargé."); })
      .finally(() => { if (vivant) setChargement(false); }); }, rechercheChaine ? 250 : 0);
    return () => { vivant = false; window.clearTimeout(timer); };
  }, [profileId, offset, rechercheChaine, revision]);

  useEffect(() => {
    if (!chaine?.catalogId) { setDetails(null); return; }
    let vivant = true;
    setChargement(true);
    api.details(chaine.catalogId, profileId)
      .then((fiche) => { if (vivant) { setDetails(fiche); setErreur(null); } })
      .catch(() => { if (vivant) setErreur("Cette chaîne n'a pas pu être ouverte."); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [chaine?.catalogId, profileId, revision]);

  /** L'arbre au niveau courant : les dossiers qu'on peut ouvrir, et les vidéos qui sont ici. */
  const niveau = useMemo(() => {
    const paliers = (details?.seasons ?? []).map((saison) => ({ saison, segments: segmentsDuPalier(saison) }));
    const sousArbre = paliers.filter((palier) => commencePar(palier.segments, chemin));
    const dossiers = [...new Set(sousArbre
      .filter((palier) => palier.segments.length > chemin.length)
      .map((palier) => palier.segments[chemin.length] as string))]
      .sort((a, b) => a.localeCompare(b, "fr"));
    const videos = sousArbre
      .filter((palier) => palier.segments.length === chemin.length)
      .flatMap((palier) => palier.saison.episodes);
    /** Combien de vidéos se trouvent sous un dossier, à toute profondeur. */
    const compte = (segment: string) => sousArbre
      .filter((palier) => palier.segments[chemin.length] === segment)
      .reduce((total, palier) => total + palier.saison.episodes.length, 0);
    /*
     * La vignette d'un dossier : celle de sa vidéo la plus récente, à toute profondeur.
     *
     * « La plus récente » par date de publication, puisque c'est l'ordre du rayon — la même vidéo que
     * celle qu'on verrait en premier en ouvrant le dossier et ses sous-dossiers.
     *
     * Une vidéo sans vignette propre porte l'avatar de sa chaîne : un dossier qui la prendrait
     * afficherait l'avatar, et toutes les cartes se ressembleraient. On prend donc la plus récente qui
     * a **sa** vignette ; s'il n'y en a aucune, la carte garde l'icône de dossier.
     */
    const avatar = details?.item?.posterUrl ?? null;
    const vignette = (segment: string) => trier(sousArbre
      .filter((palier) => palier.segments[chemin.length] === segment)
      .flatMap((palier) => palier.saison.episodes)
      .filter((episode) => episode.posterUrl && episode.posterUrl !== avatar), "recent")[0]?.posterUrl ?? null;
    return { dossiers, videos: trier(videos, tri), compte, vignette };
  }, [details, chemin, tri]);

  if (!chaine) {
    return <section className="catalog-page" aria-labelledby="web-titre">
      <header className="catalog-header">
        <div><span className="eyebrow">Vos chaînes</span><h1 id="web-titre">Web</h1>
          <p>{total} {total > 1 ? "chaînes" : "chaîne"}</p></div>
        <label className="sort-control">Rechercher une chaîne
          <input type="search" value={rechercheChaine} maxLength={120} aria-label="Rechercher une chaîne"
            onChange={(event) => { setRechercheChaine(event.target.value); setOffset(0); }} />
        </label>
      </header>
      {erreur && <p className="live-vide">{erreur}</p>}
      {!erreur && !chargement && !chaines.length
        && <p className="live-vide">{rechercheChaine ? "Aucune chaîne ne correspond à cette recherche."
          : "Aucune chaîne pour l'instant. Déclarez un dossier Web et lancez une analyse."}</p>}
      <div className="web-grille web-grille-chaines">
        {chaines.map((item) => <button key={item.id} type="button" className="web-carte web-carte-chaine"
          onClick={() => { setChaine(item); setChemin([]); }}>
          <Vignette url={item.posterUrl} nom={item.showTitle ?? item.title} classe="web-portrait" />
          <span className="web-nom">{item.showTitle ?? item.title}</span>
        </button>)}
      </div>
      {total > taillePage && <nav className="catalog-controls" aria-label="Pages des chaînes">
        <button type="button" disabled={chargement || offset === 0} onClick={() => setOffset(Math.max(0, offset - taillePage))}>Page précédente</button>
        <span aria-live="polite">Page {Math.floor(offset / taillePage) + 1} sur {Math.ceil(total / taillePage)}</span>
        <button type="button" disabled={chargement || offset + taillePage >= total} onClick={() => setOffset(offset + taillePage)}>Page suivante</button>
      </nav>}
    </section>;
  }

  const titreChaine = chaine.showTitle ?? chaine.title;
  return <section className="catalog-page" aria-labelledby="web-titre">
    <header className="catalog-header">
      <div>
        <span className="eyebrow">Chaîne</span>
        <h1 id="web-titre">{titreChaine}</h1>
        {/*
          * Le fil d'Ariane porte la navigation : chaque segment ramène à son niveau, et le premier
          * élément ressort du rayon. Sans lui, on entre dans une arborescence sans pouvoir remonter.
          */}
        <nav className="web-fil" aria-label="Chemin">
          <button type="button" onClick={() => { setChaine(null); setChemin([]); }}>Web</button>
          <span aria-hidden="true">/</span>
          <button type="button" onClick={() => setChemin([])}>{titreChaine}</button>
          {chemin.map((segment, rang) => <span key={`${segment}-${rang}`}>
            <span aria-hidden="true">/</span>
            <button type="button" onClick={() => setChemin(chemin.slice(0, rang + 1))}>{segment}</button>
          </span>)}
        </nav>
      </div>
      <div className="catalog-controls">
        {modifiable && <CorrectionWeb profileId={profileId} item={chaine} genre="chaine"
          onCorrige={() => setRevision((r) => r + 1)} />}
        <label className="sort-control"><span>Trier par</span>
          <select value={tri} onChange={(event) => setTri(event.target.value as TriWeb)} aria-label="Trier les vidéos">
            <option value="recent">Plus récentes d'abord</option>
            <option value="ancien">Plus anciennes d'abord</option>
            <option value="titre">Ordre alphabétique</option>
          </select>
        </label>
      </div>
    </header>

    {erreur && <p className="live-vide">{erreur}</p>}

    <div className="web-grille web-grille-dossiers">
      {/*
        * Remonter d'un niveau, en tête de grille et non seulement dans le fil d'Ariane.
        *
        * Le fil est en haut de page ; au bas d'une longue liste de vidéos, y revenir demande de
        * remonter tout l'écran. La carte, elle, est là où se trouve déjà le regard.
        *
        * Elle est là **à tous les niveaux**, y compris à la racine d'une chaîne : la marche du haut
        * n'avait pas de carte, si bien qu'on remontait de dossier en dossier puis, arrivé à la
        * racine, la carte disparaissait et il fallait retrouver le fil d'Ariane pour ressortir.
        * Depuis la racine, elle ramène aux chaînes.
        */}
      <button type="button" className="web-carte web-carte-dossier web-carte-remonter"
        onClick={() => { if (chemin.length) setChemin(chemin.slice(0, -1)); else setChaine(null); }}>
        <span className="web-dossier-icone" aria-hidden="true">↰</span>
        <span className="web-nom">{chemin.length ? "Dossier parent" : "Retour aux chaînes"}</span>
        <small>{chemin.length > 1 ? chemin[chemin.length - 2] : chemin.length ? titreChaine : "Web"}</small>
      </button>
      {niveau.dossiers.map((dossier) => <button key={dossier} type="button" className="web-carte web-carte-dossier"
        onClick={() => setChemin([...chemin, dossier])}>
        {/*
          * La vignette de la vidéo la plus récente, et un badge qui dit que c'est un dossier : sans lui,
          * une carte de dossier illustrée se confondrait avec une carte de vidéo.
          */}
        {niveau.vignette(dossier)
          ? <span className="web-dossier-apercu">
            <Vignette url={niveau.vignette(dossier)} nom={dossier} classe="web-paysage" />
            <span className="web-dossier-badge" aria-hidden="true"><Icon name="folder" /></span>
          </span>
          : <span className="web-dossier-icone" aria-hidden="true"><Icon name="folder" /></span>}
        <span className="web-nom">{dossier}</span>
        <small>{niveau.compte(dossier)} {niveau.compte(dossier) > 1 ? "vidéos" : "vidéo"}</small>
      </button>)}
    </div>

    {niveau.videos.length > 0 && <div className="web-grille web-grille-videos">
      {niveau.videos.map((video) => <div key={video.id} className="web-carte-enveloppe">
      {/*
        * La correction est un bouton distinct, comme l'étoile de la grille du direct : cliquer une
        * carte lance la vidéo, et rien ne doit rendre ce geste hésitant.
        */}
      {modifiable && <CorrectionWeb profileId={profileId} item={video} genre="video"
        onCorrige={() => { if (chaine?.catalogId) void api.details(chaine.catalogId, profileId).then(setDetails); }} />}
      <button type="button" className="web-carte web-carte-video"
        disabled={!video.playableMediaId}
        onClick={() => video.playableMediaId && onPlay({ ...video, id: video.playableMediaId })}>
        <Vignette url={video.posterUrl ?? video.backdropUrl} nom={video.title} classe="web-paysage" />
        <span className="web-nom">{video.title}</span>
        {/*
          * La date à gauche, la durée à droite, sans libellé : les deux se reconnaissent à leur forme.
          * La date porte le tri et doit se lire sans ouvrir la fiche ; la durée est celle du fichier.
          */}
        <span className="web-meta">
          <small className="web-date">{dateLisible(video)}</small>
          {dureeLisible(video.runtimeSeconds) && <small className="web-duree">{dureeLisible(video.runtimeSeconds)}</small>}
        </span>
        {video.progressPercent > 0 && <i className="web-progression"><i style={{ width: `${video.progressPercent}%` }} /></i>}
      </button>
      </div>)}
    </div>}

    {!chargement && !niveau.dossiers.length && !niveau.videos.length
      && <p className="live-vide">Ce dossier ne contient aucune vidéo.</p>}
  </section>;
}
