# Validation 0.5.6.r77 — l'adresse du NAS de développement quitte le produit, et la livraison redevient sûre

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Le défaut visible : le produit portait l'adresse d'un NAS particulier

Deux endroits, tous deux dans du code livré :

| Où | Ce qui s'affichait |
| --- | --- |
| `MainWindow.xaml.cs` | l'adresse du NAS de développement, **pré-remplie** comme serveur par défaut |
| `strings.xml` | la même, donnée en exemple sur l'écran de connexion Android |

N'importe qui installant FlixTunes se voyait donc proposer une machine qui n'est pas la sienne.

Le remède n'est pas de mettre une autre adresse en dur : **Windows n'en invente plus aucune.** Le
champ reste vide, la découverte Zeroconf remplit la liste des serveurs du réseau, et la saisie
manuelle reste disponible — le dialogue le disait déjà. Android montre une adresse de réseau
domestique quelconque, puisque c'est un exemple.

La même valeur traînait sans raison dans trois suites de tests et deux commentaires d'empaquetage,
remplacée par un nom de machine ou par les plages de documentation du RFC 5737.

## 2. Et le domaine, qui était pire

Les documents d'accès distant nommaient le domaine réel, **l'IP publique de la ligne** et celle de
l'hébergeur. Ce n'est pas un secret, mais c'est la carte d'un réseau domestique et son point d'entrée.

Tout est remplacé par `flixtunes.exemple.fr` — le texte que le champ de saisie propose déjà — et par
des adresses de documentation. Balayage final sur les fichiers du projet : **plus une seule adresse
publique**, la seule séquence restante étant un numéro de version de LibVLC.

## 3. Les tests du client Windows ne s'exécutaient plus

Découvert en voulant vérifier la modification, et vérifié comme antérieur à elle : sur la version
enregistrée aussi, la commande ne trouve aucun test.

| Invocation | Résultat |
| --- | --- |
| `dotnet test <chemin>.csproj` | refusée — le SDK 10 exige `--project` |
| `dotnet test --project <chemin>.csproj` | construit, puis **zéro test découvert**, sortie 5 |
| l'exécutable produit, lancé directement | **8 tests, 0 échec, 497 ms** |

`MSTest.Sdk` produit une application autonome sous Microsoft.Testing.Platform : l'appeler est le
chemin le plus court, et le seul qui rende un résultat ici. Le script de livraison le fait désormais.

## 4. La chaîne de livraison

Elle ne pouvait pas produire une livraison juste, et échouait ou mentait selon l'étape :

| Défaut | Conséquence |
| --- | --- |
| copie de `app-debug.apk` | nom disparu depuis que l'APK porte sa révision — la livraison mourait là |
| paquet ASUSTOR sans `-PackageRevision` | estampillé `r1`, quelle que soit la révision livrée |
| Gradle sans `FLIXTUNES_PACKAGE_REVISION` | APK en `0.5.6` nu, donc deux numéros pour une livraison |
| tests Windows | jamais lancés |
| archives de sources | `apps/server/.vitest-data` inclus — 125 Mo, dont la clé de chiffrement |

Version et révision se lisent maintenant dans le **journal des versions**, dont le premier titre fait
foi, et sont recoupées avec `package.json` : une livraison ne peut plus porter un numéro que le
journal ne documente pas. Le script vérifie ensuite la cohérence des sept déclarations, estampille les
deux artefacts du même numéro, et **refuse de s'exécuter depuis un partage réseau** — pnpm n'y crée
pas ses liens symboliques, mesuré, et son installation y laisse des arborescences à demi écrites.

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **79 fichiers, 746 tests, 0 échec** |
| Suite Web | 20 fichiers, 174 tests, 0 échec |
| Tests Windows | **8 sur 8**, par l'exécutable |
| Adresses publiques dans le projet | **aucune** |
| Contexte Docker et archives de sources | données de test, bases et clés exclues |

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Construire depuis un disque local** | Le garde-fou refuse le partage ; tant que la copie de travail y vit, aucune commande unique ne produit une livraison reproductible. |
| Migrations numérotées et restauration testée | Le schéma évolue par détection de colonnes ; c'est le seul défaut connu qui puisse détruire des données. |
| Statut du client Windows | Huit tests, des capacités annoncées en dur : à remettre à niveau ou à déclarer expérimental. |
| Avertissements Android de sécurité | Service exporté sans permission, configuration réseau permissive. |
| La cadence de r73 sur le NAS, le lecteur sur téléviseur | inchangés depuis r75 |
