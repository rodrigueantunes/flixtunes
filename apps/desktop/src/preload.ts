import { contextBridge, ipcRenderer } from "electron";

/**
 * Le pont entre le client Web et la coque.
 *
 * Il est volontairement minuscule, et il le restera : chaque fonction exposée ici est une porte
 * ouverte dans une page qui charge du contenu distant. On n'y met que ce que la coque seule peut
 * faire — retenir une adresse, commander VLC, agrandir la fenêtre.
 *
 * **C'est aussi par sa présence que le client Web sait qu'il tourne dans la coque.** Une page qui
 * trouve `window.flixtunesBureau` sait qu'elle peut confier la lecture à VLC ; la même page dans un
 * navigateur ne le trouve pas et se comporte comme aujourd'hui. Aucune détection d'agent utilisateur,
 * aucune variable de compilation : la capacité s'annonce, elle ne se devine pas.
 */

/** Ce que la coque sait de la lecture, poussé à chaque quart de seconde. */
export interface EtatLecteurBureau {
  ouvert: boolean;
  /** Position **dans le flux**, en secondes — le décalage de session est ajouté par le client Web. */
  position: number;
  duree: number;
  enLecture: boolean;
  vitesse: number;
  imagesAffichees: number;
  imagesPerdues: number;
  termine: boolean;
  erreur: string | null;
}

/**
 * Commander VLC depuis le lecteur du client Web.
 *
 * Le vocabulaire est celui d'une balise vidéo, et ce n'est pas un hasard : c'est exactement ce que le
 * lecteur du Web sait déjà dire. Lui apprendre une seconde langue aurait été le premier pas vers deux
 * lecteurs à tenir à jour.
 */
export interface PontLecteur {
  /** Ouvre un flux — l'adresse doit être celle du serveur auquel la coque est connectée. */
  ouvrir(uri: string): Promise<{ ok: boolean; message?: string }>;
  lire(): Promise<void>;
  pause(): Promise<void>;
  allerA(secondes: number): Promise<void>;
  vitesse(valeur: number): Promise<void>;
  /** De 0 à 1, comme une balise vidéo. */
  volume(valeur: number): Promise<void>;
  /** Arrête la lecture : la fenêtre redevient noire, VLC reste prêt pour la suivante. */
  fermer(): Promise<void>;
  etat(): Promise<EtatLecteurBureau>;
  /** S'abonne à l'état de lecture. Rend la fonction qui met fin à l'abonnement. */
  surEtat(rappel: (etat: EtatLecteurBureau) => void): () => void;
}

export interface PontBureau {
  /** Version du pont, pour qu'une évolution soit reconnaissable côté Web. */
  readonly version: string;
  /** L'adresse du serveur actuellement retenue, ou `null` au premier démarrage. */
  serveur(): Promise<string | null>;
  /** Enregistre l'adresse saisie et recharge le client. */
  definirServeur(adresse: string): Promise<{ ok: boolean; adresse?: string; message?: string }>;
  /** Oublie le serveur : la coque revient à l'écran de saisie. */
  oublierServeur(): Promise<{ ok: boolean }>;
  /**
   * Le plein écran, qui n'est pas celui du navigateur.
   *
   * Une page ne peut agrandir que sa propre fenêtre, et l'interface vit dans une fenêtre
   * transparente posée sur la fenêtre vidéo. Un plein écran demandé au document aurait donc étalé
   * les commandes sur tout l'écran devant une vidéo restée à sa place. C'est la **fenêtre du
   * dessous** qu'il faut agrandir ; l'interface la suit, comme elle le fait déjà à chaque
   * déplacement.
   *
   * Sans argument, bascule. Rend l'état obtenu.
   */
  pleinEcran(actif?: boolean): Promise<boolean>;
  /** S'abonne au plein écran — il peut aussi être demandé au clavier, hors de la page. */
  surPleinEcran(rappel: (actif: boolean) => void): () => void;
  /**
   * Absent si VLC est introuvable sur cette machine.
   *
   * Le client Web s'en sert comme d'une réponse par oui ou par non : pas de VLC, pas de lecture
   * confiée à VLC, et le lecteur du navigateur reprend la main exactement comme dans un onglet. La
   * question est posée au chargement du pont, avant que la page n'existe, parce qu'elle doit avoir
   * une réponse au premier rendu du lecteur — une promesse arriverait trop tard.
   */
  readonly lecteur?: PontLecteur;
}

const CANAL_ETAT = "flixtunes:etat-lecture";
const CANAL_PLEIN_ECRAN = "flixtunes:etat-plein-ecran";

const lecteur: PontLecteur = {
  ouvrir: (uri) => ipcRenderer.invoke("flixtunes:lecteur-ouvrir", uri) as Promise<{ ok: boolean; message?: string }>,
  lire: () => ipcRenderer.invoke("flixtunes:lecteur-lire") as Promise<void>,
  pause: () => ipcRenderer.invoke("flixtunes:lecteur-pause") as Promise<void>,
  allerA: (secondes) => ipcRenderer.invoke("flixtunes:lecteur-aller", secondes) as Promise<void>,
  vitesse: (valeur) => ipcRenderer.invoke("flixtunes:lecteur-vitesse", valeur) as Promise<void>,
  volume: (valeur) => ipcRenderer.invoke("flixtunes:lecteur-volume", valeur) as Promise<void>,
  fermer: () => ipcRenderer.invoke("flixtunes:lecteur-fermer") as Promise<void>,
  etat: () => ipcRenderer.invoke("flixtunes:lecteur-etat-courant") as Promise<EtatLecteurBureau>,
  surEtat: (rappel) => {
    // L'événement Electron n'est pas transmis à la page : il porte de quoi répondre au processus
    // principal, ce qui n'a rien à faire dans un document chargé depuis le réseau.
    const ecouteur = (_evenement: unknown, etat: EtatLecteurBureau) => rappel(etat);
    ipcRenderer.on(CANAL_ETAT, ecouteur);
    return () => { ipcRenderer.removeListener(CANAL_ETAT, ecouteur); };
  },
};

const vlcPresent = ipcRenderer.sendSync("flixtunes:vlc-present") === true;

const pont: PontBureau = {
  version: "2",
  serveur: () => ipcRenderer.invoke("flixtunes:serveur") as Promise<string | null>,
  definirServeur: (adresse) =>
    ipcRenderer.invoke("flixtunes:definir-serveur", adresse) as Promise<{ ok: boolean; adresse?: string; message?: string }>,
  oublierServeur: () => ipcRenderer.invoke("flixtunes:oublier-serveur") as Promise<{ ok: boolean }>,
  pleinEcran: (actif) => ipcRenderer.invoke("flixtunes:plein-ecran", actif) as Promise<boolean>,
  surPleinEcran: (rappel) => {
    const ecouteur = (_evenement: unknown, actif: boolean) => rappel(actif);
    ipcRenderer.on(CANAL_PLEIN_ECRAN, ecouteur);
    return () => { ipcRenderer.removeListener(CANAL_PLEIN_ECRAN, ecouteur); };
  },
  ...(vlcPresent ? { lecteur } : {}),
};

contextBridge.exposeInMainWorld("flixtunesBureau", pont);
