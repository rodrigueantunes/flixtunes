import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChaineDirect, ClassementListe } from "@flixtunes/contracts";
import { api } from "./api";

/**
 * L'écran des chaînes en direct.
 *
 * Il ressemble volontairement au catalogue — même grille, mêmes filtres à cocher, même recherche —
 * parce que c'est la même action : parcourir beaucoup de choses pour en choisir une. Ce qui change
 * tient en trois points, et chacun vient d'un chiffre mesuré :
 *
 * - **le numéro passe avant le nom.** C'est par lui qu'on choisit une chaîne à la télécommande, et
 *   c'est aussi l'ordre naturel d'un téléviseur ;
 * - **rien n'est chargé d'avance.** Il y a 78 741 chaînes : la page se demande par tranches de
 *   soixante, comme le catalogue ;
 * - **le nombre d'adresses se voit.** Deux adresses pour une chaîne, c'est une chaîne qui a un
 *   secours ; c'est une information utile et non un détail de plomberie.
 */

const PAGE = 60;

export interface ListeChoisissable { id: string; nom: string; classement: ClassementListe; chaines: number }

/**
 * Ce que dit une pastille, en toutes lettres.
 *
 * Elle n'est pas décorative : c'est **la part des chaînes d'une liste qui répondent**, mesurée par le
 * script qui produit `m3u.json`. Le seuil est écrit à l'écran parce qu'une pastille seule ne dit rien
 * — et parce qu'un ❌ ne veut pas dire « morte », mais « une chaîne sur trois ».
 */
const FIABILITES: Array<{ classement: ClassementListe; libelle: string }> = [
  { classement: "bonne", libelle: "\u2705 75 % et plus" },
  { classement: "moyenne", libelle: "\u3030\ufe0f 50 \u00e0 74 %" },
  { classement: "faible", libelle: "\u274c 25 \u00e0 49 %" },
  { classement: "douteuse", libelle: "\u26a0\ufe0f non mesur\u00e9e" },
  { classement: "inconnue", libelle: "sans pastille" },
];

