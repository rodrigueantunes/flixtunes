# Validation 0.5.6.r63 — synchronisation après un saut, et deux défauts d'interface

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Groupes invisibles en WAN — déjà corrigé en r62, vérifié en direct

La capture montrait « Choisissez votre groupe » avec une liste vide. Ce n'était pas un défaut de r62 :
elle datait de r61, où le filtre sur la longueur du code PIN masquait tous les groupes.

**Vérifié sur le site en service** : `flixtunes.exemple.fr` affiche l'écran « Connexion à
FlixTunes ». Mesuré au passage :

| Contrôle | Résultat |
| --- | --- |
| `GET /api/remote/session` (WAN) | `{"required":true,"authenticated":false}` |
| `GET /api/profile-groups` (WAN, sans compte) | `401 REMOTE_ACCOUNT_REQUIRED` |
| `GET /api/profile-groups` (LAN) | trois groupes |
| `GET /api/system/remote-accounts` | `[]` |

**Rien ne manque au code : il manque un compte.** Tant que la liste est vide, personne ne peut
franchir la première barrière — c'est exactement ce que le contrôle « Vérifier l'accès distant »
signale.

## 2. Décalage après une avance — deux causes distinctes

### 2.1 Les sous-titres ne suivaient pas la fenêtre encodée

Quand la cible sort de la fenêtre, le serveur ouvre une session démarrant au temps `T` du film :
l'instant zéro du flux vaut `T`. Les sous-titres du fichier, eux, sont datés dans le temps du film.

`subtitleUrl` accepte un décalage, et **les deux appels du lecteur Android l'omettaient**. Les
sous-titres arrivaient donc en retard d'exactement la position du saut, et l'écart grandissait à
chaque avance. Le client Web ne rencontre pas le défaut : la fenêtre décalée est un chemin quasi
exclusivement Android.

Le signe est l'opposé du décalage de fenêtre — `-itsoffset` repousse vers l'avant, or il faut ramener
le temps du film au temps du flux.

**Second piège, trouvé en corrigeant le premier :** `normalizedSubtitleOffset` bornait à ±600 s, ce
qui convient à un réglage de synchronisation mais pas à une position dans un film. Un saut à une
heure trente demande −5400 s, et la borne l'écrasait en silence. Portée à ±86400.

### 2.2 Le son perdait son écart avec l'image, en remux seulement

`-ss` est placé **avant** `-i`, et doit le rester : après `-i`, ffmpeg décode puis jette tout ce qui
précède, soit des minutes d'attente sur un film de deux heures.

Mais en **copie de flux**, ce placement fait démarrer la vidéo à l'image-clé précédant la cible et
l'audio à la cible exacte. Le début du flux porte alors des horodatages négatifs, et le multiplexeur
les ramène à zéro **piste par piste** — ce qui supprime l'écart réel entre l'image et le son.

D'où un décalage en remux uniquement, jamais en transcodage : exactement ce qui était rapporté,
« en encodage ça avait été corrigé ».

`-avoid_negative_ts make_zero` décale toutes les pistes du **même** montant. Le flux part de zéro et
le rapport entre image, son et sous-titres est conservé.

**Au passage :** le commentaire de `startArgs` annonçait `-copyts` comme conservant les horodatages.
Cette option **n'a jamais été passée** — la remarque décrivait une intention, pas le code. Corrigée,
et un test refuse qu'elle revienne.

## 3. « Retirer le PIN » — le serveur marchait, l'interface non

Éprouvé de bout en bout sur un profil d'essai créé puis supprimé : `PATCH` avec `pin: null` et
`ancienPin` → **HTTP 200**, `protected = false` ensuite.

Le défaut était ailleurs, et il explique « rien ne se passe » :

- le bouton était **désactivé** tant que le code actuel n'était pas saisi, sans dire pourquoi ;
- le message d'échec ne s'affichait **qu'au bas du panneau**, à côté du formulaire de création — donc
  hors du regard de qui vient de cliquer en haut.

Le bouton reste désormais actionnable et nomme lui-même ce qui lui manque ; erreurs et confirmations
s'affichent à l'endroit de l'action.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **68 fichiers, 640 tests, 0 échec** |
| Suite Web | **20 fichiers, 170 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Android | `BUILD SUCCESSFUL` |

Cinq tests neufs verrouillent le §2 : les deux sorties HLS portent `make_zero`, `-ss` reste avant
`-i`, le commentaire n'annonce plus `-copyts`, les deux pistes de sous-titres portent le décalage de
fenêtre, et la borne accepte la taille d'un film.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Le décalage audio** | La correction est standard et verrouillée par un test, mais **elle n'a pas été observée sur un appareil** : la vérifier demande un vrai fichier, un vrai décodeur et une vraie avance. C'est le seul point de cette note qui repose sur un raisonnement plutôt que sur une mesure. |
| Le décalage des sous-titres | même réserve, quoique le mécanisme soit arithmétique et non perceptuel |
| Création d'un compte de connexion | rien ne peut être éprouvé à distance tant qu'aucun compte n'existe |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 (voir r61 et r62) |

**Si le décalage audio persiste après r63**, l'étape suivante est de relever la position réelle du
premier segment produit après un saut — et non d'ajouter une seconde option au hasard.
