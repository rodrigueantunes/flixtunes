import { useEffect, useState } from "react";
import type { ConversionPreferences, MediaEngineCapability, ServerCapacityReport } from "@flixtunes/contracts";
import { api } from "./api";
import type { CompteDistant, DiagnosticWan, ParametresWan } from "./api";

type Status = Awaited<ReturnType<typeof api.systemStatus>>;

function gigabytes(bytes: number): string { return `${(bytes / 1024 ** 3).toFixed(1)} Gio`; }

function CapacityTable({ capacity, expert }: { capacity: ServerCapacityReport; expert: boolean }) {
  const used = capacity.budgetUnits > 0 ? Math.min(100, Math.round(capacity.usedUnits / capacity.budgetUnits * 100)) : 0;
  return <details className="capacity-report" open={capacity.alerts.some((alert) => alert.level !== "info")}>
    <summary>Capacité de mon serveur · {capacity.selectedEncoder ?? "aucun encodeur"} · {capacity.usedUnits} / {capacity.budgetUnits} unités</summary>
    <p>{capacity.cpuModel} · {capacity.cpuCores} cœurs · {capacity.architecture} · {gigabytes(capacity.freeMemoryBytes)} libres sur {gigabytes(capacity.totalMemoryBytes)}
      {capacity.temperatureCelsius != null ? ` · ${Math.round(capacity.temperatureCelsius)} °C` : ""}</p>
    <div className="capacity-gauge" role="img" aria-label={`Budget de conversion utilisé à ${used} %`}><i style={{ width: `${used}%` }} /></div>
    <table className="capacity-grid">
      <caption>Sessions simultanées soutenables</caption>
      <tbody>{capacity.simultaneous.map((entry) => <tr key={entry.label}><th scope="row">{entry.label}</th><td>{entry.sessions}</td></tr>)}</tbody>
    </table>
    <table className="capacity-grid">
      <caption>Accélérateurs mesurés</caption>
      <tbody>{capacity.accelerators.map((probe) => <tr key={probe.id} className={probe.selected ? "selected" : ""}>
        <th scope="row">{probe.label}{probe.selected ? " ✓" : ""}</th>
        <td>{probe.usable ? `${probe.framesPerSecond} i/s${probe.relativeToSoftware != null ? ` · ${Math.round(probe.relativeToSoftware * 100)} %` : ""}`
          : probe.error ?? "indisponible"}
          {/* Le libellé lisible ne couvre que les pannes connues ; le message d'origine du pilote dit
              le reste, et c'est lui qu'on lit quand rien ne correspond. Réservé au mode expert : il est
              long, technique, et sans intérêt tant que tout fonctionne. */}
          {expert && probe.detail ? <small className="probe-detail">{probe.detail}</small> : null}</td>
      </tr>)}</tbody>
    </table>
    {capacity.toneMapping.length > 0 && <table className="capacity-grid">
      <caption>Conversion HDR → SDR mesurée</caption>
      <tbody>{capacity.toneMapping.map((probe) => <tr key={probe.id} className={probe.selected ? "selected" : ""}>
        <th scope="row">{probe.label}{probe.selected ? " ✓" : ""}{probe.hardware ? " · matériel" : ""}</th>
        <td>{probe.usable ? `${probe.framesPerSecond} i/s${probe.relativeToSoftware != null ? ` · ${Math.round(probe.relativeToSoftware * 100)} %` : ""}`
          : probe.error ?? "indisponible"}</td>
      </tr>)}</tbody>
    </table>}
    <p className="capacity-note">Analyses : {capacity.scans.effective} sur {capacity.scans.configured} autorisées
      {capacity.scans.pausedByPlayback ? " — bridées par les lectures en cours" : ""}.
      Calibrage {capacity.calibration.source} du {capacity.calibration.measuredAt ? new Date(capacity.calibration.measuredAt).toLocaleString("fr-FR") : "—"}.</p>
    {capacity.alerts.map((alert) => <p key={alert.message} className={`capacity-alert ${alert.level}`}>
      <b>{alert.message}</b><span>{alert.action}</span></p>)}
  </details>;
}

