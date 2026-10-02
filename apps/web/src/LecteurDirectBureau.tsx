import { BoutonDiffusion, useSurfaceDiffusion } from "./Diffusion";
import { useEffect, useRef, useState } from "react";
import type { ChaineDirect, ChaineDirectDetaillee } from "@flixtunes/contracts";
import { api } from "./api";
import { pontBureau, type EtatLecteurBureau } from "./bureau";
import { formatAdresse } from "./pilotage-direct";
type SourceDirect = ChaineDirectDetaillee["sources"][number];

export interface PropsDirect {
  chaine: ChaineDirect; precedente: ChaineDirect | null;
  onChaine: (chaine: ChaineDirect) => void; onClose: () => void;
}

/** La présentation reste celle du direct ; le décodage appartient au processus natif. */
export function LecteurDirectBureau({ chaine, precedente, onChaine, onClose, onRepli }: PropsDirect & { onRepli: () => void }) {
  const pont = pontBureau()!;
  const [sources, setSources] = useState<SourceDirect[]>([]);
  const [rang, setRang] = useState(0);
  const [message, setMessage] = useState<string | null>("Ouverture de la chaîne…");
  const [visible, setVisible] = useState(true);
  const [choix, setChoix] = useState(false);
  const [diagnostic, setDiagnostic] = useState(false);
  const [pause, setPause] = useState(false);
  const [volume, setVolume] = useState(1);
  const [pleinEcran, setPleinEcran] = useState(false);
  const [cache, setCache] = useState({ cacheOctets: 0, reserveCacheSecondes: 0, incident: "" });
  const [etat, setEtat] = useState<EtatLecteurBureau | null>(null);
  const commande = useRef<(index: number) => void>(() => {});
  const derniereAction = useRef(Date.now());
  const reveiller = () => { derniereAction.current = Date.now(); setVisible(true); };
  const basculerPleinEcran = () => { void pont.pleinEcran().then(setPleinEcran).catch(() => {}); reveiller(); };
  const mettreEnPause = () => {
    setPause((avant) => { void (avant ? pont.lecteur!.lire() : pont.lecteur!.pause()).catch(() => {}); return !avant; });
    reveiller();
  };
  const pauseRef = useRef(pause); pauseRef.current = pause;
  useEffect(() => pont.surPleinEcran(setPleinEcran), [pont]);

  useEffect(() => {
    let annule = false, liste: SourceDirect[] = [], index = 0, tentatives = 0, generation = 0;
    let ouverture = Date.now(), progres = Date.now(), images = 0, pret = false, occupe = false;
    let stable = 0, rapport = 0;
    let dernierRenouvellement = 0;
    let repliDemande = false;
    const arret = () => { if (!annule && !repliDemande) { repliDemande = true; onRepli(); } };
    async function actualiser() {
      const precedente = liste[index];
      const generationAvant = generation;
      dernierRenouvellement = Date.now();
      const detail = await api.chaineLive(chaine.id, "bureau-vlc", AbortSignal.timeout(10_000));
      if (annule) return;
      // Le renouvellement des jetons ne doit pas déplacer la source actuellement affichée.
      if (liste.length) liste = liste.map((s) => detail.sources.find((n) => n.identifiant && n.identifiant === s.identifiant) ?? s);
      else liste = detail.sources;
      setSources(liste);
      const courante = liste[index];
      if (!occupe && generationAvant === generation && precedente && courante && (precedente.relais ?? precedente.url) !== (courante.relais ?? courante.url)) {
        await pont.direct!.renouveler(new URL(courante.relais ?? courante.url, window.location.href).href).catch(() => false);
      }
    }
    async function ouvrir(prochain: number, manuel = false) {
      const tour = ++generation;
      const source = liste[prochain];
      if (!source || annule) { arret(); return; }
      if (formatAdresse(source.url) === "dash") { arret(); return; }
      if (manuel) tentatives = 0;
      index = prochain; setRang(index); setPause(false); pauseRef.current = false;
      ouverture = progres = Date.now(); pret = false; images = 0; stable = 0; rapport = 0; occupe = true;
      setMessage("Préparation de la lecture…");
      try {
        const cible = new URL(source.relais ?? source.url, window.location.href);
        const resultat = await pont.direct!.ouvrir(cible.href);
        if (annule || tour !== generation) return;
        if (!resultat.ok) { occupe = false; await reprendre(); return; }
        await pont.lecteur!.vitesse(1); await pont.lecteur!.volume(volumeRef.current);
        ouverture = progres = Date.now(); occupe = false;
      } catch { if (!annule && tour === generation) { occupe = false; await reprendre(); } }
    }
    async function reprendre() {
      if (annule || repliDemande || occupe || pauseRef.current) return;
      occupe = true; tentatives += 1; stable = 0;
      if (tentatives > 2) { arret(); return; }
      const source = liste[index];
      if (source) void api.resultatChaineLive(chaine.id, source.url, false, undefined, "relais", "bureau-vlc").catch(() => {});
      // Relire les accès avant de relancer la même source, puis essayer la suivante.
      await actualiser().catch(() => {});
      if (!annule) { occupe = false; await ouvrir(tentatives === 1 ? index : (index + 1) % liste.length); }
    }
    commande.current = (i) => { void ouvrir(i, true); };
    const desabonner = pont.lecteur!.surEtat((e) => {
      if (annule || occupe || !e.ouvert) return;
      setEtat(e);
      const maintenant = Date.now();
      if (e.imagesAffichees > images) {
        images = e.imagesAffichees; progres = maintenant; pret = true; setMessage(null);
        if (!stable) stable = maintenant;
        if (maintenant - stable >= 15_000 && maintenant - rapport >= 120_000) {
          rapport = maintenant; tentatives = 0;
          const s = liste[index];
          if (s) void api.resultatChaineLive(chaine.id, s.url, true, 15, "relais", "bureau-vlc").catch(() => {});
        }
      }
      if ((e.erreur || e.termine) && !pauseRef.current) void reprendre();
    });
    const surveillance = window.setInterval(() => {
      if (annule || occupe || pauseRef.current) { progres = Date.now(); stable = 0; return; }
      if ((!pret && Date.now() - ouverture > 25_000) || (pret && Date.now() - progres > 15_000)) void reprendre();
      void pont.direct!.diagnostic().then((d) => {
        if (annule || !d) return;
        setCache(d);
        if (/Relais HTTP (401|403|404)/.test(d.incident) && Date.now() - dernierRenouvellement >= 30_000) {
          void actualiser().catch(() => {});
        }
      }).catch(() => {});
    }, 1_000);
    const renouveler = window.setInterval(() => { void actualiser().catch(() => {}); }, 15 * 60_000);
    document.documentElement.classList.add("bureau-video"); document.body.classList.add("bureau-video");
    void actualiser().then(() => { if (!annule) return ouvrir(0); }).catch(arret);
    return () => {
      annule = true; generation += 1; desabonner(); window.clearInterval(surveillance); window.clearInterval(renouveler);
      void pont.direct!.fermer().catch(() => {});
      document.documentElement.classList.remove("bureau-video"); document.body.classList.remove("bureau-video");
    };
  }, [chaine.id, onRepli, pont]);
  const volumeRef = useRef(volume); volumeRef.current = volume;

  useEffect(() => {
    const minuterie = window.setInterval(() => {
      if (!pause && !choix && Date.now() - derniereAction.current >= 3_500) { setVisible(false); setDiagnostic(false); }
    }, 250);
    const clavier = (e: KeyboardEvent) => {
      reveiller();
      if ((e.target as HTMLElement)?.matches("input,select,textarea")) return;
      if (e.key === "Escape") { if (choix) setChoix(false); else onClose(); }
      if (e.key === " " || e.key === "k") { e.preventDefault(); mettreEnPause(); }
      if (e.key.toLowerCase() === "f") basculerPleinEcran();
      if (e.key.toLowerCase() === "p" && precedente) onChaine(precedente);
    };
    window.addEventListener("keydown", clavier);
    return () => { window.clearInterval(minuterie); window.removeEventListener("keydown", clavier); };
  }, [pause, choix, onClose, precedente, onChaine, pont]);

  useSurfaceDiffusion({
    etat: () => ({ contenu: { genre: "direct", id: chaine.id, titre: chaine.nom },
      lecture: !etat?.ouvert ? "chargement" : etat.enLecture ? "lecture" : "pause",
      position: 0, duree: 0, volume, navigation: false, erreur: etat?.erreur ?? null }),
    commander: async (c) => {
      if (c.type === "pause") { await pont.lecteur!.pause(); setPause(true); pauseRef.current = true; }
      else if (c.type === "reprendre") { await pont.lecteur!.lire(); setPause(false); pauseRef.current = false; }
      else if (c.type === "volume") { await pont.lecteur!.volume(c.valeur); setVolume(c.valeur); }
      else if (c.type === "arreter") onClose();
      else throw new Error("Déplacement distant indisponible pour le direct");
    },
  });
  return <div className={`lecteur-direct lecteur-direct-bureau${visible ? " commandes" : ""}`}
    role="dialog" aria-modal="true" aria-label={`Chaîne ${chaine.nom}`}
    onPointerMove={reveiller} onPointerDownCapture={reveiller} onFocusCapture={reveiller}>
    <div className="lecteur-direct-barre" inert={!visible} aria-hidden={!visible}>
      <BoutonDiffusion />
      <button type="button" className="player-icon-button" onClick={onClose} aria-label="Fermer" title="Fermer">←</button>
      {precedente && <button type="button" className="player-icon-button" onClick={() => onChaine(precedente)} aria-label="Chaîne précédente" title="Chaîne précédente">⇄</button>}
      <div className="lecteur-direct-titre"><b>{chaine.nom}</b><small>{chaine.groupe} · <button type="button"
        className="lecteur-direct-sources" aria-expanded={choix} onClick={() => setChoix(!choix)}>Source {rang + 1}/{sources.length} ▾</button></small></div>
    </div>
    {choix && <ul className="lecteur-direct-choix" aria-label="Sources de la chaîne">
      {sources.map((s, i) => <li key={s.identifiant ?? i}><button type="button" className={i === rang ? "actif" : undefined}
        onClick={() => { setChoix(false); commande.current(i); }}><b>Source {i + 1}</b><small>{s.hauteur ? `${s.hauteur}p` : "Qualité automatique"}</small></button></li>)}
    </ul>}
    {visible && <div className="lecteur-direct-progression player-command-row">
      <button type="button" className="player-icon-button" onClick={mettreEnPause}
        aria-label={pause ? "Reprendre" : "Pause"} title={pause ? "Reprendre" : "Pause"}>{pause ? "▶" : "Ⅱ"}</button>
      <label className="lecteur-direct-volume">Volume <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => {
        const v = Number(e.target.value); setVolume(v); void pont.lecteur!.volume(v);
      }} /></label>
      <span className="lecteur-direct-piste-absente" />
      <button type="button" onClick={() => commande.current(rang)}>Revenir au direct</button>
      <button type="button" className="player-icon-button" onClick={basculerPleinEcran}
        aria-label={pleinEcran ? "Quitter le plein écran" : "Plein écran"}
        title={pleinEcran ? "Quitter le plein écran" : "Plein écran"}>{pleinEcran ? "⤡" : "⤢"}</button>
    </div>}
    <details className="lecteur-direct-diagnostic" hidden={!visible} open={diagnostic}
      onToggle={(e) => setDiagnostic(e.currentTarget.open)}><summary>Diagnostic de lecture</summary>
      {diagnostic && <><dl><dt>Moteur</dt><dd>VLC intégré</dd><dt>Segments préchargés devant VLC</dt><dd>{Math.round(cache.reserveCacheSecondes)} s</dd>
        <dt>Cache local</dt><dd>{(cache.cacheOctets / 1048576).toFixed(1)} Mio / 64 Mio</dd>
        <dt>Tampon décodé / retard</dt><dd>Non mesurés par VLC</dd><dt>Images affichées / perdues</dt><dd>{etat?.imagesAffichees ?? 0} / {etat?.imagesPerdues ?? 0}</dd>
        <dt>Dernier événement</dt><dd>{cache.incident || "Aucun"}</dd></dl>
        <button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ moteur: "bureau-vlc", source: rang + 1,
            cache, imagesAffichees: etat?.imagesAffichees ?? 0, imagesPerdues: etat?.imagesPerdues ?? 0,
            retardSecondes: null, tamponDecodeSecondes: null }, null, 2)], { type: "application/json" }));
          const lien = document.createElement("a"); lien.href = url; lien.download = "flixtunes-diagnostic-live.json"; lien.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        }}>Exporter le diagnostic</button>
        <button type="button" onClick={onRepli}>Utiliser le lecteur Web</button></>}
    </details>
    {message && <p className="lecteur-direct-message" role="status">{message}</p>}
  </div>;
}
