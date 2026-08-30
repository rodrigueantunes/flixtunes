#!/usr/bin/env node
/**
 * Prépare la copie de VLC que l'installateur emportera.
 *
 * Le client de bureau ne demande pas à la machine d'avoir VLC : il l'apporte. C'est une décision, et
 * elle a un prix — une faille corrigée chez VideoLAN ne nous arrive qu'à notre prochaine livraison,
 * là où un paquet système l'aurait reçue tout seul. Le contrepoids est qu'un installateur qui
 * fonctionne sans rien demander à personne est le seul qu'on puisse donner à quelqu'un.
 *
 * ## Ce qu'on emporte, et ce qu'on laisse
 *
 * VLC installé pèse 183 Mio. On n'en prend pas la moitié, et chaque retrait se justifie par la façon
 * dont ce client s'en sert — jamais par la taille seule :
 *
 * | Écarté | Pourquoi |
 * | --- | --- |
 * | `plugins/gui` (18,9 Mio) | l'interface Qt. On lance VLC avec `--intf dummy` : elle n'est jamais ouverte. |
 * | `plugins/visualization` (2 Mio) | les animations sur la musique. Ce client montre des films. |
 * | `skins` (0,5 Mio) | les habillages de cette même interface. |
 * | `hrtfs` (0,1 Mio) | le rendu binaural au casque, que rien ici n'active. |
 * | `locale`, sauf `fr` (41,7 Mio) | les messages de VLC dans cent langues. Ils ne s'affichent nulle part — l'interface est celle du client Web —, et la seule à pouvoir apparaître dans une trace est le français. |
 * | `axvlc.dll`, `npvlc.dll` (2,4 Mio) | le contrôle ActiveX et le greffon de navigateur. Deux technologies mortes, que rien ici n'appelle. |
 * | `uninstall.exe` | **le désinstalleur de VLC.** Celui-là ne part pas pour sa taille : le laisser mettrait dans le dossier de FlixTunes un programme qui propose de désinstaller autre chose. |
 * | `NEWS.txt` | le journal des versions de VLC. `COPYING.txt`, `AUTHORS.txt` et `THANKS.txt` restent : la licence et les auteurs se transmettent, le journal non. |
 *
 * Tout le reste part tel quel, **codecs compris**. Tailler dans les codecs ferait exactement ce que
 * ce client existe pour éviter : un fichier qui ne se lit plus et un NAS qui se remet à convertir.
 *
 * ## La licence
 *
 * VLC est sous GPL v2 ou ultérieure, FlixTunes sous GPL v3 : l'embarquement est régulier. Le texte
 * de licence de VLC voyage avec ses binaires, et le dépôt public tient lieu d'offre de sources.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Là où VLC est installé, sur la machine qui construit. */
const SOURCES_WINDOWS = [
  process.env.FLIXTUNES_VLC_SOURCE,
  "C:\\Program Files\\VideoLAN\\VLC",
  "C:\\Program Files (x86)\\VideoLAN\\VLC",
].filter((chemin) => Boolean(chemin));

/** Dossiers et fichiers écartés — voir le tableau en tête de fichier. */
const ECARTES = new Set([
  "skins", "hrtfs",
  "axvlc.dll", "npvlc.dll", "uninstall.exe", "NEWS.txt",
  "New_Skins.url", "Documentation.url", "VideoLAN Website.url",
]);
const GREFFONS_ECARTES = new Set(["gui", "visualization"]);
/** La seule langue qui puisse apparaître dans une trace de ce client. */
const LANGUE_GARDEE = "fr";

function sourceVlc() {
  const trouve = SOURCES_WINDOWS.find((chemin) => existsSync(path.join(chemin, "vlc.exe")));
  if (!trouve) {
    throw new Error(
      "VLC est introuvable sur cette machine. Installez-le, ou indiquez son dossier par FLIXTUNES_VLC_SOURCE.",
    );
  }
  return trouve;
}

function mesurer(dossier) {
  let octets = 0;
  let fichiers = 0;
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      const sous = mesurer(complet);
      octets += sous.octets;
      fichiers += sous.fichiers;
    } else {
      octets += statSync(complet).size;
      fichiers += 1;
    }
  }
  return { octets, fichiers };
}

export function preparerVlc(destination) {
  if (process.platform === "linux") return preparerVlcLinux(destination);
  const source = sourceVlc();
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  for (const entree of readdirSync(source, { withFileTypes: true })) {
    if (ECARTES.has(entree.name)) continue;
    const depuis = path.join(source, entree.name);
    const vers = path.join(destination, entree.name);

    if (entree.name === "plugins") {
      mkdirSync(vers, { recursive: true });
      for (const famille of readdirSync(depuis, { withFileTypes: true })) {
        if (famille.isDirectory() && GREFFONS_ECARTES.has(famille.name)) continue;
        cpSync(path.join(depuis, famille.name), path.join(vers, famille.name), { recursive: true });
      }
      continue;
    }

    if (entree.name === "locale") {
      const langue = path.join(depuis, LANGUE_GARDEE);
      if (existsSync(langue)) cpSync(langue, path.join(vers, LANGUE_GARDEE), { recursive: true });
      continue;
    }

    cpSync(depuis, vers, { recursive: true });
  }

  const { octets, fichiers } = mesurer(destination);
  return { source, destination, fichiers, mio: octets / (1024 * 1024) };
}

/**
 * Réunit les morceaux de VLC d'un système Debian ou Ubuntu en un seul dossier.
 *
 * Rien n'est taillé ici : le paquet `vlc-plugin-base` ne porte déjà que ce qui sert, et l'interface
 * Qt vit dans un paquet à part qu'on n'installe pas. Le tri fait sous Windows n'aurait donc rien à
 * retirer.
 */
function preparerVlcLinux(destination) {
  const manquants = [];
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const morceau of MORCEAUX_LINUX) {
    const depuis = morceau.depuis.replace("@", ARCHITECTURE_LINUX);
    if (!existsSync(depuis)) { manquants.push(depuis); continue; }
    cpSync(depuis, path.join(destination, morceau.vers), { recursive: true });
  }
  if (manquants.length > 0) {
    throw new Error(
      `VLC est incomplet sur cette machine. Manquent : ${manquants.join(", ")}.
`
      + "Installez « vlc-bin » et « vlc-plugin-base », ou indiquez l'architecture par FLIXTUNES_ARCH_LINUX.",
    );
  }
  const { octets, fichiers } = mesurer(destination);
  return { source: "/usr", destination, fichiers, mio: octets / (1024 * 1024) };
}

// Appelé directement, et non importé. La comparaison passe par `pathToFileURL` : sous Windows, un
// chemin de fichier n'est pas une URL, et les recoller à la main donne des faux négatifs silencieux.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const destination = process.argv[2] ?? path.join(ici, "..", "..", "apps", "desktop", "vendor", "vlc");
  const bilan = preparerVlc(path.resolve(destination));
  console.log(`VLC préparé depuis ${bilan.source}`);
  console.log(`  ${bilan.fichiers} fichiers, ${bilan.mio.toFixed(1)} Mio dans ${bilan.destination}`);
}
