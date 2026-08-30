import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

/**
 * VLC, vu depuis la coque.
 *
 * Le principe est celui qu'a retenu la sonde du 27 août 2026 : VLC s'exécute comme **processus fils**
 * et dessine dans une fenêtre qu'on lui désigne — `--drawable-hwnd` sous Windows, `--drawable-xid`
 * sous X11. Aucune liaison native n'est à écrire, aucun module compilé n'est à livrer, et le moteur
 * est celui que la distribution tient à jour.
 *
 * Reste à le commander. VLC offre deux interfaces pour cela : `rc`, qui parle un texte à analyser
 * ligne par ligne, et `http`, qui rend du JSON. La seconde a été retenue après essai, et pour une
 * raison qui pèse : elle rend d'un seul coup l'état de lecture, la position, la durée, la vitesse,
 * **les images affichées et perdues** — ce dont le client Web a besoin pour juger un décodage — et la
 * liste des pistes. Analyser du texte pour obtenir moins aurait été un mauvais marché.
 *
 * L'interface n'écoute que sur `127.0.0.1`, sur un port libre choisi au lancement, derrière un mot de
 * passe tiré au hasard à chaque démarrage. Elle n'est donc jamais la même deux fois, et rien d'autre
 * que cette coque ne peut s'y adresser.
 *
 * **Un seul processus VLC pour toute la séance.** Le client Web redemande une session au serveur bien
 * plus souvent qu'on ne le croit — changement de piste audio, déplacement hors de la fenêtre encodée,
 * repli après coupure. Relancer VLC à chaque fois ferait clignoter la fenêtre à chacun de ces
 * événements. On garde donc le processus et on lui remplace son entrée.
 */

/** Ce que la coque sait de la lecture à un instant donné. */
export interface EtatLecteur {
  /** Un média est ouvert. Faux avant la première lecture et après une fermeture. */
  ouvert: boolean;
  /**
   * Position **dans le flux**, en secondes — jamais dans le film.
   *
   * Un flux converti ne commence pas forcément au début du film : le décalage est porté par la
   * session, et c'est le client Web qui l'ajoute. La même règle vaut pour la balise vidéo d'un
   * navigateur ; la respecter ici évite d'avoir deux comptes différents selon le client.
   */
  position: number;
  /** Durée du flux, `0` tant que VLC ne la connaît pas. */
  duree: number;
  enLecture: boolean;
  vitesse: number;
  imagesAffichees: number;
  imagesPerdues: number;
  /**
   * Les pistes que VLC a trouvées dans le flux, par leur numéro.
   *
   * Ce sont les mêmes numéros que ceux du serveur — vérifié flux par flux sur un Matroska à dix
   * pistes : vidéo 0, trois audio 1 à 3, six sous-titres 4 à 9, dans le même ordre et avec les mêmes
   * langues des deux côtés. C'est ce qui permet au client Web de désigner une piste par l'index
   * qu'il connaît déjà, sans table de correspondance.
   *
   * Seul le numéro est lu. Les libellés de VLC — « Flux », « Vidéo », « Français » — sont traduits
   * dans la langue de son installation, et `--language=en` n'y change rien : s'y fier ferait
   * dépendre le choix des pistes de la langue du système.
   */
  pistes: number[];
  /** Le flux est allé jusqu'au bout de lui-même. */
  termine: boolean;
  /** Ce que VLC n'a pas su faire, le cas échéant. */
  erreur: string | null;
}

export const ETAT_INITIAL: EtatLecteur = {
  ouvert: false, position: 0, duree: 0, enLecture: false, vitesse: 1,
  imagesAffichees: 0, imagesPerdues: 0, pistes: [], termine: false, erreur: null,
};

/** Les pistes que le client Web veut entendre et voir, désignées par l'index qu'en donne le serveur. */
export interface PistesVoulues {
  audio?: number | null;
  /** `-1` ou absent : aucun sous-titre. C'est le lecteur qui dessine ceux qui sont du texte. */
  sousTitre?: number | null;
}

/** Ce qu'on retient du JSON de VLC, avant de le rapprocher de ce que la coque a demandé. */
export interface StatutVlc {
  etat: "playing" | "paused" | "stopped";
  position: number;
  duree: number;
  vitesse: number;
  imagesAffichees: number;
  imagesPerdues: number;
  pistes: number[];
}

