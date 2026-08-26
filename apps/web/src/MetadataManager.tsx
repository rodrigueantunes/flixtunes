import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CatalogItem, LibraryFolder, MetadataProviderStatus, MetadataSearchCandidate } from "@flixtunes/contracts";
import { api } from "./api";

export function MetadataManager({
  library,
  onClose,
  onChanged,
  focusCatalogId = null,
}: {
  library: LibraryFolder;
  onClose: () => void;
  onChanged: () => void;
  /** Fiche à sélectionner d'emblée, lorsqu'on arrive depuis la fiche détaillée d'un titre. */
  focusCatalogId?: string | null;
}) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [results, setResults] = useState<MetadataSearchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualYear, setManualYear] = useState("");
  const [manualOverview, setManualOverview] = useState("");
  // Seuil d'année, saisi librement : « à partir de 2015 » écarte les rééditions anciennes sans
  // masquer ce qu'on cherche, contrairement à un filtre sur une année exacte.
  const [minYear, setMinYear] = useState("");

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  useEffect(() => {
    let active = true;
    const catalogue = focusCatalogId ? api.catalog(library.id, "", focusCatalogId) : api.reviewQueue(library.id);
    Promise.all([catalogue, api.metadataProviders()]).then(([catalog, availableProviders]) => {
      if (!active) return;
      setProviders(availableProviders);
      setItems(catalog);
      // Arrivée depuis une fiche : on ouvre sur le titre concerné plutôt que sur le premier du
      // catalogue, sans quoi il faudrait le retrouver soi-même dans une liste de plusieurs milliers.
      const cible = (focusCatalogId ? catalog.find((entry) => entry.id === focusCatalogId) : null) ?? catalog[0] ?? null;
      setSelectedId(cible?.id ?? null);
      setQuery(cible?.title ?? "");
      setResults(cible?.matchProposal ? [cible.matchProposal] : []);
      setLoading(false);
    }).catch((error) => { if (active) { setMessage(error instanceof Error ? error.message : "Catalogue inaccessible"); setLoading(false); } });
    return () => { active = false; };
  }, [library.id, focusCatalogId]);

  function select(item: CatalogItem) {
    setSelectedId(item.id);
    setQuery(item.title);
    setManualYear(item.year?.toString() ?? "");
    setManualOverview(item.overview ?? "");
    setResults([]);
    if (item.matchProposal) setResults([item.matchProposal]);
    setMessage(null);
  }

  async function saveManual(event: FormEvent) {
    event.preventDefault();
    if (!selected || !query.trim()) return;
    setApplying("manual"); setMessage(null);
    try {
      await api.updateCatalogMetadata(selected.id, { title: query.trim(), year: manualYear ? Number(manualYear) : null,
        overview: manualOverview.trim() || null, language: library.language });
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, title: query.trim(),
        year: manualYear ? Number(manualYear) : null, overview: manualOverview.trim() || null, metadataLocked: true } : item));
      setMessage("Corrections manuelles enregistrées et protégées des rescans."); onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Enregistrement impossible"); }
    finally { setApplying(null); }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!selected || !query.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      // Aucune contrainte d'année sur une recherche manuelle. On transmettait celle de la fiche
      // actuelle — c'est-à-dire de la correspondance qu'on cherche précisément à corriger : chercher
      // « Daredevil » depuis une fiche datée 2025 filtrait TMDB sur cette année et rendait la série
      // de 2015 introuvable, alors qu'elle y figure. Quand on corrige, l'année fait souvent partie
      // de l'erreur ; c'est la personne qui tranche, à partir de la liste complète.
      const seuil = Number.parseInt(minYear, 10);
      const matches = await api.searchMetadata(selected.kind === "movie" ? "movie" : "tv", query, library.language, null,
        Number.isInteger(seuil) ? seuil : null);
      setResults(matches);
      if (!matches.length) setMessage("Aucun résultat pour ce titre. Essayez le titre original ou une variante.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Recherche impossible");
    } finally {
      setSearching(false);
    }
  }

  async function apply(candidate: MetadataSearchCandidate) {
    if (!selected) return;
    const candidateKey = `${candidate.provider}:${candidate.externalId}`;
    setApplying(candidateKey);
    setMessage(null);
    try {
      const résultat = await api.matchCatalog(selected.id, candidate.externalId, candidate.provider, candidate.title, candidate.year);
      // Le titre, l'année et la jaquette viennent de la réponse : la fiche à l'écran devient la bonne
      // immédiatement. Auparavant seuls les identifiants changeaient, et l'on annonçait une
      // actualisation dont rien ne venait — la correction paraissait sans effet.
      setItems((current) => current.map((item) => item.id === selected.id
        ? {
          ...item, externalProvider: candidate.provider, externalId: candidate.externalId,
          matchStatus: "manual", metadataLocked: true, matchConfidence: 1, needsReview: false,
          title: résultat.item?.title ?? item.title,
          year: résultat.item?.year ?? item.year,
          overview: résultat.item?.overview ?? item.overview,
          posterUrl: résultat.item?.poster_url ?? item.posterUrl,
        }
        : item));
      setMessage(résultat.refreshError
        ? `Correspondance enregistrée, mais la fiche n'a pas pu être récupérée : ${résultat.refreshError}`
        : `Correspondance appliquée : ${résultat.item?.title ?? candidate.title}.`);
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Correction impossible");
    } finally {
      setApplying(null);
    }
  }

  async function unlock() {
    if (!selected) return;
    await api.unlockCatalogMatch(selected.id);
    setItems((current) => current.map((item) => item.id === selected.id ? { ...item, externalProvider: null,
      externalId: null, matchStatus: "unmatched", metadataLocked: false, matchConfidence: null, needsReview: true } : item));
    setMessage("Correspondance déverrouillée. Elle sera réévaluée au prochain scan.");
  }

  const visibleItems = items.filter((item) => item.title.toLocaleLowerCase(library.language).includes(filter.toLocaleLowerCase(library.language)));

  return (
    <section className="library-modal metadata-modal" role="dialog" aria-modal="true" aria-labelledby="metadata-title">
      <header>
        <div><span className="eyebrow">{library.name}</span><h2 id="metadata-title">Correspondances</h2></div>
        <button className="close-button" onClick={onClose} aria-label="Retour">×</button>
      </header>
      <div className="provider-strip" aria-label="Fournisseurs de métadonnées">
        {providers.map((provider) => <span className={provider.enabled ? "enabled" : "disabled"} key={provider.id}
          title={provider.message}>{provider.name}<i>{provider.enabled ? "actif" : "non configuré"}</i></span>)}
      </div>
      <div className="metadata-layout">
        <aside className="catalog-picker">
          <label><span>Filtrer le catalogue</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Titre…" /></label>
          {loading && <p className="muted">Chargement…</p>}
          {!loading && !visibleItems.length && <p className="muted">Aucune correspondance à revoir.</p>}
          <div className="catalog-picker-list">
            {visibleItems.map((item) => (
              <button className={item.id === selectedId ? "selected" : ""} key={item.id} onClick={() => select(item)}>
                <span className="catalog-thumb" style={item.posterUrl ? { backgroundImage: `url(${item.posterUrl})` } : undefined}>{!item.posterUrl && item.title.charAt(0)}</span>
                <span><b>{item.title}</b><small>{item.kind === "movie" ? "Film" : "Série"}{item.year ? ` · ${item.year}` : ""}{item.matchConfidence != null ? ` · ${Math.round(item.matchConfidence * 100)} %` : ""}</small></span>
                <i className={`match-dot ${item.matchStatus}`} title={item.matchStatus === "manual" ? "Correspondance manuelle verrouillée" : item.matchStatus === "automatic" ? "Correspondance automatique" : item.matchStatus === "review" ? "Proposition en attente de validation" : "Non identifié"} />
              </button>
            ))}
          </div>
        </aside>
        <main className="match-workspace">
          {!selected && <p className="muted">Sélectionnez un élément du catalogue.</p>}
          {selected && <>
            <span className="eyebrow">Correction sans renommer le fichier</span>
            <h3>{selected.title}</h3>
            {selected.matchProposal && <p className="metadata-message">Proposition non appliquée : <b>{selected.matchProposal.title}</b>{selected.matchProposal.year ? ` (${selected.matchProposal.year})` : ""}. Elle n'a modifié ni la fiche ni le regroupement.</p>}
            {selected.metadataLocked && <button className="danger-link" onClick={() => void unlock()}>Déverrouiller la correspondance</button>}
            <form className="metadata-search" onSubmit={search}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Titre à rechercher" />
              {/* Seuil et non filtre exact : « à partir de 2015 » écarte les rééditions anciennes sans
                  masquer ce qu'on cherche. Laissé vide, il n'exclut rien. */}
              <input className="metadata-year" value={minYear} inputMode="numeric" placeholder="Année min."
                onChange={(event) => setMinYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-label="Année minimale des résultats" title="Ne proposer que les titres parus à partir de cette année" />
              <button className="primary" disabled={searching}>{searching ? "Recherche…" : "Rechercher"}</button>
            </form>
            <button className="provider-advanced-toggle" type="button" aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}>✎ {manualOpen ? "Masquer la correction manuelle" : "Corriger les informations manuellement"}</button>
            {manualOpen && <form className="manual-metadata-form" onSubmit={saveManual}>
              <label><span>Année</span><input type="number" min="1870" max="2200" value={manualYear} onChange={(event) => setManualYear(event.target.value)} /></label>
              <label><span>Résumé</span><textarea rows={4} value={manualOverview} onChange={(event) => setManualOverview(event.target.value)} /></label>
              <button disabled={applying != null}>{applying === "manual" ? "Enregistrement…" : "Enregistrer et verrouiller"}</button>
            </form>}
            {message && <p className="metadata-message">{message}</p>}
            <div className="match-results">
              {results.map((candidate) => (
                <article key={`${candidate.provider}:${candidate.externalId}`}>
                  <span className="match-poster" style={candidate.posterUrl ? { backgroundImage: `url(${candidate.posterUrl})` } : undefined}>{!candidate.posterUrl && candidate.title.charAt(0)}</span>
                  <div><h4>{candidate.title}</h4><small>{candidate.year ?? "Année inconnue"} · {candidate.provider.toUpperCase()} #{candidate.externalId} · {Math.round(candidate.score * 100)} %</small><p>{candidate.overview || "Aucun résumé disponible."}</p>{candidate.matchReasons?.length ? <small>{candidate.matchReasons.join(" · ")}</small> : null}</div>
                  <button onClick={() => void apply(candidate)} disabled={applying != null}>{applying === `${candidate.provider}:${candidate.externalId}` ? "Application…" : "Choisir"}</button>
                </article>
              ))}
            </div>
          </>}
        </main>
      </div>
    </section>
  );
}
