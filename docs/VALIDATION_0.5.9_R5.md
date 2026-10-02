# FlixTunes 0.5.9 r5

## Live TV Windows et Linux

Les films et séries utilisaient déjà VLC. Le direct utilisait les deux balises vidéo du lecteur Web,
y compris dans Electron. Le nouveau module `LecteurDirectBureau` consomme une capacité explicite du
pont de bureau : les anciens clients et les navigateurs gardent leur lecteur actuel.

VLC dessine derrière l'interface FlixTunes. Le processus principal sérialise les ouvertures et
fermetures ; quitter le direct libère son relais et son cache. Les commandes du direct, le choix
des sources, le volume et le plein écran restent dans l'application. Un échec déclenche le
renouvellement des accès, une relance, puis une autre source ; après deux reprises infructueuses,
le lecteur Web reprend la main. Une pause volontaire ne déclenche pas de reprise.

La passerelle n'écoute que sur 127.0.0.1, avec une adresse aléatoire propre à la lecture. Les accès
NAS passent par la session Electron, avec ses cookies. VLC ne reçoit ni cookie ni URL fournisseur.
Seules les routes du relais Live TV et de la conversion du NAS connecté sont autorisées.
Les redirections ne sont pas suivies. Les manifestes réécrivent les variantes, segments et clés ;
les options de playlist VLC et les manifestes non pris en charge sont refusés.
Une nouvelle adresse de maître remplace ses variantes uniquement si leur disposition est identique.
Une révocation d'accès ne réutilise pas un ancien manifeste.

Le cache HLS garde au plus 64 Mio, avec une durée de conservation de 90 secondes. Les segments de
plus de 12 Mio passent en flux sans duplication dans le cache. Le préchargement se limite aux
variantes récemment demandées et aux 60 dernières secondes publiées. Les manifestes et les clés
ne deviennent pas des fichiers persistants.

Le réglage de cache VLC seul s'est révélé insuffisant : une coupure réseau de 15 secondes causait
environ 11 secondes de gel sur le premier banc. La passerelle retarde maintenant la fin de la fenêtre
présentée de 30 secondes au maximum, en fonction de sa longueur et de ses segments. Lors d'une panne,
elle révèle progressivement la réserve déjà préchargée. Le second essai de 100 secondes, avec la
même coupure de 15 secondes, ne détecte plus de gel à l'échantillonnage d'une seconde.

Le diagnostic indique les segments préchargés devant les demandes de VLC, pas un tampon décodé
inventé. Le pont HTTP VLC ne fournit pas de mesure exacte du retard à l'écran. Le plafond de
60 secondes reste une cible de fonctionnement, pas une garantie mesurée sur ce moteur.
Les fenêtres trop courtes, les flux sans réserve et les transports continus TS/MP4 ne peuvent pas
bénéficier de la même marge HLS. Les changements entre deux fournisseurs peuvent provoquer une
interruption ; il n'y a qu'un VLC. DASH et les formats refusés utilisent le repli Web/conversion.

## Android TV : voile et qualité après reprise

Signalement : Philips, FlixTunes r4, image correcte au départ puis voile blanc/gris et dégradation
après une coupure et sa relance. Les photos ne suffisent pas à prouver une cause HDR particulière.

Deux défauts de gestion ont été corrigés :

- Le seuil de retour en qualité exigeait systématiquement 25 secondes de réserve, parfois
  inatteignables avec la fenêtre du flux ou la mémoire du téléviseur. Il suit maintenant la capacité
  réelle. Huit secondes de lecture sont laissées au remplissage initial avant de réduire le débit.
  Une minute avec une réserve saine et des chargements récents retire entièrement le plafond.
  Le plafond effectif est appliqué au lecteur de secours et remis à zéro sur une nouvelle source.
- Une relance complète conservait la même surface et parfois le même décodeur. Elle renouvelle
  désormais les deux en libérant l'ancien décodeur avant d'en créer un autre. Une relève prête ou
  un changement de colorimétrie crée aussi une nouvelle vue/surface. Le changement `INVISIBLE` /
  `VISIBLE` a été remplacé : il ne garantit pas la destruction de surface sur Android récent.

Une mise en tampon ordinaire conserve sa surface. Les budgets mémoire r4 et les conditions de
double décodage restent actifs. Les paramètres de couleur et de qualité avant/après apparaissent
dans le diagnostic, avec la limite de débit effectivement appliquée.

Référence du cycle de surface : [documentation Media3](https://developer.android.com/media/media3/ui/surface).
La disparition effective du voile sur le Philips doit encore être vérifiée sur ce téléviseur ;
aucun appareil ADB n'est connecté au poste de validation.

## Vérifications et livraison

Les tests portent sur les limites/expiration du cache, les coupures, les manifestes fragmentés,
les destinations refusées, les gros segments, le renouvellement des variantes, le classement VLC
séparé, les ouvertures annulées, la pause et le repli. Android couvre les fenêtres courtes, le
remplissage initial, le débit inconnu et le retour du plafond après stabilisation.

Le banc `apps/desktop/scripts/continuite-direct.mjs` exécute Electron et VLC réels avec une vidéo
H.264/AAC synthétique de 320 × 180, 15 images/s, une session HTTP avec cookie HttpOnly et des coupures
de 15/30 secondes. Il isole les réglages dans un dossier temporaire et garde ses fenêtres cachées.
Ce banc ne qualifie pas le rendu HDR/4K ni l'affichage Linux. La première passe longue a enregistré
52 minutes et 30 secondes de progression, mais s'est interrompue sans bilan final : elle ne vaut
pas une heure de validation complète. Les rapports des essais terminés, ce journal partiel,
les résultats de construction et les vérifications des paquets sont conservés dans
`artifacts/validation-0.5.9.r5/`.

La construction complète passe 1 769 tests (349 Web, 1 127 serveur, 30 bureau, 263 Android).
Deux tests serveur de corpus externe sont ignorés. Android lint termine sans erreur, avec
55 avertissements. L'APK signé porte le code de version 59005 et le nom `0.5.9.r5`.

Le module bureau est chargé à la demande. Le JavaScript initial mesuré passe d'environ 94,9 à
95,1 Kio gzip ; les modules différés totalisent environ 212,6 Kio. Budgets révisés à 96 et 215 Kio,
avec justification dans le garde de construction. Le budget CSS reste à 18 Kio.

La version serveur et les clients doivent être mis à jour ensemble pour activer le nouveau pont.
Aucune installation sur le NAS, Windows, Linux ou Android n'est effectuée par cette livraison.
