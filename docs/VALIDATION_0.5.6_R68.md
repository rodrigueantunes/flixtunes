# Validation 0.5.6.r68 — deux séries illisibles sur Android : leurs pistes étaient rangées à la fin

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Le symptôme, et ce qu'il excluait déjà

*H* et *Ma famille d'abord* ne se lisaient **pas du tout** sur Android — mobile **et** téléviseur —
alors qu'elles se lisaient sur le Web. À l'écran : image noire, **aucun son**, et aucune avance
rapide possible.

Ces trois symptômes ensemble ne désignent pas un codec. Un décodeur qui refuse un profil lève une
erreur ; une piste audio non décodable laisse l'image se dérouler. Ici il n'y a ni image, ni son, ni
table de positions : le lecteur n'a **aucune piste**.

## 2. Ce que le journal du serveur a établi

Trois tentatives depuis l'application, toutes identiques :

```
POST /playback            → mode direct
GET  /stream × 3          ← Media3 ouvre le fichier
PUT  /progress × 2-3      ← la position avance
GET  /api/home            ← la personne abandonne
```

**Aucune erreur, aucun repli en remux, aucune quarantaine de codec** — la table
`device_codec_failures` est vide. Le lecteur ne s'arrête donc pas : il tourne et ne rend rien.

Le journal donnait aussi la ligne de partage entre ce qui marche et ce qui ne marche pas :

| Fichier | Audio retenu | Mode | Résultat |
| --- | --- | --- | --- |
| H S01E01 | AAC HE 2.0 | **direct** | échoue |
| Ma famille d'abord S01E02 | AAC LC 2.0 | **direct** | échoue |
| Le Loup et le Lion | E-AC-3 5.1 | remux | marche |
| Le Flambeau S01E06 | E-AC-3 5.1 | remux | marche |

Sur mobile, l'E-AC-3 n'est pas dans les codecs déclarés : ces fichiers-là partent en remux et
échappent au défaut. Ce n'est donc pas l'audio qui est en cause — c'est **la lecture directe**.

## 3. La cause, mesurée dans les fichiers

Position de l'élément `Tracks`, celui qui définit les pistes :

| Fichier | Position | Part du fichier |
| --- | --- | --- |
| Le Loup et le Lion — marche | octet 4 340 | 0,0 % |
| H S01E01 — échoue | octet 430 681 691 sur 430 682 020 | **les 329 derniers octets** |
| Ma famille d'abord S01E02 — échoue | octet 713 660 800 sur 713 661 263 | **les 463 derniers octets** |

Matroska l'autorise : le `SeekHead` posé en tête renvoie à cette position. FFmpeg suit ce renvoi —
donc le serveur, donc FFprobe, donc le navigateur, qui joue le fichier sans broncher.

**Media3 analyse le flux linéairement.** Il rencontre les premiers Clusters avant d'avoir vu la
moindre définition de piste, et se retrouve sans vidéo, sans audio et sans table de positions. Rien
n'est malformé de son point de vue : il ne lève aucune erreur. C'est pourquoi ni le repli automatique,
ni la quarantaine de codec, ni le journal ne l'ont jamais signalé.

## 4. La correction

Le remède ne coûte rien : un **remux** réécrit l'en-tête en tête de flux, l'image et le son restant
copiés au bit près. Vérifié sur *H* : l'`init.mp4` produit expose bien `hevc` et `aac`.

- **Le serveur mesure où sont les pistes** (`matroska-entetes.ts`), en ne lisant que des en-têtes :
  **2 à 4 ms** sur les quatre fichiers d'essai, jamais les données.
- **Le client dit s'il sait les chercher** (`seekableTrackHeaders`). Android déclare `false`.
- **Un client muet est présumé savoir faire** — c'était le cas de tous jusqu'ici. La présomption
  s'inverse pour `deviceClass` `mobile` et `tv` : **les versions Android antérieures à r68 sont donc
  corrigées par le serveur seul**, sans attendre l'installation de l'application.
- **Le pari sur la lecture directe s'abstient** : il repose sur trois signaux — une erreur, un
  compteur, une quarantaine — et ici il n'y en a aucun. Le module `essai-direct.ts` réservait déjà ce
  raisonnement au film muet ; il en existe donc deux cas, et le second est nommé.
- **Le mode « direct » demandé explicitement ne passe pas outre** : le bouton « Essayer en direct » ne
  doit pas ramener une image noire.

### Ce qui ne change pas

Le navigateur garde sa lecture directe sur ces fichiers — il suit le renvoi sans y penser, et lui
imposer un remux ferait travailler le NAS pour rien. Un fichier ordinaire n'est pas touché, sur aucun
client. Aucune migration.

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Détection sur les quatre fichiers d'essai | 2 vrais positifs, 2 vrais négatifs, 2–4 ms |
| Remux de *H* | `init.mp4` porte `hevc` + `aac` en tête de flux |
| Suite serveur | **71 fichiers, 666 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

**Le doute profite au fichier** : toute difficulté d'analyse — taille inconnue, identifiant inattendu,
lecture trop courte — répond « tout va bien ». Se tromper dans ce sens coûte le défaut déjà connu sur
les seuls fichiers concernés ; se tromper dans l'autre imposerait un remux à une bibliothèque saine.

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Les deux séries, sur l'appareil** | La cause est mesurée dans les fichiers et la correction vérifiée hors ligne, mais la lecture n'a pas été observée sur un mobile ni sur le téléviseur. |
| Décalage audio après un saut (r67) | la règle E-AC-3 élargie n'a pas encore été éprouvée sur l'appareil |
| Décalage des sous-titres (r63) | même réserve |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |

La ligne de journal posée en r67 (`Décision de lecture — … mode=… audio=…`) donnera désormais le mode
retenu pour chaque fichier : c'est elle qu'il faudra lire en premier si un fichier résiste encore.

## 7. Confirmé sur l'appareil

**Validé par l'utilisateur le 25 août 2026.** Les quatre séries se lisent sur Android — 300 fichiers
que la lecture directe rendait injouables depuis toujours, sans qu'aucune erreur ne le signale.
La cause n'a été trouvée qu'en mesurant la position de l'élément `Tracks` dans les fichiers.
