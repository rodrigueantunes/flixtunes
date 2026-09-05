import { useState } from "react";
import type { LibraryInput, LibraryKind } from "@flixtunes/contracts";
import { api } from "./api";
import { FolderBrowser } from "./FolderBrowser";

type DraftLibrary = LibraryInput & { draftId: string };

export function createDraftId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `draft-${Date.now().toString(36)}-${randomPart}`;
}

function createDraft(kind: "movie" | "tv"): DraftLibrary {
  return {
    draftId: createDraftId(),
    name: kind === "movie" ? "Films" : "Séries TV",
    path: "",
    kind,
    language: "fr-FR",
    organizeSeasons: false,
  };
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [libraries, setLibraries] = useState<DraftLibrary[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsingDraftId, setBrowsingDraftId] = useState<string | null>(null);

  function update(draftId: string, patch: Partial<DraftLibrary>) {
    setLibraries((current) => current.map((library) => library.draftId === draftId ? { ...library, ...patch } : library));
  }

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await api.completeSetup({ libraries: libraries.map(({ draftId: _draftId, ...library }) => library) });
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration impossible");
    } finally {
      setSaving(false);
    }
  }

  const ready = libraries.length > 0 && libraries.every((library) => library.name.trim() && library.path.trim());

  return (
    <main className="setup-page">
      <div className="setup-glow" />
      <header className="setup-brand"><img src="/brand/flixtunes-logo.png" alt="" /><span>Flix<span>Tunes</span></span></header>
      <section className="setup-card">
        <span className="eyebrow">Configuration du serveur</span>
        <h1>Où se trouve votre cinéma&nbsp;?</h1>
        <p className="setup-lead">Ajoutez les dossiers que ce serveur doit analyser. Rien n’est ajouté ni déplacé sans votre choix.</p>

        <div className="setup-library-list">
          {libraries.map((library, index) => (
            <article className="setup-library" key={library.draftId}>
              <div className={`setup-library-number ${library.kind}`}><span>{index + 1}</span>{library.kind === "movie" ? "FILM" : library.kind === "tv" ? "TV" : library.kind === "web" ? "WEB" : "AUTRE"}</div>
              <div className="setup-library-fields">
                <label><span>Nom de la bibliothèque</span><input value={library.name} onChange={(event) => update(library.draftId, { name: event.target.value })} /></label>
                <label className="setup-path"><span>Chemin du dossier</span><div className="path-input-row"><input autoFocus={index === libraries.length - 1} value={library.path} onChange={(event) => update(library.draftId, { path: event.target.value })} placeholder={library.kind === "movie" ? "/volume1/Multimédia/Film" : "/volume1/Multimédia/Serie Tv"} /><button type="button" onClick={() => setBrowsingDraftId(library.draftId)}>Parcourir le NAS</button></div></label>
                <label><span>Type</span><select value={library.kind} onChange={(event) => update(library.draftId, { kind: event.target.value as LibraryKind })}>
                  <option value="movie">Films</option><option value="tv">Séries TV</option><option value="web">Web</option><option value="auto">Détection automatique</option><option value="other">Autre</option>
                </select></label>
                <label><span>Langue des métadonnées</span><select value={library.language} onChange={(event) => update(library.draftId, { language: event.target.value as "fr-FR" | "en-US" })}>
                  <option value="fr-FR">Français</option><option value="en-US">English</option>
                </select></label>
              </div>
              <button className="setup-remove" onClick={() => setLibraries((current) => current.filter((item) => item.draftId !== library.draftId))} aria-label={`Retirer ${library.name}`}>×</button>
            </article>
          ))}
        </div>

        <div className="setup-add">
          <button onClick={() => setLibraries((current) => [...current, createDraft("movie")])}><b>＋</b><span><strong>Ajouter des films</strong><small>Un dossier contenant vos longs-métrages</small></span></button>
          <button onClick={() => setLibraries((current) => [...current, createDraft("tv")])}><b>＋</b><span><strong>Ajouter des séries TV</strong><small>Classement logique par séries et saisons</small></span></button>
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="setup-footer"><span>Les dossiers resteront enregistrés uniquement sur ce serveur.</span><button className="primary" disabled={!ready || saving} onClick={() => void finish()}>{saving ? "Vérification des dossiers…" : "Créer ma médiathèque"}</button></div>
      </section>
      {browsingDraftId && <FolderBrowser
        initialPath={libraries.find((library) => library.draftId === browsingDraftId)?.path}
        onClose={() => setBrowsingDraftId(null)}
        onSelect={(selectedPath) => { update(browsingDraftId, { path: selectedPath }); setBrowsingDraftId(null); }}
      />}
    </main>
  );
}
