# Validation 0.5.6.r35 — OSS 117 et Superman sans régression

## Causes confirmées par `server (3).log`

- `OSS 117 - Le Caire nid d'espion.mkv` et `OSS 117 - Rio ne répond plus.mkv` atteignaient TMDB
  `15152` et `15588`, avec un titre exact confirmé par deux fournisseurs. L'ancien rejet du parseur
  local annulait ensuite cette preuve distante.
- Le tag MKV d'`Alerte Rouge en Afrique Noire` contenait
  `OSS 117 Alerte Rouge en Afrique Noire 2021 FRENCH`. L'année et la langue restaient dans le titre,
  ce qui empêchait même la constitution d'une proposition.
- `Superman (2025).mkv` atteignait déjà le bon TMDB `1061474` à 1,000, mais une fiche homonyme du même
  fournisseur créait une égalité parfaite et forçait la revue.

## Verrous de non-régression

1. Aucun seuil de score ni marge globale n'est abaissé.
2. Un rejet local n'est contourné que par un titre exact confirmé par au moins deux fournisseurs.
3. Une confirmation isolée, approchante ou encore ambiguë reste refusée.
4. Le rang fournisseur ne départage que deux résultats du même fournisseur ayant titre et année exacts ;
   le gagnant doit porter explicitement le rang zéro.
5. Sans rang fournisseur explicite, deux homonymes exacts restent en revue comme en r34.
6. Le rang ne peut jamais battre un meilleur score.
7. Les règles r31 à r34 sur les alias, traductions, suites, priorité TMDB et vraies jaquettes restent testées.

## Vérifications automatisées

- OSS 117 : sauvetage uniquement avec `titre exact` et `œuvre confirmée par 2 fournisseurs`.
- Superman : TMDB `1061474` gagne l'égalité par son rang natif zéro.
- Tag MKV : extraction de 2021 et nettoyage de `FRENCH`, sans traiter `2001` ni
  `The French Dispatch` comme du bruit.
- 111 tests ciblés réussis deux fois, typage serveur/Web réussi, puis construction des deux paquets.
- 103 tests périphériques supplémentaires réussis : détection, parseur de chemin, hints de
  correspondance, corpus vérité, fédération, métadonnées ouvertes et reprises automatiques.
- Android : tests unitaires, lint, assemblage et signature vérifiés ; `versionCode 56035`,
  `versionName 0.5.6.r35`.
- ASUSTOR x86-64 : APKG 2.0 validé et copie finale contrôlée par SHA-256.
