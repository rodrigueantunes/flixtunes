import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { MetadataProviderStatus } from "@flixtunes/contracts";
import { api } from "./api";

export function ProviderSetup() {
  const [providers, setProviders] = useState<MetadataProviderStatus[]>([]);
  const [tmdbToken, setTmdbToken] = useState("");
  /**
   * Clé TVDB, saisie séparément.
   *
   * Elle n'était configurable que par variable d'environnement du serveur, donc inaccessible depuis
   * un NAS où l'application s'installe en paquet : le fournisseur restait éteint sans qu'on puisse
   * rien y faire depuis l'interface. Le code qui l'exploite existait pourtant déjà.
   */
  const [tvdbApiKey, setTvdbApiKey] = useState("");
  const [tvdbSaving, setTvdbSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setProviders(await api.metadataProviders());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "État des fournisseurs indisponible");
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tmdbToken.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.configureMetadataProviders({ tmdbToken: tmdbToken.trim() });
      setProviders(result.providers);
      setTmdbToken("");
      setMessage(`TMDB configuré. ${result.jobs.length} actualisation${result.jobs.length > 1 ? "s" : ""} ajoutée${result.jobs.length > 1 ? "s" : ""} à la file.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration impossible");
    } finally {
      setSaving(false);
    }
  }

  const tmdb = providers.find((provider) => provider.id === "tmdb");

  return (
    <section className="provider-setup" aria-labelledby="provider-setup-title">
      <div className="provider-setup-heading">
        <div><span className="eyebrow">Identification et jaquettes</span><h3 id="provider-setup-title">Fournisseurs de métadonnées</h3></div>
        <span className={`provider-health ${tmdb?.enabled ? "enabled" : "disabled"}`}>{tmdb?.enabled ? "TMDB actif" : "TMDB à configurer"}</span>
      </div>
      <p>Ajoutez un jeton d’accès TMDB pour obtenir les titres français, résumés, affiches et saisons. Le jeton est chiffré sur ce serveur et n’est jamais réaffiché.</p>
      <form onSubmit={submit}>
        <label className="provider-token"><span>Jeton d’accès TMDB</span><input type="password" autoComplete="off" minLength={20} required value={tmdbToken} onChange={(event) => setTmdbToken(event.target.value)} placeholder={tmdb?.enabled ? "Remplacer le jeton existant" : "eyJhbGciOiJIUzI1NiJ9…"} /></label>
        <button className="primary" disabled={saving || tmdbToken.trim().length < 20}>{saving ? "Vérification…" : tmdb?.enabled ? "Remplacer" : "Activer TMDB"}</button>
      </form>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (tvdbApiKey.trim().length < 8) return;
        setTvdbSaving(true);
        try {
          // Chaque fournisseur s'enregistre seul : une clé refusée ne doit pas emporter celle du
          // voisin, ni obliger à ressaisir un jeton déjà validé.
          const resultat = await api.configureMetadataProviders({ tvdbApiKey: tvdbApiKey.trim() });
          setProviders(resultat.providers);
          setTvdbApiKey("");
          setMessage("Clé TVDB enregistrée.");
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Clé TVDB refusée");
        } finally {
          setTvdbSaving(false);
        }
      }}>
        <label className="provider-token">
          <span>Clé d’API TVDB <em>(facultative)</em></span>
          <input type="password" autoComplete="off" minLength={8} value={tvdbApiKey}
            onChange={(event) => setTvdbApiKey(event.target.value)} placeholder="Séries, saisons et épisodes" />
        </label>
        <button disabled={tvdbSaving || tvdbApiKey.trim().length < 8}>
          {tvdbSaving ? "Vérification…" : "Activer TVDB"}
        </button>
      </form>
      <button type="button" className="provider-advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? "Masquer" : "Afficher"} l’état de tous les fournisseurs</button>
      {advanced && <div className="provider-status-grid">{providers.map((provider) => <article key={provider.id} className={provider.enabled ? "enabled" : "disabled"}><b>{provider.name}</b><span>{provider.enabled ? "Actif" : "Non configuré"}</span><small>{provider.message}</small></article>)}</div>}
      {message && <p className="provider-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}
