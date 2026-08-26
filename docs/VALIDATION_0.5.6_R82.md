# Validation 0.5.6.r82 — l'interface ne connaît plus Android

*27 août 2026. Deuxième étape du chantier « client de bureau identique à Android ». Cette note ne
rapporte que des résultats **réellement exécutés**.*

## 1. Ce qui restait à couper

Après r81, tout le dossier `ui/` était portable **sauf deux fichiers**. C'est peu, et c'était
suffisant pour empêcher le tout de bouger : un module partagé ne peut pas embarquer un fichier qui
importe `android.content.Context`.

| Fichier | Ce qu'il apportait d'Android | Traitement |
| --- | --- | --- |
| `ui/Gabarit.kt` | `Context`, `UiModeManager`, `ActivityManager`, `PackageManager`, `Configuration` | les deux fonctions qui interrogent l'appareil sont parties dans `AppareilAndroid.kt` |
| `ui/PleinEcran.kt` | `Activity`, `Build`, `WindowManager` | **déplacé hors de `ui/`** : c'est une extension d'`Activity`, appelée par les activités et jamais par un composable |

**`ui/` ne contient plus un seul `import android.`**

## 2. La frontière, et de quel côté tombe quoi

Le principe tient en une phrase : `Gabarit.kt` dit **ce qu'on fait** d'une classe de mémoire ou d'un
type d'écran ; `AppareilAndroid.kt` dit **comment on les découvre**.

Concrètement, les fonctions qui choisissaient une taille de texture prenaient un `Context` et
appelaient `memoireTv(context)` sur place. Elles prennent maintenant la classe de mémoire elle-même,
et l'activité la mesure une fois pour toutes en la fournissant en ambiance — `LocalMemoireTv`, à côté
de `LocalGabarit` qui existait déjà pour la même raison.

Un écran ne demande donc plus à Android quelle taille décoder : il lit une valeur qu'on lui a donnée.

## 3. Deux contrats pour la couche données

`SessionStore` range dans les préférences partagées d'Android ; `ServerDiscovery` interroge le service
NSD du système. Ni l'un ni l'autre n'existe ailleurs, et tant que le reste du code **nommait ces
classes-là**, il ne pouvait pas quitter Android.

| Contrat | Ce qu'il expose | Mise en œuvre Android | Mise en œuvre neutre |
| --- | --- | --- | --- |
| `Reglages` | trois valeurs : serveur, profil, jeton distant | `SessionStore` | `ReglagesEnMemoire` |
| `DecouverteServeurs` | deux gestes : commencer, arrêter | `ServerDiscovery` | `AucuneDecouverte` |

Les contrats sont volontairement minuscules. `Reglages` n'expose ni fichier, ni clé, ni format —
chaque système range ces trois valeurs à sa façon, et c'est cette petitesse qui permet au reste du
code de ne jamais savoir où il vit.

`FlixTunesRepository` et `MainViewModel` déclarent désormais le contrat, pas la mise en œuvre.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Tests JVM Android | **211**, 0 échec — 208 plus les trois nouveaux |
| Imports `android.` dans `ui/` | **0** |
| APK debug | construit, 18,1 Mio |

Les trois cas ajoutés ne vérifient pas un comportement subtil : ils vérifient une **propriété de
construction**. L'entrepôt se monte avec un stockage en mémoire, sans `Context` ni préférences
partagées — exactement ce qu'un module partagé aura besoin de faire, et exactement ce qui échouerait
si quelqu'un remettait le type concret dans une signature.

Un défaut trouvé ainsi pendant l'étape, d'ailleurs : `FlixTunesRepository` déclarait encore
`SessionStore`. Le compilateur l'a signalé dès que le ViewModel a cessé de le faire.

## 5. Où en est le chantier

| Étape | État |
| --- | --- |
| 1 — sortir les écrans de l'activité | **faite** (r81) |
| 2 — isoler les frontières plateforme | **faite** (r82) |
| 3 — restructurer Gradle en multiplateforme | à venir |
| 4 — ressources | à venir |
| 5 — lecteur desktop VLCJ | à venir, pari déjà levé par la sonde |
| 6 — fenêtre, clavier, paquets Windows et `.deb` | à venir |

Restent hors du dossier partagé, et c'est leur place : les activités, le lecteur Media3, la découverte
NSD, le stockage en préférences, et la lecture du son de démarrage.
