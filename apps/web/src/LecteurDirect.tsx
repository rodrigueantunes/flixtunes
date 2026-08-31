import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { ChaineDirect } from "@flixtunes/contracts";
import { api } from "./api";

/**
 * Le lecteur d'une chaîne en direct.
 *
 * Il est séparé de `Player.tsx`, et ce n'est pas un doublon : les deux ne partagent presque rien.
 * Le lecteur de la médiathèque négocie une session avec le serveur, choisit un mode de conversion,
 * gère les pistes, la reprise, les sous-titres et l'enchaînement d'épisodes. Une chaîne, elle, est
 * **une adresse HLS qu'on ouvre** : pas de session, pas de position, pas de fin. Faire entrer ce cas
 * dans l'autre aurait ajouté des conditions à chaque étape d'un fichier de mille lignes, pour un
 * comportement qui n'a rien à voir.
 *
 * Ce qu'il apporte en propre, et qui est tout l'intérêt du modèle de l'étape 1 : **le repli**. Une
 * chaîne porte en moyenne une adresse et demie, et 57 % des entrées du corpus sont des doublons.
 * Quand la première refuse, on prend la suivante — sans message d'erreur, parce que la personne
 * devant l'écran n'a rien demandé d'autre que de regarder la chaîne.
 */

/** Au-delà, on ne s'acharne pas : quatre adresses mortes disent que la chaîne l'est. */
const REPLIS = 4;

/** Une adresse et son doublon relayé, tels que le serveur les rend. */
interface SourceLisible { url: string; relais: string | null }

