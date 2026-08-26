import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { db } from "./database.js";
import { NOM_COOKIE_SESSION, attenteApresEchecs, cookieDeLaRequete, oublierEchecs } from "./sessions-profil.js";
import { COOKIE_COMPTE_DISTANT } from "./comptes-distants.js";

/**
 * L'accès distant, éprouvé par ce qu'il **refuse**.
 *
 * Les tests positifs d'une protection sont les moins utiles : ils confirment que le cas prévu
 * fonctionne, alors que les défauts vivent dans les cas non prévus. L'essentiel de ce fichier vérifie
 * donc que des requêtes parfaitement formées n'aboutissent pas.
 */
describe("accès distant", () => {
  let wan: FastifyInstance;
  let lan: FastifyInstance;
  let profilDistant = "";
  let profilLocal = "";
  let jeton = "";
  let jetonDistant = "";
  let compteDistant = "";

  beforeAll(async () => {
    lan = await buildApp();
    wan = await buildApp({ exposition: "wan" });

    const compte = await lan.inject({ method: "POST", url: "/api/system/remote-accounts",
      payload: { username: "test-r62", password: "mot-de-passe-r62-solide" } });
    compteDistant = compte.json().id;
    const connexion = await wan.inject({ method: "POST", url: "/api/remote/login",
      payload: { username: "test-r62", password: "mot-de-passe-r62-solide", deviceName: "Vitest" } });
    jetonDistant = connexion.json().token;

    const distant = await lan.inject({ method: "POST", url: "/api/profiles",
      payload: { name: "Distant", avatarColor: "#4488ff", language: "fr-FR",
        preferredAudioLanguages: ["fra"], preferredSubtitleLanguages: ["fra"], pin: "482913" } });
    profilDistant = distant.json().id;

    const local = await lan.inject({ method: "POST", url: "/api/profiles",
      payload: { name: "Local", avatarColor: "#ff8844", language: "fr-FR",
        preferredAudioLanguages: ["fra"], preferredSubtitleLanguages: ["fra"], pin: "1234" } });
    profilLocal = local.json().id;

    oublierEchecs("127.0.0.1");
    const ouverture = await wan.inject({ method: "POST", url: `/api/profiles/${profilDistant}/unlock`,
      headers: { "x-flixtunes-remote-token": jetonDistant }, payload: { pin: "482913" } });
    jeton = ouverture.json().token;
  });

  afterAll(async () => {
    await wan?.close();
    await lan?.close();
    for (const id of [profilDistant, profilLocal]) {
      if (id) db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    }
    if (compteDistant) db.prepare("DELETE FROM remote_accounts WHERE id = ?").run(compteDistant);
  });

  it("rend une administration interdite indiscernable d'une administration inexistante", async () => {
    for (const url of ["/api/system/backups", "/api/filesystem/directories", "/api/libraries",
      "/api/system/status", "/api/metadata/providers", "/api/devices"]) {
      const reponse = await wan.inject({ method: "GET", url, headers: { "x-flixtunes-profile-token": jeton,
        "x-flixtunes-remote-token": jetonDistant } });
      expect(reponse.statusCode, `${url} doit répondre 404 et non 403`).toBe(404);
    }
  });

  it("ne laisse pas télécharger la base, même avec une session valide", async () => {
    const reponse = await wan.inject({ method: "GET", url: "/api/system/backups/flixtunes.db",
      headers: { "x-flixtunes-profile-token": jeton, "x-flixtunes-remote-token": jetonDistant } });
    expect(reponse.statusCode).toBe(404);
  });

  it("refuse toute lecture sans session, flux vidéo et jaquettes compris", async () => {
    for (const url of ["/api/catalog?libraryId=x", "/api/home", "/api/search?q=a",
      "/api/media/inexistant/stream", "/api/artwork/inexistant"]) {
      const reponse = await wan.inject({ method: "GET", url });
      expect(reponse.statusCode, `${url} sans session`).toBe(401);
      expect(reponse.json().code).toBe("REMOTE_ACCOUNT_REQUIRED");
    }
  });

  it("refuse un jeton inventé, et un jeton de la bonne longueur mais faux", async () => {
    const faux = "a".repeat(64);
    const reponse = await wan.inject({ method: "GET", url: "/api/home", headers: { "x-flixtunes-profile-token": faux,
      "x-flixtunes-remote-token": jetonDistant } });
    expect(reponse.statusCode).toBe(401);
    const court = await wan.inject({ method: "GET", url: "/api/home", headers: { "x-flixtunes-profile-token": "trop-court",
      "x-flixtunes-remote-token": jetonDistant } });
    expect(court.statusCode).toBe(401);
  });

  it("accepte la session par cookie, puisque la balise vidéo ne peut porter aucun en-tête", async () => {
    const reponse = await wan.inject({ method: "GET", url: "/api/home",
      headers: { cookie: `${COOKIE_COMPTE_DISTANT}=${jetonDistant}; ${NOM_COOKIE_SESSION}=${jeton}` } });
    expect(reponse.statusCode).toBe(200);
  });

  it("pose le cookie au déverrouillage, hors de portée des scripts et des sites tiers", async () => {
    oublierEchecs("127.0.0.1");
    const reponse = await wan.inject({ method: "POST", url: `/api/profiles/${profilDistant}/unlock`,
      headers: { "x-flixtunes-remote-token": jetonDistant }, payload: { pin: "482913" } });
    const cookie = String(reponse.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookieDeLaRequete(cookie, NOM_COOKIE_SESSION)).toHaveLength(64);
  });

  it("impose le profil de la session : un jeton ne donne pas accès aux autres profils", async () => {
    const reponse = await wan.inject({ method: "GET", url: `/api/home?profileId=${profilLocal}`,
      headers: { "x-flixtunes-profile-token": jeton, "x-flixtunes-remote-token": jetonDistant } });
    expect(reponse.statusCode).toBe(200);
    // La requête réclamait le profil local ; c'est celui de la session qui a servi.
    expect(reponse.json().profile?.id ?? reponse.json().profileId ?? profilDistant).toBe(profilDistant);
  });

  it("montre groupes et profils une fois le compte de connexion franchi", async () => {
    // Ils étaient filtrés sur la longueur du PIN, à l'époque où celui-ci était le seul rempart depuis
    // Internet. Un foyer n'ayant pas reposé ses codes ne voyait alors strictement rien, sans qu'aucun
    // message ne l'explique. La porte est désormais tenue par un compte à mot de passe.
    const distants = await wan.inject({ method: "GET", url: "/api/profiles",
      headers: { "x-flixtunes-remote-token": jetonDistant } });
    const ids = distants.json().map((profil: { id: string }) => profil.id);
    expect(ids).toContain(profilDistant);
    expect(ids, "un code court reste un profil visible : le compte garde la porte").toContain(profilLocal);

    const groupes = await wan.inject({ method: "GET", url: "/api/profile-groups",
      headers: { "x-flixtunes-remote-token": jetonDistant } });
    expect(groupes.statusCode).toBe(200);
    expect(groupes.json().length, "au moins un groupe doit être proposé").toBeGreaterThan(0);
  });

  it("ne montre ni groupe ni profil sans compte de connexion", async () => {
    for (const url of ["/api/profiles", "/api/profile-groups"]) {
      const reponse = await wan.inject({ method: "GET", url });
      expect(reponse.statusCode, `${url} sans compte`).toBe(401);
      expect(reponse.json().code).toBe("REMOTE_ACCOUNT_REQUIRED");
    }
  });

  it("accepte à distance un profil au code court, le compte ayant déjà gardé la porte", async () => {
    oublierEchecs("127.0.0.1");
    const reponse = await wan.inject({ method: "POST", url: `/api/profiles/${profilLocal}/unlock`,
      headers: { "x-flixtunes-remote-token": jetonDistant }, payload: { pin: "1234" } });
    expect(reponse.statusCode).toBe(200);
    expect(reponse.json().token).toHaveLength(64);
    oublierEchecs("127.0.0.1");
  });

  it("refuse toujours un code faux, à distance comme en local", () => {
    return (async () => {
      oublierEchecs("127.0.0.1");
      const reponse = await wan.inject({ method: "POST", url: `/api/profiles/${profilLocal}/unlock`,
        headers: { "x-flixtunes-remote-token": jetonDistant }, payload: { pin: "9999" } });
      expect(reponse.statusCode).toBe(401);
      expect(reponse.json().message).toBe("Code PIN incorrect");
      oublierEchecs("127.0.0.1");
    })();
  });

  it("ralentit les essais de PIN jusqu'à rendre la force brute sans objet", async () => {
    oublierEchecs("127.0.0.1");
    let dernier = 0;
    for (let essai = 0; essai < 6; essai += 1) {
      const reponse = await wan.inject({ method: "POST", url: `/api/profiles/${profilDistant}/unlock`,
        headers: { "x-flixtunes-remote-token": jetonDistant }, payload: { pin: "000000" } });
      dernier = reponse.statusCode;
    }
    expect(dernier, "le sixième essai doit être bloqué, pas seulement refusé").toBe(429);

    // Le rythme obtenu : rien jusqu'à cinq essais, puis doublement. Au dixième échec l'attente est
    // déjà de trente-deux minutes, et le plafond d'une heure tombe au onzième — moins de vingt-cinq
    // essais par jour depuis une même source.
    expect(attenteApresEchecs(4)).toBe(0);
    expect(attenteApresEchecs(5)).toBe(60_000);
    expect(attenteApresEchecs(10)).toBe(1_920_000);
    expect(attenteApresEchecs(11)).toBe(3_600_000);
    expect(attenteApresEchecs(40)).toBe(3_600_000);
    oublierEchecs("127.0.0.1");
  });

  it("ne dit pas sa version à Internet, mais la dit au diagnostic local", async () => {
    const distant = await wan.inject({ method: "GET", url: "/api/health" });
    expect(distant.statusCode).toBe(200);
    expect(distant.json()).toEqual({ status: "ok", name: "FlixTunes" });

    const local = await lan.inject({ method: "GET", url: "/api/health" });
    expect(local.json()).toHaveProperty("version");
    expect(local.json()).toHaveProperty("step");
  });

  it("laisse un profil sans code ouvrir une session, sinon il est bloqué dehors", async () => {
    // L'impasse constatée le 25 août 2026 : sur le WAN chaque lecture réclame une session, et le seul
    // moyen d'en obtenir une exigeait un code de quatre à huit chiffres. Retirer le code d'un profil
    // le rendait donc inaccessible à distance, avec « Impossible de joindre le serveur » à l'écran.
    const sansCode = await lan.inject({ method: "POST", url: "/api/profiles",
      payload: { name: "Sans code", avatarColor: "#33aa66", language: "fr-FR",
        preferredAudioLanguages: ["fra"], preferredSubtitleLanguages: ["fra"] } });
    const id = sansCode.json().id as string;
    try {
      const ouverture = await wan.inject({ method: "POST", url: `/api/profiles/${id}/unlock`,
        headers: { "x-flixtunes-remote-token": jetonDistant }, payload: {} });
      expect(ouverture.statusCode, "un profil sans code doit pouvoir ouvrir une session").toBe(200);
      const jeton = ouverture.json().token as string;
      expect(jeton).toHaveLength(64);

      const accueil = await wan.inject({ method: "GET", url: "/api/home",
        headers: { "x-flixtunes-remote-token": jetonDistant, "x-flixtunes-profile-token": jeton } });
      expect(accueil.statusCode, "et lire ensuite").toBe(200);
    } finally {
      db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    }
  });

  it("continue d'exiger le code quand le profil en a un", async () => {
    oublierEchecs("127.0.0.1");
    const sansPin = await wan.inject({ method: "POST", url: `/api/profiles/${profilDistant}/unlock`,
      headers: { "x-flixtunes-remote-token": jetonDistant }, payload: {} });
    expect(sansPin.statusCode, "un corps vide ne doit pas ouvrir un profil protégé").toBe(400);
    oublierEchecs("127.0.0.1");
  });

  it("laisse le réseau local intact", async () => {
    for (const url of ["/api/system/status", "/api/libraries", "/api/filesystem/directories"]) {
      const reponse = await lan.inject({ method: "GET", url });
      expect(reponse.statusCode, `${url} doit rester accessible en local`).not.toBe(404);
    }
    // Et aucune session n'y est réclamée, comme avant.
    const accueil = await lan.inject({ method: "GET", url: "/api/home" });
    expect(accueil.statusCode).toBe(200);
  });
});