/**
 * Traduit le statut de VLC, et fabrique une position plus fine que celle qu'il annonce.
 *
 * `time` est un entier de secondes : une barre de progression nourrie par lui avance par sauts d'une
 * seconde, ce qui se voit. `position` est une fraction du média en virgule flottante ; multipliée par
 * la durée, elle donne la même valeur au centième près. On garde `time` en secours, pour les flux
 * dont la durée n'est pas connue — un direct, une conversion en cours d'écriture.
 *
 * Fonction pure, et volontairement : c'est la seule partie de ce fichier qu'on peut éprouver sans
 * lancer VLC, et c'est aussi celle qui se trompera si VLC change son vocabulaire.
 */
export function lireStatut(brut: unknown): StatutVlc | null {
  if (!brut || typeof brut !== "object") return null;
  const source = brut as Record<string, unknown>;
  const etat = source.state === "playing" || source.state === "paused" ? source.state : "stopped";
  const duree = nombre(source.length);
  const fraction = nombre(source.position);
  const secondes = nombre(source.time);
  const stats = (source.stats ?? {}) as Record<string, unknown>;
  return {
    etat,
    position: duree > 0 && fraction > 0 ? fraction * duree : secondes,
    duree,
    vitesse: nombre(source.rate) || 1,
    imagesAffichees: nombre(stats.displayedpictures),
    imagesPerdues: nombre(stats.lostpictures),
    pistes: lirePistes(source.information),
  };
}

/**
 * Les numéros de piste, et rien d'autre.
 *
 * VLC range ses pistes sous des clés de la forme « Flux 3 » — « Stream 3 » sur une installation
 * anglaise, et d'autres mots ailleurs. On n'en garde que le nombre, qui lui ne se traduit pas. Le
 * type et la langue sont volontairement ignorés : le client Web les connaît déjà du serveur, et les
 * lire ici ferait dépendre le choix des pistes de la langue de VLC.
 */
function lirePistes(information: unknown): number[] {
  if (!information || typeof information !== "object") return [];
  const categories = (information as { category?: unknown }).category;
  if (!categories || typeof categories !== "object") return [];
  const numeros = Object.keys(categories)
    .map((nom) => /(\d+)\s*$/.exec(nom)?.[1])
    .filter((trouve): trouve is string => trouve != null)
    .map(Number);
  return [...new Set(numeros)].sort((gauche, droite) => gauche - droite);
}

function nombre(valeur: unknown): number {
  const lu = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(lu) && lu > 0 ? lu : 0;
}

/**
 * Où trouver VLC.
 *
 * **Celui qu'on emporte d'abord.** L'installateur embarque sa propre copie : c'est elle qu'on a
 * éprouvée, et c'est elle qui doit servir. Une installation trouvée sur la machine peut être d'une
 * autre version, amputée par un paquet allégé, ou réglée d'une façon qu'on n'a jamais essayée — s'y
 * fier ferait dépendre le bon fonctionnement du client de ce que la personne a installé par ailleurs.
 *
 * L'ordre est donc : ce qu'on impose explicitement, ce qu'on emporte, puis en dernier recours celui
 * du système. Ce dernier recours n'est pas du zèle : c'est lui qui fait tourner le client depuis le
 * dépôt, avant tout empaquetage.
 */
export function trouverVlc(): string | null {
  const impose = process.env.FLIXTUNES_VLC;
  if (impose && existsSync(impose)) return impose;
  return [...vlcEmbarque(), ...vlcDuSysteme()].find((chemin) => existsSync(chemin)) ?? null;
}

/**
 * La copie que l'installateur a posée à côté du programme.
 *
 * Deux endroits, et ils correspondent aux deux façons dont ce code s'exécute : dans une application
 * empaquetée, où Electron range les ressources supplémentaires sous `resourcesPath` ; et depuis le
 * dépôt, où `packaging/bureau/preparer-vlc.mjs` l'a déposée à côté des sources de la coque.
 */
function vlcEmbarque(): string[] {
  const nom = process.platform === "win32" ? "vlc.exe" : "vlc";
  const endroits: string[] = [];
  if (process.resourcesPath) endroits.push(path.join(process.resourcesPath, "vlc", nom));
  // `__dirname` n'existe pas quand ce fichier est chargé comme module ES — ce que fait le lanceur de
  // tests, qui se contente d'en retirer les types. La coque, elle, est compilée en CommonJS.
  if (typeof __dirname === "string") endroits.push(path.join(__dirname, "..", "vendor", "vlc", nom));
  return endroits;
}

function vlcDuSysteme(): string[] {
  return process.platform === "win32"
    ? ["C:\\Program Files\\VideoLAN\\VLC\\vlc.exe", "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"]
    : ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc"];
}

