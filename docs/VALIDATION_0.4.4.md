# Validation FlixTunes 0.4.4 — étape 44

## Périmètre livré

L'étape 44 remplace la gestion limitée SRT/ASS par un moteur de sous-titres indépendant du lecteur. Le serveur inventorie les pistes internes et les fichiers compagnons, normalise leurs attributs, choisit rendu client ou incrustation et mémorise les préférences par profil et média.

## Matrice fonctionnelle

| Famille | Formats | Chemin attendu |
| --- | --- | --- |
| Texte natif | SRT, WebVTT, SBV/SubViewer, MicroDVD, MPL2, TTML/DFXP, SAMI | Conversion UTF-8 WebVTT, sans transcodage vidéo |
| Texte FFmpeg | ASS, SSA | Conversion WebVTT ou incrustation conservant le style |
| Image | PGS/SUP, VobSub SUB/IDX, DVB | Incrustation vidéo ; aucune fausse promesse WebVTT |
| Captions | CEA-608/708 | Détection par FFprobe et capacité `cc_dec` contrôlée dans FFmpeg |

## Cas obligatoires

1. Langues ISO-639 et BCP-47 (`fre`, `fra`, `fr-FR`, `pt_BR`) normalisées sans interpréter `forced`, `sdh`, `hi` ou `cc` comme une langue.
2. BOM UTF-8/UTF-16, UTF-8 valide et Windows-1252 détectés ; `Français` reste intact après conversion réelle.
3. Une paire VobSub `.idx/.sub` produit une seule piste image ; un `.sub` MicroDVD isolé reste une piste texte.
4. Les offsets négatifs et positifs sont bornés à ±600 secondes et intégrés à la clé de cache.
5. Une piste texte est ajoutée au lecteur Web/Android ; une piste image force une décision de transcodage avec incrustation.
6. Sélection, offset, taille, fond, position, police et encodage survivent au rechargement et restent isolés entre profils.
7. Les migrations créent la table de préférences sans modifier profils, progression, bibliothèques ni corrections existantes.

## Barrière de sortie

- TypeScript contrats/serveur/Web sans erreur.
- Toutes les suites Vitest serveur et Web sans régression.
- Intégration FFmpeg : conversion SRT décalée, Windows-1252 vers UTF-8, Direct Play, HLS fMP4/MPEG-TS, E-AC-3 vers AAC et transcodage.
- Tests JVM Android, compilation APK versionCode 44 et pistes Media3 externes.
- Contrôle navigateur réel de la liste des pistes, des réglages et de leur restauration.
- Builds serveur/Web de production, APKG ASUSTOR x86-64/ARM64 et hashes de livraison.

## Résultats

- Contrats, serveur et Web : compilation TypeScript sans erreur.
- Serveur : 19 fichiers et 96 tests Vitest réussis.
- Web : 6 fichiers et 22 tests Vitest réussis ; build Vite/PWA de production réussi.
- FFmpeg : Direct Play, HLS fMP4/MPEG-TS, E-AC-3 vers AAC, conversion SRT décalée et Windows-1252 vers UTF-8 réussis.
- Moteur natif : SRT, SBV, MicroDVD, MPL2, TTML et SAMI testés avec offset ; ASS/SSA restent confiés au moteur FFmpeg intégré.
- Diagnostic réel Windows : 41 capacités sur 41, dont CEA-608/708, et aucun composant critique absent.
- Navigateur réel : contrôles visibles et restauration après réouverture de −2,5 s, taille grande, position haute, monospace, Windows-1252 et fond désactivé.
- Android : tests JVM et APK debug `versionCode 44` réussis ; pistes WebVTT internes/externes transmises à Media3.
- ASUSTOR : APKG 2.0 x86-64 et ARM64 vérifiés structurellement avec runtime FFmpeg embarqué.
- Hashes : publiés dans `artifacts/SHA256SUMS-0.4.4.txt`.

Tous les critères bloquants de l'étape sont satisfaits. L'OCR des sous-titres image reste volontairement un connecteur local optionnel : l'absence d'un moteur OCR ne bloque jamais l'incrustation PGS/VobSub, qui constitue le repli garanti.
