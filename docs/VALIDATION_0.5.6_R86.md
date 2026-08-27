# Validation 0.5.6.r86 — le lecteur du client de bureau est celui du Web, et VLC décode dessous

*27 août 2026. Étape 3 du chantier « client de bureau » — le pont de lecture. Cette note ne rapporte
que des résultats **réellement exécutés**, captures d'écran et relevés à l'appui.*

## 1. Ce qui a été constaté à l'écran

| Ce qu'il fallait voir | Résultat |
| --- | --- |
| Le film s'affiche dans la fenêtre FlixTunes | **oui** — « The Drama », HEVC décodé en D3D11 |
| Les commandes du client Web se dessinent par-dessus | **oui** — retour, titre, Infos, Pistes, barre, horloge, vitesse, minuteur |
| Le serveur sert un fichier **tel quel** | **oui** — « Le Loup et le Lion » en `Direct Play` |
| Le serveur sait toujours convertir quand il le faut | **oui** — « The Drama » en `Remux HLS` |
| Le déplacement dans le film | **oui** — clic sur la barre à 42:07, session renégociée, lecture reprise à 42:25 |
| La reprise à la position mémorisée | **oui** |
| Le plein écran | **oui** — au bouton, et `Échap` pour en sortir |
| Les sous-titres | **oui** — « Je suis un fan absolu. » à 43:34, réplique juste, au bon instant |

Les deux modes de l'énoncé — **une lecture directe et une lecture convertie** — sont donc constatés.

## 2. Ce que le client annonce, et ce qui en découle

C'est la déclaration de capacités qui fait tout le bénéfice. VLC lit le Matroska, le HEVC, le TrueHD,
le DTS ; un navigateur, non. En l'annonçant, le client de bureau obtient le fichier tel quel et **le
NAS ne réencode plus rien** — un boîtier de salon qui convertissait un film entier pendant qu'on le
regardait se contente désormais de le servir.

Trois promesses ont été écartées faute de pouvoir les tenir aujourd'hui, et le refus est aussi
important que la déclaration :

- **le choix d'une piste audio dans un fichier servi entier** — VLC en est capable, le pont ne sait
  pas encore lui désigner une piste ; l'annoncer rendrait le menu « Langue » sans effet ;
- **Dolby Vision** — VLC ne le restitue pas fidèlement, l'annoncer donnerait une image délavée ;
- **Dolby Atmos et DTS:X** — sans transmission directe vers un amplificateur, la promesse serait creuse.

La plage dynamique, elle, est **mesurée** : c'est l'écran qui décide, et Chromium le sait aussi bien
dans la coque que dans un onglet.

## 3. Le pivot : une surface de lecture, deux réponses

`Player.tsx` — 1 250 lignes de lecteur — ne parle qu'à une interface de treize membres. Dans un
navigateur, `HTMLVideoElement` la satisfait **telle quelle** : aucun adaptateur, aucune indirection,
pas une ligne de comportement changée. Dans la coque, `SurfaceVlc` la satisfait en traduisant les
mêmes mots vers VLC.

C'est ce qui garantit qu'il n'y aura pas deux lecteurs. On aurait pu en écrire un second pour le
bureau : deux barres de progression, deux cartes d'enchaînement, deux jeux de défauts. Ou parsemer
`Player.tsx` d'un « si bureau » dans chacune de ses quarante interactions avec la vidéo. Nommer ce
que le lecteur demande vraiment à une surface coûtait moins et ment moins.

## 4. Les sous-titres sont dessinés par nous, et c'est un choix

VLC est lancé avec `--no-spu` : il ne dessine aucun sous-titre. Le lecteur charge lui-même le WebVTT
— **le même fichier, la même adresse, le même décalage** qu'un navigateur — et affiche la réplique du
moment.

Laisser VLC s'en charger aurait été plus court et franchement mauvais : sa police, sa taille, son
placement, et six réglages du profil devenus sans effet. Ici la feuille de style est celle du Web,
taille, couleur, fond, position et police comprises.

## 5. Trois défauts trouvés en chemin, et ce qu'ils apprennent

### 5.1 Le film jouait derrière une interface figée à 0:00

Le mode strict de React monte un composant, le démonte aussitôt et le remonte — exactement pour
débusquer les nettoyages mal appariés. Le nôtre l'était : la surface était créée au rendu et son
abonnement défait au démontage, si bien que le démontage simulé le coupait pour de bon. VLC annonçait
sa quarante-troisième seconde pendant que la barre restait à zéro.

