# Journal des versions

## 0.5.6.r87 — VLC choisit ses pistes, et le NAS cesse de recopier des films pour ça

- **Changer de langue est devenu immédiat.** Un navigateur ne sait pas activer une piste secondaire d'un Matroska : le serveur devait l'isoler dans un remux, et recopiait le film entier à chaque changement. VLC choisit dans le fichier tel quel. Constaté à l'écran : l'entrée de VLC ne change pas, l'horloge ne bronche pas, et le serveur ne reçoit aucune nouvelle demande.
- **Un sous-titre image ne fait plus réencoder le film.** Un PGS ne peut pas devenir du texte : pour un navigateur il faut l'**incruster**, c'est-à-dire tout réencoder — la conversion la plus chère de toutes, sur le processeur d'un boîtier de salon. VLC le dessine, et la session reste en lecture directe.
- **Les numéros de piste sont ceux du serveur, et on l'a vérifié deux fois** plutôt que de le supposer : les dix flux d'un Matroska comparés un à un — mêmes numéros, mêmes langues des deux côtés, y compris le « fre » isolé en huitième position —, puis un marqueur indépendant de tout libellé, `audio-track-id=3` sélectionnant bien la piste à 2 canaux et 224 kb/s que le serveur annonce à l'index 3.
- **On ne lit que le nombre, jamais les libellés de VLC.** Ils sont traduits dans la langue de son installation — « Flux » ici, « Stream » ailleurs — et `--language=en` n'y change rien. S'y fier aurait fait dépendre le choix des pistes de la langue du système, un défaut qui n'apparaîtrait que chez quelqu'un d'autre.
- **Deux défauts vus en regardant l'application tourner, et corrigés.** Le film démarrait dans la mauvaise langue : en dispensant le serveur d'isoler la piste, on avait oublié de dire à VLC laquelle jouer, et il prenait la première du fichier. Puis, une fois cela corrigé, il démarrait **sans son** — la trace de VLC disait « too low audio sample frequency (0) » puis « failed to create audio output » : il annonce ses pistes avant d'avoir lu le format du flux audio, et changer de piste à cet instant lui fait rouvrir un flux dont il ignore encore la fréquence.
- **La réponse n'était pas d'attendre le bon moment mais de ne pas changer du tout** : les pistes sont passées en options de l'entrée et prises au moment où le flux s'ouvre. Aucun décodeur à tuer, aucune sortie audio à refaire. Relevé après correction : piste française décodée en 6 canaux, sortie audio créée, tampons joués qui montent, et **zéro** changement de piste en cours de route.
- **Ce qu'on ne mesure pas est dit plutôt que simulé.** Annoncer huit canaux quel que soit le matériel vaut mieux qu'une mesure — le serveur transmet alors le son tel quel et VLC réduit lui-même vers les haut-parleurs présents, sans rien réencoder. La définition décrit ce qu'un décodeur accepte, pas la taille d'un écran. Seule la plage dynamique est réellement mesurée, et elle l'était déjà.
- **Les commandes du lecteur reçoivent enfin les jetons de style.** Elles avaient échappé à la mise en ordre des boutons : trois traitements pour un même rôle, des hauteurs de 44, 38 et 34 px, des arrondis de 50 %, 9 et 8 px, un fond tantôt à 12 % tantôt à 20 % de blanc, une bordure sur les uns seulement. Le bouton de retour n'avait même pas de couleur de texte — sa flèche sortait en sombre sur une pastille claire, illisible dès que l'image derrière était lumineuse.
- **Une seule forme, deux silhouettes** : celle du reste de l'application — bordure fine, rayon de commande, fond qui s'éclaircit au survol — mais posée sur une **image** et non sur un panneau, d'où un fond plus opaque et un flou d'arrière-plan. Une icône seule est ronde, un libellé est un rectangle arrondi ; lire et mettre en pause se distingue par la taille, pas par la couleur.
- **Les réglages de sous-titres s'éteignent devant une image.** Un PGS de Blu-ray n'est pas du texte : c'est une suite d'images déjà composées avec leur police et leur couleur, et aucun des six réglages ne peut s'y appliquer — ni quand VLC les dessine, ni quand le serveur les incruste. Les laisser actifs faisait promettre à l'interface ce qu'elle ne pouvait pas tenir : on tournait le bouton « Taille » et rien ne bougeait. Ils restent visibles, éteints, avec la raison écrite.
- **Les bandes en haut et en bas d'un film plus large que la fenêtre sont noires**, et non au bleu-nuit de l'application. Android avait le même défaut.
- **Un correctif écrit puis retiré, faute de défaut à corriger.** On soupçonnait Chromium de ne pas remettre en forme une réplique déjà affichée, et une piste éteinte-rallumée l'y aurait forcé. Le constat était ailleurs : le texte s'applique bien en direct, c'était l'image qui ne bougeait pas. Le code est parti avec son test.
- 227 tests Web et 20 tests de la coque, tous verts.

## 0.5.6.r86 — le lecteur du client de bureau est celui du Web, et VLC décode dessous

- **Le film s'affiche dans la fenêtre FlixTunes, sous les commandes du client Web.** Pas une imitation : le même `Player.tsx`, la même barre, la même carte d'enchaînement, les mêmes menus. VLC décode par le matériel — « Format décodé : DX11 » relevé dans sa trace — et l'interface se dessine par-dessus, dans une fenêtre transparente.
- **Le NAS ne convertit plus ce qu'il n'a pas besoin de convertir.** Le client annonce ce que VLC sait lire : Matroska, HEVC, TrueHD, DTS. Constaté à l'écran, un film servi **tel quel** en `Direct Play`, et un autre en `Remux HLS` quand il le fallait — les deux modes de l'énoncé.
- **Trois promesses ont été écartées faute de pouvoir les tenir** : le choix d'une piste audio dans un fichier servi entier — VLC en est capable, le pont ne sait pas encore lui désigner une piste, et l'annoncer rendrait le menu « Langue » sans effet —, Dolby Vision, que VLC ne restitue pas fidèlement, et Atmos, creux sans transmission vers un amplificateur.
- **Le pivot tient en treize membres.** `Player.tsx` ne parle plus qu'à une « surface de lecture ». Dans un navigateur, `HTMLVideoElement` la satisfait **telle quelle** — aucun adaptateur, pas une ligne de comportement changée ; dans la coque, VLC la satisfait en traduisant les mêmes mots. C'est ce qui garantit qu'il n'y aura jamais deux lecteurs à tenir à jour.
- **Les sous-titres sont dessinés par le lecteur, pas par VLC**, à partir du même WebVTT et du même décalage qu'un navigateur. Laisser VLC s'en charger aurait rendu sans effet les six réglages du profil — taille, couleur, fond, position, police, synchronisation.
- **Le plein écran vaut pour toute l'application** : `F11` partout, `Échap` pour en sortir, et le bouton du lecteur. Il passe par la fenêtre et non par le document — une page ne sait agrandir que sa propre fenêtre, et l'interface aurait été étalée sur tout l'écran devant une vidéo restée à sa place.
- **Le pont refuse ce qui ne vient pas du serveur du foyer.** Il est offert à une page chargée depuis le réseau, et VLC ouvre tout ce qu'on lui présente : ni fichier du disque, ni protocole exotique, ni autre hôte, ni autre port. L'interface de commande de VLC n'écoute que sur `127.0.0.1`, sur un port libre, derrière un mot de passe tiré au hasard à chaque démarrage.
- **Trois défauts trouvés en chemin.** Le film jouait derrière une interface figée à 0:00 — le mode strict de React démontait la surface et son abonnement ne revenait pas ; il n'y a qu'un VLC et qu'un lecteur à la fois, la surface est désormais partagée. La vidéo jouait derrière une vitre peinte — le fond n'était effacé que sur `body`, alors que `:root` en porte un aussi. Et VLC écrivait dans un tuyau d'erreur que personne ne vidait, ce qui l'aurait figé au bout de quelques minutes.
- **Le second défaut a résisté à plusieurs hypothèses plausibles**, toutes écartées par l'expérience : la sonde de r84 rejouée, un lancement tardif de VLC, une interface qui se redessine sans cesse. Il a fallu interroger la page en fonctionnement par le protocole de débogage pour lire la vérité — `body` transparent, `html` à `rgb(8, 11, 18)`. On mesure l'état, on ne le déduit pas d'une capture d'écran.
- **La livraison nommait `tar.exe` sans dire lequel.** Lancée depuis un terminal où Git est dans le chemin, elle prenait le tar de Git — un portage d'outil Unix qui lit « N:\… » comme une machine distante nommée N. L'échec « Cannot connect to N: resolve failed » tombait à la toute dernière étape d'une livraison de dix minutes, une fois le paquet NAS déjà construit et validé. Le tar de Windows est désormais nommé par son chemin.
- 761 tests serveur, 215 tests Web — dont 38 nouveaux pour la bascule —, 17 tests de la coque, tous verts.

## 0.5.6.r85 — la coque du client de bureau tourne, avec le client Web dedans

- **Le client Windows et Linux commence à exister.** La coque ne dessine qu'un seul écran — celui qui demande l'adresse du serveur — et tout le reste vient du client Web servi par le NAS. Constaté à l'écran : adresse saisie au clavier, validée, et « Choisissez votre groupe » s'affiche avec les trois familles réelles.
- **Le chemin a été éprouvé comme une personne l'aurait fait** : un clic dans le champ, une saisie au clavier, la touche Entrée. Écrire directement le fichier de réglages aurait vérifié bien moins de choses, à commencer par le pont entre la page et la coque.
- **Le pont est minuscule et le restera** : trois fonctions autour de l'adresse du serveur. C'est aussi par sa présence que le client Web saura qu'il tourne dans la coque et pourra confier la lecture à VLC — la capacité s'annonce, elle ne se devine pas par agent utilisateur.
- **L'écran de connexion porte l'enseigne** : le logo, « Flix » en blanc, « Tunes » en bleu, aux valeurs exactes du client Web. Le logo est embarqué dans la coque — à cet instant, aucun serveur n'est encore connu.
- **La normalisation d'adresse porte la règle qui compte** : sans schéma, une adresse locale passe en `http` avec le port 4000, une adresse publique en `https`. Un accès depuis Internet ne peut pas retomber en clair parce qu'on a tapé un nom sans préfixe. Sept cas la vérifient.

## 0.5.6.r84 — les sous-titres d'une lecture reprise s'affichent enfin, sur le Web

- **Toute lecture reprise en cours de route perdait ses sous-titres**, sur le Web, dès qu'elle passait par un flux HLS. Le serveur ouvre alors une session qui **commence au point de reprise** et compte à partir de zéro ; les sous-titres, eux, portent les temps du film. Une reprise à huit minutes faisait donc chercher au navigateur un sous-titre pour la huitième **seconde**. Mesuré dans le lecteur en service : 107 sous-titres chargés, piste sélectionnée, mode « showing » — et **aucun actif**.
- **Le client Web soustrait désormais le début de session** dans l'adresse de la piste. Tout le reste de l'interface faisait déjà cette addition — horloge, barre de progression, chapitres ; la piste de sous-titres était la seule à l'oublier. Android, lui, la faisait depuis le traitement de la fenêtre de session : c'est le Web qui n'avait jamais reçu la correction.
- **Le serveur écarte ce qui précède le début du flux** au lieu de le ramener à zéro. Le formatage borne les temps négatifs à zéro : tous les sous-titres antérieurs s'empilaient donc sur la première seconde. Android envoyant déjà un décalage négatif, il en souffrait sans que personne l'ait relié à ça.
- Quatre cas verrouillent la conversion : décalage négatif, sous-titre antérieur écarté, sous-titre à cheval sur la reprise ramené au début du flux, et le décalage réglé à la main qui continue de fonctionner seul.
- 761 tests serveur et 174 tests Web, tous verts.

## 0.5.6.r83 — deux défauts du lecteur Android, vus en service

- **Un film affichait « null » en gras, et son titre en dessous.** `optString` d'`org.json` a un piège : quand la valeur JSON vaut `null`, il ne rend pas une chaîne vide mais **la chaîne « null »** — quatre caractères qui passent tous les tests de non-vacuité. Un film, dont la série est nulle par nature, était donc pris pour une série nommée « null », et son titre relégué à la ligne réservée au numéro d'épisode. Toute lecture d'un champ facultatif passe désormais par un garde-fou qui rejette cette chaîne-là.
- **La carte « épisode suivant » surgissait au premier instant de l'épisode qu'on venait de lancer**, proposant déjà celui d'après. La préparation de session pose le marqueur de générique du **nouvel** épisode alors que le lecteur tient encore l'**ancien**, dont la position est près de la fin : un seul rafraîchissement dans cet intervalle suffisait à croire le générique atteint. La carte ne s'arme désormais qu'après avoir vu ce média **avant** son générique.
- Le voisin mémorisé est en outre oublié au changement d'épisode : il appartenait à celui qu'on quitte.
- 213 tests Android, 0 échec.

## 0.5.6.r82 — la couche interface et la couche données se détachent de la plateforme

- **Deux fichiers empêchaient tout le dossier `ui/` de bouger.** `Gabarit.kt` apportait cinq imports Android pour deux fonctions qui interrogent l'appareil ; `PleinEcran.kt` en apportait trois pour une extension d'`Activity` qui n'a jamais été appelée par un composable. Les premières sont parties dans `AppareilAndroid.kt`, le second a quitté `ui/`. **Il ne reste plus un seul `import android.` dans l'interface.**
- **La frontière tient en une phrase** : `Gabarit.kt` dit ce qu'on fait d'une classe de mémoire, `AppareilAndroid.kt` dit comment on la découvre. L'activité la mesure une fois et la fournit en ambiance — `LocalMemoireTv`, à côté du `LocalGabarit` qui existait déjà pour la même raison. Un écran ne demande plus à Android quelle taille de texture décoder : il lit une valeur qu'on lui a donnée.
- **Deux contrats pour la couche données** : `Reglages` — trois valeurs, ni fichier ni format — et `DecouverteServeurs` — commencer, arrêter. Le stockage en préférences partagées et la découverte NSD les mettent en œuvre côté Android ; `ReglagesEnMemoire` et `AucuneDecouverte` les mettent en œuvre sans plateforme. L'entrepôt et le ViewModel déclarent le contrat.
- **211 tests Android, 0 échec.** Les trois nouveaux ne vérifient pas un comportement mais une propriété de construction : l'entrepôt se monte sans `Context`. C'est ce qu'un module partagé devra faire, et ce qui échouera si quelqu'un remet un type concret dans une signature.

## 0.5.6.r81 — les écrans quittent l'activité : `MainActivity` passe de 2 253 à 64 lignes

- **`MainActivity` portait vingt-six composables** en plus de la classe d'activité : 2 253 lignes où cohabitaient le cycle de vie Android et tous les écrans. Les écrans vivent désormais dans `ui/ecrans/`, répartis par sujet — accueil, catalogue, profils, fiche, recherche, historique, personnes. L'activité fait **64 lignes**.
- **Ce n'est pas un rangement de principe** : ces composables n'importent rien d'Android, ils sont portables tels quels, mais ils étaient enfermés dans une classe qui, elle, ne l'est pas. C'est le découpage du monolithe que l'audit d'industrialisation réclamait — mené ici pour une raison précise, et non par principe.
- **Rien n'a changé**, et c'est vérifié autrement qu'à l'œil : les blocs déplacés ont été comparés au texte d'origine après normalisation — **8 562 mots, identiques**, aux deux seuls changements de visibilité près. 208 tests Android verts, 47 avertissements lint inchangés, APK construit.
- Deux pièges rencontrés, tous deux consignés : le fichier mêlait **989 fins de ligne CRLF et 1 264 LF** — trace du défaut corrigé en r77 —, et le report automatique des imports écartait `getValue`/`setValue`, jamais écrits dans le code alors que ce sont eux qui rendent possible le `by remember`.

## 0.5.6.r80 — les trois avertissements de sécurité Android

- **Le service de lecture était joignable par n'importe quelle application installée**, qui pouvait lire, mettre en pause, parcourir la file et voir ce qui est regardé. Un `MediaSessionService` doit être exporté — c'est ainsi que le système le découvre pour la notification de lecture, les touches d'un casque, Android Auto —, mais une permission dans le manifeste fermerait la porte à ces composants-là. Le tri se fait donc à la connexion : notre application, notre processus, et les composants que la session reconnaît. Le reste est refusé.
- **Le sélecteur de pistes retenait le service entier** : un champ statique fort sur un objet qui porte un `Context`, remis à zéro par `onDestroy` — qui n'est pas garanti. La référence est désormais faible, et vit exactement le temps du lecteur qui s'en sert. La cause disparaît, l'avertissement avec.
- **Le trafic en clair reste permis, délibérément.** Le serveur est joint par l'adresse IP d'un NAS, et Android ne sait exprimer une exception que par nom d'hôte : ni plage d'adresses, ni « tout ce qui est privé ». Ce qui compte est protégé ailleurs — `ServerUrl` impose `https://` dès que l'adresse n'est pas locale, donc l'accès depuis Internet ne peut pas retomber en clair. L'avertissement est éteint avec sa raison écrite dans le fichier : un avertissement qu'on ne peut pas lever et qu'on laisse crier devient du bruit.
- **50 avertissements lint ramenés à 47**, les trois de sécurité levés. Les restants sont des API dépréciées et des pluriels de traduction.
- 208 tests Android, 756 tests serveur, 174 tests Web, 17 tests Windows, tous verts.

## 0.5.6.r79 — le client Windows cesse d'inventer ses capacités

- **Il annonçait 7680 × 4320 quelle que soit la machine.** La négociation de lecture repose entièrement sur cette déclaration : un portable 1080p réclamait donc de la 8K en lecture directe, et le serveur le croyait. La définition vient désormais de l'écran, mise à l'échelle de Windows comprise — sans quoi un écran à 150 % s'annoncerait d'un tiers trop petit.
- **Une seule case commandait le HDR *et* le Dolby Atmos, le DTS:X, l'Auro-3D, seize canaux et l'audio sans perte.** Or ces deux choses n'ont aucun rapport : un écran HDR branché sur les haut-parleurs d'un portable est un cas ordinaire. Un poste stéréo annonçait seize canaux immersifs, et le serveur renonçait au mixage dont ce poste avait précisément besoin.
- **La sortie audio est maintenant un réglage à part** : stéréo par défaut, 5.1, 7.1 ou amplificateur. L'audio immersif et l'audio sans perte ne sont annoncés que dans le dernier cas, le seul où ils ont un sens. Les codecs, eux, restent ceux que VLC sait lire — le codec dit ce qu'on décode, `maxAudioChannels` dit ce qu'on restitue.
- **Le client est déclaré expérimental**, et le statut se lit dans le titre de la fenêtre : accès distant non pris en charge — vérifié, il n'envoie ni jeton d'API ni compte de session —, pas d'écran d'administration, et une négociation éprouvée par ses tests mais pas sur un parc d'appareils.
- **17 tests Windows au lieu de 8**, dont deux qui verrouillent le défaut : le HDR n'a aucun effet sur l'audio, et l'audio aucun sur le HDR.
- 756 tests serveur, 174 tests Web, 17 tests Windows, tous verts.

## 0.5.6.r78 — la base sait où elle en est, et sait revenir en arrière

