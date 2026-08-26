import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Chaque client doit ouvrir une session de profil, même sans code.
 *
 * Le défaut est apparu **deux fois**, à quelques heures d'intervalle : d'abord sur le Web, puis sur
 * Android. La cause est la même et elle est structurelle — sur le réseau local aucune lecture ne
 * réclame de session, si bien qu'un profil sans code n'en demandait jamais, et personne ne s'en
 * apercevait. Depuis l'accès distant, **chaque** lecture en exige une : le profil se retrouve enfermé
 * dehors, avec « Session requise » ou « Impossible de joindre le serveur » à l'écran.
 *
 * Un troisième client — Windows, ou tout autre à venir — retomberait dedans sans ces vérifications.
 * Elles lisent la source parce que le lien à garder est entre deux fichiers éloignés, pas un
 * comportement qu'un banc reproduirait.
 */
const web = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
const webApi = readFileSync(new URL("../../web/src/api.ts", import.meta.url), "utf8");
const androidVue = readFileSync(
  new URL("../../android/app/src/main/java/tv/flixtunes/app/MainViewModel.kt", import.meta.url), "utf8");
const androidApi = readFileSync(
  new URL("../../android/app/src/main/java/tv/flixtunes/app/data/FlixTunesApi.kt", import.meta.url), "utf8");
const androidImages = readFileSync(
  new URL("../../android/app/src/main/java/tv/flixtunes/app/FlixTunesApplication.kt", import.meta.url), "utf8");
const androidLecteur = readFileSync(
  new URL("../../android/app/src/main/java/tv/flixtunes/app/playback/JetonSession.kt", import.meta.url), "utf8");

describe("session de profil, côté clients", () => {
  it("le code est facultatif dans les deux clients", () => {
    expect(webApi, "Web : `unlockProfile` doit accepter l'absence de code").toMatch(/unlockProfile:\s*async\s*\(id: string, pin\?: string\)/);
    expect(androidApi, "Android : idem").toContain("suspend fun unlockProfile(profileId: String, pin: String? = null)");
  });

  it("le Web demande une session avant de lire, par où que l'on passe", () => {
    // Placée à la seule sélection, la demande laissait dehors un profil restauré au démarrage : il
    // n'est jamais « sélectionné ». Elle vit donc dans `loadHome`, par où toutes les voies passent.
    expect(web).toContain("const assurerSessionProfil");
    const chargement = web.slice(web.indexOf("const loadHome ="), web.indexOf("const loadHome =") + 400);
    expect(chargement, "loadHome doit s'en assurer").toContain("assurerSessionProfil");
  });

  it("Android demande une session au choix du profil", () => {
    expect(androidVue).toContain("private suspend fun assurerSessionProfil");
    const selection = androidVue.slice(androidVue.indexOf("fun selectProfile("));
    expect(selection.slice(0, 700), "selectProfile doit s'en assurer").toContain("assurerSessionProfil(profile)");
  });

  /**
   * Chaque pile HTTP secondaire porte les titres d'accès.
   *
   * Le défaut s'est manifesté **trois fois** sur Android, et jamais sur le réseau local : le lecteur
   * ExoPlayer, le chargeur d'images Coil et une seconde instance d'API ont chacun leur propre pile,
   * qui ne sait rien des jetons transportés par la première. Depuis Internet, cela donne un catalogue
   * dont les titres s'affichent et les jaquettes restent grises, puis « Compte de connexion requis »
   * au lancement d'un film.
   */
  it("le lecteur et le chargeur d'images portent les deux jetons", () => {
    for (const [nom, source] of [["lecteur ExoPlayer", androidLecteur], ["chargeur Coil", androidImages]] as const) {
      expect(source, `${nom} : jeton de profil absent`).toContain("X-FlixTunes-Profile-Token");
      expect(source, `${nom} : jeton de compte absent`).toContain("X-FlixTunes-Remote-Token");
    }
  });

  it("une instance d'API secondaire n'efface pas la session de la première", () => {
    // Le lecteur construit la sienne sans jeton de compte : son initialisation remettait
    // `JetonSession.compteDistant` à `null`, emportant celui dont ExoPlayer se sert.
    const init = androidApi.slice(androidApi.indexOf("    init {"), androidApi.indexOf("    init {") + 500);
    expect(init, "l'initialisation ne doit publier que ce qu'elle possède").not.toMatch(/JetonSession\.compteDistant = initialRemoteToken\s*$/m);
    expect(androidApi, "et reprendre le jeton du processus à défaut")
      .toContain("initialRemoteToken ?: JetonSession.compteDistant");
  });

  it("aucun client n'ouvre de session à la place de quelqu'un", () => {
    // Un profil protégé passe par son code, jamais par cette demande silencieuse.
    for (const [nom, source, marqueur] of [
      ["Web", web, "active.protected"],
      ["Android", androidVue, "profile.protected"],
    ] as const) {
      const debut = source.indexOf(nom === "Web" ? "const assurerSessionProfil" : "private suspend fun assurerSessionProfil");
      expect(source.slice(debut, debut + 500), `${nom} : un profil protégé doit être écarté`).toContain(marqueur);
    }
  });
});
