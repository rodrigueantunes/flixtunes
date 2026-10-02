# Accès distant R19

La révision 0.5.8.r19 rétablit Live TV, le rayon Web et les portraits des talents sur
l'écoute WAN existante. Le domaine, TLS, le compte distant et la session de profil
restent nécessaires. Elle ne crée aucune nouvelle ouverture de port.

Les clients distants reçoivent des liens de lecture chiffrés, valables six heures,
liés au profil et inutilisables sans session authentifiée. Les manifestes HLS,
segments, clés et logos passent par le relais du NAS. Les URL des fournisseurs
ne sont pas communiquées au client. Les destinations internes et les redirections
vers le LAN sont refusées, y compris lors de la résolution DNS utilisée pour la connexion.
Le relais accepte au maximum 24 requêtes simultanées par profil, limite les manifestes
à 2 Mio et les images à 4 Mio, et annule l'amont à la déconnexion.

Favoris et dernière chaîne restent propres au profil connecté. Les résultats WAN
ne modifient pas le classement global des sources et ne lancent pas de sondage massif.
Les réglages, imports, corrections et sauvegardes restent accessibles depuis le LAN.

Les portraits TMDB ne sont servis en WAN que s'ils sont référencés dans une fiche
autorisée pour le profil. Les noms et la navigation par talent restent inchangés.

La réparation des avatars Web commence 30 secondes après le démarrage, puis reprend
toutes les 30 minutes par lots de 200 chaînes. Elle utilise l'identifiant YouTube déjà
enregistré et la clé configurée, respecte le quota existant et conserve les images locales.
Une panne de téléchargement entraîne une attente avant nouvelle tentative.

Installer le paquet serveur R19 dans le conteneur selon la procédure de mise à jour
habituelle, puis recharger l'interface Web. Le client Android R19 est nécessaire
pour lire les liens WAN authentifiés. Aucun jeton privé du script de playlists
n'est intégré aux sources ou aux paquets.

Les tests automatisés couvrent les sessions, les restrictions WAN, les liens altérés
ou expirés, les destinations privées, la réécriture HLS, les limites de taille,
les portraits et la réparation des avatars. La lecture réelle depuis une connexion
extérieure reste à vérifier après installation sur le NAS.
