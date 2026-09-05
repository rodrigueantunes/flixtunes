#!/usr/bin/env node
/**
 * Prépare la copie de VLC que l'installateur emportera.
 *
 * Le client de bureau ne demande pas à la machine d'avoir VLC : il l'apporte. C'est une décision, et
 * elle a un prix — une faille corrigée chez VideoLAN ne nous arrive qu'à notre prochaine livraison,
 * là où un paquet système l'aurait reçue tout seul. Le contrepoids est qu'un installateur qui
 * fonctionne sans rien demander à personne est le seul qu'on puisse donner à quelqu'un.
 *
 * ## Windows : on taille dans ce qui est installé
 *
 * VLC installé pèse 183 Mio. On n'en prend pas les deux tiers, et chaque retrait se justifie par la
 * façon dont ce client s'en sert — jamais par la taille seule :
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
 * ## Linux : on tire les paquets d'Ubuntu
 *
 * On les télécharge au lieu de copier ceux de la machine, et pour une raison qui compte : **cela
 * marche depuis Windows**. Le paquet Linux se construit alors sur la machine qui construit tout le
 * reste, sous la même estampille, au lieu d'attendre qu'on en démarre une seconde.
 *
 * Un `.deb` est une archive `ar` contenant une archive `tar` ; le `tar` de Windows lit les deux, y
 * compris la compression zstd que Debian emploie désormais. Aucun outil à installer.
 *
 * On y prend la **même version de VLC** que sous Windows. Deux clients du même produit qui n'auraient
 * pas le même moteur de lecture finiraient par n'avoir pas les mêmes défauts, et chaque rapport
 * demanderait d'abord de savoir sur lequel on est tombé.
 *
 * Rien n'est taillé de ce côté : `vlc-plugin-base` ne porte déjà que ce qui sert, et l'interface Qt
 * vit dans un paquet à part qu'on ne prend pas.
 *
 * ## La licence
 *
 * VLC est sous GPL v2 ou ultérieure, FlixTunes sous GPL v3 : l'embarquement est régulier. Le texte
 * de licence de VLC voyage avec ses binaires, et le dépôt public tient lieu d'offre de sources.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

/** L'architecture des paquets Ubuntu, et la version de VLC qu'on y prend — la meme que sous Windows. */
const ARCHITECTURE_LINUX = process.env.FLIXTUNES_ARCH_LINUX ?? "x86_64-linux-gnu";
const VERSION_VLC_LINUX = process.env.FLIXTUNES_VERSION_VLC ?? "3.0.23-1";
const DEPOT_UBUNTU = process.env.FLIXTUNES_DEPOT_UBUNTU ?? "http://archive.ubuntu.com/ubuntu/pool/universe/v/vlc";
const PAQUETS_LINUX = [
  "libvlccore9", "libvlc5", "vlc-bin", "vlc-plugin-base", "vlc-plugin-video-output", "vlc-data",
];

/**
 * Les paquets qui ne dépendent d'aucune architecture, et s'appellent donc `_all.deb`.
 *
 * `vlc-data` ne contient que des fichiers de données — pages, icônes, scripts Lua : rien de compilé,
 * donc rien qui distingue un processeur d'un autre. Debian le publie sous `all`, et le demander en
 * `amd64` rend un 404 franc.
 */
const PAQUETS_SANS_ARCHITECTURE = new Set(["vlc-data"]);

/**
 * Les greffons qui permettent d'afficher une image sur un bureau Linux.
 *
 * `vlc-plugin-base` ne les contient pas : Debian les range dans un paquet à part,
 * `vlc-plugin-video-output`, qu'on ne prenait pas. Le VLC emporté savait donc décoder mais **pas
 * montrer** — ses seules sorties étaient `fb`, `vdummy`, `vmem` et `yuv`.
 *
 * Le symptôme était trompeur au possible :
 *
 *     vlc: unknown option or missing mandatory argument `--drawable-xid=…'
 *
 * L'option n'était pas inconnue de VLC : elle est **déclarée par le greffon de sortie X11**, absent.
 * On a donc cherché du côté des chemins et des permissions ce qui manquait au paquet lui-même.
 *
 * D'où cette vérification : le préparateur échoue franchement si aucune sortie d'affichage n'a été
 * emportée, plutôt que de livrer un lecteur muet qui ne se découvrira qu'à l'usage.
 */
const SORTIES_AFFICHAGE = [
  "libxcb_x11_plugin.so", "libxcb_xv_plugin.so", "libgl_plugin.so",
  "libglx_plugin.so", "libwl_shell_surface_plugin.so",
];

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

function executer(ligne, cwd) {
  const bilan = spawnSync(ligne, { shell: true, cwd, stdio: "ignore" });
  if (bilan.status !== 0) throw new Error(`« ${ligne} » a échoué (code ${bilan.status})`);
}

/** Le `tar` capable de lire un `.deb` : celui de Windows, ou celui du système. */
function tarDuSysteme() {
  return process.platform === "win32"
    ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
}

/**
 * @param destination Où déposer la copie.
 * @param cible `win32` ou `linux` — le système que l'installateur visera, pas celui qui construit.
 */
