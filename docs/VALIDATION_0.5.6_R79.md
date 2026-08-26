# Validation 0.5.6.r79 — le client Windows cesse d'inventer ses capacités, et déclare son statut

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Le client annonçait au serveur des choses fausses

La négociation de lecture repose **entièrement** sur ce que le client déclare : le serveur choisit la
lecture directe, le remultiplexage ou la conversion à partir de cette déclaration. Une déclaration
fausse ne se voit donc pas comme une erreur — elle se voit comme une lecture qui échoue, ou comme un
son qui manque. C'est précisément la classe de défaut à laquelle la semaine entière a été consacrée
côté Android.

Deux mensonges, tous deux en dur :

| Déclaré | Réalité |
| --- | --- |
| `maxWidth = 7680, maxHeight = 4320` | la définition de la machine, quelle qu'elle soit — un portable 1080p réclamait de la 8K en lecture directe |
| Une case « Écran HDR / Atmos » commandant HDR **et** Dolby Atmos, DTS:X, Auro-3D, seize canaux, audio sans perte | un écran HDR branché sur les haut-parleurs d'un portable est un cas ordinaire, et l'inverse aussi |

Le second est le plus coûteux. Un poste HDR en stéréo annonçait seize canaux immersifs, et le serveur
**renonçait au mixage** dont ce poste avait précisément besoin.

## 2. Ce que le client peut honnêtement dire

- **La définition vient de l'écran**, en pixels réels. `SystemParameters` rend des points d'affichage :
  sur un écran à 150 %, un 2560 × 1440 s'annoncerait 1707 × 960, et le serveur convertirait des vidéos
  que la machine affiche parfaitement. La matrice de la cible d'affichage porte le facteur.
- **Le HDR reste une case**, et ne commande plus que le HDR.
- **La sortie audio est un réglage à part** : stéréo par défaut, 5.1, 7.1, ou amplificateur. L'audio
  immersif et l'audio sans perte ne sont annoncés que dans le dernier cas — le seul où ils ont un sens,
  puisque c'est l'amplificateur qui décode.
- **Les codecs restent ceux que VLC sait lire**, TrueHD et DTS compris : le codec dit ce qu'on sait
  décoder, `maxAudioChannels` dit ce qu'on sait restituer. Les retirer d'un poste stéréo ferait
  convertir des pistes que la machine lit très bien.

La stéréo est le défaut parce que c'est la seule valeur qui ne ment jamais : deux haut-parleurs
existent toujours.

## 3. Le statut : expérimental, déclaré et non subi

Les trois autres clients suivent les révisions du serveur au jour le jour et sont éprouvés à chacune.
Celui-ci ne l'est pas au même degré. Le dire vaut mieux que de laisser croire le contraire — et le
statut apparaît là où on le lit sans ouvrir le dépôt : **dans le titre de la fenêtre**.

| | |
| --- | --- |
| Tests | **17**, contre 8 |
| Négociation de lecture | éprouvée par ses tests, pas sur un parc d'écrans et d'amplificateurs |
| Accès distant | **non pris en charge** — vérifié : le client n'envoie ni jeton d'API ni compte de session, donc réseau local seulement |
| Administration | absente : bibliothèques, analyses et réglages passent par le Web |

Ce n'est pas un client abandonné : lecture directe, remultiplexage, conversion, pistes, reprise et
historique fonctionnent. C'est un client dont on n'a pas la même certitude, et qui reçoit les
correctifs de fond — celui-ci en est un — sans passer par la même qualification.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Tests Windows | **17 sur 17**, 0 échec, 497 ms |
| Suite serveur | 82 fichiers, 756 tests, 0 échec |
| Suite Web | 20 fichiers, 174 tests, 0 échec |
| Construction du client et de ses tests | 0 erreur, 0 avertissement |

Neuf cas nouveaux, dont deux qui verrouillent exactement le défaut : **le HDR n'a aucun effet sur
l'audio**, et **l'audio n'a aucun effet sur le HDR**. Les autres couvrent la définition prise sur
l'écran, le garde-fou d'une définition aberrante, les canaux de chaque sortie, la relecture d'un
réglage inconnu, et l'index de sous-titres négatif qui signifie « aucun ».

Le README du client Windows rejoint par ailleurs le garde-fou de versions : son titre porte la version
du produit, et un test échoue s'il dérive.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| Construire depuis un disque local | Le garde-fou refuse le partage ; le dépôt Git rend le clone facile. |
| Jeton d'API et compte de session côté Windows | Ce qui lèverait la restriction au réseau local. |
| Avertissements Android de sécurité | Service exporté sans permission, configuration réseau permissive. |
| La cadence de r73 sur le NAS, le lecteur sur téléviseur | inchangés depuis r75 |