function CapabilityGroup({ title, items }: { title: string; items: MediaEngineCapability[] }) {
  return <section className="capability-group" aria-label={title}>
    <h4>{title}</h4>
    <div className="capability-list">{items.map((item) => <span key={item.id} className={item.available ? "capability-ok" : "capability-missing"}
      title={item.available ? `${item.label} disponible` : `${item.label} absent${item.fallback ? ` · repli ${item.fallback}` : ""}`}>
      {item.available ? "✓" : "!"} {item.label}
    </span>)}</div>
  </section>;
}

const ACCELERATEURS: Array<[string, string]> = [
  ["auto", "Automatique (mesuré)"], ["software", "Logiciel x264/x265"], ["vaapi", "VA-API"],
  ["qsv", "Intel Quick Sync"], ["nvenc", "NVIDIA NVENC"], ["amf", "AMD AMF"], ["v4l2m2m", "V4L2 M2M"],
];
const TONE_MAPPINGS: Array<[string, string]> = [
  ["auto", "Automatique (mesuré)"], ["libplacebo", "libplacebo / Vulkan"], ["vaapi", "VA-API"],
  ["opencl", "OpenCL"], ["zscale", "zscale logiciel"], ["software", "tonemap logiciel"],
];
const CODECS: Array<[string, string]> = [
  ["auto", "Automatique (conserve le HEVC d’une source HEVC)"], ["h264", "Toujours H.264"], ["hevc", "Toujours HEVC"],
];
const RESOLUTIONS: Array<[string, string]> = [
  ["auto", "Automatique (ce que l’appareil annonce)"], ["2160", "2160p au plus"], ["1440", "1440p au plus"],
  ["1080", "1080p au plus"], ["720", "720p au plus"],
];

/**
 * Les réglages détaillés de conversion.
 *
 * Ils n'existaient qu'en variables d'environnement, dans un fichier qu'on n'atteint qu'en SSH : le
 * réglage était théorique. L'automatique reste le bon choix — il s'appuie sur les mesures affichées
 * juste au-dessus — et ce panneau sert à le contredire quand on a une raison, ou simplement à
 * comparer deux chemins sur son propre matériel.
 */
function ExpertControls({ preferences, onChange, onRecalibrate, recommande }:
{ preferences: ConversionPreferences; onChange: (patch: Partial<ConversionPreferences>) => void;
  onRecalibrate: () => void; recommande: number | null }) {
  const choix = (etiquette: string, valeur: string, options: Array<[string, string]>, clef: keyof ConversionPreferences) =>
    <label>{etiquette}
      <select value={valeur} onChange={(event) => onChange({ [clef]: event.target.value })}>
        {options.map(([cle, texte]) => <option key={cle} value={cle}>{texte}</option>)}
      </select>
    </label>;
  return <div className="expert-controls">
    <label className="expert-toggle">
      <input type="checkbox" checked={preferences.expert} onChange={(event) => onChange({ expert: event.target.checked })} />
      Mode expert
    </label>
    {preferences.expert && <>
      {choix("Accélérateur", preferences.accelerateur, ACCELERATEURS, "accelerateur")}
      {choix("Conversion HDR → SDR", preferences.toneMapping, TONE_MAPPINGS, "toneMapping")}
      {choix("Codec de sortie", preferences.codecSortie, CODECS, "codecSortie")}
      {choix("Définition maximale", preferences.resolutionMax, RESOLUTIONS, "resolutionMax")}
      <label>Conversions simultanées
        <select
          value={preferences.conversionsSimultanees === "auto" ? "auto" : String(preferences.conversionsSimultanees)}
          onChange={(event) => onChange({
            conversionsSimultanees: event.target.value === "auto" ? "auto" : Number(event.target.value),
          })}
        >
          <option value="auto">Automatique{recommande != null ? ` — ${recommande}` : ""}</option>
          {Array.from({ length: 16 }, (_, index) => index + 1).map((valeur) =>
            <option key={valeur} value={valeur}>{valeur}{valeur === recommande ? " (recommandé)" : ""}</option>)}
        </select>
      </label>
      <p className="capacity-note">Le mode automatique suit la mesure de <b>cette</b> machine : il vaut
        aujourd’hui <b>{recommande ?? "?"}</b>. Une valeur imposée plus haute ne crée pas de capacité —
        le budget mesuré, la limite thermique et la réserve d’interface continuent de refuser ce qui ne
        tient pas. Refaites les mesures quand la machine est au repos : un banc lancé pendant une analyse
        ou une mise à jour sous-estime, et c’est ce chiffre bas qui serait retenu.</p>
      <p className="capacity-note">La définition ne peut être que <b>réduite</b> : imposer plus que ce que
        l’appareil annonce ne donne pas une image plus fine, mais une lecture qui échoue. Un réglage forcé
        s’applique à la prochaine lecture. Les chiffres
        ci-dessus disent ce que la mesure a trouvé sur cette machine : un chemin plus lent que le
        logiciel y apparaît comme tel, même s’il est disponible.</p>
      <button onClick={onRecalibrate}>Refaire les mesures</button>
      <p className="capacity-note">Les mesures sont conservées tant que le moteur et l’environnement du
        pilote ne changent pas. Après une mise à jour du paquet ou une correction d’accès au périphérique,
        le verdict précédent peut survivre à ce qui le corrige : c’est le moment de les refaire.</p>
    </>}
  </div>;
}

