# Validation FlixTunes 0.4.7 — étape 47

> **État : recette non exécutée.** Le code de l'étape 47 est livré et la version 0.4.7 a été publiée dans
> `CHANGELOG.md`, mais aucune note de validation n'avait été produite. Le point 7 de la validation
> obligatoire du plan reste donc ouvert pour cette étape. Ce document fixe les cas à rejouer ; il ne
> rapporte aucun résultat qui n'ait pas été mesuré.

## Périmètre

L'étape 47 couvre la diffusion adaptative locale : échelle de qualité HLS/DASH bornée par la source, le
client et le réseau, estimation continue du débit, bascule de qualité sans coupure, cache de segments
partagé et reprise de session.

## Cas obligatoires à rejouer

1. Échelle ABR bornée par la définition source, l'écran client, le débit annoncé et la capacité du NAS.
2. HLS fMP4 et MPEG-TS pour le Web, DASH natif pour Android Media3, comparés sur le même média.
3. Direct Play prioritaire : l'ABR ne doit être armé que pour un client ou un réseau qui l'exige.
4. Changement de qualité conservant audio, sous-titres, timeline et progression, sans recréer la session.
5. Session de transcodage partagée entre plusieurs clients demandant le même profil.
6. Cache borné en durée et en taille ; purge du plus ancien quand le quota est atteint.
7. Profils réseau 100 / 40 / 15 / 5 Mb/s : mesure de première image, de rebuffer et de seek.
8. Wi-Fi oscillant, veille mobile, changement d'adresse du NAS, segment incomplet, seek hors fenêtre,
   fichier encore en cours de copie, cache plein et arrêt brutal de FFmpeg.
9. Contrôle qu'un flux en lecture directe ne consomme aucun encodeur.
10. État ABR et état du cache lisibles dans le diagnostic serveur.

## Barrière de sortie

- Contrats, serveur et Web compilés ; suites complètes sans régression.
- Aucune mise en mémoire tampon durable sur les quatre profils réseau du banc.
- Tests Android JVM et APK `versionCode 47`.
- APKG x86-64/ARM64 et sommes SHA-256.

## Résultats

Aucun résultat mesuré n'est enregistré à ce jour. La note doit être complétée après exécution du banc
réseau décrit ci-dessus, ou l'étape 47 doit être explicitement requalifiée avec ses limites connues.

Les fonctions ABR pures (`selectAdaptiveProfile`, `selectAdaptiveLadder`) sont couvertes par la suite
unitaire du serveur, y compris la vérification des hauteurs retenues aux quatre profils réseau de
référence. Cette couverture ne remplace pas la mesure de première image, de rebuffer et de seek sur un
réseau réellement dégradé.