- **Le schéma évoluait par détection de colonnes**, cent-huit instructions rejouées à chaque démarrage. Robuste tant qu'on n'ajoute que des colonnes ; impuissant dès qu'il faut déplacer des données ou reconstruire une table, et incapable de dire **où la base en est** — donc de reconnaître un schéma à demi migré, ou de savoir ce qu'une restauration a rendu.
- **Un registre numéroté consigne désormais ce qui a été appliqué.** La version 1 est le socle : tout ce que `database.ts` construit déjà, adopté sans rien réexécuter, puisque ce code est idempotent par nature. Les évolutions suivantes portent un numéro, s'appliquent **dans une transaction**, et ne sont consignées que si elles ont réussi entièrement — SQLite exécutant le DDL de façon transactionnelle, une migration interrompue ne laisse pas un schéma bâtard.
- **Une sauvegarde est prise juste avant la première migration réelle**, jamais pour la simple adoption du socle. Elle porte le nom des sauvegardes ordinaires, donc elle se restaure depuis l'écran d'administration sans manipulation particulière.
- **Il n'y a pas de migration inverse, et c'est délibéré** : défaire une colonne en SQLite impose de reconstruire la table entière, ce qui est plus dangereux que ce que cela répare — et s'exécuterait après une mise à jour qui vient d'échouer. Le chemin de retour est la sauvegarde, qui elle est éprouvée.
- **La restauration a enfin des tests**, quatre, sur de vraies bases : contenu rendu et `PRAGMA integrity_check` passé, journal WAL de l'ancienne base écarté, état d'avant conservé horodaté, reprise après interruption exactement une fois, et refus d'un marqueur qui désignerait un fichier quelconque.
- **La version du schéma s'affiche** dans la tuile « Base de données » : une restauration peut faire reculer le schéma sans que la version du paquet ne bouge.
- 756 tests serveur et 174 tests Web, tous verts.

## 0.5.6.r77 — l'adresse du NAS de développement quitte le produit

- **Le client Windows proposait l'adresse du NAS de développement comme serveur par défaut, et Android l'affichait en exemple.** N'importe qui installant FlixTunes voyait l'adresse d'un NAS qui n'est pas le sien. Windows n'invente plus aucune adresse — le champ reste vide, la découverte Zeroconf remplit la liste, la saisie manuelle est toujours là — et Android montre une adresse de réseau domestique quelconque.
- **La même adresse traînait dans trois suites de tests et deux commentaires d'empaquetage**, et le domaine réel, l'IP publique de la ligne et celle de l'hébergeur figuraient dans les documents d'accès distant. Tout est remplacé par `flixtunes.exemple.fr` — le texte que le champ de saisie propose déjà — et par les plages de documentation du RFC 5737. Il ne reste aucune adresse publique dans les fichiers du projet.
- **Les tests du client Windows ne s'exécutaient plus du tout.** `dotnet test` du SDK 10 exige `--project`, et même corrigé il construit l'application de test puis n'y découvre aucun test, sortie 5. Le même binaire lancé directement en réussit huit sur huit ; le script de livraison l'appelle donc directement.
- **La chaîne de livraison est réparée.** Le script copiait un nom d'APK qui n'existe plus, appelait le paquet ASUSTOR sans révision — donc estampillé `r1` — et lançait Gradle sans la sienne : les deux artefacts d'une même livraison annonçaient des numéros différents. Version et révision se lisent maintenant dans ce journal et sont recoupées avec `package.json`.
- **Les sept déclarations de version sont alignées** — contrats, client Windows, image Compose, README, et le pnpm du Dockerfile —, propagées par `tools/Sync-Version.ps1` et gardées par six cas de test.
- **125 Mo de données de test ne partent plus dans les livraisons** : `apps/server/.vitest-data`, qui contient bases, affiches et la clé de chiffrement des fournisseurs, était absent du `.dockerignore` **et** des exclusions des archives de sources distribuées.
- 746 tests serveur, 174 tests Web, 8 tests Windows, tous verts.

## 0.5.6.r76 — le compteur d'avancement peut enfin atteindre son terme

- **Une saison entièrement chapitrée ne restait jamais dans la file de repérage.** Les repères venus des chapitres ne se rangeant pas en base, et la file ne consultant que la base, elle y revenait à chaque analyse pour n'y rien faire. Négligeable en machine, décisif à l'écran : 44 % des épisodes sont chapitrés, donc le compteur ne pouvait pas descendre à zéro.
- **La passe recopie désormais ce repère en base**, avec sa provenance `chapitre`, que rien ne peut écraser.
- **Et cette copie ne sort jamais du magasin** : le lecteur ne la sert pas. Si le fichier a ses chapitres, ils ont déjà répondu ; s'il ne les a plus — un remultiplexage —, la copie est périmée par définition. C'est ce qui lève l'objection qui avait fait écarter ce rangement à l'origine.
- **Aucun compteur n'est gonflé au passage** : la copie n'inscrit ni écoute ni découverte. « Épisodes écoutés » et « introductions repérées » gardent leur sens exact ; seul « saisons traitées » converge enfin.
- 740 tests serveur et 174 tests Web, tous verts.

## 0.5.6.r75 — une saison qui revient ne se réécoute plus en entier

- **Les épisodes déjà écoutés ne le sont plus une seconde fois.** Le choix des épisodes à traiter n'écartait que ceux dont les chapitres renseignent l'introduction ; une saison rentrée dans la file pour deux épisodes ajoutés était donc redécodée **en entier**. Le coût d'un ajout était celui de la saison : vingt épisodes décodés au lieu de deux.
- **Et cette réécoute pouvait abîmer le travail précédent** : `remplace` accepte une source de rang égal, donc « empreinte » l'emporte sur « empreinte ». La seconde passe ne travaillant pas sur les mêmes témoins que la première, elle pouvait remplacer un repère juste par un moins bon sans que rien ne le signale. C'est ce point qui a emporté la décision — un gaspillage se supporte, une régression silencieuse non.
- **Ils restent témoins.** Un épisode déjà entendu n'est pas retiré de la comparaison : il en est un excellent point de repère, et l'écarter appauvrirait le repérage de ceux qui restent.
- Le prédicat est désormais **le même que celui de la file** : ce qui met une saison à traiter et ce qu'on y fait désignent les mêmes épisodes.
- **La révision s'affiche avec la version**, côté serveur comme côté Android : `v0.5.6 r75 · étape 56` dans le diagnostic Web, et une puce `v0.5.6 r75` contre l'enseigne sur l'accueil Android. Le texte vient du numéro de construction, jamais d'une chaîne écrite à la main : il ne peut pas diverger de ce qui est installé.
- **Les commandes du diagnostic serveur rejoignent la règle de r74** — 12,5 à 12,67:1 de contraste au lieu du gris clair du navigateur. Au passage, deux défauts de mise en page : les réglages détaillés n'avaient aucune feuille de style et se collaient sur une seule ligne, et « Refaire les mesures » barrait le panneau sur toute sa largeur au lieu des 157 px de son texte.
- 737 tests serveur et 174 tests Web, tous verts.

## 0.5.6.r74 — l'avancement affiché est celui du travail, et le repérage s'active

- **L'avancement du repérage se lit en base, plus en mémoire.** Compté en mémoire, il repartait de zéro à chaque démarrage du service : après une nuit de travail et quarante-trois saisons acquises, l'écran annonçait « 0 saison sur 434 ». Le travail était intact, la présentation mentait.
- **Deux chiffres plutôt qu'un**, parce qu'ils répondent à deux questions : l'avancement global dit **où en est le travail**, la passe en cours dit **si ça avance en ce moment**. Une passe à zéro saison depuis dix minutes signale un blocage que le total ne montrerait pas.
- **Le repérage s'active, il ne s'impose plus** : un interrupteur dans le centre d'analyse, **désactivé par défaut**. La passe sonore décode des heures durant sur un Celeron à quatre cœurs ; une fonction qui coûte cela se demande. Le réglage vit en base, donc il tient après un redémarrage.
- **Le désactiver arrête la passe en cours**, à la fin de l'épisode écouté — deux à trois secondes — au lieu d'attendre ses quatre cents saisons. Et « Arrêter », à côté de l'avancement, interrompt la passe **sans** désactiver la fonction : « pas maintenant » n'est pas « jamais », et la prochaine analyse reprend là où le travail en est.
- **Les repères déjà trouvés restent proposés dans le lecteur**, activé ou non : ils ne coûtent plus rien.
- **Les commandes de la configuration serveur ont une seule apparence.** Les boutons sans classe retombaient sur le rendu du navigateur — gris très clair, texte noir — et criaient plus fort que le bouton bleu qu'ils accompagnaient. Toutes les commandes secondaires sont désormais un contour sur voile clair, à **12,67:1** de contraste mesuré, la commande principale reste le seul aplat bleu, et les champs — jeton, langue — partagent la forme de ceux du formulaire d'ajout.
- 736 tests serveur et 174 tests Web, tous verts.

## 0.5.6.r73 — l'escalade se décide par saison, pas par épisode

- **La fenêtre ne s'élargit plus indéfiniment sur une saison sans thème commun.** L'escalade de r72 accélère les succès et alourdit les échecs : trouver à cinq minutes coûte une unité, ne rien trouver en coûte quatorze. Or, relevé en service sur 388 épisodes, **la moitié ne trouve rien**. Après trois échecs d'affilée, la saison cesse d'être élargie : elle passe de 280 à **59 unités** pour vingt épisodes.
- **L'écoute, elle, n'est jamais supprimée.** Chaque épisode passe toujours par les cinq premières minutes, qui couvrent 84,7 % des génériques. Renoncer à écouter aurait condamné une saison entière sur trois épisodes atypiques — un récapitulatif, un pilote, un double épisode — sans rattrapage possible, l'écoute n'étant notée qu'une fois.
- **Un succès rouvre l'escalade** pour le reste de la saison : si un thème existe, la saison en vaut la peine.
- **Justesse préservée**, vérifiée sur les cinq séries de référence : **5 sur 5**. Quatre d'entre elles trouvent leur générique dès 300 secondes ; seule *Silo* a besoin d'élargir, et son premier épisode y réussit, ce qui garde l'escalade ouverte.
- **48 % de réussite en service** : sur les 388 premiers épisodes écoutés, 188 introductions repérées par le son, sur des séries qu'aucun chapitre ne documente.
- 731 tests serveur et 172 tests Web, tous verts.

## 0.5.6.r72 — la passe sonore descend de cent heures à moins de dix

- **La fenêtre d'analyse ne s'élargit plus qu'en cas de besoin.** Le coût de la comparaison croît avec le **carré** de la durée analysée : chercher sur quinze minutes coûte neuf fois plus que sur cinq. La passe commence donc à cinq minutes, qui couvrent 84,7 % des génériques, et n'élargit qu'à défaut d'avoir trouvé. Mesuré : **789 ms par épisode contre 7 000**.
- **Quatre témoins au lieu de trois**, et c'est une correction, pas un réglage : sur *The Office*, deux paires seulement s'accordent sur quatre — les prologues n'ont pas la même longueur. Avec trois témoins la série tombait sous le quorum et **n'était pas repérée**, alors que l'algorithme la trouve parfaitement.
- **La progression s'affiche** sous les analyses de bibliothèque : saisons traitées, introductions repérées, série en cours. Une passe de plusieurs heures qui ne dit rien se confond avec un blocage.
- **Quatre raccourcis essayés, quatre échecs mesurés** — enveloppe résumée à la seconde, classement par nombre de fenêtres, classement par pic, corrélation croisée par transformée de Fourier : tous perdaient les génériques courts, aucun ne dépassait trois séries justes sur cinq. La recherche exhaustive est conservée, chacun de ces échecs documenté dans le code pour qu'on ne les retente pas.
- **Le tone mapping par Vulkan est écarté, mesures à l'appui** : libplacebo rend 11 images par seconde sur ce circuit graphique quand la chaîne seule en fait 178 et le processeur 51 à 75. Sept fois plus lent que le logiciel, pour 11,4 Mio de bibliothèques supplémentaires — dont une pile X11 sur un NAS sans écran.
- 729 tests serveur et 172 tests Web, tous verts.

## 0.5.6.r71 — le générique se reconnaît à son thème

- **L'introduction se trouve par le son, quand aucun chapitre ne la nomme.** Le thème d'ouverture est le même fichier audio d'un épisode à l'autre : deux épisodes mis côte à côte partagent une portion identique, et c'est elle. Éprouvé sur *Dragon Ball Z*, dont les sept séries totalisent **826 épisodes sans un seul chapitre** : générique de 109,5 s retrouvé sur six épisodes avec moins d'une seconde de dispersion, et vérifié indépendamment — les zones trouvées portent bien le même son, corrélation 0,947 à 0,999.
- **Deux paires indépendantes au minimum.** Sur *Bleach*, une paire isolée donnait 65 s là où les trois autres s'accordaient sur 105 s : un logo de studio ou une coupure commune ressemble à un thème tant qu'on ne l'a vu qu'une fois.
- **Rien ne tourne pendant une lecture.** La passe suit une analyse de bibliothèque et s'efface devant toute lecture en cours. Chaque épisode n'est écouté **qu'une fois**, et l'écoute est datée même bredouille — une série sans thème commun n'en aura pas davantage au prochain scan. Mesuré : 0,8 s par épisode, soit 1,5 à 5,5 h pour 6 637 épisodes, une seule fois.
- **Les chapitres ne sont pas une preuve.** Ceux de *Silo* saison 1 désignent deux zones qui ne partagent aucun son — corrélation **−0,204** — quand celles trouvées par le son atteignent 0,987. Ceux de la saison 2 sont bons, et l'algorithme les retrouve à quatre secondes près.
- **Le tone mapping VA-API a enfin son vrai message.** Le circuit vidéo d'un Celeron N5105 ne sait pas convertir le HDR — Intel ne l'expose qu'à partir de sa 12ᵉ génération — et l'interface le dit désormais au lieu d'un « le périphérique a refusé ce filtre » sans remède.
- **Trois défauts de la sonde de capacité**, qui ont fait durer ce diagnostic : la sortie d'erreur était tronquée **par la fin** alors que la cause est en tête, la sonde tournait en `-loglevel error` ce qui masque le refus d'un pilote, et la règle « pilote absent » passait avant « nœud de rendu invisible ». Le troisième a été trouvé par un test écrit pour le premier.
- 729 tests serveur, 172 tests Web, 200 tests Android, tous verts. Une migration : la table des repères gagne une provenance par repère.

## 0.5.6.r70 — les épisodes muets héritent des repères de leurs voisins

- **Un épisode sans chapitres reçoit ceux de sa saison.** Une saison est fabriquée d'un bloc : même thème d'ouverture, même carton de fin. Mesuré sur 246 saisons, la durée du générique de fin y varie d'un **écart absolu médian de 0,5 seconde** d'un épisode à l'autre — ce qui vaut pour trois épisodes vaut pour les neuf autres. Couverture du générique de fin : **3 571 → 4 241 épisodes (44 → 52 %)**, sans lire un seul fichier.
- **Une saison trop maigre emprunte au reste de la série**, ce qui couvre le pilote rangé seul ou la saison en cours. L'emprunt ne relâche aucun critère : une série qui change de générique s'écarte d'elle-même — *Silo* a 77,0 s d'introduction en saisons 1 et 2 et 97,8 s en saison 3, et le repli refuse alors de conclure.
- **Le calcul a lieu après une analyse, jamais pendant une lecture.** Un repère absent au lancement n'est pas calculé à ce moment-là : on ne propose rien. La passe ne lit aucun fichier et traverse 8 190 épisodes en quelques centaines de millisecondes. Elle se relance sans dommage — un épisode ajouté est complété au scan suivant, et s'il porte des chapitres, il enrichit ses voisins à son tour.
- **La provenance de chaque repère est conservée**, et une source plus sûre n'est jamais écrasée par une plus faible. Les chapitres du fichier priment toujours sur une déduction.
- **Un défaut de conception attrapé par un test** : mesurée à l'écart-type, une saison régulière portant un seul chapitre mal nommé se faisait rejeter en bloc. L'écart absolu médian ignore l'intrus ; le seuil a été remesuré après ce changement.
- 697 tests serveur, 172 tests Web, 200 tests Android, tous verts. Une migration : la table des repères.

## 0.5.6.r69 — le lecteur dit ce qu'on regarde, et les génériques se voient

- **Le bandeau du lecteur Android affichait « FlixTunes » pendant tout le film.** Non par choix mais par repli : la réponse qui ouvre une lecture décrit les flux et ne nommait pas le média. Le serveur le nomme désormais, et la mise en forme est celle du lecteur Web — la série en gras, le numéro d'épisode et son titre en dessous.
- **La carte « épisode suivant » quitte le centre de l'écran**, où elle masquait la fin de l'épisode au moment précis où le générique se joue. Elle passe en bas à droite, comme sur le Web, et les deux ont été retravaillées ensemble : surtitre, titre en gras, numéro, et une **jauge qui se vide** pendant l'attente — le temps qui reste se voit plutôt qu'il ne se lit.
- **L'épisode suivant s'annonce dès le générique de fin**, et non l'écran déjà noir. Le départ, lui, ne bouge pas : il reste la fin du média, sans quoi on couperait un générique qu'on regarde peut-être.
- **Un bouton « Passer le générique »** apparaît pendant l'introduction, sur les séries seulement — un film n'en a qu'une, c'est l'épisode qu'on enchaîne vingt fois de suite. Sur un téléviseur il prend le focus : la télécommande n'a pas de curseur.
- **Les deux repères viennent des chapitres du fichier**, pas d'une analyse d'image. Mesuré sur 8 190 épisodes, dont 52 % portent des chapitres : **3 571 (44 %) obtiennent leur générique de fin**, soit 84 % de tout ce que cette approche peut atteindre, et 1 538 leur introduction. La couverture est passée de 17 à 44 % en tolérant les intitulés numérotés (« 8. End Credits ») et en déduisant le générique du **dernier chapitre** quand rien n'est nommé — après 88 % du film et de 20 à 150 s, ces segments durent 42 s en médiane, le profil exact d'un générique. Les garde-fous viennent de la même mesure : les fichiers portent aussi un « Credits » de deux heures et une « Intro » couvrant tout le film.
- **Le harnais de tests Android ne compilait plus** : un cas appelait une fonction restée dans un fichier à composables, que ce harnais écarte par construction. Toute la suite était bloquée derrière. Le raisonnement est sorti de l'activité ; 200 tests tournent à nouveau.

## 0.5.6.r68 — deux séries illisibles sur Android : leurs pistes étaient rangées à la fin

- **Écran noir, aucun son, aucune avance rapide** sur mobile comme sur téléviseur, alors que le Web jouait les mêmes épisodes. Ces trois symptômes ensemble ne désignent pas un codec : le lecteur n'avait tout simplement **aucune piste**.
- **La cause est dans le fichier.** Matroska autorise la définition des pistes à être rangée après les données ; le renvoi posé en tête y mène. Mesuré : deux séries la placent dans leurs **329 et 463 derniers octets**, quand un fichier ordinaire la met vers l'octet 4 000. FFmpeg suit ce renvoi — donc le serveur et le navigateur. Media3 analyse le flux linéairement, atteint les données sans avoir vu la moindre piste, et ne rend rien.
- **Aucune erreur n'était levée**, et c'est ce qui a rendu le défaut invisible : ni repli automatique, ni quarantaine de codec, ni trace dans les journaux. Le module qui décide de tenter la lecture directe réservait déjà ce raisonnement au film muet ; il en existe deux cas, et le second est désormais nommé.
- **Le remède ne coûte rien** : un remux réécrit l'en-tête en tête de flux, l'image et le son restant copiés au bit près. Le serveur mesure où sont les pistes en ne lisant que des en-têtes — 2 à 4 ms, jamais les données.
- **Les versions Android antérieures sont corrigées par le serveur seul.** Un client qui ne déclare pas savoir chercher ces en-têtes est présumé savoir faire — sauf s'il s'annonce mobile ou téléviseur, auquel cas on sait qu'il ne sait pas.
- **Le navigateur garde sa lecture directe** sur ces fichiers : lui imposer un remux ferait travailler le NAS pour rien. Un fichier ordinaire n'est touché sur aucun client. Aucune migration.
- 666 tests serveur et 172 tests Web, tous verts.

