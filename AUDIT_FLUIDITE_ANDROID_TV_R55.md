# Audit profond de fluidité Android TV — R55

## Symptôme et conclusion

Le préchargement réseau R54 n'a produit aucune amélioration visible. Le catalogue et le débit NAS ne
sont donc pas le goulet dominant. Le chemin critique était local au client : à chaque mouvement D-pad,
l'état de focus était lu pendant la composition, une nouvelle rangée arrivait trop tard dans la fenêtre
paresseuse et des prélectures Coil devenues inutiles continuaient leur décodage en arrière-plan.

Le rapport du compilateur Compose R55 confirme que Strong Skipping est actif et que `FlixTunesApp`,
`EcranAccueil`, `GrilleCatalogue`, `GrilleMedia`, `CarteMedia` et `Jaquette` sont skippables. Le grand
`MainState` n'est donc pas, à lui seul, la cause principale des saccades.

## Ce que font les interfaces TV de référence

Netflix traite séparément quatre mesures : latence touche→image, temps avant interactivité, cadence
d'animation et mémoire. Son moteur pré-rend les titres juste hors écran, réutilise les composants de
liste, pré-monte certains écrans et adapte les effets au budget de textures de l'appareil. Dépasser ce
budget peut ralentir brutalement les animations ; charger « le plus possible » n'est donc pas une
stratégie sûre.

Plex expose un transcodeur d'images dimensionné par le client. Ce principe évite de transférer et
décoder une texture plus grande que sa cible. FlixTunes stocke déjà les affiches TMDB en `w500`, Coil
les décode à la taille de la carte et son cache utilise `Precision.INEXACT` : la différence réseau est
donc secondaire ici. En revanche, la prélecture doit être bornée et annulable.

Sources :

- https://medium.com/netflix-techblog/crafting-a-high-performance-tv-user-interface-using-react-3350e5a6ad3b
- https://medium.com/netflix-techblog/bringing-rich-experiences-to-memory-constrained-tv-devices-6de771eabb16
- https://developer.plex.tv/pms/
- https://developer.android.com/develop/ui/compose/custom-modifiers
- https://developer.android.com/develop/ui/compose/performance/baseline-profiles
- https://developer.android.com/training/tv/playback/compose/lists

## Corrections R55

| Priorité | Correction | Effet recherché | Portée |
| --- | --- | --- | --- |
| P0 | Lecture du focus déplacée vers `graphicsLayer` et `drawWithContent` | Plus de recomposition du contenu de la carte à chaque touche | TV uniquement |
| P0 | Suppression des modificateurs `composed` du chemin des cartes | Moins de groupes et d'allocations lors de l'arrivée d'une rangée | Toutes surfaces, rendu inchangé |
| P0 | Prélecture Coil structurée, deux files annulables | Aucun arriéré de décodages après un défilement rapide | TV uniquement |
| P0 | Suppression du chauffage intégral R54 | Le CPU et le cache restent disponibles pour les images réellement proches | TV uniquement |
| P1 | Fenêtre avant/arrière agrandie | La prochaine rangée est composée hors du chemin de la touche | TV uniquement |
| P1 | Budget adapté à `ActivityManager.memoryClass` | Pas de saturation de textures sur les boîtiers modestes | TV uniquement |
| P1 | Détection TV unifiée (mode TV ou Leanback) | Impossible d'afficher l'UI TV avec le cache mobile | TV uniquement |
| P1 | Baseline Profile propre à FlixTunes | AOT du démarrage, de la grille et du focus dès l'installation | Android |
| P1 | Retrait total du journal Dolby Vision R54 | Aucun appel, compteur atomique ou route temporaire restant | Android + serveur |

## Budget appliqué

| Classe de tas | Affiches initiales | Réserve avant | Réserve arrière |
| --- | ---: | ---: | ---: |
| ≤ 128 Mio | 24 | 0,26 écran | 0,10 écran |
| 129–256 Mio | 48 | 0,38 écran | 0,18 écran |
| > 256 Mio | 64 | 0,52 écran | 0,24 écran |

La définition des affiches, la typographie, les arrondis et l'échelle de focus restent inchangés.
Mobile et tablette conservent leur fenêtre de grille et leur indication tactile animée.

## Critères de qualification sur le téléviseur de référence

À mesurer sur l'APK release R55, cache froid puis chaud, pendant 30 secondes de maintien vertical dans
Films et Séries :

1. aucune touche perdue et aucun retour de focus ;
2. aucune rangée vide après stabilisation du focus ;
3. aucune dégradation progressive après dix traversées aller-retour ;
4. aucune requête de prélecture survivant au changement de rangée ;
5. position et focus restaurés après ouverture/retour d'une fiche ;
6. mobile, tablette, lecture directe et Dolby Vision inchangés.

La mesure instrumentée finale (`dumpsys gfxinfo`/Perfetto) exige un appareil relié par ADB. Aucun
appareil n'était exposé à la machine de construction pendant cet audit ; les gains de R55 sont donc
validés statiquement, par le compilateur et les tests, puis à confirmer sur la TV réelle.
