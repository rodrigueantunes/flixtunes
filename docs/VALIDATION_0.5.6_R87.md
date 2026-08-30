# Validation 0.5.6.r87 — VLC choisit ses pistes, et le NAS cesse de recopier des films pour ça

*30 août 2026. Étape 4 du chantier « client de bureau ». Cette note ne rapporte que des résultats
**réellement exécutés**, relevés de VLC à l'appui.*

## 1. Ce qui disparaît

Deux conversions, et ce sont les deux plus chères que ce client déclenchait encore.

**Changer de langue recopiait le film.** Un navigateur ne sait pas activer une piste secondaire d'un
Matroska : le serveur devait l'isoler dans un remux. Quelques secondes d'attente, un flux de plus à
produire, et cela à chaque changement. VLC choisit dans le fichier tel quel — c'est désormais
immédiat, **constaté à l'écran** : l'entrée de VLC (`currentplid`) reste la même, l'horloge ne
bronche pas, et le serveur ne reçoit aucune nouvelle demande.

**Un sous-titre image faisait réencoder le film entier.** Un PGS ne peut pas devenir du texte : pour
un navigateur, il faut l'**incruster**. VLC le dessine. La session reste en lecture directe.

## 2. Les numéros de piste, et comment on sait qu'ils correspondent

VLC range ses pistes sous des clés traduites — « Flux 3 » ici, « Stream 3 » ailleurs, et
`--language=en` n'y change rien. On n'en lit donc **que le nombre**.

Que ce nombre soit celui du serveur a été vérifié deux fois, et non supposé :

| Épreuve | Résultat |
| --- | --- |
| Les dix flux d'un Matroska, comparés un à un | vidéo 0, audio 1 (eng) 2 (fre) 3 (spa), sous-titres 4 à 9 — **mêmes numéros, mêmes langues des deux côtés**, y compris le « fre » isolé en huitième position |
| Un marqueur indépendant de tout libellé | `audio-track-id=3` sélectionne la piste à **2 canaux, 224 kb/s** — exactement celle que le serveur annonce à l'index 3 ; `=2` en prend une à 6 canaux, 640 kb/s |

Et le lecteur ne se fie pas pour autant à cette correspondance : il ne désigne à VLC qu'un numéro
figurant dans la liste que VLC lui-même a rendue. Sinon il redemande une session au serveur — le
chemin d'hier, plus lent mais juste.

## 3. Deux défauts constatés en service, et corrigés

Les deux ont été **vus en regardant l'application tourner**, pas trouvés dans le code.

### 3.1 Le film démarrait dans la mauvaise langue

En annonçant que le client sait choisir, on a dispensé le serveur d'isoler la piste : il sert le
fichier entier, toutes langues comprises. Personne ne disait alors laquelle jouer, et VLC prenait la
première du fichier — l'anglais, quand le profil demande le français. Le défaut n'existait pas avant
ce progrès : le serveur isolait la bonne piste et il n'y avait rien à désigner.

### 3.2 Puis le film démarrait sans son

Première correction : désigner la piste dès que VLC annonce sa liste. Elle a produit un défaut pire
que le premier, et la trace de VLC le disait sans ambiguïté :

```
main audio output error: too low audio sample frequency (0)
main decoder error: failed to create audio output
```

VLC annonce ses pistes **avant** d'avoir lu le format du flux audio. Changer de piste à cet instant
lui fait rouvrir un flux dont il ignore encore la fréquence d'échantillonnage, et la sortie audio
n'est jamais créée.

La réponse n'était pas d'attendre le bon moment mais de **ne pas changer du tout** : les pistes sont
passées en options de l'entrée, et prises au moment où le flux s'ouvre. Aucun décodeur à tuer, aucune
sortie audio à refaire.

| Après correction | Relevé |
| --- | --- |
| Options passées à l'ouverture | `audio-track-id=2` (français), `sub-track-id=5` |
| Piste réellement décodée | 6 canaux, 48 kHz, 640 kb/s |
| Sortie audio créée | oui — `output 'f32l' 44100 Hz Stereo` |
| Son effectivement joué | oui — tampons joués 1 173 → 1 302 |
| Changements de piste en cours de route | **zéro** |

Les deux erreurs `failed to create audio output` du démarrage subsistent, et c'est normal : elles
apparaissent à l'identique dans une lecture VLC ordinaire, sans aucun changement de piste. VLC les
franchit dès qu'il connaît le format.

## 4. Ce que la déclaration promet maintenant

| Annonce | Avant | Après |
| --- | --- | --- |
| `directAudioStreamSelection` | `false` — le serveur isolait la piste | **`true`** |
| `burnSubtitles` sur un sous-titre image du fichier | `true` — le serveur réencodait | **`false`** |
| Sous-titre image **externe** | incrusté | incrusté — c'est un fichier à part, que VLC ne trouvera pas dans le flux qu'on lui donne |
| En compatibilité maximale | — | on ne promet plus rien : le flux converti ne porte qu'une piste |

