# Validation 0.5.6.r62 — comptes de connexion, catalogue distant visible, lecture rétablie sur projecteur

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

r62 achève l'accès distant commencé en r61 : une première barrière par compte, un catalogue enfin
visible derrière elle, et la correction d'une régression de lecture constatée sur un projecteur.

## 1. Lecture refusée sur projecteur — corrigé

Un projecteur Android affichait « **Capacités de lecture invalides** » et ne lisait rien. Relevé dans
le journal : ses `POST /api/media/:id/playback` repartaient en **400**, tandis qu'un autre appareil du
même foyer streamait normalement au même moment.

### La cause

Le schéma validait strictement les capacités annoncées. Sur un projecteur, `Display.Mode` n'annonce
parfois aucun mode tant que la surface n'est pas prête : l'enveloppe vidéo vaut alors `0 × 0`, et
`maxWidth: 0` est refusé par `.positive()`.

### Le vrai défaut

Ce n'est pas le zéro, c'est la réaction au zéro. **Ces capacités sont des indications** — elles
servent à choisir une définition de sortie, pas à décider si l'appareil a le droit de lire. Refuser la
demande entière parce que l'une d'elles est aberrante transforme un détail cosmétique en « aucune
lecture possible ». Et le message ne nommait pas le champ : il n'y avait rien à chercher.

### La correction

`capacites-client.ts` répare avant de valider :

- une valeur hors bornes est **retirée**, et c'est le schéma qui pose son défaut. Rien n'est inventé —
  inventer une valeur ici la ferait passer pour une déclaration de l'appareil ;
- les entrées inconnues d'une liste fermée sont écartées sans faire tomber le reste : un format que le
  serveur ne connaît pas signifie seulement qu'il ne sait pas s'en servir ;
- un débit ou un nombre de canaux nul devient « aucune limite », pas « limite de zéro » ;
- seule exception assumée : `containers` vide retombe sur `mp4`, car le schéma exige au moins une
  entrée. Un appareil qui n'annonce aucun conteneur n'est pas incapable de lire, il n'a pas su
  répondre ;
- si la validation échoue malgré tout, la réponse **nomme les champs** et le journal les enregistre.

Sept tests couvrent le cas, dont celui du projecteur à `0 × 0`.

## 2. Groupes et profils enfin visibles à distance

Trois filtres subsistaient sur `PIN_MINIMUM_DISTANT` : la liste des groupes, celle des profils et le
déverrouillage. Ils dataient de r59, quand le code PIN était le **seul** rempart entre Internet et la
médiathèque.

Depuis r62, la porte est tenue par un compte de connexion à mot de passe. Ces filtres ne protégeaient
donc plus rien, mais ils masquaient tout : un foyer n'ayant pas reposé ses codes à six chiffres ne
voyait **aucun groupe et aucun profil**, sans qu'aucun message ne l'explique.

Ils sont retirés. Le PIN reprend son rôle d'origine — séparer les profils entre eux — et n'a plus à
être un secret de qualité Internet. Le diagnostic vérifie désormais l'existence d'un compte de
connexion, et non plus la longueur d'un code.

**Ce qui n'a pas changé :** sans compte, l'écoute distante ne rend ni groupe ni profil. Un test le
vérifie explicitement, avec le code `REMOTE_ACCOUNT_REQUIRED`.

## 3. Certificat sans le port 80

Le contrôle exigeait la redirection des ports 80 **et** 443. C'est inexact : avec seulement le 443
redirigé, Caddy obtient son certificat par **TLS-ALPN-01**. Le message le dit maintenant, et présente
le port 80 comme une seconde voie de validation plus la redirection HTTP vers HTTPS — pas comme une
obligation.

## 3bis. Deux défauts constatés sur r61 installé

### `CHECK constraint failed` sur la bibliothèque Séries TV

L'écran affichait « **16 erreur(s). CHECK constraint failed: source IN (…)** ». La contrainte de
`metadata_field_values` énumère les provenances acceptées ; **`anilist` n'y figurait pas**, alors que
le fournisseur AniList existe et apparie les séries animées. Chaque anime identifié par lui faisait
donc échouer l'écriture de sa provenance.