export function LiveTv({ onPlay }: { onPlay: (chaine: ChaineDirect) => void }) {
  const [saisie, setSaisie] = useState("");
  const [recherche, setRecherche] = useState("");
  const [listes, setListes] = useState<ListeChoisissable[]>([]);
  const [listesChoisies, setListesChoisies] = useState<string[]>([]);
  const [pays, setPays] = useState<Array<{ code: string; nom: string; chaines: number }>>([]);
  const [paysChoisis, setPaysChoisis] = useState<string[]>([]);
  const [fiabilites, setFiabilites] = useState<Array<{ classement: ClassementListe; listes: number }>>([]);
  const [fiabilitesChoisies, setFiabilitesChoisies] = useState<string[]>([]);
  /** Ne montrer que les chaînes retenues. Vingt sur 76 823 : c'est le vrai usage. */
  const [favorisSeuls, setFavorisSeuls] = useState(false);
  /**
   * Écarter les chaînes dont la dernière lecture a échoué.
   *
   * Retenu d'une fois sur l'autre parce que c'est une préférence, pas un filtre qu'on repose à chaque
   * visite — et retenu **ici** plutôt qu'au serveur : c'est une façon de regarder, propre à l'écran
   * qu'on a devant soi, et un aller-retour de plus au chargement ne se justifierait pas.
   */
  const [masquerMortes, setMasquerMortes] = useState(() => {
    try { return window.localStorage.getItem("flixtunes.direct.masquerMortes") === "1"; } catch { return false; }
  });
  /** La dernière chaîne regardée : un téléviseur rallume sur ce qu'on regardait. */
  const [derniere, setDerniere] = useState<ChaineDirect | null>(null);
  const [chaines, setChaines] = useState<ChaineDirect[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Filtre local du volet des listes : 535 lignes ne se parcourent pas à l'œil. */
  const [filtreListes, setFiltreListes] = useState("");
  const sentinelle = useRef<HTMLDivElement | null>(null);

  // La recherche part au serveur après une pause, pas à chaque frappe : sans ce délai, saisir
  // « canal » lancerait cinq requêtes dont quatre seraient jetées.
  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 250);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  useEffect(() => {
    void api.listesLiveClient().then(setListes).catch(() => setListes([]));
    void api.paysLive().then(setPays).catch(() => setPays([]));
    void api.fiabilitesLive().then(setFiabilites).catch(() => setFiabilites([]));
    void api.derniereChaineLive().then((reponse) => setDerniere(reponse.chaine)).catch(() => setDerniere(null));
  }, []);

  const criteres = useMemo(() => ({
    q: recherche || undefined,
    listes: listesChoisies,
    pays: paysChoisis,
    fiabilites: fiabilitesChoisies,
    favoris: favorisSeuls,
    masquerMortes,
  }), [favorisSeuls, fiabilitesChoisies, listesChoisies, masquerMortes, paysChoisis, recherche]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setErreur(null);
    api.chainesLive({ ...criteres, offset: 0, limit: PAGE })
      .then((page) => { if (annule) return; setChaines(page.items); setTotal(page.total); })
      .catch((cause) => { if (!annule) setErreur(cause instanceof Error ? cause.message : "Chaînes indisponibles"); })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [criteres]);

  const suite = useCallback(async () => {
    if (chargement || chaines.length >= total) return;
    setChargement(true);
    try {
      const page = await api.chainesLive({ ...criteres, offset: chaines.length, limit: PAGE });
      setChaines((precedentes) => {
        const vues = new Set(precedentes.map((chaine) => chaine.id));
        return [...precedentes, ...page.items.filter((chaine) => !vues.has(chaine.id))];
      });
      setTotal(page.total);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : "Chaînes indisponibles");
    } finally {
      setChargement(false);
    }
  }, [chaines.length, chargement, criteres, total]);

  useEffect(() => {
    const cible = sentinelle.current;
    if (!cible || chaines.length >= total || typeof IntersectionObserver === "undefined") return;
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((entree) => entree.isIntersecting)) void suite();
    }, { rootMargin: "600px" });
    observateur.observe(cible);
    return () => observateur.disconnect();
  }, [chaines.length, suite, total]);

  const listesVisibles = useMemo(() => {
    const cherche = filtreListes.trim().toLocaleLowerCase("fr");
    const retenues = cherche ? listes.filter((liste) => liste.nom.toLocaleLowerCase("fr").includes(cherche)) : listes;
    return { retenues: retenues.slice(0, 120), restantes: Math.max(0, retenues.length - 120) };
  }, [filtreListes, listes]);

  /**
   * L'étoile bascule tout de suite à l'écran, et se confirme ensuite.
   *
   * Attendre le serveur pour repeindre une étoile ferait clignoter la grille sur un geste qui ne
   * peut presque pas échouer. En cas de refus, on remet l'étoile comme elle était — l'inverse d'un
   * état inventé qui resterait faux.
   */
  const basculerFavori = (chaine: ChaineDirect) => {
    const voulu = !chaine.favori;
    setChaines((precedentes) => precedentes.map((autre) => autre.id === chaine.id ? { ...autre, favori: voulu } : autre));
    void api.favoriLive(chaine.id, voulu).catch(() => {
      setChaines((precedentes) => precedentes.map((autre) => autre.id === chaine.id ? { ...autre, favori: !voulu } : autre));
    });
  };

  const bascule = (valeur: string, choisis: string[], poser: (suivants: string[]) => void) => {
    poser(choisis.includes(valeur) ? choisis.filter((autre) => autre !== valeur) : [...choisis, valeur]);
  };

  const restantes = Math.max(0, total - chaines.length);

  return <section className="catalog-page" aria-labelledby="live-page-title">
    <header className="catalog-header">
      <div>
        <span className="eyebrow">En direct</span>
        <h1 id="live-page-title">Live TV</h1>
        <p>{total.toLocaleString("fr-FR")} {total > 1 ? "chaînes" : "chaîne"}{restantes > 0 && ` · ${chaines.length} affichées`}</p>
      </div>
      <div className="catalog-controls">
        <label><span>Rechercher</span>
          <input value={saisie} onChange={(event) => setSaisie(event.target.value)} placeholder="Rechercher une chaîne" />
        </label>
        {/*
          * Deux interrupteurs plutôt que deux volets : ils n'ont qu'un état, et ce sont les deux
          * qu'on actionne le plus. Les mettre dans un volet à déplier coûterait deux gestes pour un.
          */}
        <fieldset className="genre-filter">
          <legend>Affichage</legend>
          <label className="genre-choice">
            <input type="checkbox" checked={favorisSeuls} onChange={() => setFavorisSeuls((valeur) => !valeur)} />
            <span>★ Mes chaînes</span>
          </label>
          <label className="genre-choice">
            <input type="checkbox" checked={masquerMortes} onChange={() => setMasquerMortes((valeur) => {
              const suivant = !valeur;
              try { window.localStorage.setItem("flixtunes.direct.masquerMortes", suivant ? "1" : "0"); } catch { /* Un navigateur qui refuse le stockage garde le réglage pour la session. */ }
              return suivant;
            })} />
            <span>Masquer celles qui n’ont pas répondu</span>
          </label>
        </fieldset>
        {/*
          * Le pays, et c'est **le** filtre qui manquait.
          *
          * Chercher « canal » rendait 1 141 chaînes : le mot est espagnol et portugais, et tous ces
          * résultats sont justes. Aucun classement ne répare cela ; seule une autre dimension le peut.
          * Le pays se déduit du `tvg-id`, d'un drapeau ou de l'intitulé du groupe — jamais inventé :
          * une chaîne sans indice reste visible tant qu'aucun pays n'est coché.
          */}
        {pays.length > 1 && <details className="live-filtre">
          <summary>Pays{paysChoisis.length
            ? ` · ${paysChoisis.map((code) => pays.find((candidat) => candidat.code === code)?.nom ?? code).join(", ")}`
            : " · tous"}</summary>
          <div className="live-filtre-corps">
            <div className="live-filtre-choix">
              {pays.map((entree) => <label key={entree.code} className="genre-choice">
                <input type="checkbox" checked={paysChoisis.includes(entree.code)}
                  onChange={() => bascule(entree.code, paysChoisis, setPaysChoisis)} />
                <span>{entree.nom} ({entree.chaines.toLocaleString("fr-FR")})</span>
              </label>)}
            </div>
            {paysChoisis.length > 0 && <button type="button" className="genre-reset" onClick={() => setPaysChoisis([])}>Tous</button>}
          </div>
        </details>}
        {/*
          * Les listes, cochées comme des genres : mêmes puces, même geste, même boîte. Deux ajouts
          * que le catalogue n'a pas besoin de faire, et qui viennent tous deux d'un chiffre :
          * **499 listes** ne se parcourent pas à l'œil, d'où le champ de filtre, et l'effectif de
          * chacune dit laquelle vaut la peine d'être cochée.
          *
          * Cocher deux listes en **réunit** les chaînes au lieu de les croiser, à l'inverse des
          * genres : une liste est une provenance, pas une caractéristique.
          */}
        {listes.length > 1 && <details className="live-filtre">
          <summary>Listes{listesChoisies.length
            ? ` · ${listesChoisies.length} choisie${listesChoisies.length > 1 ? "s" : ""}`
            : ` · toutes (${listes.length})`}</summary>
          <div className="live-filtre-corps">
            <input aria-label="Filtrer les listes" value={filtreListes} placeholder="Filtrer les listes…"
              onChange={(event) => setFiltreListes(event.target.value)} />
            <div className="live-filtre-choix">
              {listesVisibles.retenues.map((liste) => <label key={liste.id} className="genre-choice">
                <input type="checkbox" checked={listesChoisies.includes(liste.id)}
                  onChange={() => bascule(liste.id, listesChoisies, setListesChoisies)} />
                <span>{liste.nom} ({liste.chaines.toLocaleString("fr-FR")})</span>
              </label>)}
            </div>
            {listesVisibles.restantes > 0 && <small>{listesVisibles.restantes} autres — affinez le filtre.</small>}
            {listesChoisies.length > 0 && <button type="button" className="genre-reset" onClick={() => setListesChoisies([])}>Toutes</button>}
          </div>
        </details>}
        {/*
          * La fiabilité des listes, en pourcentage de flux qui répondent.
          *
          * C'est le seul filtre des trois qui ne décrit pas le contenu mais **son état**. Il vient
          * d'une mesure faite en amont, liste par liste, et s'en tenir aux « 75 % et plus » écarte
          * d'un geste celles où une chaîne sur deux est morte.
          *
          * Une chaîne traverse parfois dix listes : il suffit qu'**une** réponde au critère.
          */}
        {fiabilites.length > 1 && <details className="live-filtre">
          <summary>Fiabilité{fiabilitesChoisies.length ? ` · ${fiabilitesChoisies.length} retenue${fiabilitesChoisies.length > 1 ? "s" : ""}` : " · toutes"}</summary>
          <div className="live-filtre-corps">
            <div className="live-filtre-choix">
              {FIABILITES.filter((bande) => fiabilites.some((mesure) => mesure.classement === bande.classement))
                .map((bande) => {
                  const listes = fiabilites.find((mesure) => mesure.classement === bande.classement)?.listes ?? 0;
                  return <label key={bande.classement} className="genre-choice">
                    <input type="checkbox" checked={fiabilitesChoisies.includes(bande.classement)}
                      onChange={() => bascule(bande.classement, fiabilitesChoisies, setFiabilitesChoisies)} />
                    <span>{bande.libelle} ({listes})</span>
                  </label>;
                })}
            </div>
            {fiabilitesChoisies.length > 0 && <button type="button" className="genre-reset" onClick={() => setFiabilitesChoisies([])}>Toutes</button>}
          </div>
        </details>}
      </div>
    </header>

    {erreur && <p className="catalog-error" role="alert">{erreur}</p>}

    {/*
      * Reprendre là où l'on s'était arrêté.
      *
      * C'est ce que fait un téléviseur qu'on rallume, et la chaîne est retenue par le serveur : on la
      * retrouve depuis le téléphone comme depuis le salon. Elle ne s'affiche que si l'on ne cherche
      * rien — au milieu d'une recherche, elle serait un résultat qui n'en est pas un.
      */}
    {derniere && !recherche && !favorisSeuls && <button type="button" className="live-reprise"
      onClick={() => onPlay(derniere)}>
      <span>Reprendre</span>
      <b>{derniere.numero != null ? `${derniere.numero} · ` : ""}{derniere.nom}</b>
    </button>}

    {chaines.length ? <>
      <div className="live-grille">
        {chaines.map((chaine) => <div key={chaine.id} className="live-carte-enveloppe">
          {/*
            * L'étoile est un bouton à part, et non un coin de la carte : cliquer une carte ouvre la
            * chaîne, et rien ne doit rendre ce geste hésitant. Elle porte son propre libellé pour
            * qui n'a que la voix.
            */}
          <button type="button" className={`live-etoile${chaine.favori ? " retenue" : ""}`}
            aria-label={chaine.favori ? `Retirer ${chaine.nom} de mes chaînes` : `Garder ${chaine.nom}`}
            aria-pressed={chaine.favori === true}
            onClick={() => basculerFavori(chaine)}>{chaine.favori ? "★" : "☆"}</button>
          <button type="button" className="live-carte" onClick={() => onPlay(chaine)}>
          <span className="live-numero">{chaine.numero ?? "—"}</span>
          {/*
            * Le logo est fourni par la liste, donc par un hébergeur quelconque : il manque une fois
            * sur trois et disparaît sans prévenir. L'initiale prend sa place plutôt qu'une image
            * cassée, et `onError` la fait aussi apparaître quand le chargement échoue en route.
            */}
          {chaine.logo
            ? <img className="live-logo" src={chaine.logo} alt="" loading="lazy" referrerPolicy="no-referrer"
                onError={(event) => { event.currentTarget.style.display = "none"; }} />
            : <span className="live-logo live-initiale" aria-hidden="true">{chaine.nom.charAt(0).toUpperCase()}</span>}
          <span className="live-nom">{chaine.nom}</span>
          <small>
            {chaine.groupe ?? "Sans bouquet"}
            {chaine.adresses > 1 ? ` · ${chaine.adresses} sources` : ""}
          </small>
          </button>
        </div>)}
      </div>
      {restantes > 0 && <div className="catalog-more" ref={sentinelle}>
        <button type="button" onClick={() => void suite()} disabled={chargement}>
          {chargement ? "Chargement…" : `Afficher ${Math.min(PAGE, restantes)} chaînes de plus`}
        </button>
        <small>{restantes.toLocaleString("fr-FR")} {restantes > 1 ? "chaînes restantes" : "chaîne restante"}</small>
      </div>}
    </> : chargement
      ? <div className="live-grille" aria-busy="true" aria-label="Chargement des chaînes">
          {Array.from({ length: 18 }, (_, rang) => <div className="catalog-skeleton live-squelette" key={rang} />)}
        </div>
      : <div className="catalog-empty">
          <h2>Aucune chaîne</h2>
          <p>{recherche || listesChoisies.length || paysChoisis.length || fiabilitesChoisies.length
            ? "Modifiez la recherche ou les filtres."
            : "Réglez une source de listes dans la configuration du serveur."}</p>
        </div>}
  </section>;
}