## 0.5.6.r67 — le décalage audio tenait à une condition trop étroite

- **Le son suit l'image après un saut, en accès distant.** La r64 refusait de recopier l'E-AC-3 dans un fMP4 uniquement quand la fenêtre avait été ouverte par un saut. Or un déplacement à l'intérieur de ce qui est déjà encodé ne relance aucune session : le flux garde son E-AC-3, et c'est le cas le plus fréquent. Le journal du service l'a montré — sur quatre sessions d'un même film depuis un mobile, trois étaient parties de zéro. La règle ne s'appliquait donc qu'à une session sur quatre ; elle vaut désormais pour toute sortie fMP4.
- **Ce qu'elle épargne, délibérément** : la lecture directe, où l'E-AC-3 part au récepteur tel quel ; le Dolby Atmos, jamais sacrifié ; les segments MPEG-TS, dont la restitution ne montre pas ce défaut. Le nombre de canaux est conservé. Un téléviseur contraint au remux perd en revanche le passage direct vers l'ampli, au profit d'un AAC multicanal.
- **Le flux n'était pas en cause**, et c'est mesuré pour la troisième fois : sur 146 segments d'un remux fMP4, l'écart image/son reste entre 19 et 41 ms sans jamais dériver — la largeur d'une trame E-AC-3. Le décalage naît de la restitution, comme la r53 l'avait établi sur Chrome/Edge.
- **Le serveur dit maintenant ce qu'il décide.** Une ligne par session : mode, codec d'entrée et de sortie de chaque piste, point de départ, conteneur, classe d'appareil. Trois révisions ont été dépensées à deviner ces valeurs, faute de les écrire.
- **Des tests qui exécutent la règle au lieu de la lire.** La r64 n'avait été vérifiée que par lecture de source, et sa condition trop étroite est passée entre les mailles. La règle est extraite en fonction exportée et six cas l'appellent réellement.
- 654 tests serveur et 172 tests Web, tous verts. Aucune migration.

## 0.5.6.r66 — les jaquettes et la lecture reviennent sur mobile en accès distant

- **Les jaquettes s'affichent à distance.** Le chargeur d'images possède sa propre pile HTTP et ne portait aucun titre d'accès : chaque `/api/artwork/…` repartait nu et revenait en 401, si bien que la grille montrait des aplats de couleur pendant que titres et années s'affichaient normalement. Les en-têtes sont désormais posés par un intercepteur qui les relit à chaque requête — fixés une fois, ils resteraient ceux du premier profil ouvert.
- **Construire le lecteur n'efface plus la session.** `PlayerActivity` crée sa propre instance d'API et ne recevait que le jeton de profil : son initialisation remettait celui du compte à `null`, emportant au passage celui dont ExoPlayer se sert pour ses segments. Une instance secondaire cassait donc la session de la première. Elle reprend maintenant le jeton du processus à défaut, et ne publie que ce qu'elle possède.
- **Trois piles HTTP, trois oublis.** Sur Android, l'API, ExoPlayer et le chargeur d'images ont chacun la leur, et l'omission ne se voit jamais sur le réseau local où aucune session n'est réclamée. Cinq tests de cohérence lisent désormais ces sources et vérifient que chaque pile porte les deux jetons.
- **Vérifié dans l'artefact livré**, et pas seulement dans les sources : les deux en-têtes et l'intercepteur figurent dans le dex de l'APK.
- **La lecture n'est pas modifiée.** Direct Play, Dolby Vision, HDR, Dolby Atmos et la reprise restent ceux de r58. Aucune migration.
- 650 tests serveur et 172 tests Web, tous verts.

## 0.5.6.r65 — un profil sans code entre aussi depuis Android

- **Le mobile n'affiche plus « Session requise ».** Même défaut qu'en r64, sur le troisième client : le serveur acceptait déjà d'ouvrir une session sans code, mais Android ne la demandait pas. `unlockProfile` accepte désormais un code facultatif, et le choix d'un profil s'assure d'une session avant de charger l'accueil. Un profil protégé en est écarté : il passe par son écran de code, comme avant.
- **Le Web couvre enfin toutes ses voies.** La demande de session avait été posée à la seule sélection ; un profil restauré au démarrage n'est jamais « sélectionné » et partait lire sans session. Elle vit maintenant dans le chargement de l'accueil, par où sélection, restauration et changement de groupe passent tous.
- **Quatre tests de cohérence lisent les deux clients** et vérifient que chacun demande une session, que le code y est facultatif, et qu'aucun n'en ouvre une pour un profil protégé. Le même oubli s'était manifesté sur trois chemins en quelques heures ; un quatrième client sera signalé par ces tests.
- **À savoir après chaque installation :** l'application Web est servie par un service worker qui préenregistre sa coquille. Le premier chargement sert encore la version en cache, la nouvelle prend au suivant. Un second rechargement avant de conclure à un défaut évite de diagnostiquer un symptôme déjà corrigé.
- **La lecture n'est pas modifiée.** Direct Play, Dolby Vision, HDR, Dolby Atmos et la reprise restent ceux de r58. Aucune migration.
- 648 tests serveur et 172 tests Web, tous verts.

## 0.5.6.r64 — un profil sans code peut entrer, et le son suit après un saut

- **Un profil sans code n'est plus enfermé dehors.** L'accès distant exige une session sur chaque lecture, et le seul moyen d'en obtenir une réclamait un code de quatre à huit chiffres : retirer le PIN d'un profil le rendait inaccessible depuis Internet, avec « Impossible de joindre le serveur » à l'écran. Le serveur lit désormais le profil avant le code et n'exige un PIN que s'il en existe un ; un profil protégé refuse toujours un corps vide.
- **Le décalage audio après un saut : diagnostic refait, et corrigé à la bonne place.** Quatre mesures sur un épisode HEVC + E-AC-3 montrent que l'image et le son démarrent au même instant dans le flux produit — le mécanisme avancé en r63 n'existait pas. La cause est celle que la r53 avait déjà corrigée pour le Web : un E-AC-3 recopié dans un fMP4 se restitue avec du retard, alors même que ses horodatages sont justes. Android avait été explicitement laissé de côté ; il reçoit la même normalisation.
- **La lecture directe n'est pas touchée.** La règle agit après que le mode est arrêté, sur le seul choix de l'encodeur audio : une reprise à vingt minutes envoie `startSeconds` dès la première demande, et un fichier qui a droit au Direct Play le conserve. E-AC-3 seul, fenêtre ouverte par un saut seule, jamais au prix du Dolby Atmos.
- 644 tests serveur et 170 tests Web, tous verts. Contenu du paquet vérifié par extraction.

## 0.5.6.r63 — l'image, le son et les sous-titres restent ensemble après une avance

- **Les sous-titres suivent enfin la fenêtre encodée.** Après un saut hors de la fenêtre, le serveur ouvre une session démarrant au temps `T` du film ; les sous-titres restaient datés dans le temps du film et arrivaient en retard d'exactement la position du saut — un écart qui grandissait à chaque avance. Le lecteur Android transmet désormais le décalage de fenêtre, et le serveur accepte une valeur de la taille d'un film au lieu de la borner à dix minutes, ce qu'il faisait en silence.
- **Le son garde son écart avec l'image en remux.** `-ss` avant `-i` fait démarrer la vidéo à l'image-clé précédant la cible et l'audio à la cible : le multiplexeur ramenait alors chaque piste à zéro séparément, supprimant l'écart réel. `-avoid_negative_ts make_zero` les décale du même montant. Le déplacement reste instantané, `-ss` demeure avant l'entrée.
- **« Retirer le PIN » dit ce qui lui manque.** Le serveur retirait bien le code — vérifié de bout en bout —, mais le bouton restait grisé sans explication tant que le code actuel n'était pas saisi, et le message d'échec s'affichait au bas du panneau, loin du clic. Le bouton reste actionnable et guide ; erreurs et confirmations s'affichent à l'endroit de l'action.
- **Un commentaire qui mentait est corrigé** : `-copyts` était décrit comme conservant les horodatages alors qu'il n'a jamais été passé à FFmpeg.
- **Les groupes en accès distant n'étaient pas un défaut de r62** : la capture datait de r61. Vérifié sur le site en service, l'écran de connexion s'affiche correctement — il ne manque qu'un compte, la liste étant vide.
- **La lecture directe et le transcodage ne sont pas modifiés.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos et la reprise restent ceux de r58. Aucune migration.
- 640 tests serveur et 170 tests Web, tous verts.

## 0.5.6.r62 — la porte a un compte, le catalogue redevient visible, le projecteur relit

- **Une indication de lecture aberrante ne bloque plus la lecture.** Un projecteur annonçait une enveloppe vidéo `0 × 0` — `Display.Mode` ne rapporte parfois aucun mode tant que la surface n'est pas prête — et le serveur refusait toute la demande en 400, avec un « Capacités de lecture invalides » qui ne nommait aucun champ. Ces valeurs sont des indications : une valeur hors bornes est désormais retirée et remplacée par le défaut du schéma, les entrées inconnues d'une liste sont écartées sans faire tomber le reste, et un refus résiduel nomme les champs en cause au client comme au journal.
- **Groupes et profils sont enfin visibles depuis Internet.** Trois filtres exigeaient encore un code PIN d'au moins six chiffres, hérités de l'époque où ce code était le seul rempart. Depuis que la porte est tenue par un compte de connexion à mot de passe, ils ne protégeaient plus rien mais masquaient tout : un foyer n'ayant pas reposé ses codes ne voyait aucun groupe ni aucun profil, sans explication. Le PIN reprend son rôle d'origine — séparer les profils entre eux.
- **Sans compte, l'écoute distante ne rend toujours ni groupe ni profil.** Un test le vérifie explicitement.
- **Le certificat n'exige plus le port 80.** Avec seulement le 443 redirigé, Caddy l'obtient par TLS-ALPN ; le message du diagnostic le dit au lieu de réclamer une redirection inutile.
- **Le contrôle de l'accès distant vérifie l'existence d'un compte** plutôt que la longueur d'un code.
- **La lecture reste strictement celle de r58.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks ne sont pas modifiés. Aucune migration.
- **Les séries animées cessent de faire échouer l'analyse.** La contrainte de provenance des métadonnées énumérait douze sources et le fournisseur AniList n'y figurait pas : chaque anime identifié par lui produisait un « CHECK constraint failed », visible seulement comme un compteur d'erreurs sur la bibliothèque. La liste est désormais construite depuis une constante unique, et la migration qui reconstruit la table a été éprouvée sur l'ancien schéma — lignes préservées, index rétabli, cascade intacte.
- **Le meilleur relevé de capacité survit à une mise à jour.** La signature de calibrage contient la révision du paquet : passer de r60 à r61 classait l'historique sous une clé introuvable, et la mesure prise pendant l'installation s'imposait seule — VA-API annoncé à 396 im/s au lieu de 471. Re-mesurer et oublier sont maintenant deux choses distinctes : la révision déclenche toujours une nouvelle mesure, mais l'historique est classé sur une signature matérielle qui, elle, ne bouge pas.
- 635 tests serveur et 170 tests Web, tous verts.

## 0.5.6.r61 — la mesure redevient juste, et l'accès distant se règle à l'écran

- **Les deux micro-bancs ne se disputent plus le GPU.** Le calibrage des encodeurs et celui du tone mapping partaient ensemble et mesuraient le même nœud de rendu : VA-API tombait à 265 im/s au lieu de 471 pendant que l'encodage logiciel, lui, restait normal. Un tableau montrant le processeur intact et l'accélérateur divisé par deux fait chercher une panne de pilote ; il n'y en avait aucune. Les bancs se suivent désormais, et le tone mapping n'est mesuré qu'après les encodeurs.
- **Une mesure prise pendant une installation n'écrase plus une bonne mesure.** Installer une révision invalidait le calibrage et en déclenchait un pendant que le paquet extrayait deux cents mégaoctets. Pour une même signature, le **meilleur** relevé est conservé : un micro-banc ne peut que sous-estimer, jamais surestimer.
- **Le diagnostic cesse d'accuser à tort le nœud de rendu.** Le tone mapping VA-API était annoncé « /dev/dri non visible » alors que l'encodeur VA-API tournait dans le même processus — l'erreur réelle était `Invalid argument` sur le filtre. Vulkan et OpenCL sont désormais nommés comme des bibliothèques absentes du paquet, pas comme un matériel manquant.
- **Le plafond de conversions se règle, et la machine recommande sa valeur.** Il valait 2, écrit en dur, sur un serveur qui en soutient sept. `auto` suit maintenant la mesure de la machine, et l'écran affiche la recommandation à côté du réglage.
- **L'accès distant se règle depuis l'interface**, dans *Mode expert → Accès depuis Internet*, au lieu d'un fichier atteignable en SSH seulement. Le serveur écrit un fichier que le script de démarrage relit, pour que Node et Caddy lisent la même valeur.
- **Un bouton « Vérifier l'accès distant » contrôle six maillons** — domaine, DNS, concordance avec l'adresse publique, écoute interne, proxy, certificat, profils joignables — et donne pour chacun le geste qui le corrige. Sans lui, l'échec de n'importe lequel produit le même symptôme.
- **Le hors-root aboutit enfin.** Sur cet ADM, `/dev/dri/renderD128` appartient à `root:root` et il n'existe **ni groupe `video` ni groupe `render`** : la bascule de r60 échouait pour cette seule raison, et le filet avait maintenu le service en root sans rien perdre. Le démarrage accorde désormais le périphérique au groupe du compte de service, comme le ferait une règle udev.
- **La lecture reste strictement celle de r58.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks ne sont pas modifiés. Aucune migration.
- 613 tests serveur et 170 tests Web, tous verts.

## 0.5.6.r60 — le terminateur TLS est dans le paquet, et le service quitte root

- **Caddy 2.11.4 est embarqué.** Le script de construction le télécharge, **vérifie sa somme SHA-512** contre le fichier publié et l'extrait dans `runtime/caddy`, comme il le fait déjà pour Node.js et FFmpeg. Rien à installer sur le NAS, et rien de 16 Mo à transporter sur le partage réseau.
- **Le service ne tourne plus en root.** Un compte `flixtunes` est créé à l'installation, ajouté aux groupes `video`, `render` et `input`, et reçoit la propriété du partage persistant. C'est ce qui rend la lecture seule vérifiable par le système plutôt que promise par le programme : jusqu'ici, rien n'empêchait FlixTunes d'effacer la médiathèque.
- **La bascule ne peut pas coûter l'accélération en silence.** Une sonde vérifie, en se plaçant sous le compte cible, que `/dev/dri/renderD128` reste lisible et que le partage reste inscriptible ; un seul échec et le service démarre en root avec la raison écrite dans `logs/privileges.log`. Si le démarrage non privilégié échoue malgré la sonde, le service repart en root. Le pire cas est le comportement de r59.
- **L'installation ne peut pas échouer à cause de ça.** Un ADM dépourvu de `useradd` et d'`adduser` produit une installation qui fonctionne, en root, avec la raison au journal — jamais une installation refusée.
- **Sortie de secours sans réinstaller :** `FLIXTUNES_RUN_AS=root` dans la configuration rétablit le comportement antérieur.
- **Le paquet refuse desormais de livrer un binaire non executable.** Windows ne porte pas ce bit : une liste blanche le retablit a l'empaquetage, et Caddy y manquait — le paquet se serait installe parfaitement et l'acces distant n'aurait jamais demarre. La validation controle maintenant chaque binaire declare, pour celui-ci comme pour tout binaire ajoute plus tard.
- **La lecture reste strictement celle de r58.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks ne sont pas modifiés. Aucune migration.
- **Le hors-root n'a pas encore tourné sur le NAS.** Il est écrit et doublement protégé, mais aucune de ses lignes n'a été exécutée sur l'AS5404T. `docs/VALIDATION_0.5.6_R60.md` donne l'ordre d'installation qui permet de l'observer étape par étape, et la sortie de secours si VA-API venait à manquer.

## 0.5.6.r59 — une seconde porte, qui ne laisse passer presque rien

- **Le serveur écoute désormais à deux endroits, et le réseau local ne change pas d'un octet.** L'accès distant est une seconde instance du serveur dans le même processus, avec ses propres contrôles : ce qui est posé sur l'une n'affecte pas l'autre. Les 604 tests serveur existants passent sans modification.
- **Rien n'est activé par défaut.** Sans `FLIXTUNES_WAN_DOMAIN`, il n'y a ni seconde écoute, ni port lié, ni certificat demandé. Une mise à jour ne peut pas ouvrir l'extérieur par effet de bord.
- **La surface distante est une liste blanche de motifs de routes.** Tout ce qui n'y figure pas répond `404` — et non `403` : de l'extérieur, une administration interdite doit être indiscernable d'une administration inexistante. Bibliothèques, configuration initiale, parcours de disque, sauvegardes, analyses, corrections, fournisseurs, diagnostic et télécommande ne sont jamais joignables.
- **Toute route ajoutée plus tard sera refusée d'office.** Le filtrage porte sur le motif enregistré par Fastify, pas sur l'URL, et un test refuse toute route qui n'aurait pas été explicitement ouverte ou fermée. Il a d'ailleurs trouvé deux routes que l'inventaire manuel avait manquées.
- **Une session est exigée sur chaque requête distante, flux vidéo et jaquettes compris.** Le jeton passe par en-tête ou par cookie `HttpOnly; Secure; SameSite=Strict` — le cookie est indispensable, `<video>`, `<img>` et `<track>` ne pouvant porter aucun en-tête.
- **Les sessions survivent au redémarrage et sont révocables.** Elles vivaient dans une table en mémoire. Seule l'empreinte du jeton est enregistrée : une sauvegarde qui sortirait de la maison ne donne accès à rien.
- **Le profil est imposé par la session.** Un jeton valide pour un profil ne donne plus accès à la progression, à la liste ni aux recommandations d'un autre en changeant un paramètre de requête.
- **Le code PIN devient sérieux à distance.** Six chiffres minimum, profils moins protégés invisibles, cinq essais par source puis une attente qui double — une heure à partir du onzième échec. Le compteur est persisté : un redémarrage ne le remet pas à zéro. Changer un PIN exige désormais l'ancien, et révoque les sessions ouvertes.
- **Le paquet ASUSTOR sait piloter un terminateur TLS.** `start-stop.sh` mène deux processus dans l'ordre, engendre la configuration du proxy depuis le domaine, place le stockage des certificats dans le partage persistant — jamais dans le dossier du paquet, qu'une mise à jour remplace — et distingue « réseau local vivant, accès distant tombé » d'un arrêt complet.
- **Le lecteur Android porte le jeton sur sa propre pile HTTP.** Sans cela, manifeste, segments et sous-titres seraient partis sans titre d'accès : la vidéo aurait échoué pendant que le catalogue s'affichait.
- **Android impose TLS hors du réseau local.** Une adresse privée ou `.local` garde `http`, comportement inchangé ; une adresse publique passe en `https` et un `http://` explicite y est refusé.
- **Aucune dépendance ajoutée**, et aucune migration destructive : trois ajouts de schéma purement additifs. Les médias, profils, progressions, états vus, personnes, crédits et réglages r58 sont conservés.
- **Conséquence à connaître :** aucun profil existant n'est joignable à distance tant que son code n'a pas été reposé à six chiffres. Exposer un profil sur Internet doit être un geste, pas un héritage.
- **La lecture reste strictement celle de r58.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks ne sont pas modifiés.
- **Restent à exécuter**, listés dans `docs/VALIDATION_0.5.6_R59.md` : le passage du service hors-root, le binaire Caddy à embarquer, et la chaîne complète avec certificat réel.

