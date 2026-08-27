import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { ecrireReglages, lireReglages, normaliserAdresse } from "./reglages.js";

/**
 * La coque du client de bureau.
 *
 * Elle ne dessine rien. Tout ce qui s'affiche vient du **client Web** — le même que dans un
 * navigateur, servi par le NAS —, et c'est ce qui garantit qu'il n'y a pas deux interfaces à tenir à
 * jour. La coque ne fait que trois choses : ouvrir les fenêtres, retenir l'adresse du serveur, et
 * plus tard confier la lecture à VLC.
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

  // Chaque événement est déclaré à part : les signatures d'Electron sont typées une par une, et une
  // boucle sur une liste de noms ne se laisse pas vérifier.
  fenetreVideo.on("move", suivre);
  fenetreVideo.on("resize", suivre);
  fenetreVideo.on("restore", suivre);
  fenetreVideo.on("maximize", suivre);
  fenetreVideo.on("unmaximize", suivre);
  fenetreVideo.on("closed", () => {
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
  app.quit();
});
