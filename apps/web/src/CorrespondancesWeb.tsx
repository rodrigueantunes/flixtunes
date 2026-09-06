import { useCallback, useEffect, useState } from "react";
import type { LibraryFolder } from "@flixtunes/contracts";
import { api, type BudgetWeb, type CandidatWeb, type CorrespondanceWeb } from "./api";

/**
 * Les correspondances d'une bibliothèque web.
 *
 * Un écran à part, et non une variante de celui des films — c'est le sujet, pas un détail
 * d'organisation. Les candidats viennent de la plateforme, jamais de TMDB ni de TVDB : une chaîne
 * YouTube s'y était retrouvée présentée comme « Série · 2023 », avec des propositions issues de
 * bases de séries. Aucun code n'est partagé entre les deux écrans, donc aucune passerelle possible.
 *
 * L'ordre de résolution est celui du rangement, ici comme à l'analyse : la **chaîne** d'abord, la
 * vidéo ensuite et **dans cette chaîne-là**. Une vidéo dont la chaîne n'est pas identifiée n'a donc
 * aucun candidat, et l'écran le dit — corriger la chaîne débloque toutes ses vidéos d'un coup.
 */
export function CorrespondancesWeb({ library, profileId, onClose, onChanged }: {
  library: LibraryFolder;
  profileId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [lignes, setLignes] = useState<CorrespondanceWeb[]>([]);
  const [budget, setBudget] = useState<BudgetWeb | null>(null);
  // Decochee par defaut, comme pour les films et les series : on vient d'abord reparer ce qui manque.
  // La case reste a portee pour retrouver une fiche deja appariee et la corriger quand meme.
  const [toutes, setToutes] = useState(false);
  const [choisie, setChoisie] = useState<CorrespondanceWeb | null>(null);
  const [recherche, setRecherche] = useState("");
  const [candidats, setCandidats] = useState<CandidatWeb[]>([]);
  const [motif, setMotif] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      const reponse = await api.correspondancesWeb(profileId, { libraryId: library.id, toutes });
      setLignes(reponse.lignes);
      setBudget(reponse.budget);
      setMotif(null);
    } catch (cause) {
      setMotif(cause instanceof Error ? cause.message : "Liste indisponible.");
    }
  }, [library.id, profileId, toutes]);

  useEffect(() => { void charger(); }, [charger]);

  async function chercher(cible: CorrespondanceWeb, terme?: string) {
    setOccupe(true);
    try {
      const reponse = await api.candidatsWeb(profileId, cible.id, terme);
      setCandidats(reponse.candidats);
      setMotif(reponse.motif);
    } catch (cause) {
      setMotif(cause instanceof Error ? cause.message : "Recherche impossible.");
    } finally {
      setOccupe(false);
    }
  }

  async function appliquer(cible: CorrespondanceWeb, identifiant: string) {
    setOccupe(true);
    try {
      const reponse = await api.corrigerWeb(profileId, cible.id, identifiant);
      setMotif(reponse.message);
      setCandidats([]);
      setSaisie("");
      await charger();
      onChanged();
    } catch (cause) {
      setMotif(cause instanceof Error ? cause.message : "Correction refusée.");
    } finally {
      setOccupe(false);
    }
  }

  const chaines = lignes.filter((ligne) => ligne.genre === "chaine");
  /*
   * Les vidéos montrées sont **celles de la chaîne choisie**, et rien d'autre.
   *
   * Toutes les vidéos de la bibliothèque défilaient ensemble, chaînes mélangées : sur une centaine de
   * fichiers c'est déjà illisible, et corriger une vidéo suppose de savoir de quelle chaîne elle
   * vient — c'est même la condition pour qu'on puisse la chercher. Tant qu'aucune chaîne n'est
   * choisie, on ne montre que les chaînes.
   */
  const chaineRetenue = choisie?.chaineId ?? null;
  const nomChaine = chaines.find((ligne) => ligne.id === chaineRetenue)?.titre ?? choisie?.chaine ?? null;
  const videos = lignes.filter((ligne) => ligne.genre === "video" && ligne.chaineId === chaineRetenue);

  return <section className="library-modal metadata-modal" role="dialog" aria-modal="true"
    aria-labelledby="web-corr-titre">
    {/*
      * Le meme cadre que l'ecran du catalogue : bandeau, titre, bouton de retour, corps a deux
      * colonnes. Ce qui distingue les deux ecrans est d'ou viennent les candidats, pas leur aspect —
      * et une fenetre qui ne ressemble pas au reste de l'application se remarque immediatement.
      */}
    <header>
      <div>
        <span className="eyebrow">{library.name}</span>
        <h2 id="web-corr-titre">Correspondances</h2>
        <p className="web-corr-note">Les candidats viennent de la plateforme, jamais d’une base de films ou de séries.</p>
        {/*
          * Le budget, avant toute dépense.
          *
          * Une recherche coûte cent unités sur les 9 000 d'une journée. Le montrer évite le pire des
          * messages : « aucune chaîne trouvée » là où la chaîne existe et où c'est le budget qui
          * manquait — ce qui envoie chercher le défaut là où il n'est pas.
          */}
        {budget && <p className={budget.reste < 100 ? "web-budget epuise" : "web-budget"}>
          Budget YouTube : {budget.reste} unités restantes sur {budget.plafond}
          {budget.reste < 100 && " — une recherche en coûte 100, elle ne partira pas avant 9 h."}
        </p>}
      </div>
      <button className="close-button" onClick={onClose} aria-label="Retour">×</button>
    </header>

    <div className="metadata-layout">
      <aside className="catalog-picker">
        <label className="genre-choice">
          <input type="checkbox" checked={toutes} onChange={(event) => setToutes(event.target.checked)} />
          Afficher aussi ce qui est déjà identifié
        </label>
        <div className="catalog-picker-list web-corr-liste">
        {/*
          * Les chaînes d'abord, et ce n'est pas qu'un ordre d'affichage : tant qu'une chaîne n'est pas
          * identifiée, aucune de ses vidéos ne peut l'être. La corriger débloque toute sa liste.
          */}
        {chaines.length > 0 && <h2>Chaînes</h2>}
        {chaines.map((ligne) => <button key={ligne.id} type="button"
          className={`web-corr-ligne${choisie?.id === ligne.id ? " selected" : ""}`}
          onClick={() => { setChoisie(ligne); setCandidats([]); setMotif(null); setRecherche(ligne.titre); }}>
          <b>{ligne.titre}</b>
          <small>{ligne.identifiant ? "Identifiée" : "À identifier"}</small>
        </button>)}

        {chaineRetenue && <h2>Vidéos{nomChaine ? ` de ${nomChaine}` : ""}</h2>}
        {videos.map((ligne) => <button key={ligne.id} type="button"
          className={`web-corr-ligne${choisie?.id === ligne.id ? " selected" : ""}`}
          onClick={() => { setChoisie(ligne); setCandidats([]); setMotif(null); setRecherche(ligne.titre); }}>
          <b>{ligne.titre}</b>
          <small>{ligne.publieeLe ?? "Sans date"}</small>
        </button>)}

        {!lignes.length && <p className="muted">
          {toutes ? "Cette bibliothèque ne contient encore aucune fiche." : "Aucune correspondance à revoir."}
        </p>}
        {/* Choisir une chaine est le premier geste : sans elle, ses videos ne peuvent pas etre cherchees. */}
        {lignes.length > 0 && !chaineRetenue
          && <p className="muted">Choisissez une chaîne pour voir ses vidéos.</p>}
        </div>
      </aside>

      <main className="match-workspace">
        {!choisie && <p className="muted">Choisissez une chaîne ou une vidéo à corriger.</p>}
        {choisie && <>
          <span className="eyebrow">{choisie.genre === "chaine" ? "Chaîne" : "Vidéo"}</span>
          <h2>{choisie.titre}</h2>
          {/*
            * Ce qu'on sait déjà, montré sans rien demander à personne.
            *
            * Chercher coûte **cent unités de quota** sur les 9 000 d'une journée. Lancer une recherche
            * à chaque sélection viderait le budget en parcourant la liste — une seule analyse d'une
            * centaine de vidéos en a déjà consommé 8 901. L'écran montre donc l'état, et ne dépense
            * que sur un geste explicite.
            */}
          <dl className="web-corr-etat">
            <div><dt>Identifiant</dt><dd>{choisie.identifiant ?? "aucun"}</dd></div>
            <div><dt>Date</dt><dd>{choisie.publieeLe ?? "inconnue"}</dd></div>
            <div><dt>Vignette</dt><dd>{choisie.posterUrl ? "enregistrée" : "aucune"}</dd></div>
            <div><dt>État</dt><dd>{choisie.verrouillee ? "corrigée à la main" : choisie.statut}</dd></div>
          </dl>
          <div className="web-correction-ligne">
            <input value={recherche} onChange={(event) => setRecherche(event.target.value)}
              aria-label="Terme de recherche"
              placeholder={choisie.genre === "chaine" ? "Nom de la chaîne" : "Titre de la vidéo"} />
            <button type="button" className="secondary" disabled={occupe}
              onClick={() => void chercher(choisie, recherche || undefined)}>Chercher (100 unités)</button>
          </div>

          {candidats.map((candidat) => <button key={candidat.identifiant ?? candidat.url} type="button"
            className="web-candidat" disabled={occupe || !candidat.identifiant}
            onClick={() => candidat.identifiant && void appliquer(choisie, candidat.identifiant)}>
            <b>{candidat.titre ?? candidat.identifiant}</b>
            <small>{[candidat.chaine, candidat.publieeLe].filter(Boolean).join(" · ")}</small>
          </button>)}

          <div className="web-correction-ligne">
            {/* Coller l'adresse est souvent le plus rapide : on vient de la vérifier dans un onglet. */}
            <input value={saisie} onChange={(event) => setSaisie(event.target.value)}
              aria-label="Identifiant ou adresse"
              placeholder="…ou coller l’adresse YouTube ou l’identifiant" />
            <button type="button" className="primary" disabled={occupe || !saisie.trim()}
              onClick={() => void appliquer(choisie, saisie.trim())}>Appliquer</button>
          </div>
        </>}
        {motif && <p className="web-correction-motif" role="status">{motif}</p>}
      </main>
    </div>
  </section>;
}