## 5. Ce qu'on ne mesure pas, et pourquoi on ne fait pas semblant

L'étape prévoyait des « capacités lues sur la machine réelle ». Trois s'y prêtent mal, et les
inventer aurait été pire que de s'en tenir à ce qu'on sait :

- **Le nombre de canaux de sortie.** Annoncer huit canaux quel que soit le matériel est *meilleur*
  qu'une mesure : le serveur transmet alors le 7.1 tel quel et VLC réduit lui-même vers les
  haut-parleurs présents, sans que rien ne soit réencodé. Une mesure ferait convertir pour un
  mélange que VLC fait mieux, et pour rien.
- **La définition décodable.** Elle décrit ce qu'un décodeur accepte, pas la taille de l'écran.
  Déclarer l'écran ferait convertir une source 4K que VLC réduit sans effort.
- **La plage dynamique**, elle, *est* mesurée — c'est l'écran qui décide, et Chromium le sait aussi
  bien dans la coque que dans un onglet.

## 6. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Tests Web | **226**, 0 échec |
| Tests de la coque | **20**, 0 échec |
| Compilation TypeScript | aucune erreur |
| Décodage | matériel — D3D11VA sur RTX 5070 Ti |

## 7. L'installateur emporte tout

`FlixTunes-Bureau-0.5.6-x64.msi`, **131 Mio**, et rien à installer d'autre sur la machine qui le
reçoit. Vérifié après installation : le programme ouvre `resources/vlc/vlc.exe`, **sa** copie, et
non celle du système — lu sur la ligne de commande du processus.

VLC est taillé de 183 à 117 Mio, et chaque retrait tient à l'usage qu'on en fait :

| Écarté | Pourquoi |
| --- | --- |
| interface Qt, 19 Mio | on lance avec `--intf dummy` : elle ne s'ouvre jamais |
| traductions sauf `fr`, 42 Mio | elles ne s'affichent nulle part — l'interface est celle du Web |
| animations, habillages, rendu binaural | rien ici ne les active |
| ActiveX, greffon de navigateur | deux technologies mortes |
| **le désinstalleur de VLC** | celui-là pour une autre raison : un programme qui propose de désinstaller autre chose n'a rien à faire dans le dossier de FlixTunes |

**Aucun codec n'est touché.** Y tailler ferait exactement ce que ce client existe pour éviter : un
fichier qui ne se lit plus et un NAS qui se remet à convertir.

Le logo est l'icône, sur l'exécutable comme dans la barre des tâches — portée par la fenêtre du
dessous, l'autre étant retirée de la barre.

## 8. Deux pièges de l'empaquetage

**Des liens symboliques macOS dans une archive Windows.** electron-builder télécharge des outils dont
l'archive en contient ; Windows refuse de les créer sans un privilège qu'une session ordinaire n'a
pas, et la construction s'arrêtait sur une partie qui ne nous sert à rien. Le script extrait
désormais l'archive lui-même en écartant ce dossier — rien à régler sur la machine.

**`**/build/` avalait l'icône de l'installateur**, le même piège que `data/` en r77. La ressource a
été renommée plutôt que le motif contourné : un dossier nommé `build` qui n'est pas une sortie de
construction invite le malentendu.

## 9. Une commande pour tous les clients

`tools/Build-Release.ps1` demande la version puis la révision — la valeur du journal est proposée,
Entrée l'accepte — ou les reçoit en paramètres. Le dossier de sortie est une variable en tête de
script, et l'en-tête documente les deux formes.

La version saisie est écrite à sa source unique et propagée ; la révision estampille les paquets
**et** le titre du journal. C'est la règle du projet : une révision ne monte qu'à la génération.

Le script produit ce que son système sait produire et nomme le reste. Sous Windows : paquet ASUSTOR,
APK Android, `.msi`. Sous Linux : `.deb` et AppImage. Lancé sur les deux, il remplit le même dossier.

## 10. Le client WPF est retiré

Il portait une seconde interface, écrite à la main, en retard sur celle du Web et sans les écrans
d'administration, l'accès distant ni la liste personnelle. Le client de bureau ne la réécrit pas :
il **est** le client Web. Le dépôt passe de trois interfaces à deux, et perd avec lui un SDK .NET
épinglé et deux déclarations de version à tenir.

## 11. Suite

Les cinq étapes du chantier sont faites. Restent deux limites énoncées plutôt que tues :

- le `.deb` et l'AppImage sont configurés et le rassemblement des morceaux de VLC d'un système Debian
  est écrit, mais **aucune machine Linux n'était disponible** : ce chemin n'est pas éprouvé ;
- le menu **Qualité** est vide en mode bureau — une lecture directe n'a pas de paliers, et sur un
  flux converti c'est VLC qui choisit — et l'**incrustation dans un coin** n'est pas offerte, étant
  un service que le navigateur rend à une balise vidéo.