La bonne réponse n'était pas un nettoyage plus malin : **il n'y a qu'un VLC et qu'un lecteur à la
fois**. Une surface partagée, abonnée une fois pour toutes, dit exactement cela.

### 5.2 La vidéo jouait derrière une vitre peinte

La fenêtre qui porte l'interface est transparente, et le lecteur efface son fond pour laisser voir la
vidéo. Il ne l'effaçait que sur `body`. Or la feuille de style donne un fond **aux deux** : `:root`
porte `#080b12` sous le dégradé de `body`. Résultat, du bleu-noir précisément là où l'image jouait.

Ce défaut a résisté à plusieurs hypothèses plausibles — VLC qui ne dessinerait pas, une fenêtre créée
trop tôt, une interface qui se redessine trop — toutes écartées **par l'expérience** : la sonde de r84
rejouée, un lancement tardif, une couche animée. Il a fallu interroger la page en fonctionnement par
le protocole de débogage pour lire la vérité : `body` transparent, `html` à `rgb(8, 11, 18)`. La
leçon tient en une ligne : **on mesure l'état, on ne le déduit pas d'une capture d'écran**.

### 5.3 Un tuyau d'erreur qu'on ouvre sans le lire

VLC écrivait dans un tuyau que personne ne vidait. Un tuyau qu'on n'écoute pas se remplit, et le
processus qui écrit dedans finit par se bloquer — un lecteur qui se fige au bout de quelques minutes
est exactement le genre de défaut qu'on ne rattache jamais à sa cause. Il est désormais vidé, et
lisible sur demande par `FLIXTUNES_VLC_VERBEUX=1`.

## 6. Le plein écran passe par la fenêtre, jamais par le document

Une page ne sait agrandir que sa propre fenêtre. L'interface vivant dans une fenêtre transparente
posée sur la fenêtre vidéo, un plein écran demandé au document aurait étalé les commandes sur tout
l'écran **devant une vidéo restée à sa place**. C'est la fenêtre du dessous qu'on agrandit ;
l'interface la suit, par le mécanisme qui la fait déjà suivre un déplacement.

Il vaut pour toute l'application et non pour le seul lecteur : `F11` partout, `Échap` pour en sortir.
On parcourt parfois le catalogue sur un téléviseur, et rien n'y justifie une barre de titre.

## 7. Ce que la coque n'accepte pas

Le pont est offert à une page **chargée depuis le réseau**, et VLC ouvre tout ce qu'on lui présente.
« Ouvre ceci » est donc borné au serveur auquel la coque est connectée : ni fichier du disque, ni
protocole exotique, ni autre hôte, ni autre port. Huit cas le vérifient.

L'interface de commande de VLC n'écoute que sur `127.0.0.1`, sur un port libre choisi au lancement,
derrière un mot de passe tiré au hasard à chaque démarrage.

## 8. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Tests serveur | **761**, 0 échec |
| Tests Web | **215**, 0 échec — dont 38 nouveaux pour la bascule |
| Tests de la coque | **17**, 0 échec |
| Compilation TypeScript | aucune erreur, Web et coque |
| Décodage | **matériel** — « Format décodé : DX11 » relevé dans la trace VLC |

## 9. Suite

| Étape | Contenu |
| --- | --- |
| ~~1~~ | ~~sonde de superposition~~ — faite (r84) |
| ~~2~~ | ~~coque minimale~~ — faite (r85) |
| ~~3~~ | ~~le pont de lecture~~ — **faite** |
| 4 | capacités déclarées depuis la machine réelle ; choix de piste audio confié à VLC, qui supprimerait le remux de séparation |
| 5 | empaquetage `.msi`, `.deb`, AppImage ; retrait du client WPF |

Deux limites connues, énoncées plutôt que tues : le menu **Qualité** est vide en mode bureau — une
lecture directe n'a pas de paliers, et sur un flux converti c'est VLC qui choisit — et
**l'incrustation dans un coin de l'écran** n'est pas offerte, étant un service que le navigateur rend
à une balise vidéo. Enfin, l'italique des sous-titres est retiré plutôt qu'interprété : insérer les
balises d'un fichier de sous-titres dans la page reviendrait à lui faire confiance pour y écrire du
HTML.
