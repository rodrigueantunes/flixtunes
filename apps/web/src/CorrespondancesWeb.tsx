import { useCallback, useEffect, useState } from "react";
import type { LibraryFolder } from "@flixtunes/contracts";
import { api, type CandidatWeb, type CorrespondanceWeb } from "./api";

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
  // Tout est affiche par defaut : on vient ici pour corriger, y compris ce que l'analyse croit
  // avoir bien identifie. Un ecran qui annonce « tout est identifie » ne rend aucun service.
  const [toutes, setToutes] = useState(true);
  const [choisie, setChoisie] = useState<CorrespondanceWeb | null>(null);
  const [recherche, setRecherche] = useState("");
  const [candidats, setCandidats] = useState<CandidatWeb[]>([]);
  const [motif, setMotif] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setLignes(await api.correspondancesWeb(profileId, { libraryId: library.id, toutes }));
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
  const videos = lignes.filter((ligne) => ligne.genre === "video");

  return <section className="metadata-manager" aria-labelledby="web-corr-titre">
    <header className="metadata-header">
      <div>
        <span className="eyebrow">Web</span>
        <h1 id="web-corr-titre">Correspondances — {library.name}</h1>
        <p>Les candidats viennent de la plateforme, jamais d’une base de films ou de séries.</p>
      </div>
      <button className="details-close" onClick={onClose} aria-label="Fermer">×</button>
    </header>

    <label className="genre-choice">
      <input type="checkbox" checked={toutes} onChange={(event) => setToutes(event.target.checked)} />
      Afficher aussi ce qui est déjà identifié
    </label>

    <div className="web-corr-corps">
      <div className="web-corr-liste">
        {/*
          * Les chaînes d'abord, et ce n'est pas qu'un ordre d'affichage : tant qu'une chaîne n'est pas
          * identifiée, aucune de ses vidéos ne peut l'être. La corriger débloque toute sa liste.
          */}
        {chaines.length > 0 && <h2>Chaînes</h2>}
        {chaines.map((ligne) => <button key={ligne.id} type="button"
          className={`web-corr-ligne${choisie?.id === ligne.id ? " active" : ""}`}
          onClick={() => { setChoisie(ligne); setCandidats([]); setMotif(null); setRecherche(ligne.titre); }}>
          <b>{ligne.titre}</b>
          <small>{ligne.identifiant ? "Identifiée" : "À identifier"}</small>
        </button>)}

        {videos.length > 0 && <h2>Vidéos</h2>}
        {videos.map((ligne) => <button key={ligne.id} type="button"
          className={`web-corr-ligne${choisie?.id === ligne.id ? " active" : ""}`}
          onClick={() => { setChoisie(ligne); setCandidats([]); setMotif(null); setRecherche(ligne.titre); }}>
          <b>{ligne.titre}</b>
          <small>{[ligne.chaine, ligne.publieeLe].filter(Boolean).join(" · ") || "Sans date"}</small>
        </button>)}

        {!lignes.length && <p className="live-vide">
          {toutes ? "Cette bibliothèque ne contient encore aucune fiche." : "Tout est identifié."}
        </p>}
      </div>

      <div className="web-corr-detail">
        {!choisie && <p className="live-vide">Choisissez une chaîne ou une vidéo à corriger.</p>}
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
      </div>
    </div>
  </section>;
}
