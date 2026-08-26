# FlixTunes 0.4.1 — correctif Android et jaquettes

La phase 41 corrige les deux régressions observées sur Android mobile avec un serveur local.

## Jaquettes

- Priorité inchangée : image locale, puis fournisseur configuré.
- Sans image disponible, FFmpeg extrait une image du média.
- L'affiche est recadrée en 600×900 et le fond en 1280×720, puis conservés dans le cache serveur.
- Un rescan de fichiers complète également les éléments déjà indexés sans les réimporter.
- Android affiche un repli graphique tant que l'image n'est pas disponible.

## Lecture Android

- Direct Play limité aux conteneurs fiables sur mobile.
- Les autres conteneurs passent par HLS MPEG-TS.
- La seconde tentative force une sortie compatible H.264/AAC stéréo SDR.
- Le type HLS est explicitement transmis à Media3.
- La session du profil protégé et la reprise après `STATE_READY` sont conservées.

## Qualification

- 80 tests serveur réussis, typecheck et build réussis.
- 9 tests JVM Android réussis, lintDebug et assembleDebug réussis.
- Images générées contrôlées en HTTP 200, JPEG 600×900 et 1280×720.
- Direct Play contrôlé en HTTP 206 avec requête par plage.
- Repli transcodé contrôlé en HLS MPEG-TS avec manifeste et segment HTTP 200.
