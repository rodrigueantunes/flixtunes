/**
 * Réparation des capacités annoncées par un client.
 *
 * Ces valeurs sont des **indications** : elles disent ce qu'un appareil pense savoir lire. Le schéma
 * les validait strictement, si bien qu'une seule valeur aberrante faisait échouer toute la demande de
 * lecture — et le client n'affichait qu'« Capacités de lecture invalides », sans dire laquelle.
 *
 * C'est exactement ce qui est arrivé sur un projecteur : `Display.Mode` n'annonce parfois aucun mode
 * tant que la surface n'est pas prête, l'enveloppe vidéo valait alors `0 × 0`, et `maxWidth` à zéro
 * était rejeté par `.positive()`. Un appareil parfaitement capable de lire ne lisait plus rien, pour
 * un chiffre qui n'aurait servi qu'à choisir une définition de sortie.
 *
 * La règle retenue : **une indication douteuse est ignorée, jamais fatale.** Un champ hors bornes est
 * retiré — le schéma applique alors son défaut — plutôt que de faire échouer la requête. Ce qui reste
 * refusé après réparation est un corps qui ne ressemble pas à des capacités du tout, et là le message
 * nomme les champs en cause.
 */

const CONTENEURS_CONNUS = new Set(["mp4", "webm", "mpegts", "matroska", "avi", "mov"]);
const FORMATS_HDR = new Set(["hdr10", "hdr10plus", "hlg", "dolbyvision"]);
const AUDIO_IMMERSIF = new Set(["dolby-atmos", "dts-x", "auro-3d"]);

/** Ce que la réparation a dû corriger, pour que le journal puisse le dire. */
export interface RapportReparation {
  champs: string[];
}

function entierPositif(valeur: unknown, maximum: number): boolean {
  return typeof valeur === "number" && Number.isInteger(valeur) && valeur > 0 && valeur <= maximum;
}

/**
 * Rend un corps réparé, et la liste de ce qui a été retiré.
 *
 * Rien n'est inventé : un champ douteux est **supprimé**, et c'est le schéma qui décide ensuite de sa
 * valeur par défaut. Inventer une valeur ici la ferait passer pour une déclaration de l'appareil.
 */
export function reparerCapacites(brut: unknown): { corps: Record<string, unknown>; rapport: RapportReparation } {
  const champs: string[] = [];
  if (typeof brut !== "object" || brut === null) return { corps: {}, rapport: { champs } };
  const corps: Record<string, unknown> = { ...(brut as Record<string, unknown>) };

  const retirer = (champ: string) => { delete corps[champ]; champs.push(champ); };

  // Une définition nulle ou négative ne décrit rien. C'est le cas du projecteur : `0 × 0`.
  for (const champ of ["maxWidth", "maxHeight"]) {
    if (champ in corps && !entierPositif(corps[champ], 16384)) retirer(champ);
  }
  if ("maxAudioChannels" in corps && !entierPositif(corps.maxAudioChannels, 64)) retirer("maxAudioChannels");
  // Un débit nul veut dire « pas de limite », pas « limite de zéro ».
  if ("maxVideoBitrate" in corps && corps.maxVideoBitrate !== null && !entierPositif(corps.maxVideoBitrate, Number.MAX_SAFE_INTEGER)) {
    corps.maxVideoBitrate = null;
    champs.push("maxVideoBitrate");
  }
  for (const champ of ["audioStreamIndex", "subtitleStreamIndex", "externalSubtitleId"]) {
    const valeur = corps[champ];
    if (champ in corps && valeur !== null && !(typeof valeur === "number" && Number.isInteger(valeur) && valeur >= 0)) {
      corps[champ] = null;
      champs.push(champ);
    }
  }

  // Les listes fermées : on garde ce qui est connu, on jette le reste plutôt que tout refuser. Un
  // format inconnu du serveur signifie seulement qu'il ne sait pas s'en servir.
  const filtrerListe = (champ: string, permis: Set<string>) => {
    const valeur = corps[champ];
    if (!Array.isArray(valeur)) return;
    const garde = valeur.filter((item) => typeof item === "string" && permis.has(item));
    if (garde.length !== valeur.length) { corps[champ] = garde; champs.push(champ); }
  };
  filtrerListe("containers", CONTENEURS_CONNUS);
  filtrerListe("hdrFormats", FORMATS_HDR);
  filtrerListe("immersiveAudioFormats", AUDIO_IMMERSIF);

  const profils = corps.dolbyVisionProfiles;
  if (Array.isArray(profils)) {
    const garde = profils.filter((item) => typeof item === "number" && Number.isInteger(item) && item >= 4 && item <= 20);
    if (garde.length !== profils.length) { corps.dolbyVisionProfiles = garde; champs.push("dolbyVisionProfiles"); }
  }

  /**
   * Le seul repli qui invente quelque chose, et il est délibéré.
   *
   * `containers` est le champ sans lequel le schéma refuse — il exige au moins une entrée. Un appareil
   * qui n'annonce aucun conteneur n'est pas un appareil incapable de lire : c'est un appareil qui n'a
   * pas su répondre. MP4 est le dénominateur commun de tout ce qui lit de la vidéo, et le serveur sait
   * de toute façon convertir vers HLS. Refuser ici reviendrait à ne rien lire du tout.
   */
  if (!Array.isArray(corps.containers) || corps.containers.length === 0) {
    corps.containers = ["mp4"];
    if (!champs.includes("containers")) champs.push("containers");
  }
  for (const champ of ["videoCodecs", "audioCodecs"]) {
    const valeur = corps[champ];
    if (!Array.isArray(valeur)) { corps[champ] = []; champs.push(champ); continue; }
    const garde = valeur.filter((item) => typeof item === "string" && item.length > 0);
    if (garde.length !== valeur.length) { corps[champ] = garde; champs.push(champ); }
  }
  if (typeof corps.hls !== "boolean") { corps.hls = true; champs.push("hls"); }

  return { corps, rapport: { champs } };
}
