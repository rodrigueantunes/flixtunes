# Validation 0.5.6.r76 — le compteur d'avancement peut enfin atteindre son terme

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Le défaut, mesuré avant d'être corrigé

Une saison dont **tous** les épisodes portent leurs propres chapitres ne quittait jamais la file de
repérage. Constaté sur un banc jeté depuis, et repris ici comme cas permanent : quatre épisodes
chapitrés, une passe complète, la saison toujours comptée « restante ».

La cause tient en deux phrases, chacune juste isolément :

- les repères venus des chapitres **ne se rangent pas en base** — décision de conception explicite, et
  fondée : ils se relisent du fichier, gratuitement, et sont toujours plus sûrs qu'une déduction ;
- la file, elle, **ne consulte que la base**. N'y voyant rien, elle conclut qu'il reste tout à faire.

L'effet en machine est négligeable : la saison est écartée en une requête. L'effet à l'écran ne l'est
pas. **44 % des épisodes sont chapitrés** : le compteur ne pouvait pas descendre à zéro, et un
compteur qui ne converge jamais finit par ne plus rien vouloir dire — c'est exactement ce qui avait
motivé r74.

## 2. Le remède, et ce qui le rend sans danger

La passe recopie en base l'introduction que les chapitres désignent, avec sa provenance `chapitre` —
la plus forte du classement, qu'aucune autre source ne peut écraser.

Reste l'objection qui avait fait écarter ce rangement à l'origine : **une copie peut se périmer**. Un
fichier remultiplexé sans ses chapitres laisserait en base un repère qui ne correspond plus à rien, et
le lecteur proposerait un saut vers un endroit qui n'existe plus.

**La copie ne sort donc jamais du magasin.** Une introduction de provenance `chapitre` n'est plus
servie par `getPlaybackInfo` :

- si le fichier a ses chapitres, ils ont déjà répondu — ils passent en premier, comme avant ;
- s'il ne les a plus, la copie est périmée **par définition**, et l'écarter est la seule chose juste.

Une condition, et l'objection tombe. Le lecteur ne change pas de comportement d'un iota ; seule la
file gagne l'information qui lui manquait.

## 3. Ce qui n'est pas compté deux fois

La copie n'inscrit **ni écoute ni découverte** : `ecoute_le` reste vide, et `source_intro` vaut
`chapitre`, jamais `empreinte`. Les deux chiffres affichés gardent donc leur sens exact :

| Compteur | Ce qu'il mesure | Effet de r76 |
| --- | --- | --- |
| Épisodes écoutés | ce que la passe sonore a réellement décodé | **aucun** |
| Introductions repérées | ce que l'empreinte sonore a trouvé | **aucun** |
| Saisons traitées | ce qu'il n'y a plus à faire | **converge enfin** |

Aucune migration n'est nécessaire : la première passe visite les saisons de la file, y range les
repères de chapitre au passage, et elles en sortent. Les saisons chapitrées coûtent une requête.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **79 fichiers, 740 tests, 0 échec** |
| Suite Web | 20 fichiers, 174 tests, 0 échec |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

Trois cas nouveaux, dont deux gardent le remède de ses propres effets de bord :

- une saison entièrement chapitrée **quitte la file**, et ses épisodes portent la provenance `chapitre` ;
- le lecteur **ne sert pas** une copie `chapitre` quand le fichier n'a plus de chapitres ;
- il sert **en revanche** ce que l'empreinte sonore a trouvé — la règle ne devait pas déborder.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| La cadence de r73 sur le NAS | Le gain est raisonné sur des unités de coût mesurées ; la cadence réelle reste à constater. |
| Le lecteur sur téléviseur | Le mobile est validé ; la TV ne l'est pas encore. |
| Mesures de capacité au repos | rétabliront le plafond à 7 |
