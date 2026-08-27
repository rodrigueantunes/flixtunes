// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EtatLecteurBureau, PontLecteur } from "./bureau";
import { oublierLaSurfacePartagee, SurfaceVlc, surfacePartagee } from "./surface-lecture";

/**
 * Le pont, remplacé par un double.
 *
 * On retient ce qui a été commandé, et on garde de quoi pousser un état comme la coque le ferait
 * quatre fois par seconde. Tout ce que ce fichier éprouve tient dans un aller et un retour : le
 * lecteur commande, VLC répond, et la réponse doit se traduire dans les événements qu'une balise
 * vidéo aurait émis.
 */
function pontDouble() {
  const commandes: string[] = [];
  let pousser: (etat: EtatLecteurBureau) => void = () => undefined;
  const pont: PontLecteur = {
    ouvrir: (uri) => { commandes.push(`ouvrir ${uri}`); return Promise.resolve({ ok: true }); },
    lire: () => { commandes.push("lire"); return Promise.resolve(); },
    pause: () => { commandes.push("pause"); return Promise.resolve(); },
    allerA: (secondes) => { commandes.push(`allerA ${secondes}`); return Promise.resolve(); },
    vitesse: (valeur) => { commandes.push(`vitesse ${valeur}`); return Promise.resolve(); },
    volume: (valeur) => { commandes.push(`volume ${valeur}`); return Promise.resolve(); },
    fermer: () => { commandes.push("fermer"); return Promise.resolve(); },
    etat: () => Promise.resolve(REPOS),
    surEtat: (rappel) => { pousser = rappel; return () => { pousser = () => undefined; }; },
  };
  return { pont, commandes, pousser: (etat: Partial<EtatLecteurBureau>) => pousser({ ...REPOS, ouvert: true, ...etat }) };
}

const REPOS: EtatLecteurBureau = {
  ouvert: false, position: 0, duree: 0, enLecture: false, vitesse: 1,
  imagesAffichees: 0, imagesPerdues: 0, termine: false, erreur: null,
};

