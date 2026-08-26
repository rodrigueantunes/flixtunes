# Validation 0.5.6.r60 — Caddy embarqué et service hors-root

*24 août 2026. Complète `VALIDATION_0.5.6_R59.md`, qui reste valable pour tout ce qu'elle décrit.
Cette note ne rapporte que des résultats **réellement exécutés** ; le §4 liste le reste, avec sa
raison.*

r60 lève les deux réserves de r59 : le binaire Caddy est embarqué, et le service sait tourner sans
privilège.

## 1. Caddy embarqué

| | |
| --- | --- |
| Version | **2.11.4** |
| Fichier | `caddy_2.11.4_linux_amd64.tar.gz` |
| Source | publications officielles `caddyserver/caddy` (GitHub) |
| Taille | 16,4 Mio |
| Somme SHA-512 | **vérifiée conforme** au fichier `caddy_2.11.4_checksums.txt` publié |

Le binaire n'est **pas versionné dans le dépôt** : `Build-AsustorApkg.ps1` le télécharge, vérifie sa
somme et l'extrait dans `runtime/caddy`, exactement comme il le fait déjà pour Node.js et FFmpeg. Une
construction sur une autre machine obtient donc le même paquet sans qu'on ait à transporter 16 Mo sur
le partage réseau.

Détail relevé au passage : Caddy publie ses sommes en **SHA-512**, là où Node.js les publie en
SHA-256. La première vérification a échoué pour cette seule raison — la fonction de construction
emploie le bon algorithme.

### 1.1 Un défaut trouvé par la construction elle-même

La première construction r60 a échoué sur `InvokeMethodOnNull`, sans indiquer où.

Cause : **GitHub sert le fichier de sommes sans jeu de caractères reconnu**, si bien
qu'`Invoke-WebRequest -UseBasicParsing` rend un `Byte[]` et non une chaîne. Le `-split` découpait donc
octet par octet — 6 769 « lignes » pour un fichier de 6 769 octets —, aucune ligne ne correspondait,
et `.Trim()` s'appliquait à `$null`.

La fonction voisine `Get-NodeRuntime` ne rencontre pas le problème parce que nodejs.org annonce
`text/plain`. Copier son modèle ne suffisait donc pas : c'est la même logique, sur un serveur qui
répond autrement.

Corrigé en décodant explicitement lorsque le contenu est binaire, et en séparant le test de nullité
du `.Trim()` — un fichier de sommes introuvable produit désormais « Somme Caddy introuvable » plutôt
qu'une erreur de méthode sur une valeur nulle. Vérifié de bout en bout : ligne trouvée, somme
attendue et somme calculée identiques.

### 1.2 Un second défaut, trouvé en ouvrant le paquet

Le paquet r60 s'est construit et validé sans erreur. À l'ouverture, le binaire Caddy y figurait bien
— 46,3 Mio, ELF Linux — **en mode `0666`, sans bit d'exécution**.

`_tar_filter` de `Build-Apkg.py` tient une **liste blanche** des fichiers auxquels rendre ce bit, que
Windows ne porte pas : node, ffmpeg, ffprobe. Caddy n'y était pas. Le paquet se serait installé
parfaitement, le service aurait démarré, et l'accès distant n'aurait jamais fonctionné — avec un
message annonçant un fichier « absent » alors qu'il était là, ce qui aurait envoyé chercher au
mauvais endroit.

C'est le même mode de panne que le `libva-drm.so.2` manquant de plusieurs révisions : un paquet
complet en apparence, muet à l'exécution. Trois corrections :

1. Caddy rejoint la liste des exécutables ;
2. **`validate()` refuse désormais un paquet dont l'un des binaires déclarés n'a pas le bit
   d'exécution.** Le défaut ne peut plus être livré, pour Caddy comme pour tout binaire ajouté plus
   tard ;
3. `start_caddy` distingue « absent » de « présent mais non exécutable ».

Vérifié en extrayant le paquet, pas en le supposant — c'est d'ailleurs la seule raison pour laquelle
ce défaut a été vu.

## 2. Service hors-root

### 2.1 Ce qui change

`post-install.sh` crée un compte de service `flixtunes`, l'ajoute aux groupes `video`, `render` et
`input` lorsqu'ils existent, puis lui transfère la propriété du partage persistant. `start-stop.sh`
démarre le serveur sous ce compte.

C'est ce qui rend la lecture seule **vérifiable par le système** plutôt que promise par le programme :
jusqu'ici, rien au niveau du système n'empêchait FlixTunes d'effacer la médiathèque.

