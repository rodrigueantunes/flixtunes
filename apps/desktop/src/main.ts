import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { ecrireReglages, lireReglages, memeServeur, normaliserAdresse } from "./reglages.js";
import { ETAT_INITIAL, Lecteur, trouverVlc } from "./vlc.js";

/**
 * La coque du client de bureau.
 *
 * Elle ne dessine qu'un écran, celui qui demande l'adresse du serveur. Tout le reste vient du
 * **client Web** — le même que dans un navigateur, servi par le NAS —, et c'est ce qui garantit
 * qu'il n'y a pas deux interfaces à tenir à jour. La coque ne fait que quatre choses : ouvrir les
 * fenêtres, retenir l'adresse du serveur, confier la lecture à VLC, et agrandir la fenêtre au plein
 * écran — cette dernière parce qu'une page ne sait agrandir que la sienne, et que ce n'est pas la
 * bonne.
 *
 * **Deux fenêtres, et ce n'est pas un détail.** La sonde du 27 août 2026 l'a établi : si VLC dessine
 * dans la fenêtre qui porte l'interface, il la recouvre entièrement — une fenêtre fille se peint
 * toujours au-dessus de ce que peint son parent, et aucun réglage de transparence n'y change rien.
 * La disposition qui tient est donc :
 *
 *   - une fenêtre **du dessous**, noire, qui ne sert qu'à recevoir la vidéo ;
 *   - une fenêtre **du dessus**, transparente et possédée par la première, qui porte tout le client
 *     Web — catalogue compris.
 *
 * Il n'y a donc pas de « mode lecteur » séparé : c'est le client Web du début à la fin, avec une
 * surface vidéo qui s'allume derrière lui au moment voulu.
 */

const PAGES = path.join(__dirname, "pages");
let fenetreVideo: BrowserWindow | null = null;
let fenetreInterface: BrowserWindow | null = null;

/** L'interface épouse la fenêtre vidéo au pixel près. Mesuré à zéro d'écart par la sonde. */
function suivre(): void {
  if (!fenetreVideo || !fenetreInterface || fenetreVideo.isDestroyed() || fenetreInterface.isDestroyed()) return;
  fenetreInterface.setBounds(fenetreVideo.getContentBounds());
}

/**
 * La fenêtre du dessous, désignée à VLC comme surface de dessin.
 *
 * On se fie à la taille du tampon plutôt qu'à l'architecture du processus : sous Windows la poignée
 * fait 64 bits sur une machine 64 bits, sous X11 l'identifiant de fenêtre en fait 32 quelle que soit
 * la machine. Lire huit octets là où il n'y en a que quatre lèverait une exception au lancement.
 */
function poigneeDe(fenetre: BrowserWindow): string | null {
  if (fenetre.isDestroyed()) return null;
  const tampon = fenetre.getNativeWindowHandle();
  return tampon.length >= 8 ? tampon.readBigUInt64LE().toString() : String(tampon.readUInt32LE());
}

const lecteur = new Lecteur(() => (fenetreVideo ? poigneeDe(fenetreVideo) : null));

// L'état de lecture est poussé vers l'interface, jamais demandé par elle : une barre de progression
// qui interroge quatre fois par seconde traverserait le pont quatre fois par seconde pour rien.
lecteur.surEtat((etat) => {
  if (fenetreInterface && !fenetreInterface.isDestroyed()) {
    fenetreInterface.webContents.send("flixtunes:etat-lecture", etat);
  }
});

/**
 * Le plein écran, et pourquoi il ne peut pas venir de la page.
 *
 * Une page ne sait agrandir que sa propre fenêtre. Or l'interface vit dans une fenêtre transparente
 * posée sur la fenêtre vidéo : un plein écran demandé au document aurait étalé les commandes sur
 * tout l'écran devant une vidéo restée à sa place. C'est la fenêtre du dessous qu'on agrandit, et
 * l'interface la suit — le même mécanisme qui la fait suivre un déplacement.
 *
 * Il vaut pour toute l'application et non pour le seul lecteur : on parcourt parfois le catalogue
 * sur un téléviseur, et rien ne justifierait d'y garder une barre de titre.
 */
