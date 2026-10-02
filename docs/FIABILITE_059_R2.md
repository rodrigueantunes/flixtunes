# FlixTunes 0.5.9.r2 — validation et limites

## Changements

1. Le lecteur Web reconnaît le 404 d'un lien du relais FlixTunes devenu invalide, notamment après
   un redémarrage. Il demande une nouvelle adresse avant de lancer une autre récupération,
   avec une seule demande active et un intervalle minimal de trente secondes. Un 404 d'un
   fournisseur tiers ne déclenche pas ce renouvellement. Android traite les erreurs du relais
   401, 403 et 404 et observe le retour du réseau pendant que l'écran est ouvert.
2. Les recherches YouTube ont un compteur séparé (100 requêtes par jour). Les lectures gardent
   une marge de sécurité à 9 000 unités. Les compteurs locaux réservent avant le départ réseau,
   incluent les réponses en erreur et suivent minuit à Los Angeles, y compris le changement
   d'heure. La consommation faite par d'autres applications avec la même clé reste inconnue.
   Les limites réelles du projet sont celles de Google Cloud. L'ancien compteur est repris
   prudemment pour la première journée de migration.
3. La réparation des images parcourt au plus 200 fichiers et télécharge au plus dix images par
   passe de cinq minutes. Les origines distantes sont conservées uniquement côté serveur.
   Une ancienne vignette YouTube perdue peut être retrouvée par l'identité exacte de la chaîne.
   Une chaîne corrigée manuellement reste verrouillée. Les anciennes images d'autres fournisseurs
   dont l'origine n'a jamais été conservée nécessitent encore une actualisation des métadonnées.
4. Le lecteur HLS natif prépare une seconde vidéo muette, conserve le tampon principal et ne
   montre le secours qu'une fois prêt. L'heure de programme est utilisée si le navigateur
   l'expose ; sinon la réserve principale est consommée avant la bascule. Une pause ou une
   fermeture annule la bascule. Le choix de qualité reste piloté par le navigateur natif.
5. Le diagnostic de lecture Web et Android indique réserve, retard, qualité, numéro de source
   et dernier événement. Il ne contient ni URL de fournisseur ni jeton. Android TV permet
   de l'ouvrir avec la touche INFO, ou depuis les commandes à l'écran.
6. La recherche du rayon Web interroge tout le catalogue. La pagination présente 60 chaînes
   à la fois, sans limite globale de 200. Une correction manuelle recharge les détails.
7. Les sauvegardes utilisent l'API incrémentale asynchrone SQLite. Une seule copie peut être
   active, un fichier temporaire est publié à la fin et une erreur laisse les anciennes copies
   disponibles. Les sauvegardes ne provoquent plus de VACUUM synchrone sur le serveur HTTP.

Le téléchargement d'une image est limité à 20 Mio et vingt secondes, corps HTTP compris.
Le budget Web chargé à la demande passe de 207 à 210 Kio gzip (207,7 Kio mesurés après ajout
des fonctions) ; les budgets du premier affichage et des images ne changent pas.

## Contrôles automatisés

- Tests des quotas indépendants, frontière du jour été/hiver, dernière recherche concurrente
  et comptabilisation d'une réponse 403.
- Tests des vignettes verrouillées, changement d'identité ou d'image pendant un téléchargement,
  restauration à la même adresse d'un fichier perdu et conservation des images valides.
- Sauvegarde relue avec SQLite et PRAGMA quick_check, exécution d'autres tâches JS pendant
  la copie, absence de publication avant la fin et mutualisation des demandes simultanées.
- Parcours de 241 chaînes, recherche depuis la dernière page, reprise d'un relais 404,
  préparation et fermeture du lecteur natif, diagnostic sans jeton.
- Scénario vidéo Chrome : `node apps/web/scripts/continuite-direct.mjs`.
  Le 17 septembre 2026, les coupures de 5, 15 et 30 secondes puis la perte du fournisseur actif
  ont réussi. Aucun gel prolongé détecté (échantillonnage 250 ms), retard maximal 44,25 secondes.
  La perception audio n'est pas mesurée par cet essai.

## Qualification sur le matériel utilisé

Aucun appareil Android n'était connecté à ADB pendant le développement. Les tests de logique
et la compilation ne prouvent pas le comportement du décodeur d'un téléviseur. Safari réel
et une connexion extérieure réelle restent également à qualifier après installation.

Pour chaque client utilisé (Web HLS, Safari natif, Android TV), vérifier :

| Essai | Résultat attendu |
| --- | --- |
| Lecture continue de six heures | Pas de fuite mémoire croissante ; renouvellement des liens avant expiration |
| Coupures réseau de 5, 15 et 30 secondes | Réserve conservée, reprise automatique dans la limite des segments disponibles |
| Panne permanente du fournisseur | Bascule vers un secours fonctionnel, si disponible |
| Redémarrage du serveur en WAN | Nouvelle adresse de relais obtenue ; profil et session restent contrôlés |
| Révocation de la session | Accès refusé, aucun renouvellement ne réactive les droits |
| Veille puis reprise, changement Wi-Fi/Ethernet | Observateur réactivé, retour au direct et reprise sans relance manuelle |
| Changement de chaîne pendant une relève | Aucun ancien lecteur ne remplace la nouvelle chaîne |
| Écoute audio et observation vidéo | Vérifier synchronisation, absence de double son et raccord du décodeur |

Une source sans secours, une fenêtre amont trop courte ou une panne plus longue que la réserve
réelle peuvent toujours interrompre la lecture. Aucun essai simulé ne garantit zéro coupure.
