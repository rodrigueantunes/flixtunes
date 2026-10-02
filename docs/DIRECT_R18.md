# Direct : installation de la R18

Un outil extérieur recherche et contrôle les adresses ; FlixTunes importe la playlist
obtenue et maintient la lecture.

## Playlist locale

Dans le conteneur, le dossier réglé pour `m3u.json` doit également contenir
`chaines_francaises.m3u` et `sondes.json`. Monter le dossier complet en lecture seule,
plutôt que chaque fichier séparément : ils sont remplacés atomiquement.

La R18 lit `playlist_verifiee` dans le catalogue, vérifie la date et le SHA-256,
puis importe uniquement cette playlist. Une copie incomplète est refusée sans revenir
aux anciennes listes. Une publication réellement vide retire les anciennes adresses.

Les listes d'origine restent dans le JSON pour les anciens clients. Ceux-ci ne
bénéficient pas du filtrage local de la R18.

## Relecture après le contrôle

L'outil qui produit la playlist peut demander la relecture par
`POST /api/live/rafraichissement`, avec le jeton créé dans les réglages du direct.

La demande part après publication et copie réussies ; son attente est limitée à
cinq secondes, incluse dans la limite globale de 595 secondes. Un refus du serveur
est journalisé sans le jeton et laisse les fichiers produits disponibles.

Après mise à jour du conteneur, utiliser une fois « Relire les listes », ou lancer
l'outil qui produit la playlist. Le jeton commande une relecture du catalogue ; les
reprises d'une chaîne bloquée sont effectuées par les lecteurs eux-mêmes.

## Tampon et reprises

Le Web prépare une seconde lecture de la même adresse sans détruire d'abord le
tampon existant. Si elle ne démarre pas, il effectue une réouverture complète puis
utilise les sources de secours. Android réouvre le média complet après un blocage.

Les segments complets sont conservés en mémoire, avec une limite de 64 Mio et
une expiration de 90 secondes pour leur réutilisation. Ce cache facilite les reprises ;
il ne crée pas de vidéo que l'hébergeur n'a pas encore publiée. Les manifestes et
les clés ne sont pas mis dans ce cache. Android limite aussi chaque segment à 16 Mio
et aux réponses de taille connue, pour ne pas retenir un flux continu.

Le retard automatique vise 40 secondes pour une source stable et jusqu'à 60 secondes
pour une source fragile, dans la fenêtre disponible. Une coupure dépassant le tampon
restant peut encore interrompre l'image. Le cache ne garantit pas que chaque chaîne
dispose de 60 secondes de réserve.