/** Un port que personne n'occupe, demandé au système plutôt que deviné. */
function portLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const serveur = createServer();
    serveur.once("error", rejeter);
    serveur.listen(0, "127.0.0.1", () => {
      const adresse = serveur.address();
      const port = typeof adresse === "object" && adresse ? adresse.port : 0;
      serveur.close(() => (port ? resoudre(port) : rejeter(new Error("aucun port libre"))));
    });
  });
}

/** Vingt-cinq secondes sans une seule image : le flux ne s'ouvrira pas. */
const DELAI_OUVERTURE_MS = 25_000;
const PERIODE_ETAT_MS = 250;

export class Lecteur {
  private processus: ChildProcess | null = null;
  private port = 0;
  private motDePasse = "";
  private horloge: NodeJS.Timeout | null = null;
  private interrogationEnCours = false;
  private etat: EtatLecteur = { ...ETAT_INITIAL };
  private aDejaJoue = false;
  private ouvertureA = 0;
  private readonly abonnes = new Set<(etat: EtatLecteur) => void>();
  /**
   * La fenêtre où dessiner, lue au lancement — elle n'existe pas encore à la construction, et une
   * valeur figée trop tôt serait celle d'une fenêtre détruite.
   *
   * Le champ est déclaré à part plutôt qu'en propriété de constructeur : Node exécute les tests par
   * simple retrait des types, sans les réécrire, et cette forme-là n'est pas un type mais du code.
   */
  private readonly poignee: () => string | null;

  constructor(poignee: () => string | null) {
    this.poignee = poignee;
  }

  surEtat(rappel: (etat: EtatLecteur) => void): () => void {
    this.abonnes.add(rappel);
    return () => { this.abonnes.delete(rappel); };
  }

  etatCourant(): EtatLecteur {
    return { ...this.etat };
  }

