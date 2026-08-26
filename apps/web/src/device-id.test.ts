// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deviceId } from "./device-id";

/**
 * Identifiant d'appareil, et signalement des codecs défaillants.
 *
 * Un navigateur annonce les codecs qu'il déclare décoder, et le serveur le croit — c'est ce qui rend
 * la lecture directe possible. Mais la déclaration ment parfois, et sans mémoire attachée à
 * l'appareil, la même erreur se reproduit à chaque lecture.
 */

beforeEach(() => localStorage.clear());

describe("identifiant d'appareil", () => {
  it("reste le même d'un appel à l'autre", () => {
    // C'est toute son utilité : un identifiant qui changerait à chaque visite n'apprendrait rien au
    // serveur, qui ne verrait que des appareils inconnus.
    const premier = deviceId();
    expect(premier).toHaveLength(36);
    expect(deviceId()).toBe(premier);
  });

  it("survit à un rechargement", () => {
    const premier = deviceId();
    // Un rechargement vide la mémoire de la page, pas `localStorage`.
    expect(localStorage.getItem("flixtunes.device-id")).toBe(premier);
  });

  it("respecte la longueur minimale attendue par le serveur", () => {
    // Le serveur refuse un identifiant de moins de six caractères : un identifiant trop court serait
    // partagé par accident entre appareils, et la mémoire deviendrait fausse.
    expect(deviceId().length).toBeGreaterThanOrEqual(6);
  });

  it("se replie proprement là où `randomUUID` manque", () => {
    // Absent des navigateurs anciens et hors contexte sécurisé. Le repli n'a pas besoin d'être
    // cryptographique — seulement stable et peu susceptible de collision.
    vi.stubGlobal("crypto", {});
    localStorage.clear();
    const replié = deviceId();
    expect(replié.startsWith("web-")).toBe(true);
    expect(replié.length).toBeGreaterThanOrEqual(6);
    expect(deviceId()).toBe(replié);
    vi.unstubAllGlobals();
  });
});

describe("signalement depuis le lecteur", () => {
  const lire = async (nom: string) =>
    readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), nom), "utf8");

  it("transmet l'identifiant avec les capacités", async () => {
    const source = await lire("Player.tsx");
    expect(source).toContain("clientCapabilities.deviceId = deviceId()");
  });

  it("signale l'échec d'une lecture directe, puis replie par le remux avant la conversion", async () => {
    // Deux exigences en une, et la seconde a été apprise depuis.
    //
    // Le signalement d'abord : c'est le seul moment où l'on sait que le décodeur a refusé, le serveur
    // n'ayant fait que servir le fichier.
    //
    // Le repli ensuite. Il partait droit en conversion, ce qui se tenait tant que la lecture directe
    // n'était retenue que sur un accord complet. Depuis que le serveur la tente sur un conteneur non
    // déclaré, la cause la plus probable d'un échec est que le navigateur ne lit pas le Matroska —
    // Firefox et Safari ne le lisent pas. Transcoder ce cas remplacerait un remux, qui copie l'image
    // au bit près, par une conversion complète que le NAS peine à produire.
    const source = await lire("Player.tsx");
    expect(source).toContain("api.reportCodecFailure(deviceId()");
    const echec = source.indexOf('"Lecture directe interrompue par le lecteur"');
    const remux = source.indexOf('void start(info, "remux")', echec);
    expect(remux, "le signalement doit précéder le repli").toBeGreaterThan(echec);
    const conversion = source.indexOf('void start(info, "compatible")', remux);
    expect(conversion, "la conversion n'arrive qu'après l'échec du remux").toBeGreaterThan(remux);
    expect(source, "la seconde marche ne se prend qu'après la première")
      .toContain('session?.mode === "remux" && info && directRetry');
  });

  it("dément la quarantaine sur un décodage qui tient, pas sur la première image", async () => {
    // La première image suffisait autrefois. Elle ne suffit plus depuis que le serveur tente la
    // lecture directe malgré un désaccord annoncé : le démenti efface la ligne de quarantaine, et un
    // décodage qui décroche trois secondes plus tard repartait alors d'un compteur remis à zéro. Deux
    // échecs étant nécessaires pour retenir la leçon, elle ne l'aurait jamais été.
    const source = await lire("Player.tsx");
    expect(source).toContain("api.reportCodecSuccess(deviceId()");
    const dementi = source.indexOf("api.reportCodecSuccess");
    const declenchement = source.lastIndexOf("confirmerCodec()", dementi);
    expect(declenchement, "le démenti passe par `confirmerCodec`, appelé sur la mesure").toBeGreaterThan(-1);
    expect(source, "la mesure conclut sur plusieurs fenêtres, pas sur un instant")
      .toContain("if (echantillons.length > FENETRES_AVANT_REPLI) confirmerCodec();");
    // Le repli reste posé au premier `playing` : il sert les navigateurs sans mesure de qualité, où
    // rien d'autre ne peut faire foi.
    expect(source).toContain('video.addEventListener("playing", joue, { once: true })');
    expect(source).toContain("if (!video.getVideoPlaybackQuality) confirmerCodec();");
  });

  it("signale un décodage saccadé avant de basculer en mode compatible", async () => {
    // Le troisième mode d'échec de la lecture directe, et le seul qui soit muet : le décodeur accepte
    // le flux puis jette des images, sans erreur ni coupure. Sans ce signalement, l'essai se
    // répéterait à chaque lecture sur un appareil dont on sait déjà qu'il ne suit pas.
    const source = await lire("Player.tsx");
    expect(source).toContain('api.reportCodecFailure(deviceId(), codec, "Décodage saccadé en lecture directe")');
    const signalement = source.indexOf('"Décodage saccadé en lecture directe"');
    const bascule = source.indexOf('modePreferenceRef.current = "compatible"', signalement);
    expect(bascule, "le signalement doit précéder la bascule").toBeGreaterThan(signalement);
  });

  it("ne laisse jamais un signalement empêcher une lecture", async () => {
    // Un diagnostic est un confort : s'il échoue, la lecture doit continuer comme si de rien n'était.
    const api = await lire("api.ts");
    const bloc = api.slice(api.indexOf("reportCodecFailure"), api.indexOf("media: (id: string"));
    expect(bloc).toContain(".catch(() => undefined)");
  });
});
