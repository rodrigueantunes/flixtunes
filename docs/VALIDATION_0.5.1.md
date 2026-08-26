# Validation FlixTunes 0.5.1 — étape 51

## Périmètre

L'étape 51 remplace l'analyse de noms de fichiers par un moteur à candidats : tokeniseur Unicode,
règles typées produisant chacune une interprétation avec son score et ses indices, seuils distincts
d'auto-validation, de revue et de rejet, corpus de mesure et tests de mutation.

## Cas obligatoires

1. Tokeniseur Unicode préservant accents, apostrophes et alphabets non latins, sans perte de caractère.
2. Génération de plusieurs candidats concurrents, classés et explicables.
3. Seuils distincts : application seule, revue humaine, rejet.
4. Année entre parenthèses prioritaire sur une année nue.
5. Saison et épisode jamais déduits d'un nombre isolé sans contexte d'arborescence.
6. Couverture des cas limites : documentaires, concerts, courts-métrages, éditions, parties CD1/CD2,
   remakes homonymes, numérotation absolue d'anime, épisodes datés, doubles épisodes, saison 0,
   accents et titres multilingues.
7. Corpus d'au moins 10 000 noms synthétiques, précision et rappel par catégorie.
8. Tests de mutation de noms.
9. Aucun déplacement ni fusion destructive de fichier.

## Banc exécuté

`pnpm --filter @flixtunes/server test:detection` génère le corpus, mesure la détection, applique les
mutations et écrit `data/detection/detection-<version>.json` et `.md`.

- Corpus déterministe de **10 000 noms**, tirés d'un générateur à graine fixe : deux exécutions
  produisent exactement le même corpus, et un échec est rejouable à l'identique.
- Titres inventés ou génériques : aucun nom réel de médiathèque n'entre dans le banc.
- **10 000 / 10 000 détections exactes — 100 %**, objectif du plan fixé à 99 %.

### Robustesse aux mutations

Un corpus produit par gabarits reste plus régulier que la réalité. Cinq mutations reproduisent les
déformations des outils de partage sans changer ce que le fichier désigne :

| Mutation | Précision |
| --- | --- |
| Balise de langue collée au code d'épisode | 100 % |
| Préfixe d'équipe `[Team]` | 100 % |
| Séparateurs doublés | 100 % |
| Balise de source | 100 % |
| Suffixe d'équipe `-GROUPE` | **99,33 %** |

## Défauts trouvés par les mutations

Les mutations ont mis en évidence quatre faiblesses réelles, corrigées :

1. **Préfixe d'équipe : 5,55 % de détections exactes.** Un nom du type `[Team] Amélie (1979).mkv`
   faisait échouer la détection presque partout. C'est pourtant la forme la plus courante des
   publications d'anime. Tout groupe entre crochets ou parenthèses est désormais retiré du titre :
   année, identifiant, équipe, langue et source sont extraits par des règles dédiées.
2. **Balise collée au code d'épisode : 88,90 %.** `S08E04E05[VOSTFR]` n'était plus reconnu car les
   motifs exigeaient un séparateur après le code. Les séparateurs finaux sont devenus facultatifs.
3. **Séparateurs doublés : 94,45 %.** Une date `2025..02..22` échappait au motif, qui n'acceptait qu'un
   séparateur unique entre les composantes.
4. **Suffixe d'équipe : 93,77 %.** Le titre conservait ` -GROUPE`.

Un défaut antérieur avait aussi été trouvé par le corpus lui-même : les motifs utilisaient `\b`, or `_`
est un caractère de mot en expression régulière. Aucun marqueur n'était donc reconnu sur un nom séparé
par des tirets bas, ce qui laissait « Documentaire » ou « Live at Wembley » dans le titre. Les
séparateurs sont maintenant normalisés avant l'application des motifs.

## Limite assumée

`Amélie-GROUPE.mkv`, sans espace avant le tiret, reste détecté avec le suffixe dans le titre. Le retrait
n'est appliqué que lorsqu'un espace précède le tiret, sans quoi un titre réellement composé — « Spider-Man »,
« X-MEN » — serait amputé. C'est un arbitrage délibéré : il vaut mieux conserver un suffixe rare que
mutiler un titre courant. Ce cas explique l'intégralité des 0,67 % restants de la mutation concernée.

## Résultats

- Banc de détection : **10 000 / 10 000, 100 %**, mutations de 99,33 % à 100 %.
- Tests unitaires de détection : **31 tests**, dont la vérification du découpage sans perte, des seuils,
  de la priorité de l'année entre parenthèses et du refus d'un nombre isolé sans contexte.
- Suite serveur complète : **22 fichiers / 183 tests réussis**, sans régression après le branchement du
  moteur v2 sur le scanner.
- Suite Web : inchangée depuis 0.5.0, **6 fichiers / 28 tests**. Aucun fichier de `apps/web` n'a été
  modifié par cette étape, qui ne touche que la détection côté serveur.
- Contrats, serveur et Web compilés sans erreur, builds de production produits.
- Le moteur v2 alimente désormais le scanner. L'ancien analyseur reste exporté sous
  `parseMediaPathLegacy` le temps de comparer les deux moteurs sur une médiathèque réelle.
- Aucun déplacement ni renommage : la détection ne fait que remplir une fiche, le fichier n'est jamais
  touché. La règle est vérifiée par la suite d'audit des étapes.

### Artefacts

- Paquet ASUSTOR **produit et vérifié** : `flixtunes_0.5.1.r1_x86-64.apk`, 160 991 539 octets,
  SHA-256 `13b56583ebc8e9de6d505d982ef3bcfbad19ce2efcec91f670b5df7033c41fd0`.
  Conteneur APKG 2.0 valide, 4 095 entrées, `config.json` en `version 0.5.1.r1`, `architecture x86-64`,
  `firmware 5.0.0`. Contenu contrôlé : `dist/detection.js` et `dist/detection-corpus.js` de l'étape 51,
  ainsi que les modules des étapes précédentes et le moteur FFmpeg embarqué.
- Builds de production : contrats, serveur et Web compilés vers `dist`.
- APK Android : **non produit**, limite d'environnement inchangée. Les modifications Android en attente de
  compilation restent celles listées en 0.4.9.

### Reste à exécuter

- **Corpus de noms réels** : le corpus est synthétique. Un score de 100 % y est attendu et ne préjuge pas
  du comportement sur une médiathèque réelle, plus irrégulière. La comparaison v1/v2 sur la médiathèque
  de l'utilisateur reste à conduire, d'où la conservation de `parseMediaPathLegacy`.
- **File d'ambiguïtés dans l'administration** : les interprétations concurrentes sont exposées par le
  moteur mais l'écran de revue n'est pas encore construit. Il relève de l'étape 53.
- **Empreinte technique et hash partiel** pour regrouper les versions multiples d'un même titre : prévus
  par le dossier de l'étape, non réalisés. Le regroupement multi-version reste donc à faire.
- **Parseurs NFO et identifiants croisés** : les identifiants présents dans le nom sont lus, les fichiers
  NFO restent traités par le module existant sans passer par le moteur à candidats.
- **APK Android** : limite d'environnement inchangée.

### Décision

La barrière de sortie de l'étape 51 **n'est pas encore franchie**. Le moteur, le corpus, les mesures et
les tests de mutation sont livrés et dépassent l'objectif de 99 %, mais l'empreinte technique, le
regroupement multi-version et la confrontation à un corpus réel restent à faire.
