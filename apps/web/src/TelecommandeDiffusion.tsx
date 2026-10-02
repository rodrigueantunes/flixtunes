import { useEffect, useRef, useState } from "react";
import type { CibleDiffusion, CommandeDiffusion } from "@flixtunes/contracts";
import type { ContexteDiffusion } from "./Diffusion";
import { duree, libelleEtat, message } from "./diffusion-utilitaires";

/** Les commandes communes : une commande à la fois, et son erreur affichée là où on l'a donnée. */
function useCommandes(cible: CibleDiffusion, contexte: ContexteDiffusion) {
  const [travail, setTravail] = useState(false), [erreur, setErreur] = useState<string | null>(null);
  const envoyer = async (c: CommandeDiffusion) => {
    setTravail(true); setErreur(null);
    try { await contexte.commander(cible.id, c); } catch (e) { setErreur(message(e)); } finally { setTravail(false); }
  };
  return { travail, erreur, envoyer };
}

/**
 * La position affichée avance entre deux relevés du serveur, pour que la barre ne saute pas de
 * seconde en seconde. Elle se recale à chaque relevé.
 */
function usePositionLissee(cible: CibleDiffusion) {
  const etat = cible.etat!, releve = useRef({ position: etat.position, a: Date.now() });
  const [, rafraichir] = useState(0);
  useEffect(() => { releve.current = { position: etat.position, a: Date.now() }; }, [etat.position, etat.lecture]);
  useEffect(() => {
    if (etat.lecture !== "lecture") return;
    const minuteur = setInterval(() => rafraichir((n) => n + 1), 1000);
    return () => clearInterval(minuteur);
  }, [etat.lecture]);
  const ecoule = etat.lecture === "lecture" ? (Date.now() - releve.current.a) / 1000 : 0;
  return Math.min(etat.duree || Number.POSITIVE_INFINITY, releve.current.position + ecoule);
}

function Commandes({ cible, contexte, compact }: { cible: CibleDiffusion; contexte: ContexteDiffusion; compact?: boolean }) {
  const etat = cible.etat!, { travail, erreur, envoyer } = useCommandes(cible, contexte);
  const position = usePositionLissee(cible);
  const [glisse, setGlisse] = useState<number | null>(null);
  const prete = etat.lecture === "lecture" || etat.lecture === "pause";
  return <>
    {etat.lecture === "chargement"
      ? <div className="cast-relais-actions"><span className="cast-attente" aria-hidden="true" />
        <button type="button" disabled={travail} onClick={() => void envoyer({ type: "arreter" })}>Annuler</button></div>
      : <div className="cast-relais-actions">
        <button type="button" className="cast-relais-lecture" disabled={travail || !prete} aria-label={etat.lecture === "pause" ? "Reprendre sur le téléviseur" : "Mettre en pause sur le téléviseur"}
          onClick={() => void envoyer({ type: etat.lecture === "pause" ? "reprendre" : "pause" })}>{etat.lecture === "pause" ? "▶" : "❚❚"}</button>
        <button type="button" disabled={travail} onClick={() => void envoyer({ type: "arreter" })}>Arrêter la diffusion</button>
      </div>}
    {!compact && prete && etat.navigation && etat.duree > 0 && <label className="cast-relais-barre">
      <span>{duree(glisse ?? position)}</span>
      <input type="range" aria-label="Position sur le téléviseur" min={0} max={etat.duree} step={1} value={glisse ?? position} disabled={travail}
        onChange={(e) => setGlisse(Number(e.currentTarget.value))}
        onPointerUp={() => { if (glisse != null) { void envoyer({ type: "position", valeur: glisse }); setGlisse(null); } }}
        onKeyUp={(e) => { if (glisse != null && e.key.startsWith("Arrow")) { void envoyer({ type: "position", valeur: glisse }); setGlisse(null); } }} />
      <span>{duree(etat.duree)}</span>
    </label>}
    {!compact && prete && <label className="cast-relais-volume">Volume
      <input type="range" aria-label="Volume du téléviseur" min={0} max={1} step={0.05} defaultValue={etat.volume} key={`${cible.id}-${etat.volume}`} disabled={travail}
        onPointerUp={(e) => void envoyer({ type: "volume", valeur: Number(e.currentTarget.value) })}
        onKeyUp={(e) => { if (e.key.startsWith("Arrow")) void envoyer({ type: "volume", valeur: Number(e.currentTarget.value) }); }} />
    </label>}
    {erreur && <p role="alert" className="cast-relais-erreur">{erreur}</p>}
  </>;
}

/** Posé sur le lecteur dont le contenu passe sur un téléviseur : le lecteur devient la télécommande. */
export function TelecommandeLecteur({ cible, contexte, onReprendreIci }: { cible: CibleDiffusion; contexte: ContexteDiffusion; onReprendreIci: (position: number) => void }) {
  const etat = cible.etat!, position = usePositionLissee(cible);
  const [reprise, setReprise] = useState(false);
  const reprendre = async () => {
    setReprise(true);
    try { await contexte.commander(cible.id, { type: "arreter" }); } catch { /* le téléviseur s'arrêtera de lui-même */ }
    onReprendreIci(position);
  };
  return <section className="cast-relais" role="region" aria-label={`Télécommande de ${cible.nom}`} aria-live="polite">
    <p className="cast-relais-titre">{etat.contenu?.titre}</p>
    <h2>{libelleEtat(etat, cible.nom)}</h2>
    {etat.qualite && etat.lecture !== "chargement" && <p className="cast-relais-qualite">{etat.qualite}</p>}
    <Commandes cible={cible} contexte={contexte} />
    {etat.lecture !== "chargement" && <button type="button" className="cast-relais-ici" disabled={reprise} onClick={() => void reprendre()}>Reprendre ici</button>}
  </section>;
}

/** Sur l'accueil et partout ailleurs, tant qu'une diffusion est en cours. */
export function MiniTelecommande({ cible, contexte }: { cible: CibleDiffusion; contexte: ContexteDiffusion }) {
  const etat = cible.etat!;
  return <aside className="cast-mini" aria-label={`Diffusion sur ${cible.nom}`}>
    <button type="button" className="cast-mini-ouvrir" onClick={() => contexte.ouvrir()} aria-label={`Ouvrir la télécommande de ${cible.nom}`}>
      <strong>{etat.contenu?.titre}</strong><small>{libelleEtat(etat, cible.nom)}</small>
    </button>
    <Commandes cible={cible} contexte={contexte} compact />
  </aside>;
}
