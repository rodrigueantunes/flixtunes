# Validation 0.5.6.r78 — la base sait où elle en est, et sait revenir en arrière

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Ce qui manquait

Le schéma évoluait par **détection** : `PRAGMA table_info`, et si la colonne manque, on l'ajoute.
Cent-huit instructions de ce genre, exécutées à chaque démarrage.

C'est robuste tant qu'on n'ajoute que des colonnes. Ça cesse de l'être dès qu'une évolution demande de
déplacer des données, de reconstruire une table ou de corriger une valeur — trois choses qu'aucune
détection de colonne ne sait décrire. Et surtout, **la base ne savait pas dire où elle en était** :

- impossible de reconnaître un schéma à demi migré ;
- impossible de refuser une mise à jour trop ancienne pour la base qu'elle trouve ;
- impossible de savoir ce qu'une restauration a rendu — une sauvegarde de la semaine dernière ramène
  un schéma de la semaine dernière, sans que rien ne le signale.

C'est le seul défaut connu de ce projet qui puisse **détruire des données**, et c'est à ce titre qu'il
passe avant le reste.

## 2. Le registre, et ce qu'il ne réécrit pas

Une table `schema_migrations` consigne ce qui a été appliqué, et quand.

**La version 1 est le socle** : tout ce que `database.ts` construit déjà. Ce code est idempotent par
nature — `CREATE TABLE IF NOT EXISTS`, colonnes ajoutées à la demande — donc une base existante
l'adopte **sans qu'on réexécute quoi que ce soit**, et une base neuve l'obtient en étant créée.
Réécrire ces cent-huit instructions en migrations numérotées aurait été un chantier long sur du code
qui marche, pour un bénéfice nul : ce qui manquait n'était pas leur forme, c'était la mémoire de ce
qui a été fait.

**Toute évolution ultérieure porte un numéro**, s'applique dans une transaction, et n'est consignée
que si elle a réussi entièrement. SQLite exécute le DDL dans une transaction, contrairement à d'autres
moteurs : une migration qui échoue à mi-chemin ne laisse donc pas un schéma bâtard. C'est cette
propriété qui rend l'atomicité réelle, et pas seulement annoncée — un cas de test la vérifie en faisant
échouer une migration après qu'elle a posé une colonne.

## 3. Pourquoi il n'y a pas de migration inverse

L'audit demandait des migrations « testées aller/retour ». Le retour n'est pas écrit, et c'est délibéré.

Défaire un ajout de colonne en SQLite impose de **reconstruire la table entière** — copier, supprimer,
renommer, refaire les index et les clés étrangères. Cette reconstruction est plus dangereuse que ce
qu'elle répare, et elle s'exécuterait précisément dans le moment le plus fragile : après une mise à
jour qui vient d'échouer, sur une base dont on ne sait plus l'état.

Le chemin de retour est donc la **sauvegarde**, prise juste avant d'appliquer la première migration
réelle — jamais pour la simple adoption du socle, qui ne modifie rien. Elle porte le nom des
sauvegardes ordinaires, ce qui n'est pas un détail : c'est ce qui la rend restaurable depuis l'écran
d'administration, sans intervention particulière.

Et cette voie-là, contrairement à une migration inverse écrite « au cas où », **est éprouvée**.

## 4. La restauration, éprouvée de bout en bout

Le mécanisme existait déjà et n'avait aucun test : une demande pose un marqueur, et le **démarrage
suivant** l'exécute — remplacer un fichier SQLite pendant qu'un processus le tient ouvert ne remplace
rien de fiable, les pages en cache et le journal WAL continuant de décrire l'ancien contenu.

Quatre cas, sur de vraies bases SQLite montées dans des répertoires temporaires :

| Cas | Ce qu'il garantit |
| --- | --- |
| Restauration nominale | la base porte le contenu de la sauvegarde, **et passe `PRAGMA integrity_check`** |
| | le WAL et l'index partagé de l'ancienne base sont écartés |
| | l'état d'avant reste sur le disque, horodaté et intact |
| Interruption | le marqueur survit à une coupure et s'exécute au démarrage suivant — **une seule fois** |
| Absence de marqueur | rien n'est touché, aucune copie inutile |
| Marqueur falsifié | `../../../etc/passwd` est refusé, la base n'est pas touchée |

Le dernier cas n'est pas théorique : le marqueur est un fichier du disque, rien ne garantit que le
service l'a écrit, et un nom libre ferait copier n'importe quel fichier par-dessus la base.

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **82 fichiers, 756 tests, 0 échec** |
| Suite Web | 20 fichiers, 174 tests, 0 échec |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

Dix cas nouveaux : six pour le registre — adoption du socle, ordre, idempotence, atomicité d'un échec,
sauvegarde prise seulement quand il y a de quoi, refus d'un registre qui se contredit — et quatre pour
la restauration.

Un défaut de banc au passage, trouvé et corrigé avant d'accuser le code : l'aide de test réinsérait sa
marque avec `INSERT OR REPLACE` sur une clé différente, ce qui ajoutait une **seconde** ligne au lieu
de remplacer la première. La lecture rendait l'ancienne, et le cas affirmait un défaut inexistant.

## 6. Ce que l'écran montre

La tuile « Base de données » affiche désormais `schéma v1`, et le nombre de migrations en attente s'il
y en a. C'est la seule façon de savoir ce qu'une machine a réellement traversé : une restauration peut
faire reculer le schéma sans que la version du paquet, elle, ne bouge d'un chiffre.

## 7. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| Construire depuis un disque local | Le garde-fou refuse le partage ; le dépôt Git rend le clone facile. |
| Statut du client Windows | Huit tests, des capacités annoncées en dur. |
| Avertissements Android de sécurité | Service exporté sans permission, configuration réseau permissive. |
| La cadence de r73 sur le NAS, le lecteur sur téléviseur | inchangés depuis r75 |
