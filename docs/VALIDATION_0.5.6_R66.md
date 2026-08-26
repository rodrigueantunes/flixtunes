# Validation 0.5.6.r66 — les jaquettes et la lecture reviennent sur mobile en accès distant

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §4 liste le reste.*

## 1. Ce que les traces ont montré

Le mobile affichait un catalogue **sans jaquettes** — titres et années présents, vignettes en aplats de
couleur — puis « **Compte de connexion requis** » au lancement d'un film.

Le journal de Caddy, qui enregistre chaque requête distante, a tranché sans hypothèse :

```
  3 x 401  /api/artwork/…                okhttp/4.12.0
  4 x 401  /api/media/…/playback-info    Dalvik (Pixel 10)
  1 x 401  /api/home  puis 200           Dalvik
```

Trois enseignements immédiats :

- l'agent `okhttp/4.12.0` désigne **Coil**, le chargeur d'images, et non l'API ;
- `playback-info` échoue depuis la pile de l'application elle-même, alors que l'API transporte bien
  les deux jetons ;
- `/api/home` passe de 401 à 200 : le correctif de r65 fonctionne.

## 2. Deux causes, toutes deux dans une pile HTTP secondaire

### 2.1 Coil ne portait aucun titre d'accès

Le chargeur d'images possède son propre client HTTP. Il ne sait rien des jetons que l'API transporte,
et chaque `/api/artwork/…` repartait nu. Sur le réseau local cela ne se voyait pas — aucune session
n'y est réclamée. Depuis Internet, la grille n'affichait que des aplats pendant que les textes
s'affichaient normalement, puisqu'ils passent par l'API.

Les en-têtes sont posés par un intercepteur qui les **relit à chaque requête**. Fixés une fois à la
construction du chargeur, ils resteraient ceux du premier profil ouvert.

### 2.2 Une instance d'API secondaire effaçait la session de la première

`PlayerActivity` construit sa **propre** instance et ne lui passait que le jeton de profil :

```kotlin
api = FlixTunesApi(server, intent.getStringExtra(EXTRA_PROFILE_TOKEN))
```

Son bloc d'initialisation exécutait alors `JetonSession.compteDistant = null`. Deux conséquences, et
la seconde est la plus grave :

- ses propres appels partaient sans compte, d'où le 401 sur `playback-info` ;
- **le jeton dont ExoPlayer se sert pour ses segments était effacé au passage.** Construire le lecteur
  cassait la session de l'application.

Corrigé des deux côtés : l'instance reprend le jeton du processus quand l'appelant ne le fournit pas,
et son initialisation ne publie que ce qu'elle possède — jamais `null`.

## 3. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **69 fichiers, 650 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| APK livré | les deux en-têtes et l'intercepteur OkHttp présents **dans le dex**, vérifiés par extraction |

### 3.1 Un défaut structurel, apparu trois fois

Sur Android, trois piles HTTP coexistent : celle de l'API, celle d'ExoPlayer et celle de Coil. Chacune
a dû être équipée séparément, et l'oubli ne se voit jamais sur le réseau local — aucune session n'y
étant réclamée, une pile sans titre d'accès y fonctionne parfaitement.

Deux tests de cohérence supplémentaires lisent ces sources et vérifient que chaque pile porte les deux
jetons, et qu'une instance d'API secondaire n'efface pas la session d'une autre. Avec ceux de r65,
cinq tests couvrent désormais cette famille.

## 4. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| Jaquettes et lecture sur mobile en 5G | corrigé et vérifié dans le dex livré, **pas observé sur l'appareil** |
| **Décalage audio après un saut** (r64) | toujours pas observé corrigé sur une tablette |
| Décalage des sous-titres (r63) | même réserve |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |

Le journal de Caddy s'est révélé le meilleur outil de diagnostic de cette série : il nomme le client
fautif par son agent, ce qu'aucune capture d'écran ne peut faire. À consulter en premier pour tout
défaut d'accès distant.
