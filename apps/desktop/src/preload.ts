import { contextBridge, ipcRenderer } from "electron";

/**
 * Le pont entre le client Web et la coque.
 *
 * Il est volontairement minuscule, et il le restera : chaque fonction exposée ici est une porte
 * ouverte dans une page qui charge du contenu distant. On n'y met que ce que la coque seule peut
 * faire — retenir une adresse, et bientôt commander VLC.
 *
 * **C'est aussi par sa présence que le client Web sait qu'il tourne dans la coque.** Une page qui
 * trouve `window.flixtunesBureau` sait qu'elle peut confier la lecture à VLC ; la même page dans un
 * navigateur ne le trouve pas et se comporte comme aujourd'hui. Aucune détection d'agent utilisateur,
 * aucune variable de compilation : la capacité s'annonce, elle ne se devine pas.
 */
export interface PontBureau {
  /** Version de la coque, pour qu'une évolution du pont soit reconnaissable côté Web. */
  readonly version: string;
  /** L'adresse du serveur actuellement retenue, ou `null` au premier démarrage. */
  serveur(): Promise<string | null>;
  /** Enregistre l'adresse saisie et recharge le client. */
  definirServeur(adresse: string): Promise<{ ok: boolean; adresse?: string; message?: string }>;
  /** Oublie le serveur : la coque revient à l'écran de saisie. */
  oublierServeur(): Promise<{ ok: boolean }>;
}

const pont: PontBureau = {
  version: "1",
  serveur: () => ipcRenderer.invoke("flixtunes:serveur") as Promise<string | null>,
  definirServeur: (adresse) =>
    ipcRenderer.invoke("flixtunes:definir-serveur", adresse) as Promise<{ ok: boolean; adresse?: string; message?: string }>,
  oublierServeur: () => ipcRenderer.invoke("flixtunes:oublier-serveur") as Promise<{ ok: boolean }>,
};

contextBridge.exposeInMainWorld("flixtunesBureau", pont);
