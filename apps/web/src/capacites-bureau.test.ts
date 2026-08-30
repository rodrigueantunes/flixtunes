// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { playbackCapabilitiesSchema } from "@flixtunes/contracts";
import { capacitesBureau } from "./capacites-bureau";
import { browserCapabilities } from "./Player";

/**
 * Ce que le client de bureau promet au serveur.
 *
 * Une capacité annoncée n'est pas une opinion : le serveur s'y fie et cesse de convertir. Ces
 * épreuves portent donc autant sur ce qu'on déclare que sur ce qu'on se retient de déclarer.
 */
describe("les capacités du client de bureau", () => {
  it("respecte le contrat que le serveur valide", () => {
    // Le serveur refuse une déclaration hors contrat, et la lecture échouerait avant de commencer.
    expect(() => playbackCapabilitiesSchema.parse(capacitesBureau(null, null, false))).not.toThrow();
    expect(() => playbackCapabilitiesSchema.parse(capacitesBureau(2, null, true))).not.toThrow();
  });

  it("annonce ce qu'aucun navigateur ne sait lire — c'est toute la raison d'être du client", () => {
    const capacites = capacitesBureau(null, null, false);
    expect(capacites.containers).toContain("matroska");
    expect(capacites.videoCodecs).toContain("hevc");
    expect(capacites.audioCodecs).toContain("truehd");
    expect(capacites.audioCodecs).toContain("dts");
    expect(capacites.losslessAudio).toBe(true);

    // Et la comparaison qui donne son sens au chantier : le navigateur de cette machine ne les
    // déclare pas, donc le NAS convertit pour lui.
    const navigateur = browserCapabilities(null, null, false);
    expect(navigateur.containers).not.toContain("matroska");
    expect(navigateur.audioCodecs).not.toContain("truehd");
  });

  it("nomme un codec sous ses deux étiquettes", () => {
    // FFmpeg dit « hevc » quand il analyse un flux et « hvc1 » quand il le range dans un MP4. Le
    // serveur compare ce qu'il a relevé à cette liste : n'y mettre qu'une forme ferait convertir le
    // même film selon le conteneur qui l'abrite.
    const capacites = capacitesBureau(null, null, false);
    for (const paire of [["hevc", "hvc1"], ["h264", "avc1"], ["av1", "av01"], ["ac3", "ac-3"], ["eac3", "ec-3"]]) {
      for (const nom of paire) expect(capacites.videoCodecs.concat(capacites.audioCodecs)).toContain(nom);
    }
  });

  it("promet le choix d'une piste audio, ce qui dispense le serveur d'un remux", () => {
    // Un navigateur ne sait pas activer une piste secondaire d'un Matroska : le serveur doit
    // l'isoler, et recopie le film entier pour changer de langue. VLC choisit dans le fichier tel
    // quel.
    expect(capacitesBureau(null, null, false).directAudioStreamSelection).toBe(true);
    // Sauf en compatibilité maximale, où l'on ne promet plus rien : le flux converti ne porte alors
    // qu'une seule piste, et il n'y a plus rien à choisir.
    expect(capacitesBureau(null, null, true).directAudioStreamSelection).toBe(false);
  });

  it("ne promet ni Dolby Vision ni son immersif", () => {
    // VLC ne restitue pas fidèlement Dolby Vision : l'annoncer donnerait une image délavée. Atmos et
    // DTS:X voyagent dans un flux dont VLC ne décode que le tronc commun.
    const capacites = capacitesBureau(null, null, false);
    expect(capacites.dolbyVisionProfiles).toEqual([]);
    expect(capacites.dolbyAtmos).toBe(false);
    expect(capacites.immersiveAudioFormats).toEqual([]);
  });

  it("se déclare pour ce qu'il est : un client de bureau", () => {
    expect(capacitesBureau(null, null, false).deviceClass).toBe("desktop");
  });

  it("ne déclare plus rien quand on relance en compatibilité maximale", () => {
    // La relance de la dernière chance : on n'annonce plus rien qui puisse échouer, exactement comme
    // le fait le lecteur du navigateur.
    const repli = capacitesBureau(null, null, true);
    expect(repli.videoCodecs).toEqual([]);
    expect(repli.containers).toEqual(["mp4"]);
    expect(repli.maxHeight).toBe(1080);
    expect(repli.maxAudioChannels).toBe(2);
    expect(repli.losslessAudio).toBe(false);
    expect(repli.hdr).toBe(false);
  });

  it("transmet le sous-titre choisi et son décalage comme le fait le navigateur", () => {
    const image = { index: 5, type: "subtitle" as const, codec: "hdmv_pgs_subtitle", language: "fra",
      title: null, channels: null, width: null, height: null, hdr: false, hdrFormat: "sdr" as const,
      dolbyVisionProfile: null, dolbyAtmos: false, isDefault: false, isForced: false, canExtractAsWebVtt: false };
    const capacites = capacitesBureau(1, image, false, "auto", null, false, -2.5);
    expect(capacites.subtitleStreamIndex).toBe(5);
    expect(capacites.audioStreamIndex).toBe(1);
    expect(capacites.subtitleOffsetSeconds).toBe(-2.5);
    /*
     * Et la différence qui compte : un sous-titre image du fichier n'est **pas** à incruster ici.
     *
     * Pour un navigateur il l'est, et incruster veut dire réencoder le film entier — la conversion
     * la plus chère de toutes, sur le processeur d'un boîtier de salon. VLC le dessine.
     */
    expect(capacites.burnSubtitles).toBe(false);
    // En compatibilité maximale, on revient au chemin du navigateur : plus rien n'est promis.
    expect(capacitesBureau(1, image, true).burnSubtitles).toBe(true);
  });

  it("laisse incruster un sous-titre image **externe**, que VLC ne trouvera pas", () => {
    // C'est un fichier à part : il n'est pas dans le flux qu'on donne à VLC, et rien ne l'y mettra.
    expect(capacitesBureau(null, null, false, "auto", 7, true).burnSubtitles).toBe(true);
    expect(capacitesBureau(null, null, false, "auto", 7, false).burnSubtitles).toBe(false);
  });
});