### 2.2 Ce qui empêche la dégradation silencieuse

Le risque de cette bascule est connu et unique : perdre `/dev/dri/renderD128`, donc VA-API, donc
retomber de 471 à 151 images par seconde. Deux protections, dans cet ordre :

**Une sonde avant la bascule.** `compte_utilisable()` vérifie, *en se plaçant sous le compte cible* :
partage inscriptible, `renderD128` lisible, runtime Node et serveur lisibles. Un seul échec et le
service démarre en root, avec la raison écrite dans `logs/privileges.log`.

**Un repli après la bascule.** Si le démarrage non privilégié échoue malgré la sonde — un `su` qui
refuse sans terminal, un droit manquant plus loin —, le service repart en root et le journalise.

**Le pire cas est donc le comportement de r59, jamais une accélération perdue sans le dire.**

`post-install.sh` est écrit dans le même esprit : chaque étape est facultative et journalisée. Un ADM
dépourvu de `useradd` et d'`adduser` produit une installation qui fonctionne, en root, avec la raison
inscrite au journal — jamais une installation refusée.

### 2.3 Sortie de secours

`FLIXTUNES_RUN_AS=root` dans `flixtunes.env` rétablit le comportement antérieur sans réinstaller.

## 3. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur complète | **63 fichiers, 605 tests, 0 échec**, 148 s |
| Typechecks TypeScript et Kotlin | aucune erreur |
| `bash -n` sur `start-stop.sh` et `post-install.sh` | valides |
| Rendu à blanc du Caddyfile engendré | conforme, sans substitution involontaire |
| Somme SHA-512 de Caddy | conforme |
| Contenu réellement empaqueté (r59) | vérifié par extraction du paquet, pas supposé |

## 4. Reste à exécuter — et c'est l'essentiel de cette note

**Le hors-root n'a pas pu être éprouvé.** Il est écrit, il est protégé par deux filets, mais aucune
de ses lignes n'a tourné sur l'AS5404T : ce poste n'a pas d'accès authentifié au NAS. Concrètement,
ces questions restent ouvertes jusqu'à la première installation :

| Question | Ce qu'on saura en l'exécutant |
| --- | --- |
| ADM sait-il créer un compte système ? | `logs/privileges.log`, ligne « compte créé » ou « ni useradd ni adduser » |
| `renderD128` reste-t-il lisible ? | ligne « accélération conservée » ou « ATTENTION » |
| **M4** — VA-API ≥ 90 % de 471 im/s | `GET /api/system/capacity` après redémarrage |
| Le `su -m` conserve-t-il l'environnement VA-API ? | journal de sonde VA-API au démarrage |
| Le `chown -R` du partage passe-t-il ? | ligne « propriété transférée » |

Restent également non exécutés, comme en r59 : **M5** (première image WAN comparée au LAN), **M7**
(six conversions simultanées), `caddy validate` sur le document engendré, la chaîne complète avec
certificat réel, et l'installation elle-même. `FLIXTUNES_TRANSCODE_CONCURRENCY=6` demeure écrit et
inactif faute de redémarrage.

**Aucune de ces vérifications ne peut être faite depuis ce poste.** Elles demandent l'installation du
paquet sur le NAS, qui demande des identifiants que je ne détiens pas.

## 5. Ordre d'installation recommandé

Le paquet est conçu pour que chaque étape soit observable avant la suivante.

1. **Installer r60 sans rien activer.** `FLIXTUNES_WAN_DOMAIN` reste vide : ni écoute distante, ni
   Caddy, ni port lié. Seul le hors-root s'applique.
2. **Lire `logs/privileges.log`** et `GET /api/system/capacity`. Si VA-API n'est plus retenu ou si le
   débit s'est effondré, poser `FLIXTUNES_RUN_AS=root` et redémarrer : on revient à r59 sans
   réinstaller.
3. **Vérifier que `maximumTranscodes` vaut 6**, la variable étant désormais lue au démarrage.
4. **Puis seulement** créer l'enregistrement DNS, rediriger 80 → 8080 et 443 → 8444 sur la box, poser
   le domaine et redémarrer.
5. **Reposer les codes PIN à six chiffres** pour les profils à ouvrir à distance : aucun profil
   existant n'est joignable tant que ce n'est pas fait.

Séparer 1 et 4 est ce qui permet de savoir à quoi imputer un défaut. Tout activer d'un coup ferait
d'un problème de droits et d'un problème de certificat la même panne illisible.