export function LecteurDirect({ chaine, onClose }: { chaine: ChaineDirect; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [adresses, setAdresses] = useState<SourceLisible[]>([]);
  /**
   * Passe-t-on par le relais du serveur pour l'adresse en cours ?
   *
   * Deux refus du navigateur ne se réparent pas côté navigateur : l'absence d'en-tête CORS — vu à
   * l'écran en `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` sur une chaîne pourtant vivante — et le
   * contenu `http` nu dans une page HTTPS. Dans ces deux cas seulement, le NAS recopie les octets.
   * Une adresse n'est donc jamais relayée d'emblée : elle l'est **après** un échec direct.
   */
  const [parRelais, setParRelais] = useState(false);
  const [rang, setRang] = useState(0);
  const rangRef = useRef(0);
  const [message, setMessage] = useState<string | null>("Ouverture de la chaîne…");
  const [echec, setEchec] = useState(false);
  /** L'adresse en cours d'essai, pour ne rapporter au serveur que ce qu'on a réellement tenté. */
  const essai = useRef<string | null>(null);

  useEffect(() => {
    let annule = false;
    api.chaineLive(chaine.id)
      .then((details) => {
        if (annule) return;
        rangRef.current = 0;
        setRang(0);
        setParRelais(false);
        setAdresses(details.sources.map((source) => ({ url: source.url, relais: source.relais ?? null })));
      })
      .catch(() => { if (!annule) { setMessage("Chaîne indisponible"); setEchec(true); } });
    return () => { annule = true; };
  }, [chaine.id]);

  /**
   * Passe à l'adresse suivante.
   *
   * L'échec est rapporté au serveur avant de changer : c'est ainsi que l'ordre d'essai s'améliore
   * tout seul, et que l'état d'une chaîne se mesure à l'usage plutôt qu'en sondant cent mille
   * adresses — ce qui était la décision n° 5 du chantier.
   *
   * **Le rang vit dans une référence, et le calcul est fait ici plutôt que dans `setRang`.** La
   * première écriture posait les messages et le rapport d'échec *à l'intérieur* de la fonction de
   * mise à jour de l'état : React l'appelle deux fois en mode strict, et le journal du navigateur
   * l'a montré — **quatre** `POST /resultat` pour un seul échec, donc un compteur faussé et un
   * classement des adresses corrompu par l'affichage. `essai` remis à zéro dès l'entrée sert de
   * verrou : une seconde erreur signalée avant que la source suivante ne s'ouvre ne fait rien.
   */
  const suivante = useCallback(() => {
    const morte = essai.current;
    if (!morte) return;
    essai.current = null;
    /*
     * Une seconde chance par le relais **avant** de changer d'adresse.
     *
     * L'adresse n'est pas forcément mauvaise : c'est peut-être le navigateur qui a refusé de la lire.
     * Passer à la suivante sans avoir essayé le relais condamnerait une chaîne qui marche, et
     * inscrirait un échec qui n'en est pas un dans le classement des adresses.
     */
    const courante = adresses[rangRef.current];
    if (!parRelais && courante?.relais) {
      setParRelais(true);
      // `parRelais` figure dans les dépendances de l'effet de lecture : le changer relance la même
      // adresse, cette fois relayée. `essai` reste vide jusque-là, ce qui empêche une seconde erreur
      // arrivée entre-temps de faire sauter une adresse pour rien.
      setMessage("Nouvel essai par le serveur…");
      return;
    }
    void api.resultatChaineLive(chaine.id, morte, false).catch(() => undefined);
    const disponibles = Math.min(adresses.length, REPLIS);
    const prochain = rangRef.current + 1;
    if (prochain >= disponibles) {
      setMessage("Aucune source ne répond pour cette chaîne.");
      setEchec(true);
      return;
    }
    rangRef.current = prochain;
    setParRelais(false);
    setMessage(`Source ${prochain + 1} sur ${disponibles}…`);
    setRang(prochain);
  }, [adresses, chaine.id, parRelais]);

  useEffect(() => {
    const element = videoRef.current;
    const entree = adresses[rang];
    if (!element || !entree || echec) return;
    /*
     * Le contenu mixte se voit d'avance, lui : une page HTTPS ne demandera même pas une adresse en
     * `http` nu. Inutile d'attendre un échec que le navigateur annonce déjà — on part relayé.
     */
    const mixte = window.location.protocol === "https:" && entree.url.startsWith("http:");
    const relayer = (parRelais || mixte) && entree.relais;
    const source = relayer ? entree.relais! : entree.url;
    essai.current = entree.url;
    let annule = false;
    let minuteur = 0;

    const reussi = () => {
      if (annule) return;
      setMessage(null);
      window.clearTimeout(minuteur);
      // C'est l'adresse d'origine qu'on note, jamais celle du relais : le classement porte sur la
      // source, et le relais n'est qu'un chemin pour y aller.
      void api.resultatChaineLive(chaine.id, entree.url, true).catch(() => undefined);
    };

    void (async () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      /*
       * Un direct qui ne démarre pas ne le dit pas toujours : un hébergeur peut accepter la connexion
       * puis ne rien envoyer. Sans cette échéance, la chaîne resterait noire indéfiniment au lieu de
       * basculer sur son secours.
       */
      minuteur = window.setTimeout(() => { if (!annule) suivante(); }, 12_000);

      const natif = element.canPlayType("application/vnd.apple.mpegurl");
      const HlsClass = "MediaSource" in window ? (await import("hls.js")).default : null;
      if (annule) return;

      if (HlsClass?.isSupported()) {
        /*
         * Les réglages diffèrent de ceux du lecteur de la médiathèque, et pour une raison de fond :
         * un direct n'a pas de début. On démarre au bord du flux — c'est ce que « en direct » veut
         * dire — et on ne garde pas quatre-vingt-dix secondes derrière soi, qui ne servent qu'à un
         * retour en arrière impossible ici.
         */
        const hls = new HlsClass({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30,
          maxBufferLength: 20, liveSyncDurationCount: 3, capLevelToPlayerSize: false });
        hlsRef.current = hls;
        hls.loadSource(source);
        hls.attachMedia(element);
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => { void element.play().catch(() => undefined); });
        hls.on(HlsClass.Events.FRAG_BUFFERED, reussi);
        hls.on(HlsClass.Events.ERROR, (_evenement, donnees) => {
          if (!donnees.fatal || annule) return;
          // Une erreur fatale sur un direct ne se répare pas en réessayant la même adresse : la
          // source est en panne, et la suivante est déjà connue.
          hls.destroy();
          hlsRef.current = null;
          suivante();
        });
      } else if (natif) {
        // Safari lit HLS nativement, et n'a alors besoin ni de MediaSource ni de CORS.
        element.src = source;
        element.addEventListener("playing", reussi, { once: true });
        element.addEventListener("error", () => { if (!annule) suivante(); }, { once: true });
        void element.play().catch(() => undefined);
      } else {
        setMessage("Ce navigateur ne sait pas lire un flux en direct.");
        setEchec(true);
      }
    })();

    return () => {
      annule = true;
      window.clearTimeout(minuteur);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [adresses, chaine.id, echec, parRelais, rang, suivante]);

  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent) => { if (evenement.key === "Escape") onClose(); };
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [onClose]);

  const sources = Math.min(adresses.length, REPLIS);

  return <div className="lecteur-direct" role="dialog" aria-modal="true" aria-label={`Chaîne ${chaine.nom}`}>
    <video ref={videoRef} autoPlay playsInline muted={false} />
    <div className="lecteur-direct-barre">
      <button type="button" className="player-icon-button" onClick={onClose} aria-label="Fermer">←</button>
      <div className="lecteur-direct-titre">
        <b>{chaine.numero != null ? `${chaine.numero} · ` : ""}{chaine.nom}</b>
        {/*
          * Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source explique une
          * qualité différente sans transformer un rattrapage réussi en incident.
          */}
        <small>
          {chaine.groupe ?? "En direct"}
          {sources > 1 ? ` · source ${rang + 1}/${sources}` : ""}
          {parRelais ? " · relayée par le serveur" : ""}
        </small>
      </div>
    </div>
    {message && <p className={`lecteur-direct-message${echec ? " echec" : ""}`} role="status">{message}</p>}
  </div>;
}