## 0.5.6.r58 — définitions cinémascope exactes et grille Android TV moins chargée

- **Les films cinémascope gardent leur vraie famille de définition.** Le calcul croise désormais les deux côtés de l'image : `1920×804` et `1916×800` sont annoncés 1080p, `3840×1606` est annoncé 4K et `1280×536` reste 720p. Une définition atypique comme `1600×900` conserve le libellé honnête 900p.
- **Le même calcul alimente la fiche et les informations de lecture.** Le Web, Android, Android TV et le serveur ASUSTOR ne peuvent plus présenter deux résolutions différentes pour le même fichier. Les métadonnées déjà analysées suffisent : aucune réanalyse de bibliothèque ni migration n'est nécessaire.
- **La prélecture TV suit réellement la dernière jaquette visée.** Une file conflated oublie les positions intermédiaires pendant un maintien D-pad ; le travailleur termine au plus un bitmap périmé puis reprend à la position la plus récente. Il n'existe ni arriéré de décodages ni rafale de tâches annulées/recréées.
- **Un seul décodage opportuniste concurrence le rendu.** Les deux travailleurs R57 deviennent un seul travailleur TV. La rangée suivante continue de se préparer pendant le déplacement, mais le SoC conserve davantage de temps CPU pour Compose et le GPU.
- **Les cartes ordinaires dessinent moins.** L'initiale de secours n'est plus mise en page sous chaque affiche déjà chargée, et le relief de focus TV ne maintient plus un calque de transformation sur chaque carte non focalisée. Le liseré blanc, l'agrandissement 1,06 et le premier appui OK restent présents.
- **Les textures TV diminuent légèrement, sans changer le format couleur.** Les largeurs passent de 224/256/288 à 208/240/272 px selon la mémoire, soit environ 12 % par axe et près d'un quart de pixels en moins par rangée. Les cartes, les bandeaux, l'ARGB complet et le dimensionnement automatique mobile/tablette restent inchangés.
- **Aucune donnée ni lecture n'est touchée.** Direct Play, Dolby Vision, HDR10+, Dolby Atmos, pistes, reprise, commandes du lecteur, profils, états vus et artefacts R57 restent intacts.

## 0.5.6.r54 — Dolby Vision sans SEI concurrent et catalogue Android TV préparé au démarrage

- **Lucky reste en Direct Play mais ne transmet plus le message HDR10+ à MediaCodec.** R53 modifiait uniquement `application_identifier` ; le décodeur du téléviseur reconnaissait encore le fournisseur Samsung et activait HDR10+ Adaptive. R54 analyse chaque message SEI et retire intégralement le SMPTE ST 2094-40.
- **Dolby Vision et les autres données HDR sont préservés.** Un NAL exclusivement HDR10+ disparaît ; dans un NAL mixte, seul ce message est retiré. Les RPU Dolby Vision 62/63, les autres SEI, le HEVC compressé, l'audio, les PTS et le conteneur ne sont pas réencodés.
- **Le diagnostic matériel devient récupérable sans ADB.** Un journal R54 temporaire et borné à vingt essais enregistre après sept secondes le codec, ses formats d'entrée/sortie, les RPU conservés et les SEI/octets retirés. Aucun chemin de fichier ni jeton n'y entre.
- **Android TV prépare le catalogue une fois au choix du profil.** Les métadonnées Films et Séries sont entièrement chargées en parallèle, puis les 48 premières affiches sont décodées avant l'ouverture. Le reste chauffe le cache disque une image à la fois en arrière-plan.
- **La navigation ne rencontre plus de raccord de page.** Une fois le catalogue en mémoire, l'index A–Z positionne directement la première jaquette voulue sans appel réseau ; la grille Compose reste paresseuse et ne compose que l'écran visible.
- **Mobile et tablette gardent leur chemin léger.** Pages de 60, démarrage, gestes, cache et définition restent inchangés ; le préchargement intégral est strictement réservé au mode Android TV.
- **Aucune donnée ni ancienne livraison n'est remplacée.** Le journal est en mémoire seulement, aucune migration n'est ajoutée, et R53/R52/R51 restent intacts.

## 0.5.6.r53 — synchronisation Web, Dolby Vision Direct Play vérifiable et grille TV anticipée

- **The Drama joue la VF sans décalage sur le Web.** Le fichier et ses pistes sont alignés à 0 ms ; le retard venait de l’E‑AC‑3 secondaire recopié dans MediaSource/fMP4. La vidéo reste copiée sans perte, mais cette seule piste secondaire est désormais normalisée en AAC synchronisé pour Chrome/Edge. Android conserve sa sélection multipiste Direct Play intacte.
- **Lucky privilégie Dolby Vision sans quitter le Direct Play.** Le filtre ne dépend plus d’une ancienne valeur `availableHdrFormats` de la bibliothèque et couvre les décodeurs que le constructeur expose comme `video/hevc` après adaptation de la couche Dolby Vision.
- **Les métadonnées concurrentes sont traitées avant et pendant le décodage.** Les blocs d’initialisation du codec et chaque échantillon HEVC sont inspectés ; seul l’identifiant HDR10+ SMPTE ST 2094-40 est neutralisé. Le RPU Dolby Vision, la vidéo compressée, le MKV, l’audio et tous les timestamps restent ceux de la source.
- **Le résultat devient observable.** Le panneau Infos ne dit plus seulement que Media3 reconnaît la piste : il affiche le nombre de signaux HDR10+ réellement neutralisés pendant la session Dolby Vision.
- **La navigation Films/Séries anticipe le pouce sur Android TV.** Les deux à trois rangées suivantes sont décodées en arrière-plan à une définition légèrement supérieure à leur taille d’affichage, les pages TV passent de 60 à 120 fiches et la page suivante arrive quatre rangées plus tôt. Mobile et tablette gardent leurs pages de 60.
- **Le focus TV ne maintient plus un collecteur asynchrone par jaquette.** Son liseré et son agrandissement restent identiques, mais l’état est reçu directement par le nœud de focus ; des dizaines de coroutines disparaissent du chemin de défilement.
- **Aucune donnée ni ancienne livraison n’est modifiée.** R53 n’ajoute aucune migration et ne remplace aucun artefact R52/R51.

## 0.5.6.r52 — la bonne langue sur le Web et Dolby Vision prioritaire en Direct Play

- **La VF Web correspond enfin à la piste cochée.** Chrome et Edge ne savent pas imposer une piste audio secondaire dans un MKV servi entier : *The Drama (2026)* affichait donc Français tout en jouant la première piste anglaise. Le Web négocie désormais un remux sans perte lorsque la piste demandée n’est pas la première ; l’image et la VF E-AC-3 5.1 sont copiées bit pour bit lorsque le navigateur annonce ce codec compatible.
- **Le Direct Play reste utilisé partout où il peut honorer la piste.** Un média à piste unique ou dont la piste voulue est la première reste direct. Android conserve toujours son Direct Play multipiste, puisque Media3 sait y sélectionner réellement la langue.
- **Lucky et Astérix ne sont pas le même cas Dolby Vision.** Les deux fichiers sont des MKV Dolby Vision profil 8.1, mais *Lucky S01E01* contient aussi une signature HDR10+ à chaque image testée, tandis qu’Astérix n’en contient aucune.
- **Dolby Vision gagne maintenant sans quitter le Direct Play Android.** Lorsque la préférence est Dolby Vision sur un master hybride, FlixTunes neutralise uniquement l’identifiant HDR10+ des NAL SEI juste avant le décodeur. Le HEVC compressé, le RPU Dolby Vision, le MKV, les horodatages et l’audio restent ceux du fichier ; il n’y a ni remux serveur ni réencodage.
- **Les fichiers Dolby Vision simples restent bit pour bit intacts.** Le filtre ne s’active que sur une source déclarée Dolby Vision + HDR10+ en lecture directe avec sortie Dolby Vision. Astérix traverse donc exactement le chemin Direct Play déjà validé.
- **Le choix HDR10+ à la volée reste disponible.** Le filtre Dolby Vision est désactivé dès que HDR10+ ou une autre plage est choisie ; l’ordre global Dolby Vision → HDR10+ → HDR10 → HLG → SDR est conservé.
- **Les artefacts R51 ne sont ni remplacés ni modifiés.** R52 ajoute ces deux corrections ciblées sans migration de données.

## 0.5.6.r51 — audio fidèle, Dolby Vision complet et navigation TV maîtrisée

- **Le choix audio Web appartient désormais au média, pas au seul profil.** Un numéro de piste mémorisé sur un film ne peut plus sélectionner par accident la VO d’un autre fichier. *The Drama (2026)* choisit sa piste française `fre` E‑AC‑3 5.1 (index 2), jamais l’audiodescription, et le changement reste immédiat sans repartir de zéro.
- **Android conserve son sélecteur audio validé sur téléviseur.** Les équivalences `fr`/`fra`/`fre`, l’ordre du profil, le multicanal et l’exclusion de l’audiodescription restent testés ; aucun stockage d’index global au profil n’existe sur Android.
- **Le remux Dolby Vision écrit réellement sa configuration.** En plus du FourCC `dvh1`, FFmpeg reçoit l’autorisation ciblée nécessaire pour produire `dvcC`/`dvvC`. Le RPU n’est plus présent mais invisible : Media3 et la dalle peuvent activer Dolby Vision au lieu de retomber sur HDR10+ Adaptive.
- **Les masters hybrides exposent tous leurs formats.** *Lucky S01E01* est détecté Dolby Vision profil 8.1 avec couche HDR10 et métadonnées HDR10+ ; le menu Image propose Dolby Vision et HDR10+ lorsque l’appareil les accepte.
- **Dolby Vision ↔ HDR10+ se change à la volée.** Le lecteur redemande un remux à la seconde courante, sans réencoder l’image : `dvh1` + `dvcC/dvvC` pour DV, `hvc1` pour demander la couche HDR10+ du même flux.
- **Le maintien Bas ne pilote plus A–Z.** Bas redevient toujours une navigation de grille ; l’index latéral droit reste le seul outil alphabétique et continue de positionner la première jaquette sans filtrer.
- **La timeline TV possède un vrai mode de focus.** Hors commandes, Gauche/Droite garde le transport direct ; dans les commandes, les flèches naviguent entre les boutons, sauf sur la timeline où elles reculent/avancent. Le focus de la barre est redemandé sur plusieurs images afin de ne plus laisser Lecture/Pause visuellement sélectionné.
- **Les catalogues TV font encore moins de travail concurrent.** Précomposition et chargements de pages sont resserrés uniquement sur Android TV ; téléphone et tablette conservent leurs fenêtres, gestes, dimensions et qualité d’image.
- **Les livrables antérieurs restent intacts.** R51 n’ajoute aucune migration destructive et ne remplace aucun APK/APKG R50.

## 0.5.6.r50 — navigation TV fiable et sous-titres vraiment réglables

- **La descente A–Z déplace désormais les films pendant le maintien.** La lettre affichée et les jaquettes avancent ensemble, sans attendre le relâchement ; dans l’index latéral, une courte pause sur une lettre positionne immédiatement sa première jaquette sans filtrer le catalogue.
- **Retour rend le focus à la jaquette ouverte.** Une demande de focus n’est plus considérée comme réussie avant la confirmation d’Android, et la poignée A–Z reste temporairement hors du parcours pendant cette restitution.
- **Le lecteur TV place le focus visuel sur la barre pendant ←/→.** Les sauts restent cumulés et OK continue d’alterner lecture/pause, mais le bouton lecture ne paraît plus sélectionné lorsqu’on navigue dans le film.
- **Les sous-titres se règlent à la volée.** Android, Android TV et tablette proposent petite/normale/grande, fond transparent par défaut ou sombre, et texte blanc, jaune, cyan ou vert. Le choix est conservé par profil sur l’appareil et n’interrompt pas la lecture.
- **Le Web reçoit les mêmes choix de taille, fond et couleur.** Ils sont mémorisés avec la préférence de sous-titre du média ; la migration ajoute uniquement la couleur et conserve les réglages existants.
- **Android TV compose encore moins de jaquettes hors écran.** Les réserves de grilles, rails et listes sont resserrées ; définition des affiches, cache mémoire/disque, mise à l’échelle et qualité vidéo restent identiques.
- **Dolby Vision n’est pas renégocié à l’aveugle.** Le chemin validé, le remux `dvh1`, Dolby Atmos et les replis HDR restent inchangés. « Infos lecture » indique désormais le profil source et si Media3 reconnaît réellement le signal Dolby Vision ou expose une couche de base.
- **La migration reste additive et les livrables antérieurs restent intacts.** Aucune table ni donnée n’est supprimée ; Android, Android TV et ASUSTOR annoncent tous `0.5.6.r50` sans remplacer les artefacts r49.

## 0.5.6.r49 — des groupes familiaux et un vrai espace enfant

- **L’ouverture commence par les groupes, puis les profils du groupe choisi.** Le parcours est identique sur Web, Android, tablette et Android TV ; Retour depuis les profils remonte aux groupes sans déconnecter le serveur.
- **Les groupes se gèrent depuis les clients.** Ajout, renommage et suppression sont disponibles ; le serveur empêche de supprimer un groupe encore occupé ou le dernier groupe.
- **Un profil peut devenir un compte enfant avec un âge de 0 à 17 ans.** L’âge est obligatoire tant que la case Enfant est cochée et reste visible sur la carte du profil.
- **Le contrôle parental est appliqué par le serveur.** Accueil, films, séries, recherche globale, recommandations, genres, collections, filmographies, fiches, listes et accès directs au lecteur excluent les œuvres classées au-dessus de l’âge autorisé ; un simple contournement d’interface ne suffit donc pas.
- **Les classifications suivent le pays du profil.** TMDB fournit les classifications cinéma et TV, normalisées pour les libellés français et internationaux. Un contenu réellement non classé reste visible : aucune limite arbitraire n’est inventée.
- **Les bibliothèques existantes sont complétées sans être réécrites.** La première analyse R49 rattrape uniquement la classification manquante en réutilisant l’identité fournisseur déjà connue ; titres corrigés, correspondances manuelles, affiches et fichiers restent intacts.
- **Les anciens profils rejoignent automatiquement `Famille`.** La migration est additive : groupes, âge et classification ajoutent des colonnes/tables, sans supprimer médias, progressions, états vus, listes, crédits ou réglages.
- **Le lecteur reste celui qui a été validé.** Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise, seeks et fluidité r48 ne sont pas modifiés ; seul le contrôle d’accès au média du profil sélectionné est ajouté.
- **Les révisions précédentes restent intactes.** Android, Android TV et ASUSTOR annoncent tous `0.5.6.r49`, sans remplacer les artefacts r48.

## 0.5.6.r48 — l'alphabet se voit, la vidéothèque TV respire

- **Le saut A–Z garde réellement le catalogue autour de la cible.** Android TV et Web positionnent la première jaquette de la lettre demandée, tout en laissant les titres précédents et suivants accessibles ; les pages se chargent dans les deux sens et la réglette Web reste utilisable à la souris.
- **Le retour Android retrouve la jaquette ouverte.** Fermer une fiche rend le focus et le rang de grille exacts, sans rejouer la remise à zéro réservée à un changement de filtre.
- **Maintenir Bas affiche la lettre parcourue.** Un grand repère lisible confirme `A`, `B`, `C`… à mesure du maintien, avec une cadence de 220 ms. Le catalogue effectue un seul saut au relâchement au lieu d'empiler des appels réseau à chaque répétition ; un appui bref descend toujours d'une rangée et Droite ouvre toujours l'index complet.
- **Le travail hors écran est fortement réduit sur Android TV.** Les grilles et les huit rails d'accueil ne précomposent plus jusqu'à un écran ou une demi-rangée de jaquettes chacun : une réserve courte amorce la rangée suivante sans mettre en concurrence des dizaines de mesures et décodages avec le focus visible.
- **Le focus TV garde le même rendu, sans animation intermédiaire.** L'agrandissement `1,06`, le liseré blanc et le premier OK restent identiques, mais ils s'appliquent immédiatement ; les animateurs et l'onde tactile inutiles à la télécommande ne sont plus créés sur chaque carte.
- **Les recompositions de jaquettes allouent moins.** Les libellés secondaires et initiales de secours sont calculés une fois, tandis que Coil garde le même décodage, le même cache disque/mémoire et la même définition d'image.
- **Les pictogrammes demandés sont inclus.** Films utilise le clap `🎬` et Séries TV le téléviseur `📺` dans la navigation tactile.
- **L'APK principal est optimisé et installable.** En plus du debug de diagnostic et du release non signé, la livraison contient un release R8 signé avec la même clé de mise à jour locale : c'est celui à installer sur Android TV pour éviter le surcoût d'une construction debug.
- **La lecture reste strictement celle de r46.** Le Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, la reprise et les seeks ne sont pas modifiés ; le fichier témoin *Astérix et Obélix : L’Empire du Milieu* (2023), déjà lu en Dolby Vision, garde exactement son chemin validé.
- **Aucune migration ni suppression.** Les médias, profils, progressions, états vus, personnes, crédits et réglages r47 sont conservés ; les artefacts antérieurs ne sont pas remplacés. Android, Android TV et ASUSTOR annoncent tous `0.5.6.r48`.

## 0.5.6.r47 — A–Z devient un index, sur TV comme sur le Web

- **A–Z ne filtre plus volontairement le catalogue.** Une lettre demande directement son rang au serveur plutôt que de charger toutes les pages précédentes.
- **Le même index est accessible à la souris sur le Web.** La réglette `# · A–Z` est fixée sur le bord droit des catalogues Films et Séries et reste utilisable au clavier.
- **La pagination part du rang absolu atteint.** Android et Web demandent la suite au bon décalage et conservent un total exact après un saut alphabétique.
- **Android TV anticipe les prochaines jaquettes.** Les cellules gardent leur type stable, Coil conserve sa définition d'image et seule la carte à restaurer crée un `FocusRequester`.
- **L'APK principal est livré en release R8 signée.** Les variantes debug et release non signée restent disponibles pour le diagnostic et une signature externe.
- **La lecture reste strictement celle de r46.** Dolby Vision, HDR, Dolby Atmos, reprise et seeks ne sont pas modifiés.
- **Aucune migration ni suppression.** Les médias, profils, progressions, états vus, personnes, crédits et réglages r46 sont conservés ; Android, Android TV et ASUSTOR annoncent tous `0.5.6.r47`.

## 0.5.6.r46 — une vidéothèque instantanée, humaine, et réellement Dolby Vision

- **Les fiches relient désormais les œuvres à leurs talents.** Films et séries affichent distribution, réalisateurs, créateurs, scénaristes et compositeurs ; sélectionner une personne ouvre tous ses films et séries présents dans la bibliothèque, sans dépendre d'un catalogue extérieur.
- **La recherche globale comprend la médiathèque.** Un nom d'acteur ou de réalisateur, un genre et une collection/saga retrouvent désormais les titres concernés, accents compris. Les crédits sont indexés séparément : aucune jointure supplémentaire ne ralentit les grilles lorsqu'on ne recherche rien.
- **Le menu rapide rejoint les usages d'une vraie TV.** Clic droit sur le Web et appui long sur Android, tablette ou TV donnent Lecture/Reprendre, Informations, Vu/Non vu et Ma liste sans alourdir chaque jaquette.
- **Le retour remet exactement où l'on était.** Fermer une fiche sans lancer la lecture conserve le défilement et rend le focus à la même affiche. À l'ouverture d'une fiche TV, Lecture/Reprendre reçoit immédiatement le focus : un seul OK démarre.
- **Un index A–Z latéral parcourt instantanément les grandes bibliothèques TV.** La poignée de droite, le maintien droite ou le maintien bas ouvrent l'alphabet ; une lettre demande directement sa page au serveur au lieu de charger toutes celles qui la précèdent. Un appui droit bref reste une navigation normale entre affiches.
- **Dolby Vision est livré comme Dolby Vision.** Android rattrape les pilotes DV qui omettent leurs profils en n'annonçant que celui du fichier, privilégie explicitement DV, puis remultiplexe sans réencoder si Media3 confond la piste avec HEVC. La sortie fMP4 porte désormais l'entrée `dvh1`, afin que la dalle active Dolby Vision au lieu de HDR10+ Adaptive ; les données vidéo et Dolby Atmos restent copiées.
- **Android TV fait moins de travail par affiche.** Les modèles de catalogue sont stables, les cellules de grille sont réutilisées par type, les pinceaux de jaquette sont mémorisés, les pages suivantes sont anticipées et l'animation de focus est raccourcie à 45 ms. La définition finale des affiches et la qualité vidéo ne changent pas.
- **Compatibilité r45 conservée.** Transport télécommande r44, reprise exacte et réarmement HDR r43, préférences HDR, états vus, profils, médias et réglages restent en place. Les nouvelles tables personnes/crédits sont uniquement additives ; Android, Android TV et ASUSTOR annoncent tous `0.5.6.r46`.

