# FlixTunes 0.5.9.r4 — ouverture Web et reprises Android

## Défaut Web reproduit

La r3 appelait `crypto.randomUUID()` pendant le rendu du lecteur. Cette API n'est pas disponible
en HTTP sur une adresse de NAS. Le test reproduit l'exception avant correction, puis ouvre
le lecteur après correction avec `randomUUID` absent. L'identifiant de session est créé une seule
fois ; `getRandomValues`, disponible en HTTP local, prend le relais. Il ne remplace aucun jeton
d'authentification.

Le scénario de lecture réelle propose désormais `FLIXTUNES_TEST_HTTP_LOCAL=1` : un nom local
de test, résolu uniquement dans le navigateur vers 127.0.0.1, reproduit un contexte HTTP non sécurisé.
Il vérifie explicitement `isSecureContext === false` et l'absence de `randomUUID`. Les tests r3
effectués directement sur 127.0.0.1 n'exposaient pas ce défaut.

## Fermeture Android signalée après 5 à 10 minutes

Le retour au choix du groupe et du profil est compatible avec une recréation du processus.
Sans journal du téléviseur, la cause exacte du signalement n'est pas prouvée. Les défauts suivants
ont été corrigés dans les chemins de reprise :

- Le cache de 64 Mio et les deux tampons de lecture n'avaient pas de budget commun à l'appareil.
  Le cache est maintenant limité à 1–8 Mio et chaque tampon à 4–48 Mio selon le tas autorisé.
  Les gros segments ne sont pas dupliqués dans le cache. Les jaquettes en cache mémoire sont
  libérées à l'ouverture du direct ; leurs fichiers sur disque sont conservés.
- La relève avec un second lecteur est désactivée sur les appareils déclarés à faible mémoire
  et les tas inférieurs à 192 Mio. Ailleurs, elle exige une marge disponible et l'absence de
  pression mémoire système. Le décodeur réellement utilisé doit aussi annoncer au moins deux
  instances simultanées ; une capacité inconnue reste sur un seul lecteur. Le tampon courant
  continue d'être utilisé ; le repli ordinaire reste disponible.
- Une notification de pression mémoire vide le cache et annule la préparation du secours.
- Une exception de préparation ne remonte plus hors de la coroutine de reprise. Une annulation
  conserve son comportement normal. Le lecteur courant n'est remplacé qu'après le rattachement réussi.
- Les reprises automatiques ne détruisent plus la surface vidéo, contrairement au contournement
  ajouté en r3. Le réarmement HDR reste limité aux déplacements manuels. Le correctif Media3
  de synchronisation entre PlayerView et Compose est activé.
- Sur Android 11 et ultérieur, le diagnostic affiche la dernière cause d'arrêt anormal fournie
  par Android si elle date de moins de 24 heures, sans adresse de flux ni jeton.

Ces bornes peuvent réduire la réserve sur un flux à très haut débit : éviter la fermeture de
l'application prime sur une quantité de secondes impossible à conserver dans le tas disponible.
La disparition du voile gris et l'endurance sur l'Android TV concerné nécessitent encore un essai réel.

Références : [surfaces Media3 et Compose](https://developer.android.com/media/media3/ui/surface),
[limites des tampons Media3](https://developer.android.com/reference/androidx/media3/exoplayer/DefaultLoadControl.Builder).

## Validation et livraison

- Régression Web reproduite avant correction : `TypeError: crypto.randomUUID is not a function`.
  Le même test passe après correction.
- 345 tests Web, 1 126 tests serveur et 20 tests bureau réussis ; deux tests de corpus externe
  restent désactivés. TypeScript et les budgets Web passent.
- Opera GX en HTTP non sécurisé : `isSecureContext` vaut `false` et `randomUUID` est absent.
  Lecture, masquage des commandes, coupures de 5/15/30 secondes et changement de source réussis.
  Retard maximal observé : 42,685 secondes ; aucun gel détecté à l'échantillonnage de 250 ms.
  Vidéo synthétique H.264/AAC de 320 × 180 à 15 images/s, hors décodage matériel HD/4K.
- Tests Android : budget des appareils à petit tas, refus du second lecteur sous pression mémoire
  ou capacité de décodage insuffisante, saturation du cache sur 1 000 segments et rejet des segments
  trop gros. Les 259 tests JVM réussissent ; compilation réussie, analyse statique sans erreur
  avec 55 avertissements. Total de la livraison : 1 750 tests réussis et deux désactivés.

Les rapports et le journal final sont conservés dans `artifacts/validation-0.5.9.r4/`.
La compilation et les tests JVM ne constituent pas un essai d'endurance sur le téléviseur concerné.
Aucun déploiement automatique sur le NAS ou sur Android.