export function preparerVlc(destination, cible = process.platform) {
  return cible === "linux" ? preparerVlcLinux(destination) : preparerVlcWindows(destination);
}

function preparerVlcWindows(destination) {
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
  return { source, destination, fichiers, mio: octets / (1024 * 1024), dependances: [] };
}

function preparerVlcLinux(destination) {
  const tar = tarDuSysteme();
  const atelier = path.join(path.dirname(destination), "vlc-linux-atelier");
  const arbre = path.join(atelier, "arbre");
  rmSync(destination, { recursive: true, force: true });
  rmSync(atelier, { recursive: true, force: true });
  mkdirSync(arbre, { recursive: true });
  mkdirSync(destination, { recursive: true });

  for (const nom of PAQUETS_LINUX) {
    const architecture = PAQUETS_SANS_ARCHITECTURE.has(nom) ? "all" : "amd64";
    const fichier = `${nom}_${VERSION_VLC_LINUX}_${architecture}.deb`;
    executer(`curl -fsSL -o "${fichier}" "${DEPOT_UBUNTU}/${fichier}"`, atelier);
    executer(`"${tar}" -xf "${fichier}"`, atelier);
    const charge = readdirSync(atelier).find((entree) => entree.startsWith("data.tar"));
    if (!charge) throw new Error(`${fichier} ne contient pas de data.tar.*`);
    /*
     * L'extraction rend un code d'erreur, et on l'accepte : les seules entrees qui echouent sont les
     * **liens symboliques**, que Windows refuse de creer sans un privilege qu'une session ordinaire
     * n'a pas. Les vrais fichiers, eux, arrivent tous — verifie entree par entree. On les reconstitue
     * ensuite en copies, ce qu'un chargeur de bibliotheques ne distingue pas d'un lien.
     *
     * Ce qui manquerait vraiment se voit plus bas : la liste des morceaux est verifiee, et l'absence
     * de l'un d'eux arrete la construction.
     */
    tolerer(`"${tar}" -xf "${charge}" -C "arbre"`, atelier);
    rmSync(path.join(atelier, charge), { force: true });
  }

  const lib = path.join(arbre, "usr", "lib", ARCHITECTURE_LINUX);
  copier(path.join(arbre, "usr", "bin", "vlc"), path.join(destination, "vlc"));
  copier(path.join(lib, "vlc", "plugins"), path.join(destination, "plugins"));
  copier(path.join(lib, "vlc", "lua"), path.join(destination, "lua"));
  /*
   * **Les données Lua vivent ailleurs que les modules Lua, et il fallait les deux.**
   *
   * Debian sépare ce que Windows réunit. `/usr/lib/…/vlc/lua/` porte les modules compilés — `intf`,
   * `playlist`, `meta` —, copiés juste au-dessus. `/usr/share/vlc/lua/` porte leurs **ressources**,
   * dont le dossier `http` : la page web, ses scripts, ses feuilles de style. Deux paquets, deux
   * emplacements, un seul dossier `lua` une fois installé.
   *
   * Sans lui, l'interface de commande se charge puis renonce :
   *
   *     lua interface error: Error loading script …/lua/intf/http.luac:
   *     lua/intf/http.lua:279: Unable to find the `http' directory
   *
   * On ne se sert pourtant pas de cette page — le pilotage passe par `requests/status.json`. Mais
   * `http.lua` vérifie sa racine avant de servir quoi que ce soit, et refuse de démarrer sans elle.
   * C'est une dépendance de l'interface, pas de notre usage.
   */
  const donnees = path.join(arbre, "usr", "share", "vlc", "lua");
  if (existsSync(donnees)) {
    for (const entree of readdirSync(donnees, { withFileTypes: true })) {
      copier(path.join(donnees, entree.name), path.join(destination, "lua", entree.name));
    }
  }
  for (const dossier of [lib, path.join(lib, "vlc")]) {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (!entree.isFile() || !/^libvlc.*\.so(\.\d+)+$/.test(entree.name)) continue;
      for (const nom of nomsDeBibliotheque(entree.name)) {
        cpSync(path.join(dossier, entree.name), path.join(destination, nom));
      }
    }
  }

  const essentiels = ["vlc", "plugins", "lua", "libvlc.so.5", "libvlccore.so.9"];
  const manquants = essentiels.filter((nom) => !existsSync(path.join(destination, nom)));
  if (manquants.length > 0) {
    throw new Error(`Ces morceaux manquent dans les paquets Ubuntu : ${manquants.join(", ")}.`);
  }

  /*
   * Un lecteur qui ne sait pas afficher n'est pas un lecteur, et cela doit se voir **ici**.
   *
   * Sans ce contrôle, l'absence des sorties vidéo ne s'est manifestée qu'après quatre révisions, au
   * bout d'une installation réelle, sous la forme d'une erreur qui accusait une option. Le
   * préparateur en est le seul juge possible : il est le seul endroit où l'on sache ce qu'on a
   * effectivement emporté.
   */
  /*
   * L'interface de commande est **le** moyen de piloter la lecture : sans elle, le client de bureau
   * ne sait ni mettre en pause, ni déplacer la lecture, ni même savoir où elle en est. Son absence
   * doit donc arrêter la préparation, au même titre qu'une sortie vidéo manquante.
   */
  const racineHttp = path.join(destination, "lua", "http", "index.html");
  if (!existsSync(racineHttp)) {
    throw new Error(
      "Le dossier `lua/http` manque : l'interface de commande de VLC refusera de démarrer. "
      + "Il vient du paquet vlc-data, sous /usr/share/vlc/lua.");
  }

  const sorties = path.join(destination, "plugins", "video_output");
  const affichage = SORTIES_AFFICHAGE.filter((greffon) => existsSync(path.join(sorties, greffon)));
  if (affichage.length === 0) {
    throw new Error(
      "Aucune sortie vidéo dans les paquets Ubuntu : le VLC emporté saurait décoder mais pas afficher. "
      + `Attendu l'un de ${SORTIES_AFFICHAGE.join(", ")} dans plugins/video_output.`);
  }
  console.log(`  sorties d'affichage emportées : ${affichage.join(", ")}`);
  const licence = path.join(arbre, "usr", "share", "doc", "vlc-bin", "copyright");
  if (existsSync(licence)) cpSync(licence, path.join(destination, "COPYING.txt"));

  const dependances = lireDependances(atelier, tar);
  rmSync(atelier, { recursive: true, force: true });
  const { octets, fichiers } = mesurer(destination);
  return { source: DEPOT_UBUNTU, destination, fichiers, mio: octets / (1024 * 1024), dependances };
}

