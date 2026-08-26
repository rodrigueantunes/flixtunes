# Validation 0.5.6.r67 — le décalage audio tenait à une condition trop étroite

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. « Du moins en WAN » : l'indice qui manquait

Le décalage audio après un saut persistait sur mobile, et l'utilisateur a précisé qu'il ne le
constate **qu'en accès distant**. C'est la première information qui désigne un chemin plutôt qu'un
appareil : sur le réseau local, le mobile obtient la lecture directe et ne rencontre jamais de fMP4 ;
depuis Internet, la même lecture passe en remux.

## 2. Le journal du service a tranché, sans hypothèse

Le serveur n'enregistre pas ses décisions de lecture — c'est le défaut d'outillage traité au §4. Mais
le décalage de fenêtre transparaît par accident dans l'URL des sous-titres, que le client construit
avec `offset = -startOffsetSeconds`. Pour *Le Loup et le Lion* depuis le mobile en accès distant :

```
/api/media/406da391-…/subtitles/3.vtt?offset=-0.0        ← session démarrée à 0
/api/media/406da391-…/subtitles/3.vtt?offset=-610.541    ← session démarrée à 610,5 s
```

**Trois sessions sur quatre sont parties de zéro.** Or la règle posée en r64 exigeait
`startSeconds > 0`. Elle ne s'est donc appliquée qu'à une session sur quatre.

La raison est simple, et j'étais passé à côté : un saut **à l'intérieur** de la fenêtre déjà encodée
ne relance aucune session. `relanceNecessaire` ne redemande au serveur que si la cible sort de ce qui
est produit — pour tout le reste, le lecteur se déplace dans le flux existant, qui garde son E-AC-3
recopié. C'est le cas le plus fréquent, et c'était précisément celui que la règle ne couvrait pas.

## 3. Le flux reste hors de cause — troisième série de mesures

Avant d'élargir la règle, j'ai reproduit le remux exact du serveur sur le fichier en cause
(HEVC + E-AC-3 5.1, `channel_layout=5.1(side)`, sans Atmos) et mesuré l'écart image/son à l'entrée de
**146 segments** :

| Segment | 0 | 1 | 10 | 30 | 60 | 90 | 120 | 145 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Écart (ms) | 0 | −21 | −30 | −25 | −19 | −19 | −37 | −41 |

Aucune dérive : l'écart oscille dans la largeur d'une trame E-AC-3 (32 ms) et n'augmente pas avec la
position. Le flux produit est bon. Le décalage naît de sa **restitution**, exactement comme la r53
l'avait établi sur Chrome/Edge.

**La règle est donc élargie et non déplacée :** l'E-AC-3 n'est plus recopié dans un fMP4, quel que
soit le point de départ de la session.

### Ce qu'elle ne touche pas, délibérément

| Cas | Traitement | Pourquoi |
| --- | --- | --- |
| Lecture directe | inchangé | L'E-AC-3 part au récepteur tel quel. Consigne explicite, tenue depuis r64. |
| Dolby Atmos | inchangé | Jamais sacrifié, quelle que soit la sortie. |
| Segments MPEG-TS | inchangé | Leur restitution ne montre pas ce défaut ; rien ne justifie d'y perdre le multicanal. |
| Autres codecs | inchangé | AAC, AC-3, DTS, TrueHD, FLAC : la règle ne les regarde pas. |

Le nombre de canaux est conservé : `maxAudioChannels` vaut la sortie réelle sur un téléviseur, et
deux sur un mobile — qui redescend de toute façon en stéréo. Un téléviseur contraint au remux perd en
revanche le passage direct de son E-AC-3 vers l'ampli, au profit d'un AAC multicanal à 384 kb/s ;
c'est le prix assumé, et le chemin MPEG-TS reste ouvert pour l'éviter.

## 4. Le défaut d'outillage, corrigé aussi

Trois révisions ont été dépensées à **deviner** ce que le mobile recevait. Le journal enregistrait les
requêtes — donc qu'une session existait — mais rien du choix fait : ni le mode, ni le codec de sortie,
ni le point de départ. La cause n'a fini par apparaître que dans l'URL des sous-titres, par accident.

Le serveur écrit désormais une ligne par session, faite pour un `grep` :

```
[FlixTunes] Décision de lecture — session <id>, média <id>, mode=remux, motif=…,
video=hevc→copy, audio=eac3/6ch→aac, depart=0.0s, conteneur=fmp4, appareil=mobile
```

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **69 fichiers, 654 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Écart image/son sur 146 segments | entre 19 et 41 ms, sans dérive |

### 5.1 Des tests qui exécutent la règle au lieu de la lire

La r64 n'avait été vérifiée que par **lecture de source** — et un test qui lit un texte ne dit rien du
cas que ce texte ne mentionne pas. La règle est donc extraite en fonction exportée
(`eac3ARenormaliser`) et cinq cas l'appellent réellement : session partie de zéro, session décalée,
lecture directe, Dolby Atmos, MPEG-TS, autres codecs. Le premier échouerait sous la règle de r64 —
c'est lui qui prouve la correction.

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Le décalage audio, sur l'appareil** | La cause est étayée par le journal, par la r53 et par trois séries de mesures. Elle n'a toujours pas été **observée corrigée** sur un mobile. |
| Décalage des sous-titres (r63) | même réserve |
| Jaquettes et lecture sur mobile en 5G (r66) | vérifiées dans le dex livré, pas observées sur l'appareil |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |

**Si le décalage persiste après r67**, la nouvelle ligne de journal donnera immédiatement le codec de
sortie réellement choisi. S'il indique `audio=eac3/6ch→aac` et que le décalage demeure, alors la piste
n'est plus le codec mais le lecteur lui-même, et il faudra relever ce que Media3 rapporte comme écart
entre ses renderers après un saut.

## 7. Confirmé sur l'appareil

**Validé par l'utilisateur le 25 août 2026.** Le son suit l'image après un saut. Le défaut aura traversé quatre
révisions — r63 sur une hypothèse fausse, r64 sur une condition trop étroite, r67 sur la bonne.
Ce qui l'a résolu n'est ni une intuition ni une relecture du code, mais le journal du service :
trois sessions sur quatre partaient de zéro, ce que la règle de r64 ne couvrait pas.
