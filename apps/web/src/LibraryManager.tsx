import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { LibraryFolder, LibraryInput, LibraryKind, MetadataLanguage, ScanJob, ScanMode, ScanScope } from "@flixtunes/contracts";
import { api, type EtatGeneriques } from "./api";
import { MetadataManager } from "./MetadataManager";
import { CorrespondancesWeb } from "./CorrespondancesWeb";
import { FolderBrowser } from "./FolderBrowser";
import { ProviderSetup } from "./ProviderSetup";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TelevisionDirect } from "./TelevisionDirect";

const kindLabels: Record<LibraryKind, string> = {
  auto: "Détection automatique",
  movie: "Films",
  tv: "Séries TV",
  other: "Autre",
  web: "Web",
};

function statusLabel(library: LibraryFolder): string {
  switch (library.scan.status) {
    case "queued": return "En attente";
    case "running": return library.scan.mode === "metadata" ? "Actualisation des métadonnées" : "Analyse des fichiers";
    case "failed": return "Analyse échouée";
    case "completed": return "À jour";
    default: return "Jamais analysée";
  }
}

export function LibraryManager({ onClose, onChanged, profileId }: {
  onClose: () => void;
  onChanged: () => void;
  /** Requis par l'écran des correspondances web, dont les routes travaillent pour un profil. */
  profileId?: string;
}) {
  const [libraries, setLibraries] = useState<LibraryFolder[]>([]);
  const [form, setForm] = useState<LibraryInput>({ name: "", path: "", kind: "movie", language: "fr-FR", organizeSeasons: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadataLibrary, setMetadataLibrary] = useState<LibraryFolder | null>(null);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [generiques, setGeneriques] = useState<EtatGeneriques | null>(null);
  const [basculeEnCours, setBasculeEnCours] = useState(false);

  /*
   * Activer ou désactiver le repérage des génériques.
   *
   * La réponse du serveur porte l'état complet : on l'affiche tel quel plutôt que de deviner, pour
   * qu'un refus ou une passe qui s'arrête se voient tout de suite.
   */
  const basculerGeneriques = async (actif: boolean) => {
    setBasculeEnCours(true);
    try { setGeneriques(await api.activerGeneriques(actif)); }
    catch { /* Le sondage suivant rétablira l'affichage. */ }
    finally { setBasculeEnCours(false); }
  };

  /*
   * Arrêter la passe sans désactiver le repérage : « pas maintenant » plutôt que « jamais ».
   * La prochaine analyse reprendra là où le travail en est.
   */
  /*
   * Reprendre le repérage sur ce qui manque, et rien d'autre.
   *
   * Sans ce bouton, relancer une passe demandait soit d'éteindre puis rallumer le repérage — un
   * réglage détourné en action —, soit d'attendre la fin d'une analyse de bibliothèque, donc d'en
   * relancer une : reparcourir des milliers de fichiers pour quelques saisons.
   */
  const reprendreGeneriques = async () => {
    setBasculeEnCours(true);
    try { setGeneriques(await api.reprendreGeneriques()); }
    catch { /* Le sondage suivant rétablira l'affichage. */ }
    finally { setBasculeEnCours(false); }
  };

  const arreterGeneriques = async () => {
    setBasculeEnCours(true);
    try { setGeneriques(await api.arreterGeneriques()); }
    catch { /* Le sondage suivant rétablira l'affichage. */ }
    finally { setBasculeEnCours(false); }
  };
  const [browsing, setBrowsing] = useState(false);

  const load = async () => {
    const [next, nextJobs, prochainsGeneriques] = await Promise.all([
      api.libraries(), api.scans(30),
      // Le repérage des génériques ne dépend d'aucune bibliothèque : il ne peut pas figurer parmi les
      // analyses, mais il s'affiche au même endroit — c'est là qu'on vient voir où en est la mise à jour.
      api.generiques().catch(() => null),
    ]);
    setLibraries(next);
    setJobs(nextJobs);
    setGeneriques(prochainsGeneriques);
    setLoading(false);
    return next;
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 1500);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.addLibrary(form);
      setForm({ name: "", path: "", kind: "movie", language: form.language, organizeSeasons: false });
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ajout impossible");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await api.removeLibrary(id);
    await load();
    onChanged();
  }

  async function startScan(library: LibraryFolder, mode: "files" | "metadata") {
    setError(null);
    try {
      if (mode === "files") await api.scanLibrary(library.id);
      else await api.refreshLibraryMetadata(library.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analyse impossible");
    }
  }

  async function changeLibraryLanguage(library: LibraryFolder, language: MetadataLanguage) {
    setError(null);
    try {
      await api.updateLibraryLocalization(library.id, { language });
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Changement de langue impossible");
    }
  }

  async function startScope(scope: Exclude<ScanScope, "library">, mode: ScanMode) {
    setError(null);
    try {
      await api.startScan({ scope, mode, priority: 60 });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analyse impossible");
    }
  }

  async function updateJob(job: ScanJob, action: "cancel" | "retry") {
    setError(null);
    try {
      if (action === "cancel") await api.cancelScan(job.id);
      else await api.retryScan(job.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action impossible");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {/*
        * Deuxieme porte vers l'ecran des correspondances, et elle avait ete oubliee.
        *
        * Celle de l'accueil aiguillait deja sur le type de la bibliotheque ; celle-ci non, si bien
        * qu'une bibliotheque web ouvrait l'ecran du catalogue et s'y voyait proposer TMDB et TVDB.
        */}
      {metadataLibrary ? (metadataLibrary.kind === "web" && profileId
        ? <CorrespondancesWeb library={metadataLibrary} profileId={profileId}
          onClose={() => setMetadataLibrary(null)} onChanged={onChanged} />
        : <MetadataManager library={metadataLibrary} onClose={() => setMetadataLibrary(null)} onChanged={onChanged} />) :
      <section className="library-modal" role="dialog" aria-modal="true" aria-labelledby="libraries-title">
        <header>
          <div><span className="eyebrow">Configuration du serveur</span><h2 id="libraries-title">Bibliothèques</h2></div>
          <button className="close-button" onClick={onClose} aria-label="Fermer">×</button>
        </header>

        <ProviderSetup />
        <DiagnosticsPanel />
        <TelevisionDirect />

        <section className="scan-center" aria-labelledby="scan-center-title">
          <div className="scan-center-heading">
            <div><span className="eyebrow">Centre d’analyse</span><h3 id="scan-center-title">Rechercher les nouveautés</h3></div>
            <small>Analyse incrémentale · 2 bibliothèques en parallèle</small>
          </div>
          <div className="scan-launchers">
            <button className="primary" onClick={() => void startScope("all", "files")}>↻ Tout analyser</button>
            <button onClick={() => void startScope("movie", "files")}>Films uniquement</button>
            <button onClick={() => void startScope("tv", "files")}>Séries uniquement</button>
            <button onClick={() => void startScope("all", "metadata")}>✦ Métadonnées</button>
            {/*
              * L'interrupteur du repérage, parmi les lanceurs.
              *
              * Le repérage décode des heures durant sur un Celeron à quatre cœurs : une fonction qui
              * coûte cela s'active, elle ne s'impose pas. Le réglage vit en base — il tient donc après
              * un redémarrage — et le désactiver arrête la passe en cours au lieu d'attendre sa fin.
              *
              * Le libellé porte l'état, pas l'action : c'est un interrupteur au milieu de boutons qui
              * lancent des analyses, et rien ne distinguerait autrement « activer » d'« exécuter ». La
              * couleur ne fait que redire ce que le mot dit déjà.
              */}
            {generiques && <button className={`scan-toggle-launcher${generiques.actif ? " actif" : ""}`}
              disabled={basculeEnCours} aria-pressed={generiques.actif}
              title={generiques.actif
                ? "Le repérage écoute les épisodes après chaque analyse. Le désactiver arrête la passe en cours."
                : "Écoute les épisodes pour placer les repères de générique. Coûteux : plusieurs heures de machine."}
              onClick={() => void basculerGeneriques(!generiques.actif)}>
              {generiques.actif ? "♪ Génériques : activé" : "♪ Génériques : désactivé"}
            </button>}
          </div>
          {/*
            * Le repérage des génériques, à côté des analyses.
            *
            * Il ne porte sur aucune bibliothèque — il traverse les saisons — mais c'est ici qu'on
            * vient voir où en est une mise à jour, et une passe qui dure des heures sans rien dire se
            * confond avec un blocage.
            */}
          {/*
            * L'avancement affiché est celui du **travail**, pas celui de la passe en cours.
            *
            * Compté en mémoire, il repartait de zéro à chaque démarrage du service : après une nuit
            * de travail et quarante-trois saisons acquises, l'écran annonçait « 0 saison sur 434 » —
            * ce qui ressemble à s'y méprendre à un recommencement. Il se lit désormais en base, et la
            * ligne reste visible même passe arrêtée, tant qu'il demeure des saisons à traiter.
            */}
          {generiques && generiques.saisonsTotal > 0
            && <div className="scan-history">
            <div className="scan-job">
              <span className={`scan-state ${generiques.enCours ? "running" : generiques.actif ? "queued" : "cancelled"}`} aria-label={generiques.enCours ? "running" : "queued"} />
              <div>
                <b>Génériques de séries</b>
                {/*
                  * Deux lignes pour deux questions : le total dit où en est le travail, la passe dit
                  * si ça avance en ce moment. Une passe à zéro saison depuis dix minutes signale un
                  * blocage que le total ne montrerait pas.
                  */}
                <small>
                  {generiques.saisonsFaites} saison{generiques.saisonsFaites > 1 ? "s" : ""} sur {generiques.saisonsTotal}
                  {generiques.trouves > 0 ? ` · ${generiques.trouves} introduction${generiques.trouves > 1 ? "s" : ""} repérée${generiques.trouves > 1 ? "s" : ""}` : ""}
                  {generiques.episodesEcoutes > 0 ? ` · ${generiques.episodesEcoutes} épisodes écoutés` : ""}
                </small>
                <small>
                  {generiques.passe
                    ? `Passe en cours · ${generiques.passe.saisonsFaites} saison${generiques.passe.saisonsFaites > 1 ? "s" : ""} traitée${generiques.passe.saisonsFaites > 1 ? "s" : ""}`
                      + `${generiques.passe.trouves > 0 ? ` · ${generiques.passe.trouves} trouvée${generiques.passe.trouves > 1 ? "s" : ""}` : ""}`
                      + `${generiques.saisonCourante ? ` · ${generiques.saisonCourante}` : ""}`
                    : generiques.actif
                      ? (generiques.saisonsFaites >= generiques.saisonsTotal ? "Toutes les saisons sont traitées" : "En attente d'une analyse")
                      : "Repérage désactivé"}
                </small>
              </div>
              {/*
                * Arrêter, et non désactiver : cette commande ne concerne que la passe en cours, comme
                * l'« Annuler » d'une analyse juste en dessous. L'interrupteur de la fonction, lui, est
                * au-dessus — un réglage ne se règle pas depuis une ligne d'avancement.
                */}
              {generiques.enCours && <button className="scan-toggle" disabled={basculeEnCours}
                onClick={() => void arreterGeneriques()}>Arrêter</button>}
              {/*
                * Reprendre, et rien de plus : ce bouton ne relance aucune analyse de bibliothèque, ne
                * retouche aucune fiche et n'interroge aucun fournisseur. Il annonce le nombre de
                * saisons avant de partir, parce qu'un travail chiffré se décide au lieu de se subir.
                */}
              {!generiques.enCours && generiques.actif && generiques.saisonsTotal > generiques.saisonsFaites
                && <button className="scan-toggle" disabled={basculeEnCours}
                  title="Écoute les saisons qui n'ont pas encore de repère. Aucune bibliothèque n'est réanalysée."
                  onClick={() => void reprendreGeneriques()}>
                  Reprendre ({generiques.saisonsTotal - generiques.saisonsFaites} saison{generiques.saisonsTotal - generiques.saisonsFaites > 1 ? "s" : ""})
                </button>}
              <time>{generiques.enCours && generiques.debuteLe ? `depuis ${new Date(generiques.debuteLe).toLocaleTimeString()}` : ""}</time>
            </div>
            <div className="scan-progress">
              <span><i style={{ width: `${Math.round((generiques.saisonsFaites / generiques.saisonsTotal) * 100)}%` }} /></span>
            </div>
          </div>}
          {jobs.length > 0 && <div className="scan-history">
            {jobs.slice(0, 8).map((job) => {
              const busy = job.status === "queued" || job.status === "running";
              return <div className="scan-job" key={job.id}>
                <span className={`scan-state ${job.status}`} aria-label={job.status} />
                <div><b>{job.libraryName}</b><small>{job.mode === "metadata" ? "Métadonnées" : "Fichiers"} · {job.discovered} détectés · {job.imported} importés</small></div>
                <time>{job.startedAt ? new Date(job.startedAt).toLocaleString() : "En attente"}</time>
                {busy && <button onClick={() => void updateJob(job, "cancel")}>Annuler</button>}
                {job.retryable && <button onClick={() => void updateJob(job, "retry")}>Relancer</button>}
              </div>;
            })}
          </div>}
        </section>

        <div className="library-list">
          {loading && <p className="muted">Chargement…</p>}
          {!loading && !libraries.length && <p className="muted">Aucune bibliothèque configurée.</p>}
          {libraries.map((library) => {
            const busy = library.scan.status === "queued" || library.scan.status === "running";
            return (
              <article className="library-row library-row-detailed" key={library.id}>
                {/*
                  * La pastille nomme le type, et « Autre » etait le repli de tout ce qui n'etait ni
                  * film ni serie. Une bibliotheque web s'y retrouvait rangee, alors qu'elle a son
                  * rayon, son ecran et ses fournisseurs — la nommer autrement dit le contraire.
                  */}
                <span className={`library-kind ${library.resolvedKind}`}>{library.resolvedKind === "movie" ? "Film"
                  : library.resolvedKind === "tv" ? "TV" : library.resolvedKind === "web" ? "Web" : "Autre"}</span>
                <div className="library-info">
                  <div className="library-title-line"><b>{library.name}</b><span className={`scan-badge ${library.scan.status}`}>{busy && <i />}{statusLabel(library)}</span></div>
                  <code>{library.path}</code>
                  <small>{kindLabels[library.kind]} · {library.itemCount} fichier{library.itemCount > 1 ? "s" : ""}</small>
                  <label className="inline-language"><span>Langue des titres et affiches</span><select aria-label={`Langue de ${library.name}`} value={library.language} onChange={(event) => void changeLibraryLanguage(library, event.target.value as MetadataLanguage)}><option value="fr-FR">Français</option><option value="en-US">English</option></select></label>
                  {busy && <div className="scan-progress"><span><i style={{ width: `${Math.min(92, 12 + library.scan.discovered % 80)}%` }} /></span><small>{library.scan.discovered} détecté{library.scan.discovered > 1 ? "s" : ""} · {library.scan.imported} importé{library.scan.imported > 1 ? "s" : ""}</small></div>}
                  {library.scan.error && <small className="scan-error">{library.scan.error}</small>}
                  <div className="library-actions">
                    <button disabled={busy} onClick={() => void startScan(library, "files")}>↻ Scanner les fichiers</button>
                    <button disabled={busy} onClick={() => void startScan(library, "metadata")}>✦ Actualiser les métadonnées</button>
                    <button disabled={busy || library.itemCount === 0} onClick={() => setMetadataLibrary(library)}>◎ Correspondances</button>
                    <button className="danger-link" disabled={busy} onClick={() => void remove(library.id)}>Retirer</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <form className="library-form" onSubmit={submit}>
          <h3>Ajouter une bibliothèque</h3>
          <div className="form-grid">
            <label><span>Nom</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Films familiaux" /></label>
            <label><span>Type de contenu</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as LibraryKind })}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className="wide-field"><span>Chemin réseau ou local</span><div className="path-input-row"><input required value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} placeholder="/volume1/Multimédia/Film" /><button type="button" onClick={() => setBrowsing(true)}>Parcourir le serveur</button></div></label>
          <label className="language-field"><span>Langue des titres et affiches</span><select aria-label="Langue de la nouvelle bibliothèque" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value as "fr-FR" | "en-US" })}><option value="fr-FR">Français</option><option value="en-US">English</option></select></label>
          <p className="safe-note">FlixTunes analysera ce dossier sans déplacer ni renommer vos fichiers.</p>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Fermer</button><button className="primary" disabled={saving}>{saving ? "Vérification…" : "Ajouter et scanner"}</button></div>
        </form>
      </section>}
      {browsing && <FolderBrowser initialPath={form.path} onClose={() => setBrowsing(false)} onSelect={(selectedPath) => { setForm({ ...form, path: selectedPath }); setBrowsing(false); }} />}
    </div>
  );
}
