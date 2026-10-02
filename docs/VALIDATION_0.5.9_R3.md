# FlixTunes 0.5.9.r3 — suivi de validation

## Périmètre

Amélioration du Live TV Web en réseau local, avec conservation des contrôles WAN et des profils.
Le masquage des commandes concerne le bandeau et le diagnostic. Sur Android, une reprise automatique
ne réveille plus les incrustations ; l'effacement attend la reprise si son échéance tombe pendant
une mise en tampon. Un réarmement de surface vidéo reprend aussi le mécanisme déjà présent dans
le lecteur de films : déplacement HDR, relève HDR ou variation de colorimétrie entre sources.
Le SDR inchangé conserve sa surface. Le voile gris décrit par l'utilisateur (Live TV sur Android TV,
persistant après interaction) n'a pas été reproduit sur appareil ; cette correction ciblée doit
être confirmée sur le téléviseur concerné.

## Comportement

- Réserve de démarrage de 8 secondes, réduite pour les fenêtres courtes. Démarrage de secours après
  8 secondes si au moins une seconde est décodable ; l'ouverture reste bornée.
- Retard cible jusqu'à 55 secondes, correction progressive et plafond de 60 secondes par rapport
  à la fenêtre du lecteur. Un recul manuel conserve son sens. Le retard déjà présent chez le
  fournisseur ou ajouté par une conversion ne peut pas être déduit sans horodatage amont fiable.
- Relève préparée en parallèle, décodage vérifié et raccord réajusté avant affichage. Les sources
  dépourvues d'horloge commune ne permettent pas de garantir un raccord à la même image.
- Mémoire HLS plafonnée à 16 ou 32 Mio selon la mémoire déclarée par le navigateur ; historique
  arrière réduit à 20 secondes. L'historique de diagnostic conserve au plus 120 observations.
- Conversion H.264/AAC jusqu'à 720p/30, une session par défaut, deux au maximum via
  `FLIXTUNES_LIVE_CONVERSIONS` ; la valeur 0 la désactive. Les autres lectures et la capacité
  disponible peuvent faire refuser une conversion. Une session inactive expire après 60 secondes.
  Le stockage par session est surveillé à 128 Mio, en plus de la rotation des segments.
- La conversion utilise FFmpeg et une passerelle locale avec contrôle des destinations publiques
  à chaque requête et redirection. Les formats protégés et certaines variantes DASH complexes
  sont refusés. Aucun accès protégé n'est contourné.

## Qualification

Les essais automatisés utilisent des vidéos synthétiques et des pannes injectées. Ils ne constituent
pas une mesure de disponibilité des fournisseurs. Aucun appareil Android n'est connecté au poste
de validation ; Opera GX, Safari et les téléviseurs doivent encore être qualifiés sur matériel réel.

Résultats déjà vérifiés lors de la construction :

- TypeScript : tous les projets passent ; 342 tests Web, 1 126 tests serveur et 20 tests bureau passent.
  Deux mesures de corpus externe restent désactivées, comme précédemment.
- Test FFmpeg réel : conversion d'un HLS synthétique, réserve de segments disponible, isolation des
  profils, refus de traversée de chemin, fermeture et libération de la session.
- Chrome et Edge, en mode sans interface : vidéo H.264/AAC synthétique 320 × 180 à 15 images/s,
  interruptions réseau de 5, 15 et 30 secondes puis panne permanente d'une source. Aucun gel détecté
  avec un échantillonnage de 250 ms ; relève effective, retard maximal de 44,925 s dans Chrome et
  44,664 s dans Edge. Ce test ne mesure pas les performances matérielles du décodage HD/4K.
- Dans les deux navigateurs : bandeau masqué, diagnostic fermé puis masqué après inactivité,
  même avec la souris au-dessus du lecteur et un bouton conservant le focus.
- Budgets Web conservés : premier affichage 94,8 Kio compressés, modules différés 209,6 Kio,
  feuille de style 17,2 Kio. Aucun plafond n'a été relevé pour cette révision.

- Android : 254 tests JVM passent, dont trois couvrant les transitions HDR/HLG/Dolby Vision,
  le SDR inchangé et la variation de plage colorimétrique. Compilation réussie ; analyse statique
  sans erreur, avec 55 avertissements.
  L'APK installable est signé par la clé de débogage, version `0.5.9.r3`, code `59003`.
- Total : 1 742 tests passent, deux tests de corpus externe désactivés. Contrôle UTF-8 et absence
  de nouveaux caractères de remplacement ou de BOM inattendu dans les sources modifiées.

Les paquets et leurs empreintes sont déposés dans `artifacts/` par `Build-Release.ps1`.
Les rapports de lecture Chrome/Edge sont conservés dans `artifacts/validation-0.5.9.r3/`.
Aucun paquet n'est installé automatiquement sur le NAS.

La surface Android reste un `SurfaceView`, conformément à la
[documentation Android sur les surfaces vidéo](https://developer.android.com/media/media3/ui/surface).
Le contournement de couleur reprend celui du projet ; la documentation ne prouve pas que le
symptôme de ce téléviseur provient du HDR.