Vérifié par le type plutôt que supposé : `MetadataFieldProvenance["source"]` autorise treize valeurs,
la contrainte n'en acceptait que douze — `anilist` était la seule absente.

Corrigé par une **source unique de vérité** : la constante `SOURCES_METADONNEES` construit à la fois
la contrainte de la table et celle de la migration. La liste ne peut plus diverger du code qui écrit
dedans.

**La migration a été éprouvée sur l'ancien schéma**, et non sur une base neuve — c'est le seul chemin
qui s'exécutera réellement chez l'utilisateur, sur des dizaines de milliers de lignes. Cinq tests
reconstituent une base d'avant, la remplissent, migrent, et vérifient que les lignes sont préservées à
l'identique, que l'erreur d'origine se reproduit avant migration et disparaît après, qu'une provenance
inventée reste refusée, que l'index est rétabli et que la cascade de clé étrangère survit.

### VA-API mesuré à 396 im/s au lieu de 471

Le garde-fou « conserver le meilleur relevé » de r61 n'a pas joué, et la raison est précise : la
signature de calibrage se termine par la **révision du paquet**. Installer r61 l'a fait passer de
`|r60` à `|r61` — l'historique était donc classé sous une clé devenue introuvable, et la nouvelle
mesure, prise à `21:57:53` juste après l'installation, s'est imposée seule.

Re-mesurer et **oublier** avaient été confondus. Ils sont désormais séparés :

- la signature **complète** garde la révision et continue de déclencher une nouvelle mesure — c'est
  nécessaire, une révision peut corriger un pilote ;
- une signature **matérielle**, la même sans la révision, sert de clé à l'historique. Le meilleur
  relevé survit donc à une mise à jour, pendant que la mesure est bien refaite.

Un enregistrement au format antérieur, dépourvu de cette clé, est lu sans difficulté : elle est
alors déduite de la signature complète.

**Limite à connaître :** le relevé de 471 im/s a déjà été écrasé sur le NAS et ne peut pas être
ressuscité. Une mesure faite **machine au repos** après installation de r62 le rétablira, et il
tiendra ensuite d'une révision à l'autre.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **66 fichiers, 635 tests, 0 échec** |
| Suite Web | **20 fichiers, 170 tests, 0 échec** |
| Typechecks serveur, contrats, Web | aucune erreur |
| Android | `BUILD SUCCESSFUL`, tests unitaires et lint passés |

### 4.1 Une fragilité de harnais, réparée et signalée

La suite Web est tombée à **44 échecs** en cours de route, sans qu'aucun code d'application soit en
cause : neuf fichiers de test tiennent chacun leur propre double d'API, tous partiels. Le mode de
panne mérite d'être noté parce qu'il n'aide en rien à trouver la cause — l'appel d'une fonction
absente lève de façon **synchrone**, avant tout `.catch()`, le démarrage conclut « serveur
injoignable », et des dizaines de tests sans rapport échouent sur des éléments introuvables.

Les neuf doubles sont complétés. **La structure reste fragile** : toute fonction ajoutée à l'API
cassera à nouveau des suites sans rapport. Un double partagé, construit à partir de la surface réelle,
supprimerait la classe entière — c'est un chantier à part, signalé plutôt que laissé revenir.

## 5. Reste à exécuter

**Rien n'a été installé sur le NAS** : ce poste n'a pas d'accès authentifié. À constater après
installation :

| Sujet | Où le lire |
| --- | --- |
| Le projecteur lit-il à nouveau ? | l'appareil lui-même ; en cas d'échec, le message nomme désormais le champ |
| Capacités réparées | `server.log`, ligne « Capacités de lecture réparées » |
| Hors-root aboutit-il ? | `logs/privileges.log`, ligne « périphérique de rendu accordé au groupe » |
| VA-API revient-il vers 471 im/s ? | écran de capacité, mesures refaites **machine au repos** |
| Chaîne distante complète | bouton « Vérifier l'accès distant » |

Rappel de r61 : refaire les mesures pendant une installation ou une analyse les fausse. Le meilleur
relevé est désormais conservé, mais la première mesure après installation reste à faire au calme.