describe("la lecture confiée à VLC, vue par le lecteur Web", () => {
  it("ouvre une adresse absolue : VLC ne connaît pas l'origine de la page", async () => {
    // `api.playbackUrl` rend un chemin relatif quand le client est servi par le serveur lui-même —
    // c'est précisément le cas dans la coque. Passé tel quel, VLC n'en ferait rien.
    const { pont, commandes } = pontDouble();
    await new SurfaceVlc(pont).ouvrir("/api/playback/abc/master.m3u8");
    expect(commandes[0]).toBe(`ouvrir ${new URL("/api/playback/abc/master.m3u8", window.location.href).toString()}`);
  });

  it("remet le son à plein à chaque ouverture", () => {
    // VLC retient son volume d'une séance à l'autre, et il est partagé avec l'usage qu'on en fait
    // par ailleurs. Une application qui démarre muette parce qu'on avait baissé le son la veille
    // dans un tout autre programme serait un défaut impossible à comprendre.
    const { pont, commandes } = pontDouble();
    return new SurfaceVlc(pont).ouvrir("/api/x").then(() => {
      expect(commandes).toContain("volume 1");
    });
  });

  it("annonce les métadonnées quand la durée devient connue, et une seule fois", () => {
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    const vu = vi.fn();
    surface.addEventListener("loadedmetadata", vu);

    // VLC ouvre le flux avant d'en connaître la durée : le premier état n'apprend rien.
    pousser({ duree: 0 });
    expect(vu).not.toHaveBeenCalled();
    pousser({ duree: 6535, position: 1 });
    pousser({ duree: 6535, position: 2 });
    expect(vu).toHaveBeenCalledTimes(1);
    expect(surface.duration).toBe(6535);
  });

  it("traduit le départ et l'arrêt de la lecture en « play » et « pause »", () => {
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    const joue = vi.fn();
    const arrete = vi.fn();
    surface.addEventListener("play", joue);
    surface.addEventListener("pause", arrete);

    pousser({ duree: 100, enLecture: true });
    pousser({ duree: 100, enLecture: true, position: 1 });
    expect(joue).toHaveBeenCalledTimes(1);
    expect(surface.paused).toBe(false);

    pousser({ duree: 100, enLecture: false, position: 1 });
    expect(arrete).toHaveBeenCalledTimes(1);
    expect(surface.paused).toBe(true);
  });

  it("avance la position sur-le-champ quand on se déplace, sans attendre VLC", () => {
    // Un quart de seconde sépare deux états. Sans cette avance, le curseur de la barre reviendrait à
    // son ancienne place après chaque déplacement, et ce retour en arrière se voit.
    const { pont, commandes } = pontDouble();
    const surface = new SurfaceVlc(pont);
    surface.currentTime = 900;
    expect(surface.currentTime).toBe(900);
    expect(commandes).toContain("allerA 900");
  });

  it("annonce la fin du flux une seule fois", () => {
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    const fin = vi.fn();
    surface.addEventListener("ended", fin);
    pousser({ duree: 100, position: 100, termine: true });
    pousser({ duree: 100, position: 100, termine: true });
    expect(fin).toHaveBeenCalledTimes(1);
  });

  it("annonce un échec d'ouverture comme une balise vidéo annonce une erreur", () => {
    // C'est ce qui déclenche le repli en cascade — direct, puis remux, puis conversion. Sans cet
    // événement, un fichier que VLC ne sait pas ouvrir laisserait un écran noir sans recours.
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    const echec = vi.fn();
    surface.addEventListener("error", echec);
    pousser({ erreur: "VLC n'a pas pu ouvrir ce flux." });
    pousser({ erreur: "VLC n'a pas pu ouvrir ce flux." });
    expect(echec).toHaveBeenCalledTimes(1);
  });

  it("compte les images comme le fait un navigateur, pour que le même verdict s'applique", () => {
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    pousser({ duree: 100, imagesAffichees: 240, imagesPerdues: 12 });
    const releve = surface.getVideoPlaybackQuality();
    expect(releve.droppedVideoFrames).toBe(12);
    // `totalVideoFrames` compte les images créées, perdues comprises : c'est la définition du
    // navigateur, et `qualite-decodage` calcule sa part de pertes dessus.
    expect(releve.totalVideoFrames).toBe(252);
  });

  it("n'annonce aucun tampon plutôt qu'un tampon inventé", () => {
    // VLC ne dit pas jusqu'où il a lu d'avance. Prétendre que tout est chargé remplirait la barre
    // d'un gris mensonger.
    const { pont } = pontDouble();
    expect(new SurfaceVlc(pont).buffered.length).toBe(0);
  });

  it("ignore un état reçu alors que rien n'est ouvert", () => {
    // La coque pousse un état de repos après une fermeture. Le prendre pour une lecture ferait
    // remonter une position nulle et un « pause » à contretemps.
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    const battement = vi.fn();
    surface.addEventListener("timeupdate", battement);
    pousser({ ouvert: false, position: 42 });
    expect(battement).not.toHaveBeenCalled();
    expect(surface.currentTime).toBe(0);
  });

  it("refuse une vitesse absurde plutôt que de la transmettre", () => {
    const { pont, commandes } = pontDouble();
    const surface = new SurfaceVlc(pont);
    surface.playbackRate = 0;
    surface.playbackRate = Number.NaN;
    expect(commandes).toEqual([]);
    surface.playbackRate = 1.5;
    expect(commandes).toEqual(["vitesse 1.5"]);
  });

  it("repart de zéro à chaque ouverture", () => {
    // Deux épisodes à la suite : la durée, la position et les événements déjà annoncés appartiennent
    // au précédent. Sans remise à zéro, le second n'annoncerait jamais ses métadonnées.
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    pousser({ duree: 100, position: 99, termine: true });
    return surface.ouvrir("/api/y").then(() => {
      expect(surface.duration).toBe(0);
      expect(surface.currentTime).toBe(0);
      const fin = vi.fn();
      surface.addEventListener("ended", fin);
      pousser({ duree: 200, position: 200, termine: true });
      expect(fin).toHaveBeenCalledTimes(1);
    });
  });
});

describe("la surface partagée", () => {
  it("n'existe pas dans un navigateur ordinaire", () => {
    oublierLaSurfacePartagee();
    Reflect.deleteProperty(globalThis as object, "flixtunesBureau");
    expect(surfacePartagee()).toBeNull();
  });

  it("est la même d'une ouverture du lecteur à l'autre", () => {
    // C'est ce qui la rend insensible au montage double du mode strict de React : l'abonnement à
    // l'état de VLC est pris une fois, et aucun démontage ne le défait.
    oublierLaSurfacePartagee();
    const { pont } = pontDouble();
    Object.defineProperty(globalThis, "flixtunesBureau", {
      value: { version: "2", serveur: () => Promise.resolve(null), definirServeur: () => Promise.resolve({ ok: true }),
        oublierServeur: () => Promise.resolve({ ok: true }), lecteur: pont },
      configurable: true, writable: true,
    });
    const premiere = surfacePartagee();
    expect(premiere).not.toBeNull();
    expect(surfacePartagee()).toBe(premiere);
    Reflect.deleteProperty(globalThis as object, "flixtunesBureau");
    oublierLaSurfacePartagee();
  });

  it("continue de recevoir l'état après une fermeture", () => {
    // Le défaut constaté à l'écran : le film jouait derrière une interface figée à 0:00, parce que
    // fermer le lecteur avait coupé l'abonnement pour de bon.
    const { pont, pousser } = pontDouble();
    const surface = new SurfaceVlc(pont);
    surface.fermer();
    const battement = vi.fn();
    surface.addEventListener("timeupdate", battement);
    pousser({ duree: 100, position: 30, enLecture: true });
    expect(battement).toHaveBeenCalled();
    expect(surface.currentTime).toBe(30);
  });
});