## 0.5.6.r45 — la meilleure image disponible, et des bibliothèques qui se cochent

- **La préférence HDR appartient au profil, sur Android, TV et Web.** Automatique suit l'ordre Dolby Vision → HDR10+ → HDR10 → HLG → SDR ; un choix précis prime seulement lorsqu'il existe réellement dans la vidéo et sur l'appareil, puis retombe sans écran noir sur cet ordre.
- **Le menu Image du lecteur devient un choix radio contextuel.** Il ne montre que les sorties contenues dans le fichier ou sa couche de base — par exemple Dolby Vision profil 8, HDR10 puis SDR — et un changement relance la session à la seconde exacte où elle se trouvait.
- **Dolby Vision n'est plus promis au hasard.** Lorsqu'un pilote omet ses profils, Android vérifie le profil Dolby Vision et la définition du fichier auprès du décodeur système ; sinon il utilise la couche HDR10/HLG déclarée. Le panneau Infos affiche désormais la chaîne réelle, par exemple `Dolby Vision → HDR10`.
- **Films, épisodes, saisons et séries se marquent vus.** L'action est transactionnelle pour tous les fichiers concernés, fonctionne sur Android comme sur le Web et conserve l'isolation entre profils. Une saison n'affecte pas les autres ; une série n'est vue que lorsque tous ses épisodes disponibles le sont.
- **Les jaquettes confirment l'état.** Une coche `✓ Vu` apparaît en bas à droite des films vus et des séries entièrement vues, dans les rails comme dans les grilles et les filtres Vus/Non vus.
- **Android TV parcourt les affiches plus vite sans les dégrader.** Les bitmaps sont réutilisés entre rails à taille visuelle équivalente, le cache mémoire TV est renforcé, le fondu simultané de grandes textures est supprimé sur TV et le focus suit la télécommande en 85 ms. Les images finales et la qualité vidéo restent inchangées.
- **Le transport r44 reste intact.** Les appuis gauche/droite et leur maintien cumulé, OK lecture/pause, les panneaux et la hiérarchie Retour ne sont pas réécrits après leur validation sur téléviseur.
- **Migration uniquement additive.** La base reçoit seulement la préférence HDR du profil avec `auto` par défaut ; les progressions r44, médias, profils, réglages, Dolby Atmos et reprises exactes sont conservés. Android, Android TV et ASUSTOR annoncent tous `0.5.6.r45`.

## 0.5.6.r44 — le lecteur se commande sans mode d'emploi

- **La télécommande pilote d'abord le film.** Gauche et droite reculent ou avancent de dix secondes, même lorsque la garniture est affichée ; les appuis rapprochés se cumulent sans attendre le rafraîchissement de l'image. OK alterne lecture et pause, et les touches matérielles Lecture/Pause gardent chacune leur sens exact.
- **Les options TV restent toutes accessibles.** Haut ou bas entre dans le parcours focalisé des pistes, de la qualité, de l'image, de la vitesse, du minuteur et des informations. Dans un panneau, la croix et OK redeviennent une navigation classique ; hors panneau, elles reprennent immédiatement leur rôle de transport.
- **Retour ne quitte plus le film par surprise.** Le premier appui ferme le panneau ouvert, le suivant retire les commandes, et seul un retour sur l'image nue ferme le lecteur. La même hiérarchie couvre la touche de télécommande, le bouton Android et le geste système.
- **Le tactile distingue enfin l'image des commandes.** Une tape sur l'image affiche ou masque la garniture ; un double geste à gauche ou à droite cumule les sauts de dix secondes et confirme `−10 s`, `+20 s`… sans intercepter les boutons visibles.
- **Lecture/Pause devient la cible centrale sur téléphone et tablette.** Les commandes de transport ne sont plus tassées avec les réglages secondaires ; la barre conserve une zone de saisie de 56 dp et les épisodes précédent/suivant restent accessibles même en portrait.
- **La recherche locale Films/Séries se range comme les genres.** Elle est repliée par défaut, conserve et résume toute requête active, et peut être effacée sans toucher à la recherche globale de l'application.
- **Aucun changement de lecture ou de données.** La reprise exacte, le réarmement HDR après seek direct, Dolby Vision, Atmos et la négociation de qualité de r43 ne sont pas modifiés. Aucun schéma, média, profil ni réglage n'est migré ; Android, Android TV et ASUSTOR annoncent tous `0.5.6.r44`.

## 0.5.6.r43 — reprendre à la bonne seconde et garder le HDR après un seek

- **Play reprend à la seconde réellement laissée.** Le serveur transmet maintenant la position et la durée exactes en plus du pourcentage historique. Android les utilise avec le recul configuré, sans arrondi à une minute près sur un long film.
- **La lecture directe ne confond plus « cible demandée » et « seek déjà effectué ».** Une URL directe expose toujours le fichier depuis zéro : r42 marquait pourtant la reprise comme appliquée dès que le serveur recevait une cible, puis Media3 démarrait à 0. Les fenêtres remuxées/transcodées, qui commencent réellement à leur offset, conservent leur chemin optimisé.
- **Une reprise ou un seek n'écrase plus la progression avec le temps local du segment.** Les sauvegardes périodiques, la pause et la recréation Android convertissent toutes la position du flux en temps absolu du film avant de l'envoyer au profil.
- **Le HDR direct se réarme après avance ou retour de dix secondes.** Sur les téléviseurs dont le décodeur perd son état colorimétrique lors d'un flush, Media3 recrée uniquement son renderer vidéo à la position visée. Le même média, la même piste et le même passthrough audio restent sélectionnés : l'Atmos déjà fonctionnel n'est pas renégocié côté serveur.
- **Un repli compatible ne signifie plus automatiquement SDR.** L'écran continue d'annoncer HDR10, HDR10+, HLG ou Dolby Vision pendant un remux/réencodage ; le serveur conserve la plage dynamique en HEVC 10 bits lorsqu'elle est réellement décodable et ne tone-map vers SDR qu'en dernier recours.
- **Dolby Vision exige désormais les deux bouts de la chaîne.** Il n'est annoncé que si l'écran et un décodeur `video/dolby-vision` existent. Les profils MediaCodec sont traduits en profils Dolby Vision 4 à 10, au lieu de promettre en bloc 5/7/8/9 ; une couche HDR10/HLG compatible reste le repli sans perte de définition.
- **La qualité maximale compatible reste la règle.** AV1, HEVC, HDR10/10+, HLG, Dolby Vision, Atmos, DTS:X et TrueHD continuent d'être négociés depuis les capacités réelles. Une quarantaine codec s'applique désormais aussi au plan colorimétrique et à l'encodeur final, ce qui évite de reproduire après seek l'échec qui l'a déclenchée.
- **Aucune migration de données.** Les champs de progression exacts sont additifs, les anciens clients gardent le pourcentage, les réglages et l'ergonomie P0–P3 de r42 restent inchangés. Android, Android TV et ASUSTOR annoncent tous `0.5.6.r43`.

## 0.5.6.r42 — Android plus clair au doigt, sans perdre la télécommande

- **Changer de profil ne déconnecte plus le serveur.** La pastille du profil revient à l'écran « Qui regarde ? » en conservant le NAS actif ; « Changer de serveur » reste la seule action qui efface la connexion.
- **Le plein écran appartient au film.** Les écrans de connexion, profils, accueil, catalogues et fiches respectent de nouveau les barres système Android ; seul le lecteur conserve le mode immersif.
- **Les petits écrans ne tassent plus les commandes.** La barre supérieure, les actions de fiche, les badges, les formulaires et les réglages du lecteur se réorganisent selon la largeur. Les formulaires défilent au-dessus du clavier et la recherche reçoit directement la saisie.
- **Tablettes et écrans pliables ont leur propre gabarit.** À partir de 600 dp, marges, cartes, grille, vitrine et commandes exploitent la surface dépliée sans activer le focus propre aux téléviseurs ; une rotation ou un dépliage recalcule immédiatement le gabarit.
- **Ouvrir une fiche puis revenir ne fait plus perdre sa place.** Accueil, historique, films, séries et recherche conservent leur défilement. Au retour du lecteur, la fiche et l'accueil relisent silencieusement la progression courante.
- **TalkBack nomme les gestes utiles.** Cartes, couleurs de profil, saisons, épisodes, pistes, commandes du lecteur et barre de progression portent désormais rôle, état et action ; les principales cibles tactiles atteignent au moins 48 dp sur mobile.
- **Un chargement ou une panne de lecture ne ressemble plus à un écran noir.** Le lecteur affiche un état persistant, propose « Réessayer » et « Mode compatible », et conserve le titre ainsi que les voisins de l'épisode lors de la lecture automatique.
- **L'épisode suivant ne démarre plus sans prévenir.** Un compte à rebours de dix secondes annonce le titre suivant et propose « Lire maintenant » ou « Annuler » ; sur TV, le focus arrive directement sur l'action principale. La limite sans interaction de r41 reste appliquée.
- **Les réglages de lecture sont enfin modifiables depuis Android et Android TV.** Langues audio, sortie, sous-titres, normalisation, mode nuit, reprise, vitesse et lecture automatique enregistrent les préférences du profil déjà prises en charge par le serveur, sans toucher à son identité ni à son PIN.
- **Une coupure ne vide plus l'écran.** Les contenus déjà chargés restent en place, le message explique leur disponibilité et « Réessayer » relance uniquement la surface visible.
- **La grille TV montre davantage de fiches sans rapetisser les textes.** Elle vise quatre colonnes à 720 dp, six à 960 dp et huit à 1280 dp ; les rails restent légèrement plus larges. Le focus visible, le premier appui « OK », la croix directionnelle et les touches média restent gouvernés par le mode TV, tandis que les adaptations tactiles ne s'y activent pas.
- **Android, Android TV et ASUSTOR annoncent tous 0.5.6.r42.** Le paquet ASUSTOR ne change ni les données ni le serveur par rapport à r41 ; sa révision est alignée pour rendre le couple client/serveur identifiable.

## 0.5.6.r41 — un seul « OK », un panneau de pistes, et des filtres qui se rangent

- **Un bouton de téléviseur répond au premier appui.** Il en fallait deux, et la raison n'était pas dans la télécommande : l'indication de focus ajoutait son propre `focusable()` à des éléments qui l'étaient **déjà** — un `clickable` l'est par construction, un `Button` de Material aussi. Chaque bouton portait donc deux cibles de focus empilées dans la même chaîne : celle qui dessine le liseré, et celle qui sait répondre à la validation. La croix s'arrêtait sur la première, où valider ne déclenchait rien. L'indication ne crée plus de cible, elle lit celle qui existe déjà à travers la source d'interaction du composant. Une cible, un appui.
- **Les filtres de genre se rangent.** Vingt puces déroulées en permanence en tête de catalogue repoussaient la première jaquette hors de l'écran au doigt, et obligeaient la télécommande à toutes les traverser pour atteindre la grille. Le bloc est désormais replié par défaut, avec une flèche. Mais un filtre actif qu'on ne voit plus est un piège : l'en-tête garde en permanence le nombre de genres retenus et leur énumération. Seul l'outil se range, jamais l'état.
- **Les pistes audio et sous-titres ont enfin le panneau du client Web.** La liste modale du système se fermait à chaque choix, ne montrait nulle part ce qui était actif, et mélangeait les deux familles dans une seule énumération — on y lisait « Audio — fr · 5.1 · EAC3 » puis « Sous-titres — fr » sans jamais savoir lequel on écoutait. Le panneau reste ouvert, sépare audio et sous-titres par un intitulé, marque l'active d'un bouton radio, et applique le changement sans interrompre la lecture. L'état actif est relu au lecteur à chaque rafraîchissement, jamais retenu localement : il reste juste même quand le lecteur change de piste de lui-même.
- **La barre ne se retire plus sous les yeux de qui lit un panneau.** Le compte à rebours de quatre secondes ignorait la liste des pistes ; il suspendait déjà pour « Infos lecture ».
- **Le retour referme d'abord ce qui est ouvert.** Sortir de la liste des pistes fermait le film entier — un geste de trop, et pas celui qu'on croyait faire.
- **Deux couleurs dupliquées de moins.** Le lecteur portait ses propres `Encre` et `Bleu`, copies des jetons partagés, et la barre du téléviseur employait `Color.Gray` là où le reste emploie `#9ba5b9`.

## 0.5.6.r39 — l'application Android est enfin la même que le Web

