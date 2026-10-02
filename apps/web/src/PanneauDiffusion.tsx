import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AccuseDiffusion, CibleDiffusion, CommandeDiffusion, EtatDiffusion } from "@flixtunes/contracts";
import { api } from "./api";
import type { Catalogue } from "./Diffusion";
import { surfaceDiffusion } from "./diffusion-surface";
import { attendre, message, etatDiffusionVide, marquerTransfert } from "./diffusion-utilitaires";
type VideoAirPlay = HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void; webkitCurrentPlaybackTargetIsWireless?: boolean };
export default function PanneauDiffusion({ catalogue, monId, ouvert, fermerPanneau }: { catalogue: Catalogue; monId: RefObject<string | null>; ouvert: boolean; fermerPanneau: () => void }) {
  const [cibles, setCibles] = useState<CibleDiffusion[]>([]), [selection, choisir] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null), [travail, setTravail] = useState(false);
  const [locale, setLocale] = useState<EtatDiffusion>(etatDiffusionVide);
  const [airplay, setAirplay] = useState<{ url: string; cle: string; position: number; decalage: number; contenu: EtatDiffusion["contenu"]; duree: number; source: ReturnType<typeof surfaceDiffusion>; compatible: boolean } | null>(null);
  const [airplayActif, setAirplayActif] = useState(false);
  const lecteurAirplay = useRef<VideoAirPlay | null>(null);
  const panneau = useRef<HTMLDivElement | null>(null);
  const airplayDisponible = typeof document !== "undefined" && "webkitShowPlaybackTargetPicker" in document.createElement("video");

  useEffect(() => {
    if (!ouvert || !catalogue) return; let abandon = false;
    const precedent = document.activeElement as HTMLElement | null; panneau.current?.focus();
    const boucle = async () => { while (!abandon) {
      try {
        const r = await api.diffusion<{ cibles: CibleDiffusion[] }>(catalogue.profil, "cibles");
        if (!abandon) { setCibles(r.cibles.filter((c) => c.id !== monId.current)); setLocale(surfaceDiffusion()?.current.etat() ?? etatDiffusionVide()); }
      } catch (e) { if (!abandon) setErreur(message(e)); }
      await attendre(2500);
    } };
    void boucle(); return () => { abandon = true; precedent?.focus(); };
  }, [ouvert, catalogue?.profil]);
  useEffect(() => { choisir(null); setCibles([]); setAirplay(null); setAirplayActif(false); }, [catalogue.profil]);

  async function envoyer(c: CommandeDiffusion, id = selection) {
    if (!catalogue || !id) return; setTravail(true); setErreur(null);
    const source = surfaceDiffusion();
    try {
      const r = await api.diffusion<{ ordre?: string; ok?: boolean }>(catalogue.profil, `cibles/${encodeURIComponent(id)}/commande`, c);
      if (r.ordre) {
        const limite = Date.now() + 30_000; let resultat: AccuseDiffusion | null = null;
        while (!resultat && Date.now() < limite) {
          await attendre(500);
          resultat = (await api.diffusion<{ resultat: AccuseDiffusion | null }>(catalogue.profil, `cibles/${id}/ordres/${r.ordre}`)).resultat;
        }
        if (!resultat) throw new Error("Le lecteur n’a pas confirmé la commande. La lecture locale est conservée.");
        if (!resultat.ok) throw new Error(resultat.erreur || "Commande refusée par le lecteur");
      }
      if (c.type === "charger" && source === surfaceDiffusion()) { marquerTransfert(source); await source?.current.commander({ type: "pause" }); }
      choisir(id);
    } catch (e) { setErreur(message(e)); }
    finally { setTravail(false); }
  }
  const cible = cibles.find((c) => c.id === selection), etat = cible?.etat;
  const fermer = () => { fermerPanneau(); setErreur(null); };
  async function preparerAirplay(compatible = false) {
    const precedente = compatible ? airplay : null;
    const contenu = precedente?.contenu ?? locale.contenu;
    if (!contenu || !catalogue) return; setTravail(true); setErreur(null);
    const source = precedente?.source ?? surfaceDiffusion();
    const temps = lecteurAirplay.current?.currentTime;
    const position = precedente ? (Number.isFinite(temps) ? temps! : precedente.position) + precedente.decalage : locale.position;
    try {
      if (precedente) { await api.diffusion(catalogue.profil, `airplay/${precedente.cle}/arreter`, {}); setAirplay(null); setAirplayActif(false); }
      const r = await api.diffusion<{ url: string; cle: string; position: number; decalage: number }>(catalogue.profil, "airplay", { contenu, position, compatible });
      setAirplay({ ...r, source, contenu, duree: precedente?.duree ?? locale.duree, compatible }); }
    catch (e) { setErreur(message(e)); } finally { setTravail(false); }
  }
  useEffect(() => {
    const video = lecteurAirplay.current; if (!video || !airplay) return;
    let sauvegarde = 0;
    const progresser = () => {
      if (!video.webkitCurrentPlaybackTargetIsWireless || airplay.contenu?.genre !== "media" || !Number.isFinite(video.currentTime) || airplay.duree <= 0) return;
      void api.saveProgress(airplay.contenu.id, catalogue.profil, video.currentTime + airplay.decalage, airplay.duree).catch(() => undefined);
    };
    const progression = () => { if (Date.now() - sauvegarde > 10_000) { sauvegarde = Date.now(); progresser(); } };
    const constater = () => { const actif = !!video.webkitCurrentPlaybackTargetIsWireless; setAirplayActif(actif);
      if (actif && !video.paused && airplay.source === surfaceDiffusion()) { marquerTransfert(airplay.source); void airplay.source?.current.commander({ type: "pause" }); } };
    const changerSortie = () => { constater(); if (video.webkitCurrentPlaybackTargetIsWireless) void video.play().catch((e) => setErreur(message(e))); else video.pause(); };
    video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", changerSortie); video.addEventListener("playing", constater);
    video.addEventListener("timeupdate", progression); video.addEventListener("pause", progresser);
    return () => { progresser(); video.pause(); video.removeAttribute("src");
      video.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", changerSortie); video.removeEventListener("playing", constater);
      video.removeEventListener("timeupdate", progression); video.removeEventListener("pause", progresser);
      void api.diffusion(catalogue.profil, `airplay/${airplay.cle}/arreter`, {}).catch(() => undefined); };
  }, [airplay]);

  return <>
    {airplay && <video key={airplay.cle} ref={lecteurAirplay} src={airplay.url} playsInline className="cast-airplay-video" aria-label="Lecture AirPlay"
      onError={() => setErreur("AirPlay n’a pas pu lire ce média. Vérifiez l’accès du récepteur au NAS ou essayez le format compatible.")}
      onLoadedMetadata={(e) => { e.currentTarget.currentTime = airplay.position; }} />}
    {ouvert && catalogue && createPortal(<div className="cast-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !travail) fermer(); }}>
      <div ref={panneau} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cast-title" className="cast-panel" onKeyDown={(e) => {
        if (e.key === "Escape" && !travail) { e.stopPropagation(); fermer(); }
        if (e.key === "Tab") { const elements = panneau.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
          if (elements?.length) { const premier = elements[0]!, dernier = elements[elements.length - 1]!;
            if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
            else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); } }
        }
      }}>
        <div className="cast-heading"><h2 id="cast-title">Caster et piloter</h2><button onClick={fermer} disabled={travail} aria-label="Fermer">✕</button></div>
        <p>Appareils du réseau local · lecteurs FlixTunes connectés au même profil.</p>
        {erreur && <p role="alert" className="cast-error">{erreur}</p>}
        {travail && <p role="status">En attente du récepteur…</p>}
        <div className="cast-targets">{cibles.map((c) => <button key={c.id} disabled={c.occupe || travail} aria-pressed={selection === c.id} onClick={() => choisir(c.id)}>
          <strong>{c.nom}</strong><small>{c.protocole === "googlecast" ? "Google Cast" : c.protocole === "dlna" ? "DLNA" : "FlixTunes"}{c.occupe ? " · utilisé par un autre profil" : c.etat?.contenu ? ` · ${c.etat.contenu.titre}` : ""}</small>
        </button>)}</div>
        {!cibles.length && <p>Aucun appareil détecté pour le moment. Vérifiez qu’il est allumé et connecté au même réseau que le NAS.</p>}
        {cible && <section className="cast-remote" aria-label={`Télécommande de ${cible.nom}`}>
          <h3>{cible.nom}</h3>
          {locale.contenu && <button className="primary" disabled={travail} onClick={() => void envoyer({ type: "charger", contenu: locale.contenu!, position: locale.position })}>Diffuser « {locale.contenu.titre} » ici</button>}
          {!locale.contenu && !etat?.contenu && <p>Lancez un film, un épisode, une vidéo Web ou une chaîne, puis choisissez cet appareil.</p>}
          {etat?.contenu && <><p>{etat.contenu.titre} · {etat.lecture}</p>{etat.qualite && <p>{etat.qualite}</p>}<div className="cast-transport">
            <button disabled={travail} onClick={() => void envoyer({ type: etat.lecture === "pause" ? "reprendre" : "pause" })}>{etat.lecture === "pause" ? "Reprendre" : "Pause"}</button>
            <button disabled={travail} onClick={() => void envoyer({ type: "arreter" })}>Arrêter</button>
          </div>
          {etat.navigation && etat.duree > 0 && <label>Position <input aria-label="Position de lecture" type="range" min="0" max={etat.duree} step="1" defaultValue={etat.position} key={`${cible.id}-${Math.floor(etat.position / 5)}`} disabled={travail}
            onPointerUp={(e) => void envoyer({ type: "position", valeur: Number(e.currentTarget.value) })}
            onKeyUp={(e) => { if (e.key.startsWith("Arrow")) void envoyer({ type: "position", valeur: Number(e.currentTarget.value) }); }} /></label>}
          <label>Volume <input aria-label="Volume distant" type="range" min="0" max="1" step="0.05" defaultValue={etat.volume} key={`${cible.id}-${etat.volume}`} disabled={travail}
            onPointerUp={(e) => void envoyer({ type: "volume", valeur: Number(e.currentTarget.value) })}
            onKeyUp={(e) => { if (e.key.startsWith("Arrow")) void envoyer({ type: "volume", valeur: Number(e.currentTarget.value) }); }} /></label>
          {etat.erreur && <p role="alert">{etat.erreur}</p>}
          </>}
        </section>}
        {airplayDisponible && <section className="cast-airplay"><h3>AirPlay</h3>
          {!airplay && <button disabled={!locale.contenu || travail} onClick={() => void preparerAirplay()}>Préparer AirPlay</button>}
          {airplay && <><button onClick={() => { lecteurAirplay.current?.webkitShowPlaybackTargetPicker?.(); }}>Choisir l’appareil AirPlay</button>
            {!airplay.compatible && airplay.contenu?.genre === "media" && <button disabled={travail} onClick={() => void preparerAirplay(true)}>Réessayer en format compatible</button>}
            {airplayActif && <button onClick={() => { const v = lecteurAirplay.current; if (v) { if (v.paused) void v.play().catch((e) => setErreur(message(e))); else v.pause(); } }}>Lecture / Pause</button>}
            <button disabled={travail} onClick={() => { lecteurAirplay.current?.pause(); setAirplay(null); setAirplayActif(false); }}>Arrêter AirPlay</button></>}
        </section>}
        <small>Le cast continue lorsque cette fenêtre est fermée. Pause et déplacement dans le direct dépendent du récepteur et de son tampon.</small>
      </div>
    </div>, document.fullscreenElement ?? document.body)}
  </>;
}
