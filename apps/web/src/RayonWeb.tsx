import { useEffect, useMemo, useState } from "react";
import type { MediaDetails, MediaItem, SeasonDetails } from "@flixtunes/contracts";
import { api } from "./api";
import { Icon } from "./App";

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
  const [echouee, setEchouee] = useState(false);
  if (!url || echouee) {
    return <span className={`${classe} web-initiale`} aria-hidden="true">{nom.charAt(0).toUpperCase()}</span>;
  }
  return <img className={classe} src={url} alt="" loading="lazy" referrerPolicy="no-referrer"
    onError={() => setEchouee(true)} />;
}

export function RayonWeb({ profileId, onPlay }: { profileId: string; onPlay: (item: MediaItem) => void }) {
  const [chaines, setChaines] = useState<MediaItem[]>([]);
  const [chaine, setChaine] = useState<MediaItem | null>(null);
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [chemin, setChemin] = useState<string[]>([]);
  const [tri, setTri] = useState<TriWeb>("recent");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    api.catalogPage(profileId, { kind: "web", limit: 200 })
      .then((page) => { if (vivant) { setChaines(page.items); setErreur(null); } })
      .catch(() => { if (vivant) setErreur("Le rayon Web n'a pas pu être chargé."); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [profileId]);

  useEffect(() => {
    if (!chaine?.catalogId) { setDetails(null); return; }
    let vivant = true;
    setChargement(true);
    api.details(chaine.catalogId, profileId)
      .then((fiche) => { if (vivant) { setDetails(fiche); setErreur(null); } })
      .catch(() => { if (vivant) setErreur("Cette chaîne n'a pas pu être ouverte."); })
      .finally(() => { if (vivant) setChargement(false); });
    return () => { vivant = false; };
  }, [chaine?.catalogId, profileId]);

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
    return { dossiers, videos: trier(videos, tri), compte };
  }, [details, chemin, tri]);

  if (!chaine) {
    return <section className="catalog-page" aria-labelledby="web-titre">
      <header className="catalog-header">
        <div><span className="eyebrow">Vos chaînes</span><h1 id="web-titre">Web</h1>
          <p>{chaines.length} {chaines.length > 1 ? "chaînes" : "chaîne"}</p></div>
      </header>
      {erreur && <p className="live-vide">{erreur}</p>}
      {!erreur && !chargement && !chaines.length
        && <p className="live-vide">Aucune chaîne pour l'instant. Déclarez un dossier Web et lancez une analyse.</p>}
      <div className="web-grille web-grille-chaines">
        {chaines.map((item) => <button key={item.id} type="button" className="web-carte web-carte-chaine"
          onClick={() => { setChaine(item); setChemin([]); }}>
          <Vignette url={item.posterUrl} nom={item.showTitle ?? item.title} classe="web-portrait" />
          <span className="web-nom">{item.showTitle ?? item.title}</span>
        </button>)}
      </div>
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

    {niveau.dossiers.length > 0 && <div className="web-grille web-grille-dossiers">
      {niveau.dossiers.map((dossier) => <button key={dossier} type="button" className="web-carte web-carte-dossier"
        onClick={() => setChemin([...chemin, dossier])}>
        <span className="web-dossier-icone" aria-hidden="true"><Icon name="folder" /></span>
        <span className="web-nom">{dossier}</span>
        <small>{niveau.compte(dossier)} {niveau.compte(dossier) > 1 ? "vidéos" : "vidéo"}</small>
      </button>)}
    </div>}

    {niveau.videos.length > 0 && <div className="web-grille web-grille-videos">
      {niveau.videos.map((video) => <button key={video.id} type="button" className="web-carte web-carte-video"
        disabled={!video.playableMediaId}
        onClick={() => video.playableMediaId && onPlay({ ...video, id: video.playableMediaId })}>
        <Vignette url={video.posterUrl ?? video.backdropUrl} nom={video.title} classe="web-paysage" />
        <span className="web-nom">{video.title}</span>
        {/* La date sous le titre : c'est le critère de tri, il doit se lire sans ouvrir la fiche. */}
        <small className="web-date">{dateLisible(video)}</small>
        {video.progressPercent > 0 && <i className="web-progression"><i style={{ width: `${video.progressPercent}%` }} /></i>}
      </button>)}
    </div>}

    {!chargement && !niveau.dossiers.length && !niveau.videos.length
      && <p className="live-vide">Ce dossier ne contient aucune vidéo.</p>}
  </section>;
}
