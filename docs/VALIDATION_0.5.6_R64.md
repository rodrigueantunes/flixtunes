# Validation 0.5.6.r64 — un profil sans code peut entrer, et le son suit après un saut

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §4 liste le reste.*

## 1. « Impossible de joindre le serveur » en accès distant — impasse prouvée

Le journal montrait quatre `GET /api/home` en **401** depuis l'écoute distante. Reproduit avec un
compte d'essai, créé puis supprimé :

| Appel | Résultat |
| --- | --- |
| `/api/home` en WAN, compte de connexion valide, sans session de profil | **401 « Session requise »** |
| Déverrouiller un profil **sans code** | **400 « PIN invalide »** |
| La même lecture en LAN | **200** |

Un profil sans code était **enfermé dehors** : l'accès distant exige une session sur chaque lecture,
et le seul moyen d'en obtenir une réclamait un code de quatre à huit chiffres qu'il n'avait pas. Sans
conséquence sur le réseau local, où aucune session n'est demandée.

Le défaut est apparu **parce que le retrait de code de r63 fonctionne** : ôter le PIN d'un profil le
rendait inaccessible depuis Internet.

Corrigé des deux côtés :

- le serveur lit le profil **avant** le code, et n'exige un PIN que s'il en existe un ;
- le client demande silencieusement une session pour un profil non protégé — sans effet en local, où
  cette session reste simplement inutilisée.

Un test vérifie qu'un profil **protégé** refuse toujours un corps vide : la porte ne s'est pas
ouverte pour tout le monde.

## 2. Décalage audio après un saut — mon diagnostic de r63 était faux

### Ce que la mesure a dit

Sur `S01E06.mkv` (HEVC + E-AC-3), en reproduisant exactement le chemin du serveur :

| Cas | Début vidéo | Début audio |
| --- | --- | --- |
| copie, sans `-avoid_negative_ts` | 0,080 s | 0,080 s |
| copie, avec `make_zero` | 0,080 s | 0,080 s |
| vidéo copiée + audio réencodé, sans | 0,080 s | 0,080 s |
| vidéo copiée + audio réencodé, avec | 0,080 s | 0,080 s |

**Aucun écart, dans aucun cas.** Le mécanisme avancé en r63 — horodatages négatifs ramenés à zéro
piste par piste — ne produit rien sur ce fichier. Le drapeau reste, inoffensif et standard, mais il
n'était pas la cause et la note r63 le disait à tort.

### La cause réelle, retrouvée dans le journal du projet

La r53 avait corrigé le même symptôme sur le Web :

> « Le retard venait de l'E-AC-3 secondaire recopié dans MediaSource/fMP4 […] **alors que les PTS
> produits par FFmpeg sont identiques à ceux de l'image** […] Android conserve sa sélection multipiste
> Direct Play intacte. »

Les mesures négatives ne contredisaient donc pas le défaut : elles en **reproduisaient la signature**.
Le décalage ne naît pas du flux produit, mais de la restitution d'un E-AC-3 copié dans un fMP4. Le Web
a été traité en r53 ; Android a été explicitement laissé de côté, et le fichier en cause est en E-AC-3.

La même normalisation s'applique désormais à Android, **étroitement** : E-AC-3 seul, fenêtre ouverte
par un saut seule, jamais au prix du Dolby Atmos.

### La lecture directe n'est pas touchée

Première version de ce correctif : la règle entrait dans `audioCompatible`, donc dans la **décision de
mode**. Une reprise à vingt minutes envoie `startSeconds` dès la première demande — un fichier qui
avait droit à la lecture directe serait passé en remux.

La règle est posée **après** que le mode est arrêté, sur le seul choix de l'encodeur audio, avec une
garde explicite `decision.mode !== "direct"`. Deux tests le verrouillent : l'un vérifie que la
décision de mode l'ignore, l'autre qu'elle n'agit que sur l'encodeur.

## 3. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **68 fichiers, 644 tests, 0 échec** |
| Suite Web | **20 fichiers, 170 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Contenu du paquet | vérifié par extraction, huit contrôles |

Mesures faites sur le service en fonctionnement, et non simulées : le 401 distant, le refus du
déverrouillage sans code, la lecture LAN à 200, et les quatre relevés d'horodatage ci-dessus.

## 4. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Le décalage audio, sur l'appareil** | La cause est désormais étayée par un défaut déjà constaté et corrigé sur un autre client, et par quatre mesures qui en reproduisent la signature. Elle n'a toujours pas été **observée corrigée** sur une tablette. |
| Le décalage des sous-titres (r63) | même réserve ; le mécanisme est arithmétique, mais non vérifié sur l'appareil |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |

**Si le décalage audio persiste après r64**, l'hypothèse suivante n'est plus le flux — quatre mesures
l'excluent — mais le lecteur : il faudra relever ce que Media3 rapporte comme décalage entre ses
renderers audio et vidéo après un saut.
