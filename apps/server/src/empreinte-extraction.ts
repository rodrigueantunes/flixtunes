import { spawn } from "node:child_process";
import { setPriority } from "node:os";
import { config } from "./config.js";
import { enveloppe, PAS_MS } from "./empreinte-sonore.js";

/**
 * Lire l'enveloppe sonore d'un morceau de fichier, sans jamais le décoder entier.
 *
 * L'introduction se tient dans les premières minutes, le générique dans les dernières : décoder le
 * reste ne servirait à rien. Mesuré sur un épisode de vingt-cinq minutes servi par le partage
 * réseau : **1,07 s** pour les cinq premières minutes, **1,11 s** pour les cinq dernières, contre
 * 5,4 s pour la totalité.
 *
 * Le son est ramené à 8 kHz mono. C'est très en dessous de la qualité d'écoute, et c'est voulu :
 * l'enveloppe n'a besoin que de la **forme** du signal, pas de son détail. Le décodage y gagne
 * d'autant, et rien de tout cela ne tourne pendant une lecture.
 */

/** Fréquence d'analyse. Dix fois moins que la parole téléphonique suffirait encore. */
export const FREQUENCE_ANALYSE = 8000;

/** Au-delà, ce n'est plus une extraction mais un décodage : on abandonne. */
const DELAI_MS = 120_000;

export interface FenetreAudio {
  /** Position de départ dans le fichier, en secondes. */
  debutSecondes: number;
  /** Durée à lire, en secondes. */
  dureeSecondes: number;
}

/**
 * L'enveloppe d'une fenêtre du fichier, ou `null` si elle n'a pas pu être lue.
 *
 * L'échec est silencieux **par choix** : un fichier sans piste audio, abîmé, ou momentanément
 * indisponible ne doit pas interrompre une passe qui traite des milliers d'épisodes. Il n'aura
 * simplement pas de repère.
 */
export async function enveloppeDuFichier(chemin: string, fenetre: FenetreAudio): Promise<Float64Array | null> {
  const arguments_ = [
    "-nostdin", "-v", "error",
    // `-ss` avant `-i` : le déplacement est immédiat, et la précision d'une image est ici sans objet.
    ...(fenetre.debutSecondes > 0 ? ["-ss", fenetre.debutSecondes.toFixed(3)] : []),
    "-t", fenetre.dureeSecondes.toFixed(3),
    "-i", chemin,
    "-map", "0:a:0?", "-ac", "1", "-ar", String(FREQUENCE_ANALYSE),
    /*
     * **Un seul fil, et c'est un réglage de politesse, pas de performance.**
     *
     * ffmpeg prend par défaut autant de fils qu'il y a de cœurs. Sur le Celeron à quatre cœurs du NAS
     * de référence, une extraction occupait donc la machine entière — et le repérage des génériques,
     * pourtant censé travailler en arrière-plan, rendait la navigation poussive et faisait hoqueter
     * une lecture 4K.
     *
     * Décoder une piste audio mono en 8 kHz ne demande pas quatre cœurs : ce qui coûte, c'est de
     * traverser le conteneur, et cela ne se parallélise pas. On y perd un peu sur la durée d'une
     * extraction isolée, on y gagne une machine qui reste utilisable pendant des heures de passe.
     */
    "-threads", "1",
    "-f", "s16le", "-",
  ];
  const morceaux: Buffer[] = [];
  let total = 0;
  const plafond = Math.ceil(fenetre.dureeSecondes * FREQUENCE_ANALYSE * 2 * 1.1);

  return new Promise((resoudre) => {
    const processus = spawn(config.ffmpegPath, arguments_, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    /*
     * **La priorité la plus basse que le système accepte.**
     *
     * Un fil unique borne ce que l'extraction prend quand la machine est libre ; la priorité décide de
     * ce qu'elle prend quand la machine est **occupée**. C'est cette seconde question qui compte ici :
     * le repérage doit s'effacer devant une lecture, pas la concurrencer à armes égales.
     *
     * L'échec est sans conséquence et se tait : abaisser sa propre priorité est permis partout, mais
     * un conteneur restreint peut le refuser. On aura alors le comportement d'avant, pas pire.
     */
    try { setPriority(processus.pid ?? 0, 19); } catch { /* le système refuse : tant pis, pas tant mieux */ }
    const minuterie = setTimeout(() => { processus.kill("SIGKILL"); resoudre(null); }, DELAI_MS);
    processus.stdout?.on("data", (morceau: Buffer) => {
      total += morceau.length;
      // Un fichier dont la durée annoncée ment produirait sans cela un tampon sans fin.
      if (total > plafond) { processus.kill("SIGKILL"); return; }
      morceaux.push(morceau);
    });
    processus.once("error", () => { clearTimeout(minuterie); resoudre(null); });
    processus.once("close", () => {
      clearTimeout(minuterie);
      if (!morceaux.length) return resoudre(null);
      const octets = Buffer.concat(morceaux);
      // `Int16Array` exige un décalage aligné ; `Buffer.concat` ne le garantit pas.
      const echantillons = new Int16Array(octets.length >> 1);
      for (let index = 0; index < echantillons.length; index += 1) echantillons[index] = octets.readInt16LE(index * 2);
      const resultat = enveloppe(echantillons, FREQUENCE_ANALYSE, PAS_MS);
      resoudre(resultat.length ? resultat : null);
    });
  });
}
