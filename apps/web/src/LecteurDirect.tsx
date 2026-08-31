import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { ChaineDirect } from "@flixtunes/contracts";
import { api } from "./api";
import { courirLesAdresses } from "./course-adresses";

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

/** Une adresse, son doublon relayé et ce que le serveur sait d'elle. */
interface SourceLisible { url: string; relais: string | null; hauteur: number | null; debit: number | null }

/**
 * Ce qu'on dit d'une source dans le menu.
 *
 * La définition d'abord, parce que c'est ce qu'on voit ; le débit ensuite, parce qu'il explique
 * pourquoi la même définition ne se vaut pas partout. Une source jamais sondée dit son hébergeur
 * plutôt que d'inventer une qualité : le serveur la mesurera à la prochaine ouverture.
 */
function decrireSource(source: SourceLisible): string {
  const morceaux: string[] = [];
  if (source.hauteur != null) morceaux.push(`${source.hauteur}p`);
  if (source.debit != null) morceaux.push(`${(source.debit / 1_000_000).toFixed(1)} Mb/s`);
  if (!morceaux.length) {
    try { return new URL(source.url).hostname; } catch { return "source"; }
  }
  return morceaux.join(" · ");
}

/**
 * Ce qu'un direct laisse derrière lui, mesuré sur le corpus.
 *
 * Soixante chaînes françaises sondées, treize manifestes lisibles : **fenêtre médiane de 61 s**,
 * 92 % entre 30 s et 2 min, et une exception à quatre heures — Arte et ses 1 875 segments. Les
 * segments durent 8 s de médiane. Ces deux chiffres commandent tout ce qui suit : de combien on peut
 * reculer, et ce qu'une barre de progression a le droit de promettre.
 */
const SEGMENT_TYPE_S = 8;

/** Le saut d'une flèche. Dix secondes, comme partout ailleurs : ce n'est pas le moment d'innover. */
const SAUT_S = 10;

/** La barre s'efface d'elle-même : on regarde la télévision, pas une interface. */
const REPOS_BARRE_MS = 3_500;

/** Trois blocages dans cette fenêtre, et le lecteur recule. */
const MEMOIRE_BLOCAGES_MS = 120_000;
const BLOCAGES_AVANT_RECUL = 3;

/** Au-delà de deux segments, une fenêtre mérite une barre. En deçà, elle ne promettrait rien. */
const FENETRE_MINIMALE_S = 2 * SEGMENT_TYPE_S;

/** Le direct, c'est le bord à quelques secondes près : au-delà, on est en différé et on le dit. */
const MARGE_DIRECT_S = 12;

function horodatage(secondes: number): string {
  const entier = Math.max(0, Math.round(secondes));
  const minutes = Math.floor(entier / 60);
  return `${minutes}:${String(entier % 60).padStart(2, "0")}`;
}

/** Ce que la barre montre : la fenêtre publiée par la chaîne, et où l'on s'y trouve. */
interface Fenetre { debut: number; fin: number; position: number; enPause: boolean }

