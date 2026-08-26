import { useEffect, useState } from "react";
import type { DirectoryBrowserListing } from "@flixtunes/contracts";
import { api } from "./api";

export function FolderBrowser({ initialPath, onSelect, onClose }: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirectoryBrowserListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function open(path?: string, allowRootFallback = false) {
    setLoading(true);
    setError(null);
    try {
      setListing(await api.browseDirectories(path));
    } catch (cause) {
      if (allowRootFallback && path) {
        try {
          setListing(await api.browseDirectories());
          setError("Le chemin saisi n'est pas accessible depuis le serveur. Choisissez un dossier ci-dessous.");
          return;
        } catch (fallbackCause) {
          cause = fallbackCause;
        }
      }
      setError(cause instanceof Error ? cause.message : "Parcours impossible");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void open(initialPath?.trim() || undefined, true); }, []);

  return (
    <div className="folder-browser-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="folder-browser" role="dialog" aria-modal="true" aria-labelledby="folder-browser-title">
        <header>
          <div><span className="eyebrow">Dossiers du serveur</span><h2 id="folder-browser-title">Parcourir le NAS</h2></div>
          <button className="close-button" onClick={onClose} aria-label="Fermer le parcours">×</button>
        </header>

        <div className="folder-browser-location">
          <button disabled={!listing?.path} onClick={() => void open()}>Volumes</button>
          <span aria-label="Dossier actuel">{listing?.path ?? "Choisissez un volume"}</span>
        </div>

        <div className="folder-browser-list" aria-busy={loading}>
          {listing?.path && listing.parentPath && <button className="folder-entry parent" onClick={() => void open(listing.parentPath ?? undefined)}>
            <span>↰</span><div><b>Dossier parent</b><small>{listing.parentPath}</small></div>
          </button>}
          {listing?.path && !listing.parentPath && <button className="folder-entry parent" onClick={() => void open()}>
            <span>▦</span><div><b>Volumes du serveur</b><small>Revenir à la liste des volumes</small></div>
          </button>}
          {listing?.directories.map((directory) => <button className="folder-entry" key={directory.path} onClick={() => void open(directory.path)}>
            <span>▰</span><div><b>{directory.name}</b><small>{directory.path}</small></div><i>›</i>
          </button>)}
          {loading && <p className="folder-browser-message">Lecture des dossiers…</p>}
          {!loading && !listing?.directories.length && <p className="folder-browser-message">Ce dossier ne contient aucun sous-dossier accessible.</p>}
          {error && <p className="form-error">{error}</p>}
        </div>

        <footer>
          <span>Seuls les dossiers sont affichés. Aucun média n'est modifié.</span>
          <button className="secondary" onClick={onClose}>Annuler</button>
          <button className="primary" disabled={!listing?.path} onClick={() => listing?.path && onSelect(listing.path)}>Choisir ce dossier</button>
        </footer>
      </section>
    </div>
  );
}
