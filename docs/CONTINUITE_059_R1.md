# Continuité du direct — 0.5.9.r1

Le tampon décodable du lecteur et le cache de segments ont des rôles distincts : le premier
permet de continuer pendant une panne ; le second évite de retélécharger des segments lors
d'une réouverture. Le cache existant reste borné à 64 Mio et 90 secondes par lecture de chaîne.
Le retard automatique reste plafonné à 60 secondes et dépend de la fenêtre publiée en amont.

Les lecteurs surveillent la réserve disponible et le temps depuis le dernier segment reçu.
Sous 30 secondes de réserve, un téléchargement qui stagne déclenche une préparation en
arrière-plan. Une seule préparation est active, avec deux sources alternatives au maximum
par tentative. Une pause, un changement de chaîne ou la fermeture annule cette préparation.
Une reprise échouée ne justifie pas de détruire le tampon encore lisible.

Le Web relance les téléchargements en place et peut préparer un second lecteur HLS. Android
prépare un second ExoPlayer. Une heure de programme commune permet de rechercher le même
instant ; les numéros de segments de fournisseurs différents ne sont jamais assimilés.
Sans horloge commune, la bascule attend que la réserve principale soit presque épuisée.
Un saut temporel ou un bref gel reste possible, notamment au changement de décodeur Android.

La baisse de qualité commence sous 15 secondes de réserve, et devient plus forte sous 6 secondes.
La remontée demande au moins 20 secondes avec une réserve de 25 secondes et reste progressive.
Une source sans variantes de qualité ne peut pas bénéficier d'une baisse de débit.

Les clients rapportent les périodes de 120 secondes de lecture continue. Le serveur borne
les rapports et conserve les observations sept jours, avec un retrait temporaire de deux minutes
après un incident. Le classement historique reste utilisé en l'absence de mesures.
La table additive `live_stabilite` sépare le LAN et chaque profil WAN ; les rapports distants
ne modifient pas les compteurs globaux des sources.

Les liens WAN restent chiffrés, liés au profil, authentifiés et limités à six heures. Leur
renouvellement devient possible trente minutes avant expiration ; les lecteurs vérifient les
adresses toutes les quinze minutes. L'identifiant exact de source permet de retrouver le même
flux sans dévoiler l'adresse fournisseur. Une session utilisateur révoquée n'est pas réactivée.

Installer le serveur et le client Android de cette version, puis recharger le Web. Le vérificateur
de playlists reste indépendant. Aucune modification des ports ou des accès WAN n'est nécessaire.

Une coupure dépassant la réserve réelle et l'indisponibilité simultanée des sources peuvent
toujours interrompre la lecture. Les essais de laboratoire ne remplacent pas une vérification
sur le téléviseur et sur la connexion WAN utilisés au quotidien.

## Validation du 17 septembre 2026

Le scénario `node apps/web/scripts/continuite-direct.mjs` utilise Chrome sans interface et une
vidéo avec son générée par FFmpeg, servie exclusivement sur la boucle locale. Il impose des
réponses HTTP 503 pendant 5, 15 puis 30 secondes, puis rend définitivement indisponible la source
qui joue. Les deux fournisseurs simulés emploient des numéros de segments différents et une
heure de programme commune. Le contrôle observe les images décodées toutes les 250 ms.

Les quatre scénarios ont réussi : aucun gel vidéo détecté, retard maximal de 42,2 secondes,
et bascule effective vers l'autre fournisseur après la panne définitive. Un test de régression
vérifie que le seul secours restant peut être réessayé même pendant son retrait temporaire.
Cet essai ne mesure pas la perception audio et ne qualifie pas les décodeurs des téléviseurs.

Les tests WAN vérifient aussi le renouvellement anticipé, le refus des liens expirés ou liés à
un autre profil, et l'isolation des rapports de stabilité. Une lecture depuis une vraie connexion
extérieure et une vérification sur le matériel Android restent à faire après installation.
