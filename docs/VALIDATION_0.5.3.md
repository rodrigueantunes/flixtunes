# Validation FlixTunes 0.5.3 — étape 53

## Périmètre

L'étape 53 rend les corrections durables : commandes transactionnelles de correspondance, de numérotation,
de verrouillage, de regroupement et de séparation, journal d'audit avec annulation, prévisualisation des
corrections de masse, et conservation garantie des corrections lors d'un nouveau scan.

## Défaut majeur corrigé

Le verrou de fiche existait depuis l'étape 40, mais il ne protégeait que deux colonnes : `match_status`
et `match_confidence`. L'ordre d'insertion du scanner réécrivait sans condition le titre, et par
`COALESCE` l'année, le résumé et les identifiants externes.

Conséquence : **une correspondance corrigée à la main était effacée au scan suivant.** Le verrou donnait
l'illusion d'une protection tout en laissant passer l'essentiel de l'identité d'une fiche. C'est
précisément le scénario que l'étape 53 doit rendre impossible.

L'ordre d'insertion protège désormais titre, titre original, titre de tri, année, résumé et les trois
identifiants externes derrière la même condition de verrou.

## Cas obligatoires

1. Forcer une correspondance verrouille la fiche et survit à un nouveau scan.
2. Corriger une numérotation d'épisode survit à un nouveau scan.
3. Regrouper un doublon ne supprime ni fiche ni fichier.
4. Séparer une fiche annule le regroupement sans perte.
5. Toute commande est annulable et rétablit l'état exact d'avant.
6. Le journal d'audit enregistre portée, résumé et état avant/après, et reste filtrable.
7. Une commande qui échoue n'écrit rien, pas même dans le journal.
8. Une correction de masse affiche sa portée réelle et exclut les fiches déjà corrigées à la main.

## Résultats

- Tests de corrections : **12 tests** couvrant les six commandes, l'aplatissement des chaînes de
  regroupement, le refus des cycles, l'annulation, le journal filtrable et l'absence d'écriture sur échec.
- Preuve du cycle complet : **3 tests** qui analysent un vrai dossier, appliquent une correction, relancent
  l'analyse et vérifient la survie de la correction — y compris qu'une annulation rend la main au scan et
  que le fichier sur disque n'est jamais touché.
- Suite serveur complète : **27 fichiers / 234 tests réussis**.
- Suite Web : inchangée depuis 0.5.2, **6 fichiers / 30 tests**. Cette étape ne touche que le serveur.
- Contrats, serveur et Web compilés sans erreur, builds de production produits.

### Choix d'implémentation à connaître

Le regroupement de doublons est enregistré comme une **appartenance**, dans une table dédiée, plutôt que
par une fusion des fiches. Trois conséquences voulues : aucune donnée n'est perdue, la séparation est une
simple suppression de ligne, et l'annulation ne demande aucune reconstruction. Le prix est que la vue
catalogue doit consulter cette table pour présenter un groupe — ce branchement fait partie du reste à
faire.

## Reste à exécuter

- **Centre de revue dans l'interface** : les commandes, le journal et la prévisualisation sont exposés en
  API mais aucun écran ne les utilise. La file d'ambiguïtés, la comparaison côte à côte et l'explication
  du score restent à construire, en s'appuyant sur les interprétations concurrentes que le moteur de
  détection produit déjà depuis l'étape 51.
- **Branchement du regroupement sur la vue catalogue** : les groupes existent en base mais l'accueil et
  les fiches ne les présentent pas encore comme une entrée unique à plusieurs versions.
- **Recherche multi-source depuis la file** : la correction par identifiant est possible, la recherche
  assistée dans l'interface ne l'est pas.
- **Export NFO facultatif** : prévu par le dossier, non réalisé.
- **Restauration depuis sauvegarde vérifiant verrous et associations** : à conduire.
- **Rollback après interruption** : les commandes sont transactionnelles, mais le comportement après une
  coupure d'alimentation en cours de transaction n'a pas été éprouvé.
- **APK Android** : limite d'environnement inchangée.

### Décision

La barrière de sortie de l'étape 53 **n'est pas franchie**. Le moteur de correction, l'audit, l'annulation
et surtout la conservation réelle des corrections sont livrés et prouvés par un cycle complet, mais le
centre de revue et l'export NFO restent à construire.