- **Un seul jeu de jetons de style pour les deux clients.** Les couleurs, arrondis, durées et approches typographiques du Web vivaient dans `styles.css` ; côté Android, ils étaient écrits sur place — trois `val` privés en tête de `MainActivity`, un quatrième recopié dans le lecteur, des arrondis en 7, 10, 11, 13, 14 et 24 dp semés dans les écrans, et `Color.Gray` (#888888) partout où le Web emploie `#9ba5b9`. `ui/Design.kt` les transcrit valeur par valeur, chaque jeton portant en commentaire la règle CSS dont il vient.
- **Les polices du Web sont embarquées.** DM Sans pour le texte, Manrope pour les titres, avec l'approche resserrée qui donne son caractère à l'enseigne (`-0,065 em` sur les grands titres). Android affichait la police du système sans aucun espacement : c'est l'écart qui se voyait en premier. Les fichiers sont dans l'APK plutôt que téléchargés — un boîtier de téléviseur n'a ni services Google ni Internet garanti, et l'application sert un NAS local. `FontWeight.Black`, qui n'a pas de fichier correspondant chez Manrope, laissait Compose épaissir artificiellement le dessin ; c'est `ExtraBold` désormais, la vraie graisse 800 du Web.
- **L'enseigne est de nouveau une marque.** « Flix » en blanc, « Tunes » en bleu, comme sur le Web et dans le logo. Android écrivait « FlixTunes » d'un seul blanc.
- **L'accueil affiche les huit rails du Web, plus seulement cinq.** « Sélection pour X », « Ma liste » et « Historique récent » manquaient — non par oubli de l'API, mais parce que `parseHome` ignorait trois champs que le serveur envoyait déjà : la donnée traversait le réseau pour être jetée à l'analyse. Chaque intitulé porte maintenant son décompte à droite, seule indication de ce qui se cache au-delà du bord de l'écran.
- **La section Historique existe sur Android.** Un profil pouvait consulter son activité depuis un navigateur et pas depuis son téléphone, alors qu'elle arrive dans la même réponse `/api/home`.
- **Le catalogue se filtre.** Recherche interne, état (tous, en cours, vus, non vus), tri (titre, sortie, ajout) et genres, comme sur le Web. Les critères partent au serveur, qui les applique sur le catalogue entier : les appliquer sur les fiches déjà reçues afficherait un décompte faux dès la deuxième page. Sur mille cinq cents films, un catalogue sans filtre ne se parcourt pas, il se subit.
- **Une saison se présente par sa jaquette, plus par une puce de réglage.** Le Web montre l'affiche, le nombre d'épisodes, le titre et le résumé ; Android alignait « Saison 1 », « Saison 2 » dans une rangée de filtres, sans le moindre indice de ce que la saison contient. Les épisodes portent désormais leur durée, leur résumé, leur avancement et le bouton « marquer vu ».
- **La fiche montre les qualités et les versions.** Résolution, plage dynamique et codec en pastilles, et le choix du fichier à lire quand un film en a plusieurs — le serveur les envoyait depuis r36 sans qu'Android les affiche. S'y ajoutent « Ma liste » et « Marquer vu », jusque-là réservés au Web.
- **Un titre de carte occupe toujours deux lignes.** Il était coupé à une seule : la ligne de méta ne tombait donc pas à la même hauteur d'une carte à l'autre, et une grille de jaquettes identiques paraissait dentelée.
- **Un profil se modifie depuis Android.** Nom, couleur, langue et code PIN. Il fallait auparavant supprimer le profil et le recréer, ce qui emporte tout l'historique. Le serveur accepte pour cela `PUT` en plus de `PATCH` sur `/api/profiles/:id` : `java.net.HttpURLConnection`, dont dépend le client Android, refuse `PATCH` par une liste de méthodes figée dans le JDK.
- **Le retour ramène à la section d'où l'on vient.** Partir de Films, ouvrir un film, revenir — et se retrouver à l'accueil. La section était retenue *dans* l'écran d'accueil ; ouvrir une fiche le retire de la composition, son état disparaît avec lui, et le retour en reconstruisait un neuf. Le client Web n'a pas ce défaut parce que sa section vit dans l'adresse. Le retour défait désormais un cran à la fois : la fiche, puis la section.
- **Un bouton « Actualiser » dans Films et Séries.** Une analyse lancée sur le NAS pendant que l'application est ouverte ne se voyait nulle part : il fallait fermer l'application. Le rafraîchissement reste volontaire — automatique, il ferait sauter la grille pendant qu'on la parcourt.
- **Le lecteur répond enfin à la télécommande.** Il n'y répondait pas du tout, et la cause n'était pas dans les touches : la barre de commandes n'est composée que lorsqu'elle est visible, et la seule chose qui la réveillait était un appui **tactile**. Sur un téléviseur il n'y a pas de doigt — donc jamais de barre, donc rien de focusable, et la croix directionnelle appuyait dans le vide. Barre retirée, gauche et droite naviguent de dix secondes et le centre ramène la barre ; barre visible, la croix appartient au parcours au focus, qui se pose de lui-même sur pause/lecture. Retour et volume restent au système, sans quoi le lecteur serait une impasse.
- **L'Atmos cesse d'être perdu par excès de prudence.** Les capacités de sortie étaient lues dans le seul `AudioDeviceInfo.encodings`, que beaucoup de téléviseurs et de boîtiers renvoient vide ou amputé : l'appareil se déclarait incapable, le serveur convertissait en AAC, et l'Atmos disparaissait sans qu'aucune erreur ne le signale. `AudioCapabilities` de Media3 — déjà dans l'application, et la source dont ExoPlayer se sert lui-même — est désormais consultée en plus : intention HDMI, `isDirectPlaybackSupported`, profils directs, réglage de son surround externe. Au passage, la règle qui décidait de l'Atmos était fausse par priorité d'opérateurs, `if (c) A else false || B` se lisant `if (c) A else (false || B)` : sur Android 9 et au-delà, le repli TrueHD n'était jamais examiné.
- **Le cadre autour d'un film est noir.** La ressource nommée `black` valait `#080B12`, l'encre de la marque — assez bleue pour se voir sur un grand écran. Un film 2.39:1 sur un téléviseur 16:9 était donc encadré de gris bleuté, et ses propres noirs paraissaient plus profonds que le cadre censé disparaître.

## 0.5.6.r38 — FlixTunes a enfin une signature sonore

- **Le son de démarrage n'est plus un bip, c'est une marque.** L'ancien empilait quatre sinusoïdes pures à décroissance exponentielle : chaque note était juste, et l'ensemble sonnait comme un réveil. Le nouveau dure 2,40 s — l'indice SoundOut 2025 situe l'optimum de mémorisation entre deux et trois secondes — et tient en deux gestes soudés, en fa d'un bout à l'autre. **« Flix »** : un impact précédé de 70 ms d'appel d'air, une chute de 164 à 44 Hz doublée de ses harmoniques, et un corps frappé qui énonce déjà l'accord. **« Tunes »** : quatre coups, **fa – do – fa – ré**, qui montent d'une quinte puis d'une quarte et redescendent d'une tierce mineure sur la sixte de l'accord.
- **Le motif dessine une arche, et ce n'est pas un choix esthétique.** Jakubowski (2017) montre que les airs qui reviennent involontairement en tête ont un contour global *archétypal* — l'arche de Huron, montée puis descente — mais des écarts *inhabituels* aux points de retournement ; Dowling (1978) montre que c'est le contour, et non les intervalles exacts, qui survit en mémoire à long terme. D'où la dissymétrie recherchée : douze demi-tons de montée en deux pas, trois seulement de descente.
- **Percutant et agressif ont été séparés.** Le premier est temporel, le second spectral, et les confondre produit un son gros mais mou et âpre. Le punch — contraste entre le transitoire et le corps qui suit — passe de 5,4 à **10,6 dB**, le temps de montée à **0,3 ms**, grâce à deux étages de « knock » : l'un de 470 à 190 Hz, l'autre une octave au-dessus et deux fois plus bref. Dans ces bandes une période dure moins de cinq millisecondes, alors qu'à 44 Hz il en faut cinq rien que pour la première alternance — c'est pourquoi un impact fait de grave seul ne claque jamais.
- **Le silence fait autant que les coups.** L'impact dure 130 ms au lieu de 210, les trois premières notes s'éteignent en 200 ms, et un vide de 220 ms précède l'arrivée. Trois frappes également espacées sonnent comme une machine ; les mêmes suivies d'un silence sonnent comme une phrase, et l'attente rend la dernière note plus lourde qu'aucun gain ne l'aurait rendue. Le facteur de crête gagne 3,2 dB.
- **Et l'agressivité a baissé pendant que le punch doublait.** Le transitoire de bruit passe deux pôles à 2,2 kHz sur trois millisecondes, au lieu d'un seul pôle à 4 kHz sur cinq : sa sharpness de Zwicker tombe de 1,31 à 0,52 acum. L'ensemble descend à **0,72 acum, sous les 0,99 du son d'origine**.
- **L'accord final a été revoisé d'après Plomp & Levelt.** La dissonance sensorielle culmine lorsque deux partiels sont séparés d'un quart de bande critique. L'accord contenait un la3–do4 à 0,42 bande critique et un fa3–do4 à 0,82 : la quinte a été retirée et le voisinage ouvert à 2,5 bandes critiques. La note d'arrivée, ré5, pose une sixte au-dessus — moins conclusive qu'un accord parfait, donc entendue comme une ouverture, ce qui est le sujet même d'un démarrage.
- **L'impact s'entend enfin sur un téléphone.** Grave coupé à 250 Hz, comme le fait tout petit haut-parleur, le contraste de frappe passe de 4,7 à **16,0 dB**. Un impact qui ne vit que sous 120 Hz disparaît là où l'application est le plus utilisée ; celui-ci est porté par le knock, qui survit à la coupure.
- **Le fichier ne se fait plus couvrir par le film qui suit.** Il plafonnait à −10,3 dBFS ; il est masterisé à −3,0 dBFS, sans un seul échantillon écrêté — les sommets sont tassés par saturation douce, pas coupés. Somme mono vérifiée : 0,24 dB de perte, grave et choc restant au centre.
- **Les chiffres ci-dessus sont vérifiables.** `node tools/mesure-signature.mjs <fichier.wav>` calcule punch, temps de montée, facteur de crête, sharpness de Zwicker, dissonance de Plomp-Levelt et tenue sur petit haut-parleur, et accepte plusieurs fichiers pour les comparer côte à côte.
- **La signature se régénère seule.** Elle vit dans `tools/New-StartupSound.ps1`, appelé par `tools/New-BrandAssets.ps1` : la retravailler ne demande plus de réécrire toutes les icônes. `-PreviewPath` rend un fichier d'essai sans toucher aux ressources, et `-Variant` choisit entre trois motifs — `Arche` par défaut, `Envol` (arpège ascendant), `Signe` (deux notes).
- **La correction d'un balayage de fréquence faux depuis l'origine.** L'ancien code écrivait `sin(2π·f(t)·t)` : la fréquence instantanée d'une telle expression vaut le double de la pente annoncée. La chute est désormais intégrée en phase et descend bien où elle le prétend.

## 0.5.6.r37 — une série ne dépend plus du fournisseur qui a répondu

- **Six séries entières reviennent au catalogue.** Un fichier nommé `E001`, `EP001`, `Ep001` ou `E01` n'était reconnu par aucune règle : il retombait sur l'interprétation « film » et allait grossir l'accueil des films. Dragon Ball Z, Naruto, Dragon Ball, Dragon Ball Super, Dragon Ball GT et FullMetal Alchemist — 910 fichiers — en sortaient. Le marqueur d'épisode employé seul est désormais une règle à part entière, avec ou sans nom de série devant lui ; un fichier posé sans dossier de saison rejoint la saison 1, comme chez Plex et Jellyfin.
- **Une bibliothèque déclarée série ne produit plus de films.** La personne qui range un dossier dans « Séries TV » énonce un fait, et ce fait vaut mieux que l'incapacité d'une expression régulière à lire un nom de fichier. Les lectures « film » restent consultables dans l'explication de la détection, mais ne peuvent plus l'emporter. `Bonus`, `Pilote`, `Autres`, `Extras` et `Making of` sont rattachés à leur série, en saison 0, au lieu de devenir des longs métrages.
- **Une série s'identifie par son dossier, plus par son titre.** Pendant une analyse, TMDB peut céder la main à TVDB ou à TVmaze le temps que son coupe-circuit se referme ; les épisodes suivants recevaient alors un autre titre de série, donc une autre fiche. Dix dossiers étaient ainsi éclatés, dont `Dr Who` en deux fiches toutes deux datées 2005 et `Dr House` réparti entre « House » et « Dr House ». Les dossiers déjà éclatés se recollent d'eux-mêmes à la prochaine analyse. Deux dossiers homonymes, eux, restent deux séries : `Dr Who` et `Dr Who (2023)` lisent le même titre et désignent deux œuvres.
- **Déverrouiller une correspondance ne la détruit plus.** La commande effaçait aussi le fournisseur et son identifiant. La fiche devenait anonyme, l'analyse suivante en fabriquait une seconde depuis le nom de fichier, et la bonne restait derrière — vide, sans jaquette, visible au catalogue. Dix-sept films avaient été perdus ainsi, soit la totalité des films alors « non appariés » ; chacun avait pourtant la bonne correspondance avant qu'on ne le répare.
- **Un film s'identifie aussi par son fichier.** La fiche déjà rattachée à un fichier est retrouvée en dernier recours, après l'identifiant du fournisseur : le regroupement « une œuvre, une fiche » de r36 continue de primer, mais une indisponibilité passagère ne peut plus fabriquer un doublon.
- **Les fiches qui ne désignent plus aucun fichier disparaissent.** Le retrait remonte des épisodes vers les séries, épargne les corrections manuelles et les regroupements, et s'interrompt au-delà de la moitié du catalogue : une telle proportion ne décrit pas des traces mais un incident.
- **Les séries longues retrouvent leurs titres d'épisodes.** `Naruto Shippuden - 078` rangé dans `Saison 4` était interrogé sur un S04E78 qui n'existe pas — la saison 4 en compte vingt-cinq. Le numéro est absolu, la saison est relative, et la conversion manquait. Elle n'est tentée qu'après l'échec de la recherche directe, ignore les spéciaux et ne rend rien plutôt que de désigner un épisode au hasard.
- **La reprise des fiches existantes réessaie au lieu d'abandonner.** Elle tenait à une minuterie unique de quinze secondes : une analyse déjà en cours à cet instant précis suffisait à l'annuler définitivement. Le serveur annonçait r36 pendant que la base était restée à la génération 4, et aucun correctif livré depuis ne s'appliquait aux fiches déjà en base.
- **Une fiche de film s'affiche même quand son fichier est injoignable.** Le partage réseau endormi vidait la fiche entière — ni titre, ni jaquette, ni résumé — au lieu de montrer l'œuvre.

## 0.5.6.r36 — une œuvre, une fiche, toutes ses versions

- **Le troisième OSS 117 est récupéré même depuis un ancien cache de son tag MKV.** `OSS 117 Alerte Rouge en Afrique Noire 2021 FRENCH` fournit désormais 2021 et un titre propre au moment de la fusion, même si l'ancienne extraction avait conservé une année nulle.
- **BAC Nord conserve la fiche TMDB illustrée lorsque Wikidata confirme la même œuvre avec son année de festival.** Cette préférence reste limitée à un titre exact, une identité inter-fournisseurs commune, un écart d'une année et quatre points de score au maximum ; elle ne relâche aucun seuil général.
- **Un film possédant plusieurs fichiers n'occupe plus plusieurs cartes.** Les variantes partageant le même identifiant de catalogue — ainsi que les regroupements manuels — sont réunies sans déplacer, renommer ni supprimer les fichiers.
- **La fiche affiche la qualité avant la lecture.** Résolution, HDR et codec sont lus dans les données FFprobe déjà analysées pour les films et les séries. Lorsqu'un film a plusieurs fichiers, leurs noms complets, tailles et qualités sont visibles et la version à lire peut être choisie.
- **La génération de métadonnées 10 reprend automatiquement les fiches r35.**

## 0.5.6.r35 — les preuves fournisseurs réparent les derniers rejets locaux

- **Un nom rejeté localement peut être réparé sans relâcher le seuil global.** L'automatisation exige un titre littéralement exact confirmé par au moins deux fournisseurs indépendants. Les deux premiers OSS 117 du journal passent ainsi sur les bons identifiants TMDB ; une proposition isolée, approchante ou ambiguë reste bloquée.
- **`OSS 117 Alerte Rouge en Afrique Noire 2021 FRENCH` est nettoyé à sa source.** L'année et la balise de langue finales du tag MKV sont extraites avant la recherche, sans confondre les vrais titres `1917`, `2001`, `French Kiss` ou `The French Dispatch`.
- **`Superman (2025)` utilise le rang natif TMDB comme ultime départage entre deux fiches strictement identiques.** Cette règle ne s'active qu'avec titre exact, année exacte, même fournisseur et rang zéro explicite ; sans ces quatre preuves, la revue prudente de r34 est conservée.
- **La génération de métadonnées 9 réexamine les fiches r34 sans demander de supprimer la bibliothèque.**

## 0.5.6.r34 — un film exact bat enfin ses bonus homonymes

- **Un titre exact avec une année exacte gagne sur un bonus ou making-of seulement proche, même si la règle des suites leur donne le même score numérique.** `Iron Man 3` ne peut plus être neutralisé par `Iron Man 3 Unmasked`; le même correctif couvre `Spider-Man 2`, `Spider-Man 3`, `Jurassic Park III` et les autres suites observées dans le journal r33.
- **« Suite reconnue » et « titre exact » sont désormais deux preuves distinctes.** Un bonus partageant le nom et le rang d'une franchise n'est plus présenté comme une égalité littérale. Deux fiches réellement exactes d'un même fournisseur restent en revue.
- **Une correspondance fournisseur parfaite peut départager une hésitation locale.** Un tag de conteneur ou un dossier parent légèrement différent ne bloque plus une fiche TMDB confirmée ; seul un nom réellement rejeté interdit l'automatisation.
- **La recherche essaie aussi le titre sans son article initial.** `The Avengers EndGame (2019)` interroge également `Avengers EndGame`, qui rend TMDB `299534` alors que la requête originale ne rend rien.
- **La génération de métadonnées 8 réexamine automatiquement les fiches de r33 et récupère leurs vraies jaquettes.**

## 0.5.6.r33 — TMDB porte toujours la fiche et la vraie affiche

- **Une réponse Wikidata plus rapide ne peut plus voler une correspondance parfaite à TMDB.** À score égal, le classement privilégie explicitement TMDB, puis TVDB ; l'ordre réseau n'intervient plus. La recherche agrégée n'est plus court-circuitée par Wikidata et une candidate TMDB est rechargée par son identifiant pour obtenir sa fiche complète et ses illustrations. Cela couvre notamment `Iron Man 3`, `Spider-Man 2` et `Spider-Man 3`.
- **Une capture du film n'est plus utilisée comme jaquette.** Les images vidéo restent possibles comme fonds, mais jamais dans les cartes verticales. Les anciennes captures reconnues sont retirées à la prochaine réévaluation, sans imposer de repartir de zéro.
- **Les séparateurs typographiques ne créent plus un conflit avec les métadonnées intégrées.** `SpiderMan Far From Home` et `Spider-Man: Far From Home` corroborent la même identité ; le tiret ou l'espace manquant ne force plus une revue manuelle.
- **La génération de métadonnées 7 reprend automatiquement les correspondances et jaquettes produites par r32.**

## 0.5.6.r32 — une même œuvre reste la même dans deux langues

- **TMDB, TVDB et Wikidata ne créent plus une fausse ambiguïté en traduisant différemment le même film.** Les titres principal, original et alternatifs sont comparés entre fournisseurs. `Ant-Man et la Guêpe` et `Ant-Man and the Wasp`, tous deux datés de 2018, corroborent désormais la même œuvre au lieu de finir à égalité comme deux films distincts.
- **Les affiches de secours entièrement noires sont refusées.** L'image vidéo est cherchée plus loin dans le film et mesurée par FFmpeg ; une image noire à 96 % ou plus est supprimée avant son inscription au catalogue.
- **Le journal ASUSTOR explique chaque étape de métadonnées.** Décision, fournisseur, identifiant, confiance, motifs, offre d'illustration, écriture et erreur éventuelle sont écrits en JSON dans `FlixTunes/logs/server.log`, sans jeton ni URL d'API sensible.
- **La révision du paquet est de nouveau lisible.** Un caractère de contrôle s'était glissé dans l'expression `sed` du script de démarrage ; `/api/health` annonçait `\u0001` au lieu de `r31`.
- **La génération de métadonnées 6 reprend les fiches r31 en revue et leurs illustrations noires.**

## 0.5.6.r31 — les alias du fournisseur ne sont plus perdus

- **Le résultat que TMDB avait déjà trouvé n'est plus rejeté après coup.** Quand la recherche reconnaît un nom alternatif mais rend seulement son titre officiel, FlixTunes demande les alias de la candidate de la bonne année et les soumet au même moteur de décision. `Hulk (2008)` rejoint ainsi *L'Incroyable Hulk* et `Jurassic Park II (1997)` rejoint *Le Monde perdu : Jurassic Park* sans exception écrite pour ces films.
- **Les chiffres romains sont de vrais rangs de suite.** `II` à `XX` sont interprétés comme `2` à `20`, et le nom de franchise peut se trouver après le sous-titre officiel — comme dans *The Lost World: Jurassic Park* — tout en exigeant toujours l'année exacte ou un rang explicite.
- **L'année enfermée dans le titre du conteneur devient une preuve.** Un tag `Jurassic Park II (1997) ...` fournit 1997 même si les champs `date` et `year` sont absents. Seules les années entre parenthèses ou crochets sont admises, afin de ne pas dater *2001 : L'Odyssée de l'espace* de 2001.
- **Un titre embarqué plus complet confirme le fichier au lieu de le contredire.** Le nom principal reste celui du fichier, tandis que la variante du conteneur est conservée comme alias de recherche.
- **La génération de métadonnées 5 reprend les affiches noires existantes.** Les fiches pauvres de r30 sont automatiquement remises en file après installation.

## 0.5.6.r30 — les preuves locales retrouvent les fichiers opaques

- **Les métadonnées intégrées peuvent sauver un fichier opaque.** Titre et année, identité de série/saison/épisode et identifiants TMDB/IMDb/TVDB lus par FFprobe deviennent des preuves véritables. Une identité interne complète relève une détection rejetée au lieu de rester bloquée par `video_001.mkv`.
- **Les conventions Plex sont réutilisables.** Le dossier individuel `Titre (année)` participe à la détection et les fichiers `.plexmatch` sont lus du dossier de série au dossier de saison ; `.flixtunesmatch` permet de les surcharger sans modifier la configuration Plex.
- **Les années de première ne créent plus de fausse ambiguïté.** Deux fournisseurs décrivant le même titre à un an près se corroborent, afin que première en festival et sortie nationale soient reconnues comme la même œuvre (`BAC Nord`, 2020/2021). Deux fiches distinctes du même fournisseur restent concurrentes.
- **Les NFO sont fusionnés selon leur portée.** Le `tvshow.nfo` du dossier racine fournit l'identité de série, puis `season.nfo` et le NFO de l'épisode le complètent sans remplacer le titre de l'épisode par celui de la série.
- **La source réelle est visible depuis la fiche Web et Android.** « Détails du fichier » affiche le nom complet du film avec extension ; « Détails du dossier » affiche le dossier racine de la série, jamais `Saison 1`.
- **La génération de métadonnées 4 reprend les anciennes décisions.** Les fiches pauvres conservées pendant une indisponibilité TMDB, dont `BAC Nord`, sont réévaluées avec les nouvelles preuves.

## 0.5.6.r29 — la revue ne modifie plus le catalogue

- **Une proposition n'est plus une correspondance.** Seules une décision automatique non ambiguë, un identifiant exact ou une correction manuelle validée peuvent modifier titre, année, identifiants et regroupement. Les propositions de revue restent dans une table séparée et sont visibles dans le centre de correspondances sans toucher à la fiche.
- **L'année éloignée devient bloquante pour l'automatisme.** Un titre exact assorti d'une autre année — `Destination Finale I (2000)` face à *Destination finale 4* (2009), ou *Blanche-Neige* 1937 face à 2025 — passe en revue au lieu d'être fusionné.
- **Deux œuvres au coude à coude imposent une revue.** Une marge minimale sépare le premier résultat d'une autre œuvre ; deux fournisseurs décrivant le même titre et la même année se corroborent au lieu de créer une fausse ambiguïté.
- **L'élargissement ne s'arrête plus sur une proposition moyenne.** Il continue jusqu'à une candidate réellement automatique, ce qui permet à `Destination Finale I` de devenir `Destination Finale` tout en conservant l'année 2000.
- **Les preuves exactes sont exploitées.** Les suffixes Jellyfin `tmdbid`, `imdbid` et `tvdbid`, les NFO `movie`, `tvshow` et `season`, ainsi que la résolution TMDB `/find` pour IMDb/TheTVDB, contournent la recherche floue.
- **Le calcul de titre reste Unicode.** Les alphabets non latins ne sont plus effacés avant comparaison, et `La French` n'est plus amputé par un marqueur de langue trop général.
- **Les corrections sont atomiques et auditées.** Le serveur valide la fiche distante avant toute écriture, journalise la correspondance et son déverrouillage, puis seulement rafraîchit la fiche. Un fournisseur qui refuse l'identifiant ne laisse plus un verrou invalide en base.
- **Android et ASUSTOR portent exactement la révision r29.** Android annonce `0.5.6.r29` avec `versionCode 56029`, ce qui rend la mise à jour ordonnée et identifiable.

## 0.5.6 — la lecture directe devient le défaut

- **Le serveur ne teste jamais ce qu'un appareil sait décoder : il le lui demande, et il le croit.** Cette confiance s'est révélée mal placée bien plus souvent qu'on ne le pensait, et chaque refus faux envoyait vers le chemin le plus coûteux du serveur un film qui se lisait gratuitement. La règle est désormais celle-ci : **on sert le fichier tel quel, et si ça ne marche pas on convertit.**
- **`hev1` et `hvc1` désignent le même codec HEVC**, rangé différemment, et les navigateurs n'acceptent pas les mêmes étiquettes. Seul `hvc1` était sondé : la négociation annonçait « codec vidéo hevc non pris en charge » sur la machine même où Chrome venait de lire du HEVC 4K. Ce verdict entrant dans `videoCompatible`, un mot d'écart décidait entre copier un flux et le réencoder entièrement.
- **Le débit décidait de la compatibilité, et il se mesurait lui-même.** La bande passante est relevée par `hls.js` pendant la session en cours : pendant une conversion, elle mesure la vitesse de l'encodeur, non celle du réseau. Le cercle se refermait — on convertit, c'est lent, donc le réseau est déclaré insuffisant, donc on convertit — et le serveur se confiait le travail le plus lourd à cause d'une estimation que ce travail avait faussée. Seul subsiste le plafond posé par le lecteur après deux coupures réelles.
- **`decodingInfo` répond très souvent « décodable mais peut-être pas fluide » pour du HEVC 4K matériel.** C'était pris pour un refus, le plafond restait à 1080p, et le serveur partait en conversion 4K qu'un NAS Celeron ne produit pas.
- **Ni AC-3 ni E-AC-3 n'étaient sondés**, alors que Chrome et Edge les lisent sur la plupart des postes Windows. Un film en EAC3 — la piste par défaut de presque tous les Blu-ray — partait en remux pour son seul son. La réponse exigée est `probably`, plus stricte que pour l'image : une erreur sur le son donne un film muet, que rien ne signale.
- **Le nombre de canaux ne refuse plus rien.** `maxAudioChannels` décrit la sortie de l'appareil, pas son décodeur : le lecteur mixe lui-même 5.1 ou 7.1 vers la stéréo, comme le ferait le serveur.
- Ne subsistent que les refus portant sur ce que la lecture directe **ne peut pas faire** : incruster des sous-titres, appliquer une normalisation, jouer une piste choisie à la main, respecter un plafond de définition réglé, et sortir un son que le lecteur ne décode pas. Ce dernier a été retiré une fois, et l'usage l'a démenti en une lecture — un DTS servi à Chrome donne une image normale et aucun son.
- **Le repli après un échec passe par le remux avant la conversion.** Firefox et Safari ne lisent pas le Matroska : un repli droit vers la conversion les aurait fait passer d'une copie d'image au bit près à un transcodage complet.
- **La quarantaine de codecs n'était pas consultée là où il fallait.** `withoutQuarantined` retire le codec défaillant des capacités, ce qui le fait justement ressembler à un codec non déclaré — le cas même où l'on voudrait parier. Elle est désormais lue sur la liste brute.
- **Le démenti de quarantaine partait à la première image**, et il efface la ligne. Un décodage qui décrochait trois secondes plus tard repartait donc d'un compteur remis à zéro, et deux échecs étant nécessaires pour retenir la leçon, elle ne l'aurait jamais été. Il attend maintenant que la lecture ait tenu.
- **Le décrochage du décodeur se mesure** : cinq pour cent d'images perdues tenus trois fenêtres font basculer en mode compatible. C'est le seul mode d'échec muet du décodage — ni erreur, ni coupure, juste une image hachée que rien ne remarquait.

## 0.5.6 — sessions orphelines, reprise, et poids du client Web

- **« Limite de 2 conversions simultanées atteinte » alors qu'aucune lecture n'était en cours.** `preparePlayback` ne se protégeait pas de la ré-entrée : deux avances rapprochées lançaient deux coroutines, la seconde remettait l'identifiant de session à zéro avant que la première ait assigné le sien, et la session de la première devenait introuvable. Ni le lecteur ni `onDestroy` ne pouvaient plus l'arrêter, et elle gardait son créneau dix minutes.
- Corrigé de deux façons volontairement redondantes : les préparations sont **sérialisées** côté Android, et le serveur applique un garde-fou qui ne dépend d'aucun client — **un appareil ne regarde qu'une chose à la fois**, une nouvelle demande libérant ses sessions précédentes. Un lecteur peut oublier d'annoncer un arrêt ; il ne peut pas demander une session sans se nommer.
- **Quitter le lecteur n'arrêtait pas la lecture.** `PlaybackService` est un `MediaSessionService` : son lecteur survit délibérément à l'activité, c'est ce qui permet le son en arrière-plan. Libérer le `MediaController` ne le suspendait donc pas — la conversion précédente continuait d'être demandée segment après segment, sa session n'était ni orpheline ni inactive, et aucun ramassage ne pouvait la prendre. Lancer un second film se heurtait alors à « limite de 2 conversions simultanées », ce qui décrivait la situation sans en dire la cause. Le lecteur est désormais arrêté en quittant l'écran, et le service s'arrête aussi quand l'application est balayée hors des tâches récentes.
- **Une conversion jamais démarrée gardait son créneau dix minutes.** Ce délai vaut pour une lecture en pause, dont le tampon plein cesse de demander des segments ; pas pour une session en préparation, dont le client interroge sans relâche puis abandonne à trente secondes.
- **La reprise faisait encoder deux fois.** La session était ouverte au début, puis le lecteur sautait au point de reprise — lequel tombe hors de la fenêtre encodée en conversion, obligeant à relancer une seconde session. Le point de départ est désormais décidé **avant** de demander la session, sur les deux clients.
- Un troisième défaut se cachait derrière : `preparePlayback` remettait `initialSeekApplied` à `false`, si bien qu'après chaque relance le saut de reprise se rejouait et ramenait au point d'origine. Une avance s'annulait d'elle-même.
- **L'accueil Web chargeait le lecteur entier pour afficher des jaquettes.** Le budget de poids l'a dit à 111,7 Kio pour un plafond de 100. Le lecteur est passé en chargement à la demande : premier affichage ramené à **81,3 Kio**, et le seuil resserré de 100 à 95 pour retenir le gain. Le total expédié ne bouge pas, mais qui parcourt sans lire télécharge vingt-sept pour cent de moins.
- **`registerDefaultNetworkCallback` était appelé sous le minimum Android déclaré**, et le `NoSuchMethodError` était avalé par un `runCatching` : la surveillance réseau ne s'installait jamais sur Android 6 ou 7, et rien ne le disait. La limite est désormais explicite.

## 0.5.6 — étape 56 : lecteur Android mobile et TV

- **La barre de commandes Media3 ne pouvait pas convenir** : son temps total vient de la `Timeline` du lecteur, que rien ne traduit. En conversion elle affichait la position dans le film sur la durée de la fenêtre encodée — « 1:23:45 / 0:03:20 » — avec un curseur borné à ce qui était produit. La barre est désormais la nôtre, en Compose, aux mêmes éléments et aux mêmes mots que le lecteur Web, avec un sélecteur audio et sous-titres qui n'existait pas sur Android.
- **La définition annoncée venait de la dalle, non du décodeur.** Un téléphone à panneau 2400 × 1080 déclarait ne pas savoir lire un film 4K, alors que son décodeur le lit et que le système réduit ensuite l'image gratuitement. Le serveur partait en conversion 4K et le film ne démarrait pas du tout. Elle vient maintenant de `MediaCodecInfo`, la dalle ne servant plus que de plancher.
- Auparavant, ces mêmes valeurs étaient envoyées **à l'envers** : `Display.Mode` rapporte la définition dans l'orientation native du panneau, donc en portrait sur un téléphone, et un simple film 1080p était jugé trop grand.
- **Le détecteur de gestes était détruit quatre fois par seconde.** `pointerInput` portait la position de lecture parmi ses clés, et Compose recrée le détecteur à chaque changement : un double tape, qui s'étale sur trois cents millisecondes, n'avait jamais le temps de se former. La tape simple qui réveille les commandes se perdait de la même façon.
- Le réveil des commandes passe désormais par `onPress` plutôt que `onTap` — ce dernier n'arrive qu'après le délai du double tape, et ce tiers de seconde se ressentait comme une barre qui ne répond pas. Les tapes du même côté se cumulent, la série partant de la position d'**avant** le premier saut, sans quoi les sauts se contrarient.
- **Toute panne de lecture menait au transcodage**, y compris une coupure de Wi-Fi — la plus courante sur un NAS domestique, et la seule qui se répare seule. Chaque famille d'erreur Media3 appelle désormais sa réponse, et le codec n'est mis en cause que lorsque le décodeur a réellement refusé.
- **La cadence d'affichage n'était pas accordée** : un film à 23,976 images par seconde sur un panneau à 60 Hz avance par à-coups, et c'est le défaut de fluidité le plus visible de la chaîne — le seul qu'aucun débit ne corrige.
- **La reprise après destruction du processus repartait au mauvais endroit** : Android recrée l'activité avec l'intention d'origine, celle du début de séance, et un film tué à 74 % reprenait à 10 %.
- Le mode tunnel est activé sur téléviseur, et c'est lui qu'on écarte en premier devant un refus de décodage : le perdre coûte un peu de synchronisation, tandis qu'accuser le codec priverait l'appareil de lecture directe sur tous les films qui l'emploient.
- **Le paquet et l'APK portent le même numéro de révision**, tiré de la même variable. Ils étaient numérotés séparément, ce qui rendait impossible de savoir depuis un téléphone si le correctif cherché y était.

## 0.5.6 — étape 56 : la conversion matérielle du NAS

- **L'accélération matérielle ne pouvait pas démarrer, et six causes distinctes se cachaient l'une derrière l'autre.** Chacune était un vrai défaut, chacune a été corrigée, et le NAS continuait de convertir sur son processeur. Aucune n'était devinable depuis le poste de développement.
- **`libva-drm.so.2` était absente du paquet.** Les constructions FFmpeg de BtbN chargent libva par `implib-gen` : la bibliothèque est ouverte à l'exécution, donc invisible du contrôle de dépendances, qui lit les `DT_NEEDED`.
- **Le chemin de recherche du binaire était cassé** (`DT_RPATH=-Wl:../lib`), et `post-install.sh` lançait FFmpeg sans poser `LD_LIBRARY_PATH` : le script sortait en erreur et App Central laissait sa barre de progression tourner sans fin. Trois révisions ont paru « ne jamais s'installer » pour cela seul.
- **`vaMapBuffer2` manquait**, et la sanction n'est pas une lenteur mais une assertion en pleine conversion. Aucune libva de Debian ne réunit ce symbole et la glibc de l'ADM — mesuré sur les quatre versions du pool.
- **La libva embarquée ignore `LIBVA_DRIVERS_PATH`** : elle est compilée avec ses chemins figés. Les cinq pilotes livrés échouaient donc identiquement, non parce qu'ils étaient mauvais mais parce qu'aucun n'était jamais regardé. Le service dépose désormais le pilote là où cette libva regarde, à chaque démarrage.
- **Le répartiteur oneVPL ne trouvait pas son runtime**, et annonçait un nœud de rendu absent — ce qui n'avait aucun rapport.
- **La pile de conversion passe sur les constructions Jellyfin**, seules à fournir libva 2.23 compilée contre une glibc compatible avec l'ADM, appariée à son pilote `iHD`. Trois gains viennent avec, dont deux qui n'étaient pas cherchés : libva liée par `DT_NEEDED` — donc un symbole manquant redevient une erreur de chargement propre —, et le runtime Intel Media SDK sans lequel Quick Sync ne pouvait ouvrir aucune session.
- **Le tone mapping renvoyait l'encodage au processeur.** Une ligne, sans commentaire ni test : toute conversion HDR — le cas le plus fréquent et le plus coûteux — était encodée en logiciel, même sur une machine dont l'encodeur matériel fonctionnait.
- **Le tone mapping est désormais mesuré, non plus supposé.** Chaque chemin est chronométré sur la machine, et « auto » ne retient un chemin matériel que s'il s'est montré plus rapide que le logiciel **ici**.
- **Réglages de conversion et mode expert** : accélérateur, tone mapping, codec de sortie et résolution maximale, avec les mesures qui justifient chaque choix et un bouton pour les refaire.
- **Les alertes ne conseillent plus l'impossible** : elles cessent de réclamer un matériel absent dès qu'un accélérateur a été retenu.
- **Un affichage faisait croire à un rabaissement qui n'avait pas lieu** : un film 4K servi en remux — donc copié — s'annonçait « Sortie 2560×1440 · 12 Mb/s » alors qu'il sortait à sa définition et à son débit d'origine.
- **Les vignettes de survol lançaient un FFmpeg par image.** Balayer un film de deux heures, c'était jusqu'à sept cent vingt processus, précisément au moment où le NAS convertit déjà. Une planche en regroupe cent en un seul passage : huit processus pour un film entier, et rien du tout au second survol.

## 0.5.5 — corrections d'usage signalées

- **Lecteur : deux barres de commandes se superposaient.** `<video controls>` était actif en plus de la nôtre, et la barre native ne connaît que le flux transcodé — d'où « 0:15 / 1:31 » derrière « 0:15 / 1:41:51 ». En plein écran, c'était pire : la commande native agrandit la vidéo seule, laissant nos commandes en dehors. Les commandes natives sont retirées et le plein écran porte sur le conteneur.
- **Ordre des épisodes.** Un épisode dont la numérotation manque a `episode_number` à NULL, et SQLite classe les NULL en premier : une saison s'ouvrait sur son neuvième épisode. Ils passent en fin de liste, le titre départageant à numéro égal.
- **Détection.** Un fichier nommé `S02E03 - Titre.mkv` — sans nom de série avant le code, courant quand le dossier parent le porte — était pris pour un film, donc sans saison ni numéro.
- **Résumés d'épisodes.** Quand le détail d'un épisode manquait, le synopsis de la série était recopié sur chacun : les neuf épisodes d'une saison affichaient le même texte. Une fiche porte désormais son propre résumé, jamais emprunté à un parent.
- **TVmaze fournit enfin titres et résumés d'épisodes.** La crainte initiale — un appel réseau par épisode — était fondée ; l'API rend la série entière en un seul appel, et le cache sert les épisodes suivants. Le coût est d'un appel par série.
- **Correction manuelle : `tvmaze` et `wikidata` étaient absents du schéma de validation.** Une série proposée depuis TVmaze — toutes celles hors TMDB — recevait « Correspondance invalide » sans que rien ne désigne le fournisseur. Le test lie désormais la validation à la liste réelle des fournisseurs plutôt qu'à une énumération recopiée.
- **Recherche manuelle : l'année de la fiche en cours était imposée comme filtre.** Chercher « Daredevil » depuis une fiche datée 2025 masquait la série de 2015, pourtant présente chez TMDB. L'année devient un **seuil saisi librement**, appliqué aux résultats ; l'analyse automatique conserve l'année exacte.
- **Correction accessible depuis la fiche**, ouverte directement sur le bon titre.
- **Le nombre de saisons présentes sur le disque départage deux séries homonymes.** Jamais éliminatoire, sans effet en dessous de deux saisons, et consulté uniquement quand deux candidats sont au coude à coude : le coût réseau reste nul dans le cas nominal.

## 0.5.5 — correctif : pages Films et Séries inutilisables

- **Corrige un défaut majeur livré en 0.5.4.r1, 0.5.4.r2 et 0.5.5.r1.** Les pages Films et Séries restaient entièrement noires. La méthode de pagination ajoutée à l'étape 54 s'appelait `catalog`, nom déjà pris par le centre de correspondances : deux clés homonymes dans un objet littéral ne lèvent aucune erreur, la seconde écrase la première. Le catalogue partait donc vers la mauvaise route, recevait un tableau au lieu d'une page, et React démontait tout l'arbre au rendu suivant.
- Aucun test ne pouvait le voir : les tests d'interface remplacent l'intégralité du module d'API par un double, où la collision n'existe pas. Un fichier de tests s'exécute désormais contre le **vrai** module, `fetch` intercepté, et vérifie qu'aucune méthode n'est en double, que les deux routes sont distinctes et que chaque critère part bien dans l'URL.
- **Ajoute une barrière d'erreur.** Une exception de rendu vidait l'écran sans message ni action possible. Elle affiche désormais une explication, un bouton de rechargement et le détail technique dépliable — c'est elle qui a permis de localiser ce défaut.

## 0.5.5 — étape 55 (premier volet) : affichage et négociation Web

- **Corrige les jaquettes du rail « Sélection ».** `.media-card` est un bouton : enfant direct de la grille il remplit sa colonne, mais enveloppé dans une carte de recommandation il redevient `inline-block` et se rétracte à la largeur de son contenu. Mesuré sur reproduction : 33×107 au lieu de 179×327. La même cause produisait, sur une version antérieure, l'inverse — des images à leur taille native débordant sur leurs voisines.
- **Corrige une négociation de lecture qui refusait à tort des fichiers lisibles.** Une seule cause, quatre symptômes : chaînes de codec incomplètes (`codecs="hvc1"`), conteneur Matroska jamais sondé, et définition maximale déduite de `screen.width` — donc de l'écran et non de la capacité de décodage. Le serveur en concluait qu'il devait transcoder du 4K HEVC, l'admission jugeait ce transcodage trop lourd et bridait à 1080p.
- La sonde interroge désormais `mediaCapabilities.decodingInfo`, avec des chaînes de codec complètes, et éprouve chaque codec en 1080p et en 2160p. Un codec décodable mais poussif est déclaré — le refuser condamnerait au transcodage un fichier lisible — sans pour autant relever la définition annoncée.
- **Supprime une seconde source de bridage** : `capLevelToPlayerSize` plafonnait la qualité aux dimensions rendues de l'élément vidéo, ce qui ramenait à 720p dans toute fenêtre non maximisée sur un écran 1080p.
- **Ajoute le choix manuel de la plage dynamique** — Auto, HDR conservé, Converti en SDR — offert uniquement sur une source qui en possède une, et relançant la session à la position courante.
- **Rend les fenêtres modales utilisables au clavier** : le focus se place dedans à l'ouverture, la tabulation y reste enfermée, et il revient à son déclencheur à la fermeture. `aria-modal` retire le fond de l'arbre d'accessibilité mais ne le rend pas inatteignable.

## 0.5.4 — étape 54 (second volet) : écriture du catalogue

- **Corrige un défaut majeur et silencieux.** Une racine devenue illisible ou vide — partage démonté, disque en veille, point de montage muet — faisait marquer indisponible **toute** la bibliothèque. La marche « réussissait », elle ne trouvait simplement rien, et aucune erreur n'était levée.
- Ajoute deux garde-fous : racine muette, et disparition de plus de la moitié des médias en une analyse. Tous deux se contournent par une confirmation explicite, et laissent les petites bibliothèques se vider sans discuter — marquer indisponible n'efface rien, donc le préjudice d'une erreur suit le volume.
- N'importe plus un fichier encore en cours de copie : il produisait une fiche tronquée qui persistait jusqu'à ce qu'une analyse ultérieure remarque le changement de taille. Seuls les fichiers récemment écrits sont observés, une date d'écriture future comprise.
- Journalise les fichiers restés à la porte, avec motif, détail et nombre de tentatives, exposés sur `/api/scans/skipped`. Le compteur distingue l'incident isolé du problème installé ; la ligne disparaît dès que le fichier entre ou quitte le disque.
- **Supprime une extraction d'image relancée indéfiniment.** Chaque analyse relançait une extraction ffmpeg pour toute fiche sans affiche, y compris celles dont l'affiche ne peut pas être produite. C'est le gain le plus net de ce volet.
- Le regroupement des écritures en transactions a été implémenté puis retiré : le banc montre ±102 % de dispersion d'un passage à l'autre, bien au-delà de l'écart qu'on lui attribuait. Le banc publie désormais sa dispersion pour empêcher ce genre de conclusion.

## 0.5.4 — étape 54 (premier volet) : lecture d'une grande médiathèque

- **Mesure d'abord.** Un banc de montée en charge peuple une base synthétique à l'échelle voulue et chronomètre l'accueil et la recherche. Sur 2 000 films et 200 séries, l'accueil demandait **2696 ms p95 et 1004 Kio** pour une cible de 150 ms.
- **Supprime un N+1 de 400 requêtes.** Chaque série déclenchait une requête pour son épisode représentatif et une autre pour la liste d'envies. Le tout tient désormais en deux requêtes bornées à la page affichée.
- **Corrige une recherche qui reconstruisait tout le catalogue.** Chaque frappe payait le prix d'un accueil complet, pour ne renvoyer que quelques dizaines de résultats.
- **Ajoute trois index.** `idx_catalog_library_kind` ne pouvait servir aux parcours ignorant la bibliothèque, faute de colonne de tête : l'accueil balayait toutes les fiches pour isoler les séries.
- **Borne les rails par SQL.** L'accueil chargeait la totalité des médias, épisodes compris, pour n'en garder que quelques dizaines après filtrage en mémoire.
- **Pagine le catalogue.** Nouvelle route `/api/catalog` avec tri, filtre d'état, recherche et découpage. L'accueil ne transmet plus que les soixante premières fiches de chaque type et annonce les totaux réels.
- **Déplace tri et filtres côté serveur.** Ils s'appliquaient en mémoire sur les fiches reçues : les laisser au client aurait produit, une fois la pagination en place, un classement faux mais plausible — juste sur deux films, faux sur deux mille, et sans aucune erreur pour le signaler.
- **Rend la recherche insensible aux accents.** `LIKE` n'ignore la casse que sur l'ASCII : « SÉRIE » ne trouvait pas « Série ».
- **Web et Android chargent la suite au défilement**, avec un bouton explicite en repli et le décompte du reste à afficher.
- Résultat à l'échelle visée : accueil **35,9 ms p95** et **78 Kio**, recherche **21 ms**, page de catalogue **1 ms**.

## 0.5.3 — étape 53 : revue et corrections durables

- **Corrige un défaut majeur de conservation.** Le verrou de fiche ne protégeait que le statut et la confiance de correspondance : un simple rescan réécrivait titre, année, résumé et identifiants par-dessus une correction manuelle. Toute l'identité d'une fiche verrouillée est désormais préservée.
- Ajoute des commandes de correction transactionnelles : forcer une correspondance, corriger une numérotation d'épisode, verrouiller ou déverrouiller une fiche, regrouper un doublon et l'en séparer.
- Chaque commande est journalisée avec son état avant et après, ce qui rend l'annulation exacte et fournit une trace consultable et filtrable.
- Regrouper deux doublons n'efface rien : les deux fiches et les deux fichiers restent en place, seule l'appartenance au groupe est enregistrée. Séparer revient donc à retirer cette appartenance.
- Aplatit les chaînes de regroupement vers la fiche finale et refuse les cycles ainsi que la fusion d'une fiche avec elle-même.
- Ajoute la prévisualisation d'une correction de masse : portée réelle et liste des fiches écartées avec leur raison, les fiches déjà corrigées à la main étant systématiquement exclues.
- Expose ces opérations en API : application, annulation, journal filtrable et prévisualisation.

## 0.5.2 — étape 52 : fédération de métadonnées

- Sépare l'arbitrage des adaptateurs fournisseurs : un module décide champ par champ, sans jamais parler au réseau, ce qui rend la décision entièrement vérifiable hors ligne.
- Une correction manuelle verrouillée et une métadonnée locale ou NFO l'emportent toujours sur un fournisseur distant, quelle que soit sa confiance : un ré-enrichissement ne peut plus écraser le travail de l'utilisateur.
- Ajoute un arbitre de langue : la langue de la bibliothèque prime, puis l'anglais, puis toute autre langue. Un champ sans langue, comme une durée ou une année, n'est jamais pénalisé.
- Ajoute un pipeline d'images contrôlant type de contenu, dimensions et proportions : une réponse HTML, une vignette minuscule, un pixel de suivi ou une affiche aux mauvaises proportions sont refusés avec leur raison.
- Choisit les affiches et fonds par langue puis définition, et ne retient l'image extraite de la vidéo qu'en dernier recours.
- Ajoute un cache HTTP conditionnel : `If-None-Match` et `If-Modified-Since` évitent de retélécharger une charge utile inchangée, ce qui économise le quota des fournisseurs.
- Continue de servir le cache quand un fournisseur est injoignable ou répond en erreur : une panne réseau n'efface jamais ce qui a déjà été appris.
- Ajoute un compteur de quota par fournisseur sur fenêtre glissante, avec état exposable à l'administration.
- Ajoute un jeu de vérité films, séries et documentaires mesurant couverture et faux positifs hors ligne, incluant homonymes, séries relancées, années divergentes, identifiants croisés et absence de résultat.

### Corrections signalées à l'usage — révision r2

- **Durée de lecture erronée.** Le lecteur se calait sur la durée déclarée par le flux HLS, qui ne couvre que la portion déjà encodée. La barre sautait, la reprise repartait du début et la progression enregistrée était fausse. La référence est désormais la durée mesurée par FFprobe, sur Web comme sur Android.
- **Progressions déjà enregistrées corrompues.** Une position de 300 s stockée avec une durée de 12 s donnait 2500 %, plafonné à 100 % : le média passait pour terminé. Une réparation unique rétablit la durée réelle et recalcule l'état « terminé » au démarrage, sans défaire les marquages manuels.
- **Barre de progression à trois niveaux** sur le Web : portion encodée par le serveur, portion chargée par le lecteur et position lue, plus l'indication de l'avance du transcodage dans l'horloge.
- **Lecteur Android en plein écran.** L'activité n'ayant aucun thème déclaré héritait du thème de démarrage et affichait une barre de titre portant le nom de l'application. Thème dédié sans barre de titre, barres système masquées et passage sous les encoches.
- **Écran de démarrage Android** avec logo en fondu, barre de progression et pourcentage suivant les étapes réellement franchies : connexion, profils, médiathèque.
- **Création et suppression de profils sur Android**, absentes jusqu'ici, avec choix du nom, de la couleur, de la langue et d'un code PIN facultatif.
- **Modification d'un profil existant sur le Web** : nom, couleur, langue et code PIN, y compris son retrait, qui n'étaient plus modifiables après la création.

## 0.5.1 — étape 51 : détection de fichiers v2

- Remplace l'analyse par expressions régulières enchaînées par un moteur à candidats : chaque règle propose une interprétation avec son score et les indices qui l'ont produite.
- Ajoute un tokeniseur Unicode qui préserve accents, apostrophes et alphabets non latins, et découpe sans perdre un seul caractère.
- Ajoute trois seuils distincts : application automatique au-dessus de 90 %, revue humaine au-dessus de 55 %, refus en dessous, plus une revue forcée quand deux interprétations de familles différentes sont au coude à coude.
- Applique les deux règles du plan : l'année entre parenthèses prime sur une année nue, et un nombre isolé ne produit jamais un épisode sans arborescence de série confirmée.
- Refuse de prendre un nombre du titre pour une année de sortie : « Blade Runner 2049 » conserve son nombre tant qu'aucune année plausible n'est présente.
- Retire du titre les groupes entre crochets, les marqueurs de nature, l'édition, le numéro de partie et le suffixe d'équipe, sans amputer un titre réellement composé du type « Spider-Man ».
- Couvre doubles épisodes, forme courte 1x02, épisodes datés, numérotation absolue d'anime, spéciaux en saison 0, documentaires, concerts, courts-métrages, éditions et films en plusieurs parties.
- Ajoute un corpus déterministe de 10 000 noms synthétiques avec vérité terrain, et un banc `pnpm --filter @flixtunes/server test:detection` mesurant rappel par catégorie et précision par règle.
- Ajoute des tests de mutation de noms reproduisant les déformations réelles des outils de partage : suffixe d'équipe, balises de langue et de source, préfixe de groupe, séparateurs doublés.
- Expose la règle retenue, la décision, les indices et les interprétations concurrentes, de quoi alimenter une file d'ambiguïtés sans jamais déplacer ni fusionner un fichier.

## 0.5.0 — étape 50 : qualification de la lecture

- Ajoute un corpus de régression versionné, décrit par propriété technique : conteneur, codec vidéo et audio, HDR, canaux, sous-titres, cadence et cas limites.
- Toutes les fixtures sont synthétiques et reproductibles, générées par `lavfi` à partir de mires et de tonalités : aucun média sous droits n'entre dans le banc, et la recette FFmpeg fait partie du manifeste.
- Couvre les cas limites du dossier d'étape : piste par défaut incorrecte, audio retardé, cadence variable, B-frames, fichier encore en cours de copie et conteneur sans index.
- Ajoute cinq profils clients de référence — Chromium, Safari, Android mobile, Android TV et Windows — décrivant ce que ces clients annoncent réellement, sans capacité optimiste.
- Ajoute un banc `pnpm --filter @flixtunes/server test:qualification` qui génère le corpus, rejoue la négociation réelle et compare au résultat attendu, avec rapport lisible par machine et rapport humain.
- Mesure la synchronisation audio/vidéo de chaque fixture et en fait un critère avec une tolérance de 40 ms, au lieu d'un simple relevé.
- Distingue échec critique et limite connue documentée : une limite assumée n'échoue pas le banc mais reste visible dans le rapport.

## 0.4.9 — étape 49 : capacité NAS, GPU et admission

- Sonde chaque accélérateur au démarrage par un micro-banc non destructif : NVENC, Quick Sync, VA-API, AMF, V4L2 M2M et logiciel sont réellement essayés, pas seulement détectés.
- Écarte un pilote qui répond mais reste plus lent que le processeur, cas mesuré sur Quick Sync à 84 images/s contre 266 en logiciel, au lieu de l'imposer par simple ordre de présence.
- Conserve le calibrage entre redémarrages et le refait dès que la version de FFmpeg ou la liste des accélérateurs change.
- Ajoute un modèle de coût par session, ajusté au banc : le coût d'une conversion se déduit de la définition, de la cadence, du tone mapping et du nombre de variantes ABR.
- Ajoute un contrôle d'admission : une lecture directe n'est jamais refusée, une conversion trop lourde est proposée à définition réduite avant tout refus, et le refus explique quoi faire.
- Les analyses de bibliothèque cèdent la place aux lectures : un seul travailleur dès qu'une conversion tourne, aucune quand le budget est saturé, reprise automatique ensuite.
- Ajoute le tableau « capacité de mon serveur » : processeur, mémoire, température, débit mesuré par accélérateur, sessions simultanées soutenables et alertes accompagnées d'une action.
- Rend la mémoire libre et la température bloquantes pour l'ouverture d'une nouvelle conversion, sans jamais interrompre celles déjà en cours ni refuser une lecture directe.

### Corrections signalées à l'usage

- Le changement de piste audio s'applique immédiatement : la session est renégociée à la position courante, dans le mode de lecture déjà choisi. Il fallait auparavant cliquer sur un bouton de relance pour que le choix prenne effet.
- Le changement de sous-titre texte s'applique sans recréer le flux ; seule une incrustation impose une nouvelle session. Le décalage, l'encodage et la position se répercutent aussi sans relance.
- La qualité n'est plus bridée à 720p sur le réseau local : `navigator.connection.downlink`, plafonné à 10 Mb/s par les navigateurs et représentatif du lien Internet et non du lien vers le NAS, n'est plus utilisé comme plafond hors réseau mobile. L'échelle suit désormais l'écran et la source jusqu'en 1440p et 2160p, l'adaptation réelle restant assurée par la mesure de débit HLS.
- Android : les sections Films, Séries et Recherche passent d'un rail horizontal unique à une grille adaptative qui remplit l'écran, du téléphone en portrait au téléviseur, et la barre de navigation reste fixe pendant le défilement.

## 0.4.8 — étape 48 : chaîne vidéo HDR et colorimétrie

- Relève le modèle colorimétrique complet de chaque piste vidéo : primaires, matrice, transfert, plage, position chroma, sous-échantillonnage, profondeur, rotation et entrelacement.
- Lit le mastering display et MaxCLL/MaxFALL même lorsqu'ils ne sont portés que par les SEI d'image, par un sondage borné à une seule image et réservé aux sources PQ.
- Corrige la lecture des données annexes de flux FFprobe : `stream_side_data_list` remplace une section inconnue, ce qui rend enfin détectables le profil, le niveau et la rétrocompatibilité Dolby Vision.
- Lit un Dolby Vision 8.1 en direct sur un téléviseur HDR10 et un 8.4 sur un téléviseur HLG, via leur couche de base, au lieu de le transcoder inutilement.
- Corrige le tone mapping HDR → SDR : le blanc de référence est normalisé à 100 nits et la crête source est exprimée en multiples de ce blanc. L'image passe de 10,88 dB à 17,40 dB de PSNR sur le banc de mires.
- Choisit libplacebo/Vulkan quand il est disponible (19,19 dB), sinon zscale logiciel ; VA-API et OpenCL restent sur décision administrateur via `FLIXTUNES_TONEMAP`.
- Relance automatiquement la session en logiciel quand le chemin matériel échoue.
- Conserve HDR10 lors d'un réencodage lorsqu'un encodeur HEVC 10 bits existe, en réinjectant mastering display et MaxCLL/MaxFALL.
- Désentrelace en conservant la cadence source et reflète la rotation du conteneur dans les dimensions de sortie.
- Compose les sous-titres après la conversion colorimétrique, jamais avant.
- Annonce toute perte de format avant la lecture et expose la chaîne colorimétrique pas à pas dans « Infos lecture » et dans le diagnostic serveur.
- Affiches chargées paresseusement en vraies images avec squelette et fondu, flèches de défilement sur les rails et squelette d'accueil pendant le chargement.

## 0.4.7 — étape 47 : diffusion adaptative locale

- Produit une échelle HLS ABR jusqu’à quatre qualités, bornée par la source, l’écran, le débit client et la capacité réseau.
- Ajoute DASH natif pour Android Media3 et conserve HLS fMP4/MPEG-TS pour le Web et les clients compatibles.
- Partage une session de transcodage identique entre plusieurs clients et conserve les sorties terminées dans un cache borné par durée et taille.
- Ajoute la qualité automatique ou manuelle, l’estimation réseau, le comptage des rebuffers et la récupération après erreur réseau/média.
- Sécurise l’accès aux manifestes et segments, et expose l’état ABR/cache dans le diagnostic serveur.

## 0.4.6 — lecteur instantané et continuité

- Reprise configurable par profil avec retour de contexte, vitesse par défaut, lecture suivante et garde-fou anti-lecture infinie.
- Contrôles Web enrichis : seek précis, chapitres, vignettes de timeline, PiP, minuteur, précédent/suivant et panneau technique temps réel.
- Android Media3 : reprise cohérente, vitesse, PiP mobile et passage automatique à l'épisode suivant selon la politique du profil.
- API déterministe des épisodes voisins et cache local de vignettes générées à la demande.

## 0.4.5 — étape 45

- Sélectionne automatiquement version originale, français ou anglais selon l'ordre du profil, sans choisir commentaire ou audiodescription par accident.
- Classe les pistes principales, originales, doublées, commentaires et audiodescriptions depuis dispositions et titres FFprobe.
- N'annonce le passthrough Android TV AC-3/E-AC-3/TrueHD/DTS/DTS-HD/Atmos/DTS:X que lorsque la sortie audio active le déclare réellement.
- Ajoute les sorties configurables AAC, Dolby Digital/AC-3 et Opus, avec conservation du flux compatible.
- Ajoute normalisation EBU R128, mode nuit, downmix borné et limiteur anti-écrêtage.
- Persiste ces préférences par profil et les applique sur Web, Android mobile et Android TV.

## 0.4.4 — étape 44

- Détecte et classe les sous-titres externes SRT, WebVTT, ASS/SSA, TTML/DFXP, SAMI, SBV/SubViewer, MicroDVD, MPL2, VobSub SUB/IDX et PGS.
- Normalise les langues BCP-47 et les indicateurs forcé, SDH/SME/HI/CC sans confondre ces marqueurs avec une langue.
- Détecte UTF-8, UTF-16 LE/BE et Windows-1252, propose un encodage manuel et conserve les accents pendant la conversion WebVTT.
- Convertit nativement les principaux formats texte, incruste automatiquement les formats image et prend en charge un décalage de ±10 minutes.
- Persiste par profil et média la piste, la synchronisation, la taille, le fond, la position, la police et l'encodage.
- Ajoute les pistes texte internes et externes au lecteur Android Media3 et étend le diagnostic aux CEA-608/708.

## 0.4.3 — étape 43

- Inventorie les décodeurs, encodeurs, conteneurs, filtres et accélérateurs du moteur FFmpeg réel.
- Affiche dans l'administration une matrice de compatibilité vidéo, audio, conteneurs, sous-titres et conversions.
- Signale les composants critiques absents et le repli disponible au lieu d'une erreur générique.
- Ajoute les modes Lecture automatique, Direct forcé, Remux sans perte et Compatible au lecteur Web.
- Transmet explicitement les modes Auto/Compatible depuis Android et conserve le repli automatique après une erreur Media3.

## 0.4.2 — étape 42

- Embarque FFmpeg 8.1 GPL complet dans le paquet ASUSTOR afin de décoder notamment E-AC-3, AC-3, DTS et TrueHD sans dépendre du paquet ADM incomplet.
- Ajoute des agents publics sans clé pour les séries (TVmaze) et les films (Wikidata/Wikipedia/Wikimedia), avec titres français, résumés et affiches.
- Complète en français les résumés de séries et de saisons TVmaze grâce aux pages Wikipédia correspondantes.
- Lance automatiquement un enrichissement des bibliothèques existantes après mise à jour, avec cache persistant et limitation respectueuse des requêtes.
- Normalise les années présentes dans les dossiers de séries et masque les anciennes fiches sans épisode disponible.
- Renforce la relance Web compatible en HLS MPEG-TS, H.264/AAC 1080p SDR et expose les décodeurs dans le diagnostic.

## 0.4.1 — étape 41

- Génère automatiquement une affiche 2:3 et un fond 16:9 depuis la vidéo quand aucune image locale ou distante n'est disponible.
- Ajoute un repli visuel Android lorsque l'image est absente ou en cours de chargement.
- Rend la négociation mobile conservatrice et utilise HLS MPEG-TS pour les conteneurs non directement fiables.
- Force H.264/AAC stéréo sans HDR lors de la seconde tentative de lecture Android.
- Transmet la session du profil protégé au lecteur et applique la reprise une fois la durée Media3 connue.

## 0.4.0 — étape 40

- Pipeline de métadonnées localisées multi-fournisseurs, provenance et correction manuelle.
- Négociation lecture directe/remux/transcodage, HDR10/HLG/Dolby Vision, Atmos/DTS:X et sous-titres.
- Lecteur Web résilient et interfaces catalogue, profils, historique et administration.
- Clients Android mobile et Android TV reconstruits autour de Media3.
- PIN de profil haché et contrôle d'accès API par jeton temporaire.
- Dialogue PIN intégré au Web et invalidation propre des sessions après redémarrage serveur.
- Requêtes Web sans corps corrigées et états de progression/visionnage immédiatement synchronisés.
- Installateurs et mises à jour sans perte de données pour Windows, Linux et ASUSTOR.

Le détail étape par étape et la matrice de validation sont dans `docs/VALIDATION_0.4.0.md`.