/**
 * L'accès distant : le régler, et surtout savoir pourquoi il ne répond pas.
 *
 * La chaîne compte un enregistrement DNS, deux redirections sur la box, un certificat obtenu auprès
 * d'une autorité, un proxy, une écoute interne et un code PIN. L'échec de n'importe lequel produit le
 * même symptôme — une page qui ne s'ouvre pas. Le bouton de vérification existe pour que ce symptôme
 * unique redevienne six réponses distinctes, chacune avec le geste qui la corrige.
 */
function AccesDistant() {
  const [parametres, setParametres] = useState<ParametresWan | null>(null);
  const [domaine, setDomaine] = useState("");
  const [diagnostic, setDiagnostic] = useState<DiagnosticWan | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [comptes, setComptes] = useState<CompteDistant[]>([]);
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

  useEffect(() => {
    void api.wanParametres().then((reponse) => {
      setParametres(reponse.parametres);
      setDomaine(reponse.parametres.domaine ?? "");
    }).catch(() => setParametres(null));
    void api.remoteAccounts().then(setComptes).catch(() => setComptes([]));
  }, []);

  const creerCompte = async () => {
    if (!identifiant.trim() || motDePasse.length < 12 || occupe) return;
    setOccupe(true); setMessage(null);
    try {
      const compte = await api.createRemoteAccount(identifiant.trim(), motDePasse);
      setComptes((actuels) => [...actuels, compte].sort((a, b) => a.username.localeCompare(b.username)));
      setIdentifiant(""); setMotDePasse("");
      setMessage("Compte créé. Il sera demandé une seule fois sur chaque nouvel appareil distant.");
    } catch (erreur) { setMessage(erreur instanceof Error ? erreur.message : "Création impossible"); }
    finally { setOccupe(false); }
  };

  const retirerCompte = async (compte: CompteDistant) => {
    setOccupe(true); setMessage(null);
    try {
      await api.removeRemoteAccount(compte.id);
      setComptes((actuels) => actuels.filter((entree) => entree.id !== compte.id));
      setMessage(`Compte ${compte.username} retiré avec ses appareils autorisés.`);
    } catch (erreur) { setMessage(erreur instanceof Error ? erreur.message : "Suppression impossible"); }
    finally { setOccupe(false); }
  };

  const enregistrer = async () => {
    setOccupe(true); setMessage(null);
    try {
      const reponse = await api.enregistrerWan({ domaine: domaine.trim() || null });
      setParametres(reponse.parametres);
      setMessage(reponse.parametres.domaine
        ? "Enregistré. Redémarrez FlixTunes pour que l’écoute distante et le certificat soient créés."
        : "Accès distant désactivé. Il prendra effet au prochain redémarrage.");
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : "Enregistrement impossible");
    } finally { setOccupe(false); }
  };

  const verifier = async () => {
    setOccupe(true); setMessage(null);
    try { setDiagnostic(await api.verifierWan()); }
    catch (erreur) { setMessage(erreur instanceof Error ? erreur.message : "Vérification impossible"); }
    finally { setOccupe(false); }
  };

  if (!parametres) return null;
  const pastille = (etat: string) => etat === "ok" ? "✓" : etat === "attention" ? "!" : etat === "inconnu" ? "?" : "✗";

  return <div className="expert-controls">
    <h4>Accès depuis Internet</h4>
    <label>Nom de domaine
      <input type="text" value={domaine} inputMode="url" autoComplete="off" spellCheck={false}
        placeholder="flixtunes.exemple.fr" onChange={(event) => setDomaine(event.target.value)} />
    </label>
    <p className="capacity-note">Vide, l’accès distant n’existe pas : aucune écoute, aucun port lié,
      aucun certificat demandé. La box doit rediriger le port <b>80</b> vers <b>{parametres.portHttp}</b>
      et le port <b>443</b> vers <b>{parametres.portHttps}</b> sur ce NAS. Les ports publics restent 80
      et 443 : c’est là que l’autorité de certification vient vérifier le domaine.</p>
    <div className="expert-actions">
      <button onClick={() => void enregistrer()} disabled={occupe}>Enregistrer</button>
      <button onClick={() => void verifier()} disabled={occupe}>{occupe ? "Vérification…" : "Vérifier l’accès distant"}</button>
    </div>
    {message && <p className="capacity-note" role="status">{message}</p>}
    {diagnostic && <table className="capacity-grid">
      <caption>{diagnostic.pret ? "Chaîne complète : prête" : "Ce qui bloque"}</caption>
      <tbody>{diagnostic.controles.map((controle) => <tr key={controle.id} className={controle.etat}>
        <th scope="row">{pastille(controle.etat)} {controle.libelle}</th>
        <td>{controle.constat}{controle.action ? <><br /><small>{controle.action}</small></> : null}</td>
      </tr>)}</tbody>
    </table>}
    <details className="capacity-report remote-accounts">
      <summary>Comptes de connexion à distance · {comptes.length}</summary>
      <p className="capacity-note">Ces comptes protègent l’entrée depuis Internet. Ils sont indépendants des groupes et profils.
        Le mot de passe n’est saisi qu’à la première connexion de chaque appareil.</p>
      <form className="expert-actions" onSubmit={(event) => { event.preventDefault(); void creerCompte(); }}>
        <input value={identifiant} maxLength={64} autoComplete="off" placeholder="Identifiant"
          onChange={(event) => setIdentifiant(event.target.value)} />
        <input value={motDePasse} type="password" minLength={12} autoComplete="new-password" placeholder="Mot de passe · 12 caractères minimum"
          onChange={(event) => setMotDePasse(event.target.value)} />
        <button disabled={occupe || !identifiant.trim() || motDePasse.length < 12}>Créer le compte</button>
      </form>
      {comptes.length === 0 ? <p className="diagnostic-warning">Aucun compte : la médiathèque distante reste volontairement inaccessible.</p>
        : <table className="capacity-grid"><tbody>{comptes.map((compte) => <tr key={compte.id}>
          <th scope="row">{compte.username}</th><td>{compte.devices} appareil{compte.devices > 1 ? "s" : ""} autorisé{compte.devices > 1 ? "s" : ""}</td>
          <td><button disabled={occupe} onClick={() => void retirerCompte(compte)}>Retirer</button></td>
        </tr>)}</tbody></table>}
    </details>
  </div>;
}

