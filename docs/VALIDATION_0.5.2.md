# Validation FlixTunes 0.5.2 — étape 52

## Périmètre

L'étape 52 fédère les métadonnées : arbitrage champ par champ avec provenance, arbitre de langue,
pipeline d'images contrôlé, cache HTTP conditionnel, quotas par fournisseur, fonctionnement hors ligne
après enrichissement et mesure de couverture sur un jeu de vérité.

## Choix d'architecture

L'arbitrage a été séparé des adaptateurs fournisseurs. `metadata-federation.ts` ne fait **aucun appel
réseau** : il reçoit des candidats et décide. Cette séparation a une conséquence directe sur la preuve —
toute la logique de décision devient vérifiable hors ligne, de façon déterministe, sans dépendre de la
disponibilité d'une API tierce ni consommer de quota pour tester.

## Cas obligatoires

1. Métadonnée locale ou NFO prioritaire sur tout fournisseur distant.
2. Verrou utilisateur jamais écrasé, quelle que soit la confiance du fournisseur.
3. Langue de la bibliothèque prioritaire, repli anglais, puis toute autre langue.
4. Affiches et fonds choisis par langue puis définition, image extraite en dernier recours.
5. Contrôle du type de contenu, des dimensions et des proportions avant d'accepter une image.
6. Cache conditionnel évitant de retélécharger une charge utile inchangée.
7. Quotas respectés et exposés.
8. Fonctionnement hors ligne après enrichissement.
9. Couverture et faux positifs mesurés sur un jeu de vérité films, séries et documentaires.

## Résultats

- Tests de fédération : **23 tests** couvrant fusion par champ, verrous, arbitre de langue, pipeline
  d'images, quotas et cache conditionnel.
- Jeu de vérité : **12 cas**, **couverture 100 %**, **0 faux positif**.
- Suite serveur complète : voir la note de version.
- Contrats, serveur et Web compilés sans erreur.

### Détail du jeu de vérité

| Cas | Nature | Attendu |
| --- | --- | --- |
| Titre et année exacts | film | correspondance |
| Deux homonymes séparés par l'année | film | la bonne des deux |
| Année voisine à un an | film | correspondance |
| Année éloignée de 36 ans | film | **abstention** |
| Titre original différent du titre localisé | film | correspondance |
| Identifiant croisé contre titre sans rapport | film | l'identifiant gagne |
| Titre sans rapport, même année | film | **abstention** |
| Série relancée sous le même titre | série | la relance |
| Accents et casse divergents | série | correspondance |
| Documentaire à titre long | documentaire | correspondance |
| Fournisseur sans résultat | film | **abstention** |
| Aucune année de part et d'autre | film | correspondance |

Les cinq cas d'abstention comptent autant que les correspondances : un faux positif se corrige à la main
sur chaque fiche, alors qu'une abstention se rattrape par une recherche. Le jeu impose donc qu'aucune
correspondance ne soit appliquée seule quand la preuve manque.

## Comportement hors ligne

Le cache conditionnel distingue quatre issues, toutes testées : `revalidated` sur un 304, `updated` sur
une réponse complète, `offline` quand le fournisseur est injoignable ou répond en erreur alors qu'une
entrée existe, et `unavailable` seulement lorsque rien n'est connu. Une panne réseau ne supprime jamais
une entrée : le serveur continue de servir ce qu'il a appris.

## Reste à exécuter

- **Branchement des adaptateurs existants sur l'arbitre** : `metadata-providers.ts` et `open-metadata.ts`
  conservent leur cache TTL propre. L'arbitre, le pipeline d'images, les quotas et le cache conditionnel
  sont livrés et testés mais ne remplacent pas encore le chemin d'appel en production.
- **Provenance par champ dans l'interface** : la donnée existe côté serveur depuis l'étape 40 et
  l'arbitre produit désormais la raison de chaque choix, mais l'affichage par champ reste à construire.
- **État, latence et quota par fournisseur dans l'administration** : le compteur est disponible, son
  exposition dans l'écran de diagnostic reste à faire.
- **Mesure sur fournisseurs réels** : la couverture est mesurée sur des réponses simulées. Une campagne
  contre TVmaze et Wikidata réels, avec contrôle des licences, reste à conduire.
- **Réparation planifiée** des fiches incomplètes.
- **APK Android** : limite d'environnement inchangée.

### Décision

La barrière de sortie de l'étape 52 **n'est pas franchie**. Le cœur d'arbitrage, le pipeline d'images, le
cache conditionnel, les quotas et la mesure de couverture sont livrés et testés, mais la fédération n'est
pas encore branchée sur le chemin d'appel réel et l'exposition en administration reste à construire.
