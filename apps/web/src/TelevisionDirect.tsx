import { useEffect, useMemo, useRef, useState } from "react";
import type { EtatDirect, ListeDirect, ParametresDirect, SourceDirect } from "@flixtunes/contracts";
import { api } from "./api";
import { FolderBrowser } from "./FolderBrowser";

/**
 * Le réglage de la télévision en direct, dans l'écran de configuration du serveur.
 *
 * Il est ici et non dans un écran à part parce que c'est ici qu'on vient dire au serveur **où
 * chercher** : les bibliothèques désignent des dossiers de films, celui-ci désigne un fichier de
 * listes. Le geste est le même, et le sélecteur de dossier aussi.
 *
 * Ce que l'écran doit rendre évident, dans cet ordre :
 *
 * 1. **la fonction est éteinte**, et le rester ne coûte rien ;
 * 2. **ce qu'elle a trouvé** — des chiffres, pas une barre qui tourne ;
 * 3. **ce qui n'a pas répondu**, pour qu'une liste morte se dise au lieu de se deviner.
 *
 * Ce qu'il ne fait **pas** : choisir les listes qu'on regarde. Ce choix a quitté la configuration pour
 * devenir un filtre de l'écran Live TV, repliable comme les genres du catalogue — on choisit ce qu'on
 * regarde au moment de regarder.
 */

/**
 * Ce que mesure chaque pastille : la part des flux d'une liste qui répondent, relevée par le script
 * qui produit `m3u.json`. Le seuil est écrit plutôt que sous-entendu — un ❌ n'est pas une liste
 * morte, c'est une liste sur trois chaînes utiles.
 */
const CLASSEMENTS: Record<ListeDirect["classement"], { libelle: string; pastille: string }> = {
  bonne: { libelle: "75 % des flux répondent ou plus", pastille: "✅" },
  moyenne: { libelle: "50 à 74 % des flux répondent", pastille: "〰️" },
  faible: { libelle: "25 à 49 % des flux répondent", pastille: "❌" },
  douteuse: { libelle: "Part non mesurée", pastille: "⚠️" },
  inconnue: { libelle: "Sans pastille", pastille: "·" },
};

function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}

/**
 * Séparer un chemin complet en dossier et fichier, sans savoir sur quel système il vit.
 *
 * Le serveur peut tourner sous Windows comme sur le NAS : le séparateur n'est pas le même, et le
 * navigateur n'a aucun moyen de le deviner. On coupe donc au dernier séparateur, quel qu'il soit.
 */
function dossierDe(chemin: string): string {
  const coupe = Math.max(chemin.lastIndexOf("/"), chemin.lastIndexOf("\\"));
  return coupe > 0 ? chemin.slice(0, coupe) : "";
}

function fichierDe(chemin: string): string {
  const coupe = Math.max(chemin.lastIndexOf("/"), chemin.lastIndexOf("\\"));
  return coupe >= 0 ? chemin.slice(coupe + 1) : chemin;
}

function joindre(dossier: string, fichier: string): string {
  const separateur = dossier.includes("\\") && !dossier.includes("/") ? "\\" : "/";
  return `${dossier.replace(/[\/]+$/, "")}${separateur}${fichier}`;
}

