# Validation 0.5.6.r61 — mesure fiable, réglages à l'écran, accès distant vérifiable

*24 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

r61 corrige une régression constatée après l'installation de r60, rend réglables deux choses qui ne
l'étaient pas, et donne à l'accès distant le moyen de dire pourquoi il ne répond pas.

## 1. La régression de capacité : cause trouvée

Après r60, l'écran annonçait VA-API à 408 im/s au lieu de 471, un budget de 6,5 au lieu de 7,5, et six
sessions 1080p au lieu de sept. Deux causes distinctes, toutes deux réelles.

### 1.1 Les deux micro-bancs se disputaient le GPU

`getCapacityReport` lançait le calibrage des encodeurs **et** celui du tone mapping par deux `void`
successifs. Les deux mesurent le même nœud de rendu : le banc d'encodage VA-API tournait donc pendant
que le banc de tone mapping occupait `/dev/dri/renderD128`.

Le symptôme était trompeur au point d'égarer : **l'encodage logiciel revenait à sa valeur normale
(142 im/s) tandis que VA-API s'effondrait à 265.** Un tableau qui montre le processeur intact et
l'accélérateur divisé par deux fait chercher une panne de pilote ou un problème de droits. Il n'y en
avait aucun.

En r58, le tableau affichait `toneMapping: []` : ce second banc n'avait jamais abouti, et l'encodeur
avait le GPU pour lui seul. D'où les 471 im/s d'origine.

**Correction :** une file d'attente — jamais deux bancs simultanés — et le tone mapping n'est demandé
qu'**après** l'aboutissement du calibrage des encodeurs. La file couvre aussi le bouton « refaire les
mesures » : deux clics rapprochés produisaient le même faux effondrement.

### 1.2 Une mesure prise pendant une installation était retenue comme vérité

La signature de calibrage contient la révision du paquet — à raison : deux révisions peuvent annoncer
le même FFmpeg en embarquant des bibliothèques différentes. Mais installer r60 invalidait donc le
calibrage et en déclenchait un nouveau **pendant l'installation**, quand le paquet extrayait 205 Mio
de FFmpeg et changeait le propriétaire de tout le partage.

**Correction :** pour une signature donnée, on conserve le **meilleur** relevé de chaque accélérateur.
Un micro-banc ne peut que sous-estimer — rien de ce qui tourne à côté ne rendra l'encodeur plus
rapide qu'il n'est. Le maximum observé est donc l'estimation la plus proche de la vérité, et la seule
qui ne se dégrade pas toute seule. La signature reste le garde-fou : un pilote corrigé ou une
bibliothèque ajoutée la fait changer et l'historique est abandonné, ce qui est correct.

## 2. Un diagnostic qui cessait d'être franc

Le tone mapping VA-API était annoncé « **Le nœud de rendu /dev/dri n'est pas visible depuis le
service** », alors que l'encodeur VA-API tournait à 408 im/s dans le même processus. Le classificateur
d'erreurs voyait la chaîne `/dev/dri` dans le message et concluait à l'invisibilité ; l'erreur réelle
était `Invalid argument` sur le filtre.

Ce message envoyait vérifier des droits qui n'avaient rien à se reprocher. Trois corrections :

- l'invisibilité n'est affirmée que si le message la décrit vraiment (`no such`, `cannot open`,
  `does not exist`…) ;
- `Unable to open the libvulkan library` devient « Bibliothèque Vulkan absente de cette installation »
  — c'est une bibliothèque qui manque au paquet, pas un matériel ;
- `Failed to get number of OpenCL platforms` devient « Aucun pilote OpenCL installé ».

## 3. Le plafond de conversions devient réglable

Il valait 2, écrit en dur, sur une machine qui en soutient sept. Le `?? 2` de `config.ts` rendait
« non posée » et « posée à 2 » indiscernables, ce qui empêchait tout mode automatique.

Désormais : **`auto` suit la mesure de cette machine**, ou l'on impose une valeur. L'écran affiche la
recommandation à côté du réglage — sept ici, deux sur un NAS sans accélérateur. Aucune constante ne
pouvait convenir aux deux.

