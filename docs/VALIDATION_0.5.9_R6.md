# FlixTunes 0.5.9 r6

## Commandes VLC

Le Live TV natif utilisait des boutons sans les classes et sélecteurs du thème du lecteur.
Les barres et les actions du diagnostic utilisent maintenant les mêmes règles que les films :
fond sombre translucide, texte clair, bordure, arrondis, survol et focus visible. Les commandes
Pause/Reprendre et plein écran sont des icônes nommées pour l'accessibilité. Le curseur de volume
utilise la couleur du thème ; les commandes se replient sur écran étroit.

Le moteur VLC, son relais authentifié et son cache restent ceux de la r5.

## Rendu Android TV après reprise

Le voile gris reste signalé sur Philips en r5. Sans accès au téléviseur, sa cause matérielle
ne peut pas être prouvée. Le code présentait néanmoins deux défauts dans la relève :
un lecteur préparé sans vue pouvait initialiser son codec sur une surface provisoire, puis le
transférer à la vraie surface ; l'état READY était accepté sans attendre une image affichée.
Recréer seulement la PlayerView, comme en r5, ne garantissait donc pas une nouvelle configuration
du codec du candidat.

Le rendu propre au Live TV sur téléviseur désactive les surfaces provisoires/détachées de Media3.
Les segments peuvent être préchargés, mais le codec vidéo attend une vraie surface. Le changement
de surface recrée le codec. Une variation de définition, de MIME ou de métadonnées colorimétriques
interdit aussi sa réutilisation ; un simple changement de débit la conserve. Aucun filtre de
saturation, aucune plage de couleurs inventée et aucune conversion HDR/SDR ne sont appliqués.

La bascule attend la première image du candidat, avec une échéance de cinq secondes et vérification
de l'erreur et de la génération de lecture. L'ancien lecteur reste disponible pour un retour en cas
d'échec. Une source audio seule conserve son chemin de reprise. Une relève vers une autre source
ne conserve plus le plafond de débit imposé à la précédente. Les budgets mémoire et le cache r4/r5
restent en vigueur. Les téléphones gardent le rendu standard.

Le choix conservateur du codec TV peut ajouter une brève interruption lors d'un changement de
définition ou d'une relève. Il vise à retrouver une sortie correctement configurée ; il ne garantit
pas une reprise imperceptible sur tous les appareils.

Références de l'implémentation :
[MediaCodecVideoRenderer 1.10.1](https://github.com/androidx/media/blob/1.10.1/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/MediaCodecVideoRenderer.java)
pour les surfaces et la réinitialisation du codec ;
[SurfaceView et HDR](https://developer.android.com/media/media3/ui/surface).

## Diagnostic à la télécommande

Pendant le direct, Haut ouvre le menu avec « Diagnostic de lecture » sélectionné ; OK l'affiche.
Bas ouvre le même menu sur la source actuelle. Info/Menu permet aussi d'ouvrir le diagnostic.
Le panneau demandé explicitement reste visible jusqu'à Retour. Il indique le fabricant, le modèle,
la version Android, le chemin de rendu TV, la qualité, les couleurs et le plafond de débit.
Les commandes ordinaires continuent de disparaître après inactivité.

## Vérification sur le Philips

Après mise à jour du serveur et des clients r6, provoquer une courte interruption réseau pendant
le Live TV. Comparer les couleurs et la définition après reprise. Si le voile revient, Haut puis OK
permet de relever le modèle exact et les lignes Rendu / Avant reprise sans quitter la chaîne.
La disparition effective du voile reste à confirmer sur ce téléviseur.

Les résultats automatisés et les contrôles de livraison sont dans `artifacts/validation-0.5.9.r6/`.
Aucune installation sur le NAS ou les appareils n'est effectuée par la construction.