  /**
   * Ouvre un flux, en lançant VLC s'il ne tourne pas encore.
   *
   * La liste de lecture est vidée d'abord : `in_play` ajoute, il ne remplace pas. Sans ce ménage,
   * VLC finirait la séance avec une pile d'entrées mortes et enchaînerait sur l'une d'elles à la fin
   * du film — ce que le client Web prendrait pour une lecture qui continue.
   */
  async ouvrir(uri: string, pistes: PistesVoulues = {}): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.demarrer();
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : "VLC n'a pas pu démarrer";
      this.publier({ ...this.etat, erreur: message });
      return { ok: false, message };
    }
    this.aDejaJoue = false;
    this.ouvertureA = Date.now();
    this.etat = { ...ETAT_INITIAL, ouvert: true };
    await this.commander("pl_empty");
    /*
     * Les pistes sont désignées **à l'ouverture**, et c'est tout le sujet.
     *
     * On les changeait juste après, dès que VLC annonçait sa liste — et VLC ne connaissait pas
     * encore le format du flux audio. Sa trace le disait sans ambiguïté : « too low audio sample
     * frequency (0) », puis « failed to create audio output ». Le film démarrait sans son.
     *
     * Passées en options de l'entrée, elles sont prises en compte au moment où VLC ouvre le flux :
     * aucun décodeur à tuer, aucune sortie audio à refaire. La numérotation est celle du serveur —
     * vérifié avec un marqueur indépendant, `audio-track-id=3` sélectionnant bien la piste à deux
     * canaux et 224 kb/s que le serveur annonce à l'index 3.
     */
    const options: Array<[string, string]> = [["input", uri]];
    if (pistes.audio != null) options.push(["option", `:audio-track-id=${Math.trunc(pistes.audio)}`]);
    options.push(["option", `:sub-track-id=${Math.trunc(pistes.sousTitre ?? -1)}`]);
    await this.commander("in_play", options);
    this.publier(this.etat);
    return { ok: true };
  }

  async lire(): Promise<void> { await this.commander("pl_forceresume"); }
  async pause(): Promise<void> { await this.commander("pl_forcepause"); }

  /** Se déplacer dans le flux. La position est optimiste : VLC mettra un instant à la confirmer. */
  async allerA(secondes: number): Promise<void> {
    const cible = Math.max(0, Math.floor(secondes));
    this.publier({ ...this.etat, position: cible });
    await this.commander("seek", [["val", String(cible)]]);
  }

  /**
   * Choisit une piste par son numéro, ou la coupe avec `-1`.
   *
   * Éprouvé : `audio_track=-1` fige le compteur d'audio décodé — 4 265 inchangé pendant que le film
   * continue — et un numéro valide le fait repartir. La commande atteint donc bien le moteur.
   */
  async pisteAudio(numero: number): Promise<void> {
    await this.commander("audio_track", [["val", String(Math.trunc(numero))]]);
  }

  async pisteSousTitre(numero: number): Promise<void> {
    await this.commander("subtitle_track", [["val", String(Math.trunc(numero))]]);
  }

  async vitesse(valeur: number): Promise<void> {
    if (!Number.isFinite(valeur) || valeur <= 0) return;
    await this.commander("rate", [["val", String(valeur)]]);
  }

  /** Le volume de VLC va de 0 à 256, celui d'une balise vidéo de 0 à 1. */
  async volume(valeur: number): Promise<void> {
    const cible = Math.round(Math.min(1, Math.max(0, valeur)) * 256);
    await this.commander("volume", [["val", String(cible)]]);
  }

  /** Arrête la lecture sans tuer VLC : la fenêtre redevient noire, le processus reste prêt. */
  async fermer(): Promise<void> {
    if (!this.processus) return;
    this.etat = { ...ETAT_INITIAL };
    await this.commander("pl_stop");
    await this.commander("pl_empty");
    this.publier(this.etat);
  }

  /** Fin de la séance : VLC s'en va avec la fenêtre. */
  arreter(): void {
    if (this.horloge) { clearInterval(this.horloge); this.horloge = null; }
    this.processus?.kill();
    this.processus = null;
    this.etat = { ...ETAT_INITIAL };
  }

  private async demarrer(): Promise<void> {
    if (this.processus && !this.processus.killed) return;
    const binaire = trouverVlc();
    if (!binaire) throw new Error("VLC est introuvable sur cette machine. Installez VLC pour lire les fichiers tels quels.");
    const dessin = this.poignee();
    if (!dessin) throw new Error("La fenêtre vidéo n'est pas prête");
    this.port = await portLibre();
    this.motDePasse = randomBytes(18).toString("hex");
    const surface = process.platform === "win32" ? `--drawable-hwnd=${dessin}` : `--drawable-xid=${dessin}`;
    const arguments_ = [
      surface,
      "--intf", "dummy",
      "--extraintf", "http",
      "--http-host", "127.0.0.1",
      "--http-port", String(this.port),
      "--http-password", this.motDePasse,
      // Le titre et l'affichage à l'écran appartiennent à l'interface Web.
      "--no-video-title-show",
      "--no-osd",
      "--no-embedded-video",
      /*
       * Aucun sous-titre tant qu'on n'en demande pas.
       *
       * VLC en choisit un tout seul quand une piste est marquée « par défaut » dans le fichier, et
       * on se retrouverait avec deux jeux superposés : les siens et ceux que le lecteur dessine.
       * C'est le client Web qui décide, et lui seul.
       *
       * `--no-spu` couperait le décodeur de sous-titres pour de bon ; ici on veut pouvoir le
       * rallumer, parce qu'un sous-titre **image** ne peut pas devenir du texte et que VLC sait le
       * dessiner — ce qui évite au NAS de réencoder le film entier pour l'y incruster.
       */
      "--sub-track=-1",
      "--no-sub-autodetect-file",
      // Le décodage matériel est la raison d'être de ce client : c'est lui qui permet au NAS de ne
      // rien convertir. Relevé à l'essai sur un HEVC 1080p : « Format décodé : DX11 ».
      "--avcodec-hw=any",
      "--network-caching=1500",
    ];
    // De quoi voir ce que VLC choisit comme sortie vidéo et ce dont il se plaint. Muet par défaut :
    // en marche normale, personne ne lit ces lignes.
    if (process.env.FLIXTUNES_VLC_VERBEUX === "1") arguments_.push("-vv");
    const processus = spawn(binaire, arguments_, { stdio: ["ignore", "ignore", "pipe"], env: this.environnementDe(binaire) });
    // Le tuyau d'erreur est vidé, et pas seulement ouvert : un tuyau qu'on n'écoute pas se remplit,
    // et le processus qui écrit dedans finit par se bloquer. Un lecteur vidéo qui se fige au bout de
    // quelques minutes est exactement le genre de défaut qu'on ne rattache jamais à sa cause.
    processus.stderr?.on("data", (morceau: Buffer) => {
      if (process.env.FLIXTUNES_VLC_VERBEUX === "1") console.log("[vlc]", String(morceau).trimEnd());
    });
    processus.on("exit", () => {
      this.processus = null;
      if (this.horloge) { clearInterval(this.horloge); this.horloge = null; }
    });
    this.processus = processus;
    await this.attendreInterface();
    this.horloge = setInterval(() => void this.interroger(), PERIODE_ETAT_MS);
  }

  /**
   * L'environnement d'un VLC déplacé.
   *
   * Sous Windows, un exécutable trouve ses bibliothèques et ses greffons dans son propre dossier :
   * rien à dire. Sous Linux, non — le chargeur cherche les bibliothèques dans les chemins du système,
   * et VLC cherche ses greffons là où son paquet les a posés. Un VLC qu'on a déménagé à côté de notre
   * application ne trouverait donc ni `libvlccore`, ni un seul décodeur.
   *
   * On le lui dit. Seulement pour la copie qu'on emporte : un VLC du système sait déjà où il habite.
   */
  private environnementDe(binaire: string): NodeJS.ProcessEnv | undefined {
    if (process.platform === "win32") return undefined;
    const dossier = path.dirname(binaire);
    if (!vlcEmbarque().includes(binaire)) return undefined;
    return {
      ...process.env,
      VLC_PLUGIN_PATH: path.join(dossier, "plugins"),
      LD_LIBRARY_PATH: [dossier, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
    };
  }

  /** VLC ouvre son interface un instant après son processus : on frappe jusqu'à ce qu'on réponde. */
  private async attendreInterface(): Promise<void> {
    for (let essai = 0; essai < 60; essai += 1) {
      const statut = await this.appeler("");
      if (statut) return;
      await new Promise((resoudre) => setTimeout(resoudre, 100));
    }
    throw new Error("VLC n'a pas ouvert son interface de commande");
  }

  // Une liste de paires plutôt qu'un objet : VLC accepte plusieurs `option` pour une même ouverture,
  // et un objet ne sait porter qu'une valeur par clé.
  private async commander(commande: string, parametres: Array<[string, string]> = []): Promise<void> {
    const requete = new URLSearchParams([["command", commande], ...parametres]);
    const statut = await this.appeler(requete.toString());
    if (statut) this.appliquer(statut);
  }

  private async interroger(): Promise<void> {
    if (this.interrogationEnCours) return;
    this.interrogationEnCours = true;
    try {
      const statut = await this.appeler("");
      if (statut) this.appliquer(statut);
    } finally {
      this.interrogationEnCours = false;
    }
  }

  private async appeler(requete: string): Promise<StatutVlc | null> {
    if (!this.port) return null;
    const adresse = `http://127.0.0.1:${this.port}/requests/status.json${requete ? `?${requete}` : ""}`;
    try {
      const reponse = await fetch(adresse, {
        headers: { Authorization: `Basic ${Buffer.from(`:${this.motDePasse}`).toString("base64")}` },
      });
      if (!reponse.ok) return null;
      return lireStatut(await reponse.json());
    } catch {
      // VLC démarre encore, ou s'en est allé. Les deux se voient ailleurs : ici on ne fait que se taire.
      return null;
    }
  }

  /**
   * Rapproche ce que VLC dit de ce que la coque a demandé.
   *
   * Toute la subtilité tient en un mot : « arrêté ». VLC l'annonce avant d'avoir ouvert le flux, et
   * il l'annonce encore quand le film est fini — même mot, deux situations opposées. On les sépare
   * avec ce qu'on sait et que VLC ignore : a-t-on demandé une ouverture, et a-t-on déjà vu une image ?
   */
  private appliquer(statut: StatutVlc): void {
    if (!this.etat.ouvert) return;
    if (statut.etat === "playing") this.aDejaJoue = true;
    const termine = statut.etat === "stopped" && this.aDejaJoue;
    const jamaisOuvert = statut.etat === "stopped" && !this.aDejaJoue
      && Date.now() - this.ouvertureA > DELAI_OUVERTURE_MS;
    this.publier({
      ouvert: true,
      position: termine ? this.etat.position : statut.position,
      duree: statut.duree || this.etat.duree,
      enLecture: statut.etat === "playing",
      vitesse: statut.vitesse,
      imagesAffichees: statut.imagesAffichees,
      imagesPerdues: statut.imagesPerdues,
      pistes: statut.pistes.length ? statut.pistes : this.etat.pistes,
      termine,
      erreur: jamaisOuvert ? "VLC n'a pas pu ouvrir ce flux." : null,
    });
  }

  private publier(etat: EtatLecteur): void {
    this.etat = etat;
    for (const abonne of this.abonnes) abonne({ ...etat });
  }
}