/**
 * Les noms sous lesquels une bibliotheque doit se trouver.
 *
 * Debian livre `libvlc.so.5.6.1` et laisse `ldconfig` poser `libvlc.so.5` a cote. Personne ne le fera
 * ici : on ecrit les deux noms, et le chargeur trouve celui qu'il cherche.
 */
function nomsDeBibliotheque(fichier) {
  const noms = [fichier];
  const majeure = /^(.*\.so)\.(\d+)(?:\.\d+)*$/.exec(fichier);
  if (majeure) noms.push(`${majeure[1]}.${majeure[2]}`);
  return [...new Set(noms)];
}

function copier(depuis, vers) {
  if (!existsSync(depuis)) throw new Error(`Absent des paquets Ubuntu : ${depuis}`);
  cpSync(depuis, vers, { recursive: true, dereference: true });
}

function tolerer(ligne, cwd) {
  spawnSync(ligne, { shell: true, cwd, stdio: "ignore" });
}

/**
 * Ce dont VLC a besoin en plus, lu dans le paquet lui-même plutôt que deviné.
 *
 * Une soixantaine de bibliothèques que la distribution fournit — codecs, sous-titres, disques. Elles
 * sont **déclarées** par notre `.deb` et non embarquées : c'est la seule part de l'installateur qui
 * ne voyage pas avec lui, et elle est dite plutôt que tue.
 */
function lireDependances(atelier, tar) {
  const paquet = `vlc-plugin-base_${VERSION_VLC_LINUX}_amd64.deb`;
  const coin = path.join(atelier, "controle");
  mkdirSync(coin, { recursive: true });
  executer(`"${tar}" -xf "${paquet}" -C "controle"`, atelier);
  const controle = readdirSync(coin).find((entree) => entree.startsWith("control.tar"));
  if (!controle) return [];
  executer(`"${tar}" -xf "${controle}"`, coin);
  const texte = readFileSync(path.join(coin, "control"), "utf8");
  const trouve = /^Depends:[ \t]*([^\n]*(?:\n[ \t][^\n]*)*)/m.exec(texte);
  if (!trouve) return [];
  // Ce qu'on embarque soi-même ne se déclare pas : `libvlccore9` et `libvlc5` voyagent dans le
  // paquet, exiger de la distribution qu'elle les fournisse aussi serait faux — et empêcherait
  // l'installation là où une autre version de VLC est en place.
  return trouve[1].split(",")
    .map((entree) => entree.trim().split(/[\s(]/)[0])
    .filter((nom) => nom.length > 0 && !nom.startsWith("vlc-") && !PAQUETS_LINUX.includes(nom));
}

// Appelé directement, et non importé. La comparaison passe par `pathToFileURL` : sous Windows, un
// chemin de fichier n'est pas une URL, et les recoller à la main donne des faux négatifs silencieux.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const cible = process.argv.includes("--linux") ? "linux" : process.platform;
  const donne = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const destination = donne ?? path.join(ici, "..", "..", "apps", "desktop", "vendor", "vlc");
  const bilan = preparerVlc(path.resolve(destination), cible);
  console.log(`VLC préparé depuis ${bilan.source}`);
  console.log(`  ${bilan.fichiers} fichiers, ${bilan.mio.toFixed(1)} Mio dans ${bilan.destination}`);
  if (bilan.dependances.length > 0) console.log(`  ${bilan.dependances.length} bibliothèques déclarées en dépendance`);
}