export function DiagnosticsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [capacity, setCapacity] = useState<ServerCapacityReport | null>(null);
  const [preferences, setPreferences] = useState<ConversionPreferences | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    void api.systemStatus().then(setStatus).catch(() => setMessage("Diagnostic serveur indisponible"));
    // Le micro-banc peut être en cours au premier appel : son absence ne doit pas masquer le reste du diagnostic.
    void api.systemCapacity().then(setCapacity).catch(() => setCapacity(null));
    void api.conversionPreferences().then(setPreferences).catch(() => setPreferences(null));
  }, [open]);
  async function relancerMesures() {
    try {
      await api.recalibrate();
      setMessage("Mesures relancées : le tableau se remplit au fur et à mesure.");
      setCapacity(await api.systemCapacity());
    } catch { setMessage("Relance des mesures impossible"); }
  }
  async function changerPreferences(patch: Partial<ConversionPreferences>) {
    try { setPreferences(await api.saveConversionPreferences(patch)); }
    catch { setMessage("Réglage de conversion non enregistré"); }
  }
  async function backup() {
    try { const result = await api.createBackup(); setMessage(`Sauvegarde créée : ${result.name}`); }
    catch { setMessage("Sauvegarde impossible"); }
  }
  const matrix = status?.playback.compatibility;
  return <section className="diagnostics-panel">
    <button className="provider-advanced-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>⚙ {open ? "Masquer" : "Afficher"} le diagnostic serveur</button>
    {open && <>
      {!status ? <p>Chargement du diagnostic…</p> : <>
        <div className="diagnostic-grid">
          <article><b>FlixTunes</b><span>v{status.version}{status.packageRevision ? ` ${status.packageRevision}` : ""} · étape {status.step ?? status.phase}</span><small>{Math.round(status.uptimeSeconds / 60)} min</small></article>
          {/* La version du schéma vit à côté de l'intégrité : ce sont deux façons de dire l'état de
              la base, et une restauration peut faire reculer la première sans toucher à la seconde. */}
          <article><b>Base de données</b><span>{status.database.integrity === "ok" ? "Intègre" : status.database.integrity}</span><small>{Math.round(status.memory.rss / 1024 / 1024)} Mo{status.schema ? ` · schéma v${status.schema.version}${status.schema.enAttente.length ? ` (${status.schema.enAttente.length} en attente)` : ""}` : ""}</small></article>
          <article><b>Lecture</b><span>{status.playback.ffmpegAvailable ? status.playback.selectedVideoEncoder ?? "FFmpeg" : "FFmpeg absent"}</span><small>{status.playback.activeTranscodes}/{status.playback.maximumTranscodes} transcodages</small></article>
          <article><b>Analyses</b><span>{status.scans.active} active · {status.scans.queued} attente</span><small>{status.scans.concurrency} simultanées</small></article>
        </div>
        {matrix && <details className="compatibility-matrix" open={!matrix.healthy}>
          <summary>Compatibilité multimédia · {matrix.healthy ? "moteur complet" : `${matrix.missingCritical.length} composant(s) critique(s) absent(s)`}</summary>
          <p>{matrix.engineVersion ?? "Version FFmpeg inconnue"}</p>
          {matrix.missingCritical.length > 0 && <p className="diagnostic-warning">Manquants critiques : {matrix.missingCritical.join(", ")}</p>}
          <CapabilityGroup title="Vidéo en entrée" items={matrix.video} />
          <CapabilityGroup title="Audio en entrée" items={matrix.audio} />
          <CapabilityGroup title="Conteneurs" items={matrix.containers} />
          <CapabilityGroup title="Sous-titres" items={matrix.subtitles} />
          <CapabilityGroup title="Conversions et filtres" items={matrix.processing} />
          {matrix.colorPipelines?.length ? <CapabilityGroup title="Chaîne HDR et colorimétrie" items={matrix.colorPipelines} /> : null}
          <small>Accélération : {status.playback.hardwareAccelerators?.join(", ") || "logicielle"}</small>
        </details>}
        {capacity && <CapacityTable capacity={capacity} expert={preferences?.expert === true} />}
        {preferences && <ExpertControls preferences={preferences} onChange={(patch) => void changerPreferences(patch)}
          onRecalibrate={() => void relancerMesures()} recommande={capacity?.plafondRecommande ?? null} />}
        <AccesDistant />
      </>}
      {status?.playback.recentFailures.length ? <details><summary>Derniers incidents</summary>{status.playback.recentFailures.map((failure) => <p key={failure.at}>{failure.message}</p>)}</details> : null}
      <button onClick={() => void backup()}>Créer une sauvegarde maintenant</button>
      {message && <p role="status">{message}</p>}
    </>}
  </section>;
}