Le plafond ne remplace pas le budget : deux sessions 4K coûtent tout le budget et resteront refusées
quel que soit ce nombre, comme la limite thermique et la réserve d'interface.

## 4. L'accès distant se règle et se vérifie à l'écran

Le domaine ne se posait que dans un fichier atteignable en SSH. Il se règle maintenant dans
*Configuration du serveur → Mode expert → Accès depuis Internet*.

**Deux lecteurs, une source de vérité.** Le domaine est lu par le serveur Node *et* par le script
shell qui lance Caddy — or le shell ne sait pas lire SQLite. Le serveur écrit donc `data/wan.env`, que
le script source **après** `flixtunes.env` : le réglage d'écran l'emporte, le fichier historique reste
la valeur par défaut.

**Le bouton « Vérifier l'accès distant »** contrôle six maillons et donne pour chacun le geste qui le
corrige : domaine enregistré, résolution DNS, concordance avec l'adresse publique de la box, écoute
interne, proxy Caddy, certificat obtenu, et profils réellement joignables. Sans lui, l'échec de
n'importe lequel produit le même symptôme — une page qui ne s'ouvre pas.

Le domaine est validé par une expression stricte : ce texte finit concaténé dans un fichier de
configuration Caddy, et une valeur contenant une accolade ou un saut de ligne y ajouterait des
directives, sur le composant exposé à Internet.

Ces trois routes ne figurent pas dans la liste blanche du WAN : on ne règle pas l'ouverture d'une
porte depuis l'extérieur de celle-ci.

## 5. Hors-root : la cause de l'échec de r60

`privileges.log` de r60 : « compte flixtunes créé », « propriété transférée », puis « **renderD128
illisible par flixtunes — le service restera en root** ». Le filet a joué, VA-API a été préservé.

La cause est nette : sur cet ADM, `/dev/dri/renderD128` est en `crw-rw---- root root`, et **il
n'existe ni groupe `video` ni groupe `render`** — les noms que tout le reste du monde Linux emploie.
La boucle de r60 cherchait des groupes inexistants.

Sur un poste Linux ordinaire, c'est une règle `udev` qui accorde ce périphérique. ADM n'en a pas :
`start-stop.sh` le fait donc à chaque démarrage, `/dev` étant reconstruit à chaque redémarrage du NAS.
Le propriétaire reste `root` et seul le groupe change — root garde son accès par la propriété, et rien
d'autre que ce compte ne gagne quoi que ce soit. C'est l'inverse d'ajouter le compte au groupe `root`,
qui lui donnerait accès à tout ce que ce groupe protège.

## 6. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **64 fichiers, 613 tests, 0 échec** |
| Suite Web | **20 fichiers, 170 tests, 0 échec** |
| Typechecks serveur, contrats, Web | aucune erreur |
| `bash -n` sur les scripts d'empaquetage | valides |

Huit tests neufs verrouillent les corrections du §1 et du §2 : le meilleur relevé est conservé, une
mesure meilleure est acceptée, un changement de signature abandonne l'historique, un accélérateur
devenu inutilisable n'est pas ressuscité, et le diagnostic n'accuse plus le nœud de rendu quand la
session s'ouvre et que seul le filtre échoue.

## 7. Reste à exécuter

**Rien de ce qui précède n'a tourné sur le NAS** : ce poste n'a pas d'accès authentifié pour installer
le paquet. Restent donc à constater après installation :

| Sujet | Où le lire |
| --- | --- |
| Le hors-root aboutit-il enfin ? | `logs/privileges.log`, ligne « périphérique de rendu accordé au groupe » |
| VA-API revient-il à ~471 im/s et 7 sessions ? | écran de capacité, après une mesure **machine au repos** |
| La chaîne distante | bouton « Vérifier l'accès distant » |
| Certificat Let's Encrypt réel | dépend de la redirection 80/443 sur la box |
| `caddy validate` sur le document engendré | jamais soumis au binaire |

**Ordre conseillé** : installer, lire `privileges.log`, refaire les mesures au repos, vérifier le
plafond à 7 — **puis seulement** poser le domaine et rediriger les ports. Séparer les deux permet
d'imputer un défaut aux droits ou au certificat, au lieu d'une panne illisible.