export function LecteurDirect({ chaine, precedente, onChaine, onClose }: {
  chaine: ChaineDirect;
  /** La chaîne quittée, ou `null` la première fois. */
  precedente: ChaineDirect | null;
  onChaine: (chaine: ChaineDirect) => void;
  onClose: () => void;
}) {
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
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [barreVisible, setBarreVisible] = useState(true);
  const [choixOuvert, setChoixOuvert] = useState(false);
  /**
   * Le retard de sécurité pris après des blocages répétés, en secondes.
   *
   * Zéro tant que tout va bien : on part **au bord du flux**, parce que c'est ce que « en direct »
   * veut dire, et on ne paie du retard que lorsqu'il est mérité.
   */
  const [securite, setSecurite] = useState(0);
  const blocages = useRef<number[]>([]);
  /**
   * Quand on a demandé quelque chose au lecteur pour la dernière fois.
   *
   * Ouvrir, sauter, reprendre : chacun de ces gestes remplit le tampon et ressemble à un hoquet.
   * Les compter revenait à se punir soi-même — trois flèches en deux minutes suffisaient à faire
   * reculer le lecteur alors que tout allait bien.
   */
  const dernierGeste = useRef(0);

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const details = await api.chaineLive(chaine.id);
        if (annule) return;
        /*
         * L'ordre vient du serveur, et il est déjà le bon : échecs, puis définition, puis débit. La
         * course qui suit ne fait qu'écarter les injoignables — elle ne reclasse pas ce qu'il a mesuré.
         */
        const declarees = details.sources.map((source) => ({
          url: source.url, relais: source.relais ?? null,
          hauteur: source.hauteur ?? null, debit: source.debit ?? null,
        }));
        /*
         * La course, avant d'ouvrir quoi que ce soit.
         *
         * Les adresses partent ensemble et l'ordre des réponses devient l'ordre d'essai : une chaîne
         * dont la première adresse est morte démarrait en treize secondes, elle démarre en une. Elle
         * ne coûte rien au NAS — ces requêtes partent d'ici — et ne jette aucune adresse : une
         * silencieuse reste jouable, elle passe simplement derrière.
         *
         * Une seule adresse ne se court pas contre elle-même : la fonction rend la liste telle quelle.
         */
        const ordonnees = await courirLesAdresses(declarees);
        if (annule) return;
        rangRef.current = 0;
        setRang(0);
        setParRelais(false);
        setAdresses(ordonnees);
      } catch {
        if (!annule) { setMessage("Chaîne indisponible"); setEchec(true); }
      }
    })();
    return () => { annule = true; };
  }, [chaine.id]);

  /** Une chaîne neuve repart au bord : le retard de sécurité était celui de la précédente. */
  useEffect(() => {
    setSecurite(0);
    blocages.current = [];
    setFenetre(null);
    setChoixOuvert(false);
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

  /**
   * Choisir une source à la main.
   *
   * Le repli automatique décide bien quand une adresse ne répond pas ; il ne sait rien de celle qui
   * répond **mal** — l'image qui se fige toutes les dix secondes, la définition qui s'effondre. Cela,
   * seule la personne devant l'écran le voit, et c'est le seul moyen qu'elle a de le dire.
   *
   * L'adresse quittée n'est **pas** rapportée comme morte : elle ne l'est pas, on lui préfère juste
   * une autre. Inscrire un échec ici fausserait le classement avec une opinion.
   */
  const choisirSource = useCallback((index: number) => {
    setChoixOuvert(false);
    if (index === rangRef.current && !parRelais) return;
    essai.current = null;
    rangRef.current = index;
    setParRelais(false);
    setEchec(false);
    setMessage(`Source ${index + 1}…`);
    setRang(index);
  }, [parRelais]);

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
    // Ouvrir un flux remplit le tampon : c'est un geste, pas un hoquet.
    dernierGeste.current = Date.now();
    let annule = false;
    let minuteur = 0;
    let reparations = 0;

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
         * dire.
         *
         * **`lowLatencyMode` est éteint, et c'est une correction.** Il vise le LL-HLS et ses segments
         * partiels ; sur les treize manifestes mesurés, aucun n'en publie — 8 s de segment, huit
         * segments à la fois. Allumé, il ne faisait donc que serrer la marge devant un flux qui n'a
         * rien de faible latence, et transformait chaque hoquet du réseau en gel de l'image.
         *
         * `backBufferLength` garde une minute derrière le point de lecture : c'est ce qui rend le
         * retour en arrière de la barre instantané sur la fenêtre médiane, au lieu de rappeler les
         * segments à l'hébergeur.
         */
        const hls = new HlsClass({
          enableWorker: true, lowLatencyMode: false, backBufferLength: 60,
          maxBufferLength: 30, liveSyncDurationCount: 3, capLevelToPlayerSize: false,
        });
        hlsRef.current = hls;
        hls.loadSource(source);
        hls.attachMedia(element);
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => { void element.play().catch(() => undefined); });
        hls.on(HlsClass.Events.FRAG_BUFFERED, reussi);
        hls.on(HlsClass.Events.ERROR, (_evenement, donnees) => {
          if (annule) return;
          /*
           * Le blocage du tampon n'est pas une panne, c'est un avertissement.
           *
           * Il arrive et se répare seul. Mais trois fois en deux minutes, il dit que cette source ne
           * tient pas la cadence à laquelle on la lit — et la réponse n'est pas d'en changer, c'est
           * de **reculer**. Deux segments de plus derrière le bord, soit une quinzaine de secondes,
           * pris dans les 37 s de marge que la fenêtre médiane laisse. On le paie une fois, et
           * l'image tient.
           */
          if (donnees.details === HlsClass.ErrorDetails.BUFFER_STALLED_ERROR) {
            const maintenant = Date.now();
            // Quatre secondes de répit : ce qui recharge juste après un geste vient de nous.
            if (maintenant - dernierGeste.current < 4_000) return;
            blocages.current = [...blocages.current, maintenant]
              .filter((instant) => maintenant - instant < MEMOIRE_BLOCAGES_MS);
            if (blocages.current.length >= BLOCAGES_AVANT_RECUL && hls.config.liveSyncDurationCount < 5) {
              hls.config.liveSyncDurationCount = 5;
              blocages.current = [];
              setSecurite(2 * Math.round(hls.levels[hls.currentLevel]?.details?.targetduration ?? SEGMENT_TYPE_S));
            }
            return;
          }
          if (!donnees.fatal) return;
          /*
           * Réparer avant d'abandonner.
           *
           * Une erreur fatale de **média** est un segment que le décodeur refuse : elle se répare sur
           * place, et hls.js a la manœuvre pour cela. Changer de source à la première occurrence
           * coupait l'image pendant plusieurs secondes pour un incident qui en dure une — et
           * inscrivait au passage un échec dans le classement d'une adresse qui marche.
           *
           * Deux tentatives, pas plus : la seconde échange les codecs audio, et si cela ne suffit
           * pas, la source est bien en cause.
           */
          if (donnees.type === HlsClass.ErrorTypes.MEDIA_ERROR && reparations < 2) {
            reparations += 1;
            if (reparations > 1) hls.swapAudioCodec();
            hls.recoverMediaError();
            return;
          }
          // Une erreur fatale de réseau sur un direct ne se répare pas en réessayant la même
          // adresse : la source est en panne, et la suivante est déjà connue.
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

  /**
   * Ce que la fenêtre publiée laisse voir, relevé quatre fois par seconde.
   *
   * `seekable` est la seule source de vérité : c'est ce que l'hébergeur publie encore, et cela varie
   * d'une chaîne à l'autre du simple au deux-cent-quarantième — 61 s de médiane, quatre heures pour
   * Arte. La barre s'en sert telle quelle plutôt que d'inventer une échelle qui promettrait un retour
   * en arrière inexistant.
   */
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const relever = () => {
      if (!element.seekable.length) { setFenetre(null); return; }
      const debut = element.seekable.start(0);
      const fin = element.seekable.end(element.seekable.length - 1);
      setFenetre({ debut, fin, position: element.currentTime, enPause: element.paused });
    };
    const minuteur = window.setInterval(relever, 250);
    return () => window.clearInterval(minuteur);
  }, [adresses, rang]);

  const auDirect = !fenetre || fenetre.fin - fenetre.position <= MARGE_DIRECT_S;
  const largeurFenetre = fenetre ? fenetre.fin - fenetre.debut : 0;
  const barreUtile = largeurFenetre >= FENETRE_MINIMALE_S;

  /** Revenir au bord du flux — la seule position qui mérite le mot « direct ». */
  const rejoindreDirect = useCallback(() => {
    const element = videoRef.current;
    if (!element?.seekable.length) return;
    dernierGeste.current = Date.now();
    element.currentTime = element.seekable.end(element.seekable.length - 1) - 1;
    void element.play().catch(() => undefined);
  }, []);

  /**
   * Reculer ou avancer dans la fenêtre.
   *
   * Le début est écarté de deux secondes : c'est le bord que l'hébergeur va retirer d'une seconde à
   * l'autre, et s'y coller garantit d'en tomber. La fin l'est d'une seconde, pour la même raison
   * dans l'autre sens.
   */
  const sauter = useCallback((secondes: number) => {
    const element = videoRef.current;
    if (!element?.seekable.length) return;
    dernierGeste.current = Date.now();
    const debut = element.seekable.start(0) + 2;
    const fin = element.seekable.end(element.seekable.length - 1) - 1;
    element.currentTime = Math.min(fin, Math.max(debut, element.currentTime + secondes));
    setBarreVisible(true);
  }, []);

  /**
   * Mettre en pause un direct, c'est reculer dans la fenêtre.
   *
   * Rien ne s'arrête à la source : le flux continue d'avancer pendant qu'on regarde une image fixe,
   * et l'on dérive vers l'arrière de la fenêtre. Sur 92 % des chaînes mesurées, elle fait entre 30 s
   * et 2 min : une pause d'une minute passe, une pause de cinq ne passe pas. Plutôt que d'interdire,
   * on laisse faire et **on rattrape** — l'effet ci-dessous rejoint le direct avant que le
   * navigateur ne tombe sur du vide, ce qui aurait figé l'image sans rien dire.
   */
  const basculerPause = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    dernierGeste.current = Date.now();
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
    setBarreVisible(true);
  }, []);

  useEffect(() => {
    if (!fenetre || !barreUtile) return;
    // Deux segments de marge : au-delà, l'hébergeur retire le segment qu'on est en train de lire.
    if (fenetre.position >= fenetre.debut + FENETRE_MINIMALE_S) return;
    rejoindreDirect();
    setMessage("Fin de la fenêtre : retour au direct.");
    const oubli = window.setTimeout(() => setMessage(null), 4_000);
    return () => window.clearTimeout(oubli);
  }, [barreUtile, fenetre, rejoindreDirect]);

  /**
   * La barre s'efface après une accalmie, et revient au moindre geste. En pause, elle reste.
   *
   * **La position ne figure pas dans les dépendances**, et c'est tout le correctif : elle est relevée
   * quatre fois par seconde, l'effet repartait donc toutes les 250 ms et remettait sa minuterie à
   * zéro. La barre ne s'effaçait jamais — vérifié à l'écran, cinq secondes après le dernier geste
   * elle était toujours là. Ce qui doit la rappeler, ce sont les gestes, et ils passent tous par
   * `setBarreVisible`.
   */
  const enPause = fenetre?.enPause ?? false;
  useEffect(() => {
    if (!barreVisible || choixOuvert || enPause) return;
    const oubli = window.setTimeout(() => setBarreVisible(false), REPOS_BARRE_MS);
    return () => window.clearTimeout(oubli);
  }, [barreVisible, choixOuvert, enPause]);

  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent) => {
      if (evenement.key === "Escape") { onClose(); return; }
      /*
       * Le clavier reprend, touche pour touche, ce que la télécommande fait sur Android TV : les
       * flèches horizontales reculent et avancent dans la fenêtre, l'espace met en pause, `D` rejoint
       * le direct. Une seule chose lui est propre — `P` pour la chaîne précédente, qui n'a pas
       * d'équivalent naturel au clavier.
       */
      if (evenement.key === "ArrowLeft") { evenement.preventDefault(); sauter(-SAUT_S); return; }
      if (evenement.key === "ArrowRight") { evenement.preventDefault(); sauter(SAUT_S); return; }
      if (evenement.key === " " || evenement.key === "k") { evenement.preventDefault(); basculerPause(); return; }
      if (evenement.key.toLowerCase() === "d") { rejoindreDirect(); return; }
      if (evenement.key.toLowerCase() === "p" && precedente) onChaine(precedente);
    };
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [basculerPause, onChaine, onClose, precedente, rejoindreDirect, sauter]);

  const sources = Math.min(adresses.length, REPLIS);
  const avance = fenetre && largeurFenetre > 0
    ? Math.min(100, Math.max(0, (fenetre.position - fenetre.debut) / largeurFenetre * 100))
    : 100;

  return <div className={`lecteur-direct${barreVisible ? " commandes" : ""}`}
    role="dialog" aria-modal="true" aria-label={`Chaîne ${chaine.nom}`}
    onMouseMove={() => setBarreVisible(true)}>
    <video ref={videoRef} autoPlay playsInline muted={false}
      onClick={basculerPause} onPause={() => setBarreVisible(true)} />
    <div className="lecteur-direct-barre">
      <button type="button" className="player-icon-button" onClick={onClose} aria-label="Fermer">←</button>
      {precedente && <button type="button" className="player-icon-button"
        aria-label={`Revenir à ${precedente.nom}`} title={`Revenir à ${precedente.nom}`}
        onClick={() => onChaine(precedente)}>⇄</button>}
      <div className="lecteur-direct-titre">
        <b>{chaine.numero != null ? `${chaine.numero} · ` : ""}{chaine.nom}</b>
        <small>
          {chaine.groupe ?? "En direct"}
          {/*
            * Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source explique une
            * qualité différente sans transformer un rattrapage réussi en incident. Cliquable, il
            * devient le moyen d'en changer soi-même.
            */}
          {sources > 1 && <>
            {" · "}
            <button type="button" className="lecteur-direct-sources" aria-expanded={choixOuvert}
              onClick={() => setChoixOuvert((ouvert) => !ouvert)}>
              source {rang + 1}/{sources} ▾
            </button>
          </>}
          {parRelais ? " · relayée par le serveur" : ""}
          {securite > 0 ? ` · +${securite} s de sécurité` : ""}
        </small>
      </div>
    </div>

    {choixOuvert && <ul className="lecteur-direct-choix" role="listbox" aria-label="Sources de la chaîne">
      {adresses.slice(0, REPLIS).map((entree, index) => (
        <li key={entree.url}>
          <button type="button" role="option" aria-selected={index === rang}
            className={index === rang ? "actif" : undefined} onClick={() => choisirSource(index)}>
            <b>Source {index + 1}{index === 0 ? " · recommandée" : ""}</b>
            <small>{index === rang && parRelais ? "relayée par le serveur" : decrireSource(entree)}</small>
          </button>
        </li>
      ))}
    </ul>}

    {/*
      * La pause s'affiche **toujours**, la piste seulement quand il y a une fenêtre.
      *
      * Les deux étaient liées, et le bouton disparaissait donc sur les chaînes dont l'hébergeur ne
      * publie presque rien derrière le direct — c'est-à-dire là où l'on veut encore pouvoir mettre en
      * pause. Ce qui n'a pas de sens sans fenêtre, c'est la piste : elle promettrait un retour en
      * arrière qui n'existe pas. Le bouton, lui, en a toujours un.
      */}
    {barreVisible && fenetre && <div className="lecteur-direct-progression">
      <button type="button" className="player-icon-button" onClick={basculerPause}
        aria-label={fenetre.enPause ? "Reprendre" : "Mettre en pause"}>{fenetre.enPause ? "⏵" : "⏸"}</button>
      {barreUtile ? <div className="lecteur-direct-piste" role="slider" aria-label="Position dans la fenêtre du direct"
        aria-valuemin={0} aria-valuemax={Math.round(largeurFenetre)}
        aria-valuenow={Math.round(fenetre.position - fenetre.debut)} tabIndex={0}
        onClick={(evenement) => {
          const cadre = evenement.currentTarget.getBoundingClientRect();
          const part = (evenement.clientX - cadre.left) / cadre.width;
          sauter(fenetre.debut + part * largeurFenetre - fenetre.position);
        }}>
        <i style={{ width: `${avance}%` }} />
      </div> : <span className="lecteur-direct-piste-absente" />}
      <span className="lecteur-direct-retard">
        {auDirect ? "EN DIRECT" : `− ${horodatage(fenetre.fin - fenetre.position)}`}
      </span>
      {!auDirect && barreUtile && <button type="button" className="player-icon-button" onClick={rejoindreDirect}
        aria-label="Revenir au direct" title="Revenir au direct">⏭</button>}
    </div>}

    {message && <p className={`lecteur-direct-message${echec ? " echec" : ""}`} role="status">{message}</p>}
  </div>;
}