function basculerPleinEcran(actif?: boolean): boolean {
  if (!fenetreVideo || fenetreVideo.isDestroyed()) return false;
  const vise = actif ?? !fenetreVideo.isFullScreen();
  fenetreVideo.setFullScreen(vise);
  suivre();
  return vise;
}

function annoncerPleinEcran(actif: boolean): void {
  suivre();
  if (fenetreInterface && !fenetreInterface.isDestroyed()) {
    fenetreInterface.webContents.send("flixtunes:etat-plein-ecran", actif);
  }
}

function ouvrirFenetres(): void {
  fenetreVideo = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: "#080b12",
    title: "FlixTunes",
    show: false,
  });
  // Une page, et non rien du tout : sans contenu chargé, Electron n'émet jamais « prête à montrer ».
  void fenetreVideo.loadFile(path.join(PAGES, "fond.html"));

  fenetreInterface = new BrowserWindow({
    parent: fenetreVideo,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /*
   * F11 partout dans l'application, et Échap pour en sortir.
   *
   * Les touches sont interceptées avant la page : le client Web les recevrait sans pouvoir en faire
   * quoi que ce soit, puisque le plein écran ne lui appartient pas ici. Échap ne quitte que le plein
   * écran, et seulement s'il y est — sans quoi elle fermerait des panneaux dont ce n'est pas le
   * rôle de la coque de s'occuper.
   */
  fenetreInterface.webContents.on("before-input-event", (evenement, entree) => {
    if (entree.type !== "keyDown") return;
    if (entree.key === "F11") { evenement.preventDefault(); basculerPleinEcran(); return; }
    if (entree.key === "Escape" && fenetreVideo?.isFullScreen()) { evenement.preventDefault(); basculerPleinEcran(false); }
  });

  // Chaque événement est déclaré à part : les signatures d'Electron sont typées une par une, et une
  // boucle sur une liste de noms ne se laisse pas vérifier.
  fenetreVideo.on("move", suivre);
  fenetreVideo.on("resize", suivre);
  fenetreVideo.on("restore", suivre);
  fenetreVideo.on("maximize", suivre);
  fenetreVideo.on("unmaximize", suivre);
  fenetreVideo.on("enter-full-screen", () => annoncerPleinEcran(true));
  fenetreVideo.on("leave-full-screen", () => annoncerPleinEcran(false));
  fenetreVideo.on("closed", () => {
    // VLC dessine dans cette fenêtre : elle disparaît, il n'a plus de raison d'être. Sans cela le
    // processus survivrait à la fermeture, invisible et toujours en train de lire.
    lecteur.arreter();
    if (fenetreInterface && !fenetreInterface.isDestroyed()) fenetreInterface.destroy();
    fenetreVideo = null;
    fenetreInterface = null;
  });

  fenetreVideo.once("ready-to-show", () => {
    fenetreVideo?.show();
    suivre();
    fenetreInterface?.show();
    afficher();
  });
}

/** Le client Web s'il y a un serveur connu, sinon l'écran qui demande son adresse. */
function afficher(): void {
  const reglages = lireReglages(app.getPath("userData"));
  if (!fenetreInterface) return;
  if (reglages.serveur) {
    void fenetreInterface.loadURL(reglages.serveur);
  } else {
    void fenetreInterface.loadFile(path.join(PAGES, "serveur.html"));
  }
  suivre();
}

/*
 * Le nom de l'application, et non celui du paquet.
 *
 * Sans lui, Electron range les réglages sous le nom du manifeste — `@flixtunes/desktop`, portée
 * comprise — dans un dossier que personne ne devine. C'est aussi ce nom qui s'affiche dans la barre
 * des tâches et dans les fenêtres du système.
 */
app.setName("FlixTunes");

app.whenReady().then(() => {
  // Aucun menu : le client Web porte sa propre navigation, et un menu « Fichier / Édition » n'aurait
  // aucun sens devant une médiathèque.
  Menu.setApplicationMenu(null);

  ipcMain.handle("flixtunes:definir-serveur", (_evenement, saisie: unknown) => {
    const adresse = typeof saisie === "string" ? normaliserAdresse(saisie) : null;
    if (!adresse) return { ok: false, message: "Adresse invalide" };
    ecrireReglages(app.getPath("userData"), { serveur: adresse });
    afficher();
    return { ok: true, adresse };
  });

  ipcMain.handle("flixtunes:oublier-serveur", () => {
    ecrireReglages(app.getPath("userData"), { serveur: null });
    afficher();
    return { ok: true };
  });

  ipcMain.handle("flixtunes:serveur", () => lireReglages(app.getPath("userData")).serveur);

  /*
   * VLC est-il installé ? La question se pose avant que la page n'existe.
   *
   * Le client Web décide au premier rendu de son lecteur s'il pilote VLC ou une balise vidéo. Une
   * promesse arriverait après ce choix ; c'est donc l'une des rares réponses que le pont doit rendre
   * sur-le-champ, et le seul endroit du programme où un aller-retour synchrone se justifie.
   */
  ipcMain.on("flixtunes:vlc-present", (evenement) => { evenement.returnValue = trouverVlc() !== null; });

  /*
   * Les commandes de lecture.
   *
   * Une seule mérite une garde, et c'est la première : « ouvre ceci ». Le pont est offert à une page
   * chargée depuis le réseau, et VLC ouvre tout ce qu'on lui présente — y compris un fichier du
   * disque. On n'accepte donc que ce qui vient du serveur auquel la coque est connectée. Les autres
   * commandes ne portent qu'un nombre et ne peuvent rien ouvrir.
   */
  ipcMain.handle("flixtunes:lecteur-ouvrir", async (_evenement, uri: unknown) => {
    const serveur = lireReglages(app.getPath("userData")).serveur;
    if (typeof uri !== "string" || !memeServeur(uri, serveur)) {
      return { ok: false, message: "Ce flux ne vient pas du serveur FlixTunes." };
    }
    return lecteur.ouvrir(uri);
  });
  ipcMain.handle("flixtunes:lecteur-lire", () => lecteur.lire());
  ipcMain.handle("flixtunes:lecteur-pause", () => lecteur.pause());
  ipcMain.handle("flixtunes:lecteur-aller", (_evenement, secondes: unknown) =>
    lecteur.allerA(typeof secondes === "number" ? secondes : 0));
  ipcMain.handle("flixtunes:lecteur-vitesse", (_evenement, valeur: unknown) =>
    lecteur.vitesse(typeof valeur === "number" ? valeur : 1));
  ipcMain.handle("flixtunes:lecteur-volume", (_evenement, valeur: unknown) =>
    lecteur.volume(typeof valeur === "number" ? valeur : 1));
  ipcMain.handle("flixtunes:lecteur-fermer", () => lecteur.fermer());
  ipcMain.handle("flixtunes:lecteur-etat-courant", () => (trouverVlc() ? lecteur.etatCourant() : { ...ETAT_INITIAL }));

  ipcMain.handle("flixtunes:plein-ecran", (_evenement, actif: unknown) =>
    basculerPleinEcran(typeof actif === "boolean" ? actif : undefined));

  ouvrirFenetres();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) ouvrirFenetres();
  });
});

/**
 * Les liens externes s'ouvrent dans le navigateur du système, jamais dans la coque.
 *
 * Sans cela, un lien sortant remplacerait le client par une page quelconque, et l'application
 * n'aurait plus aucun moyen de revenir : il n'y a ni barre d'adresse ni bouton de retour.
 */
app.on("web-contents-created", (_evenement, contenu) => {
  contenu.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
});

app.on("window-all-closed", () => {
  lecteur.arreter();
  app.quit();
});

// Un arrêt demandé par le système — session qui se ferme, machine qui s'éteint — n'emprunte pas le
// chemin des fenêtres. VLC est un processus à part : il faut le renvoyer explicitement.
app.on("before-quit", () => lecteur.arreter());