export function TelevisionDirect() {
  const [parametres, setParametres] = useState<ParametresDirect | null>(null);
  const [etat, setEtat] = useState<EtatDirect | null>(null);
  const [listes, setListes] = useState<ListeDirect[]>([]);
  const [sources, setSources] = useState<SourceDirect[]>([]);
  const [hote, setHote] = useState("");
  const [utilisateur, setUtilisateur] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [chemin, setChemin] = useState("");
  const [parcourt, setParcourt] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  /**
   * Les champs ne sont repris du serveur qu'une fois.
   *
   * Le sondage d'avancement rejoue cette lecture toutes les deux secondes : sans ce garde-fou, un
   * chemin en cours de saisie serait réécrit sous les doigts à chaque tour.
   */
  const champsRemplis = useRef(false);

  const charger = async () => {
    const [reponse, prochaines, prochainesSources] = await Promise.all([
      api.live(), api.listesLive().catch(() => []), api.sourcesLive().catch(() => []),
    ]);
    setParametres(reponse.parametres);
    setEtat(reponse.etat);
    setListes(prochaines);
    setSources(prochainesSources);
    if (!champsRemplis.current) {
      setChemin(reponse.parametres.dossier ? joindre(reponse.parametres.dossier, reponse.parametres.fichier) : "");
      champsRemplis.current = true;
    }
  };

  useEffect(() => {
    void charger().catch(() => setErreur("État de la télévision en direct indisponible"));
  }, []);

  /**
   * On ne sonde que pendant un rafraîchissement.
   *
   * Une horloge qui tourne en permanence sur un écran de configuration interroge le NAS pour rien
   * des heures durant. Ici, il n'y a quelque chose à voir qu'entre le départ de la passe et sa fin.
   */
  useEffect(() => {
    if (!etat?.enCours) return;
    const horloge = window.setInterval(() => void charger().catch(() => undefined), 2000);
    return () => window.clearInterval(horloge);
  }, [etat?.enCours]);

  /** Le champ porte un chemin complet ; le serveur, lui, garde le dossier et le nom séparés. */
  const enregistrerChemin = (valeur: string) => {
    const propre = valeur.trim();
    return api.enregistrerLive(propre
      ? { dossier: dossierDe(propre), fichier: fichierDe(propre) }
      : { dossier: null });
  };

  const agir = async (action: () => Promise<unknown>, reussite?: string) => {
    setOccupe(true);
    setErreur(null);
    setMessage(null);
    try {
      await action();
      await charger();
      if (reussite) setMessage(reussite);
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : "Action impossible");
    } finally {
      setOccupe(false);
    }
  };

  /** Une liste qui n'a pas répondu porte un message : c'est le seul cas qui mérite d'être montré ici. */
  const muettes = useMemo(() => listes.filter((liste) => liste.dernierMessage), [listes]);

  if (!parametres || !etat) return null;

  return (
    <section className="expert-controls" aria-labelledby="live-title">
      <div className="scan-center-heading">
        <div><span className="eyebrow">Télévision en direct</span><h3 id="live-title">Chaînes en direct</h3></div>
        <small>{etat.configure ? `${nombre(etat.chaines)} chaîne${etat.chaines > 1 ? "s" : ""}` : "Aucune source réglée"}</small>
      </div>

      {/*
        * L'interrupteur porte l'état, pas l'action — comme celui des génériques, et pour la même
        * raison : au milieu de boutons qui lancent des travaux, « activer » et « exécuter » ne se
        * distingueraient plus. Éteinte, la fonction ne télécharge rien et n'apparaît nulle part chez
        * les clients.
        */}
      <div className="scan-launchers">
        <button className={`scan-toggle-launcher${parametres.actif ? " actif" : ""}`}
          disabled={occupe} aria-pressed={parametres.actif}
          title={parametres.actif
            ? "Les listes sont relues au démarrage et sur demande. La désactiver arrête la passe en cours."
            : "Éteinte, elle ne télécharge rien et n'apparaît pas dans les clients."}
          onClick={() => void agir(() => api.enregistrerLive({ actif: !parametres.actif }))}>
          {parametres.actif ? "📡 Direct : activé" : "📡 Direct : désactivé"}
        </button>
        <button className="primary" disabled={occupe || !parametres.actif || !etat.configure || etat.enCours}
          onClick={() => void agir(() => api.rafraichirLive(), "Rafraîchissement lancé.")}>
          ↻ Relire les listes
        </button>
        {etat.enCours && <button disabled={occupe} onClick={() => void agir(() => api.arreterLive())}>Arrêter</button>}
      </div>

      {/*
        * Un seul champ : le chemin **du fichier**, choisi comme on choisit un dossier de films.
        *
        * Il y en avait deux — le dossier, puis le nom du fichier à taper. Choisir le dossier dans une
        * fenêtre de parcours puis saisir « m3u.json » à la main revenait à faire à moitié le travail
        * que cette fenêtre existe pour faire. Elle descend maintenant jusqu'au fichier.
        */}
      <div className="expert-actions">
        <label className="wide-field"><span>Fichier des listes, sur le serveur</span>
          <div className="path-input-row">
            <input value={chemin} onChange={(event) => setChemin(event.target.value)}
              placeholder="/volume1/Multimédia/TV/m3u.json" />
            <button type="button" onClick={() => setParcourt(true)}>Parcourir le serveur</button>
          </div>
        </label>
        <button disabled={occupe} onClick={() => void agir(() => enregistrerChemin(chemin), "Emplacement enregistré.")}>
          Enregistrer l’emplacement
        </button>
      </div>
      <p className="safe-note">
        Un objet JSON « nom de liste » : « adresse », comme celui de TvPourTous. FlixTunes le lit sans
        jamais le modifier.
      </p>

      {/*
        * Les fournisseurs, et pourquoi ils tiennent en si peu de place.
        *
        * Les trois sortes se ramènent à la même chose — des adresses M3U — et rien de ce qui suit ne
        * les distingue : téléchargement, fusion, numérotation, tout est commun. Un portail Xtream
        * expose bien une API JSON, mais il expose aussi le même bouquet au format M3U : passer par là
        * évite d'écrire un second analyseur qui finirait par diverger du premier.
        */}
      <div className="scan-center-heading">
        <div><h4>Fournisseurs</h4></div>
        <small>{sources.length ? `${sources.length} réglé${sources.length > 1 ? "s" : ""}` : "Aucun"}</small>
      </div>
      {sources.length > 0 && <ul className="live-liste-choix">
        {sources.map((source) => (
          <li key={source.id}><label>
            <span className="live-classement">{source.type === "xtream" ? "🔑" : source.type === "fast" ? "🎁" : "📄"}</span>
            <b>{source.libelle}</b>
            <small>
              {source.dernierMessage ?? source.emplacement}
              {source.type !== "m3u" && (
                <button type="button" className="genre-reset"
                  onClick={() => void agir(() => api.retirerSourceLive(source.id), "Fournisseur retiré.")}>Retirer</button>
              )}
            </small>
          </label></li>
        ))}
      </ul>}

      <div className="expert-actions">
        <label><span>Portail (hôte)</span>
          <input value={hote} onChange={(event) => setHote(event.target.value)} placeholder="http://portail.exemple:8080" />
        </label>
        <label><span>Identifiant</span>
          <input value={utilisateur} onChange={(event) => setUtilisateur(event.target.value)} autoComplete="off" />
        </label>
        <label><span>Mot de passe</span>
          {/*
            * Il part chiffré au repos, par le même mécanisme que les jetons TMDB, et n'est jamais
            * réaffiché. Le champ se vide dès qu'il est enregistré.
            */}
          <input type="password" value={motDePasse} onChange={(event) => setMotDePasse(event.target.value)} autoComplete="new-password" />
        </label>
        <button disabled={occupe || !hote.trim() || !utilisateur.trim() || !motDePasse}
          onClick={() => void agir(async () => {
            await api.ajouterXtream(hote.trim(), utilisateur.trim(), motDePasse);
            setMotDePasse("");
          }, "Portail enregistré.")}>
          Ajouter un portail
        </button>
        <button disabled={occupe || sources.some((source) => source.type === "fast")}
          onClick={() => void agir(() => api.activerFast(), "Chaînes gratuites ajoutées.")}>
          Ajouter les chaînes gratuites
        </button>
      </div>

      {etat.enCours && etat.progression && <div className="scan-progress">
        <span><i style={{ width: `${Math.round(etat.progression.faites * 100 / Math.max(1, etat.progression.total))}%` }} /></span>
        <small>
          {etat.progression.faites} liste{etat.progression.faites > 1 ? "s" : ""} sur {etat.progression.total}
          {etat.progression.liste ? ` · ${etat.progression.liste}` : ""}
          {etat.progression.entrees > 0 ? ` · ${nombre(etat.progression.entrees)} entrées lues` : ""}
        </small>
      </div>}

      {/*
        * Des chiffres plutôt qu'un « c'est prêt ».
        *
        * « Doublons fusionnés » est celui qui surprend et qu'il faut donc montrer : sur le corpus de
        * référence, il vaut 57 % des entrées lues. Chacun de ces doublons est une adresse de secours,
        * pas une ligne perdue.
        */}
      {etat.rafraichieLe && <dl className="live-bilan">
        <div><dt>Listes</dt><dd>{nombre(etat.listes)}</dd></div>
        <div><dt>Chaînes</dt><dd>{nombre(etat.chaines)}</dd></div>
        <div><dt>Adresses</dt><dd>{nombre(etat.adresses)}</dd></div>
        <div><dt>Doublons fusionnés</dt><dd>{nombre(etat.fusionnees)}</dd></div>
        <div><dt>Entrées écartées</dt><dd>{nombre(etat.ecartees)}</dd></div>
        {etat.dureeSecondes != null && <div><dt>Durée</dt><dd>{etat.dureeSecondes.toLocaleString("fr-FR")} s</dd></div>}
      </dl>}
      {etat.dernierMessage && <small className="probe-detail">{etat.dernierMessage}</small>}

      {/*
        * Les listes qui n'ont pas répondu, et **seulement** celles-là.
        *
        * Le choix des listes n'est plus ici : il est devenu un filtre de l'écran Live TV, repliable
        * comme les genres du catalogue — on choisit ce qu'on regarde au moment de regarder, pas dans
        * la configuration du serveur. Ce qui reste ici est un diagnostic : une liste morte se dit,
        * sinon on cherche pourquoi une chaîne a disparu sans jamais trouver.
        */}
      {muettes.length > 0 && <div className="live-listes">
        <div className="scan-center-heading">
          <div><h4>Listes sans réponse</h4></div>
          <small>{nombre(muettes.length)} sur {nombre(listes.length)}</small>
        </div>
        <ul className="live-liste-choix">
          {muettes.slice(0, 60).map((liste) => (
            <li key={liste.id}><label>
              <span className="live-classement" title={CLASSEMENTS[liste.classement].libelle}>{CLASSEMENTS[liste.classement].pastille}</span>
              <b>{liste.nom}</b>
              <small>{liste.dernierMessage}</small>
            </label></li>
          ))}
        </ul>
        {muettes.length > 60 && <small className="probe-detail">{nombre(muettes.length - 60)} autre(s).</small>}
      </div>}

      {message && <p className="form-success">{message}</p>}
      {erreur && <p className="form-error">{erreur}</p>}

      {parcourt && <FolderBrowser initialPath={dossierDe(chemin) || undefined} fichiers={["json", "m3u"]}
        onClose={() => setParcourt(false)}
        onSelect={(choisi) => { setChemin(choisi); setParcourt(false); void agir(() => enregistrerChemin(choisi), "Emplacement enregistré."); }} />}
    </section>
  );
}
