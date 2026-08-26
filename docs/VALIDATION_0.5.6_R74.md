# Validation 0.5.6.r74 — l'avancement dit le travail, et le repérage s'active

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Un compteur qui mentait

Après une nuit de repérage, l'écran annonçait :

```
Génériques de séries
0 saison sur 434 · 1923 — saison 2
```

Question posée en retour, et parfaitement fondée : *« t'es sûr que ça ne reprend pas de zéro ? »*

Non — et le **434** en était la preuve, encore fallait-il le savoir. Les chiffres réels, relevés en
base au même instant :

| | Au démarrage, la veille | Le lendemain matin |
| --- | --- | --- |
| Saisons dans la file | 477 | **434** |
| Épisodes écoutés | 388 | **989** |
| Introductions trouvées par le son | 188 | **556 (56 %)** |

Quarante-trois saisons étaient sorties de la file parce qu'elles étaient faites. Le travail était
intact ; c'est la présentation qui mentait.

## 2. La cause, et pourquoi elle était délibérée

L'état de la passe vivait **en mémoire**, avec ce commentaire dans le code de r72 :

> « il ne survit pas à un redémarrage, et c'est très bien, puisqu'une passe ne lui survit pas non plus »

Le raisonnement est juste du point de vue de l'exécution, et faux du point de vue de celui qui
regarde. Ce qu'on veut voir n'est pas *où en est cette exécution*, mais *où en est le travail*.

**L'avancement se lit désormais en base** : saisons traitées sur saisons concernées, épisodes écoutés,
introductions trouvées. Il survit aux redémarrages, parce que le travail y survit. Seul ce qui n'a de
sens que pendant une passe — la saison en cours d'écoute, l'heure de démarrage — reste en mémoire.

La ligne reste par ailleurs visible **hors passe**, avec la mention « en attente d'une analyse », tant
qu'il demeure des saisons à traiter. Elle disparaît quand tout est fait.

## 2 bis. Deux chiffres, parce qu'il y a deux questions

L'avancement global ne suffisait pas : il dit **où en est le travail**, pas **si ça avance en ce
moment**. Une passe restée à zéro saison depuis dix minutes signale un blocage que le total, qui ne
recule jamais, ne montrerait pas. L'écran porte donc les deux lignes :

```
Génériques de séries                                        depuis 10:35:45
43 saisons sur 477 · 556 introductions repérées · 989 épisodes écoutés
Passe en cours · 3 saisons traitées · 12 trouvées · Altered Carbon — saison 1
```

Hors passe, la seconde ligne dit ce qu'on attend : « En attente d'une analyse », « Repérage désactivé »,
ou « Toutes les saisons sont traitées ». La barre, elle, suit le total — celui qui ne recule pas.

## 2 ter. Le repérage s'active, il ne s'impose plus

La passe sonore décode. Sur le Celeron à quatre cœurs du NAS, elle occupe des heures de machine pour
un confort — sauter un générique — dont on ne veut pas forcément. **Une fonction qui coûte cela se
demande** : un interrupteur rejoint les lanceurs du centre d'analyse, **désactivé par défaut**.

| Geste | Ce qu'il fait | Ce qu'il ne fait pas |
| --- | --- | --- |
| **♪ Génériques : activé / désactivé** | Autorise ou interdit l'écoute. Réglage **en base**, donc il tient après un redémarrage. | Il n'efface aucun repère déjà trouvé. |
| **Arrêter** | Interrompt la passe en cours, à la fin de l'épisode écouté — deux à trois secondes. | Il ne touche pas au réglage : la prochaine analyse reprendra. |

Les deux gestes sont distincts parce que les intentions le sont : éteindre dit « je ne veux pas de
cette fonction », arrêter dit « pas maintenant ». Rien n'est perdu dans un cas comme dans l'autre,
puisque l'avancement vit en base.

Désactivé, **les repères déjà trouvés restent proposés dans le lecteur** : ils ne coûtent plus rien. Les
deux sources gratuites — chapitres du fichier, voisins de saison — continuent également de travailler ;
les priver n'économiserait rien et ferait perdre des repères acquis.

Deux points sont apparus en construisant l'interrupteur, et tous deux sont corrigés :

- **Activer lance la passe tout de suite**, au lieu d'attendre la prochaine analyse. Sans cela le clic
  n'aurait rien produit de visible, alors que c'est précisément ce qu'on vient de demander.
- **Une passe à la fois.** Elle pouvait déjà être déclenchée par deux analyses finissant ensemble ;
  elle l'est maintenant aussi par l'interrupteur. Deux passes simultanées se disputeraient les mêmes
  saisons et le même processeur, et la seconde écraserait l'avancement affiché par la première.

L'interrupteur et l'arrêt **ne sont pas exposés depuis Internet**, à la différence de l'avancement qui,
lui, se lit à distance. Allumer une passe qui décode pendant des heures est un geste sur la machine,
pas sur la médiathèque ; le garde-fou d'exposition WAN l'a signalé de lui-même, et le refus est inscrit.

## 2 quater. Une seule apparence pour les commandes du panneau

Les boutons sans classe retombaient sur le rendu du navigateur : gris très clair, texte noir. Le
contraste y est bon dans l'absolu, mais ils **crient** au milieu d'un panneau sombre — « Films
uniquement » pesait plus lourd que « Tout analyser », qui est pourtant le bouton bleu.

Trois formes, une par rôle, définies en un seul endroit de la feuille de style :

| Rôle | Forme | Contraste mesuré |
| --- | --- | --- |
| Commande principale | le seul aplat bleu | 18,7:1 |
| Commande secondaire | contour sur voile clair | **12,67:1, à l'identique sur les onze** |
| Champ | fond sombre encadré, comme le formulaire d'ajout | 19,68:1 |

Les onze commandes secondaires du panneau — lanceurs d'analyse, actions de bibliothèque, boutons des
fournisseurs, interrupteur, arrêt — relèvent toutes de la même règle : le chiffre est le même pour
toutes, ce qui est la preuve de l'uniformité. Le seuil AAA du WCAG est à 7:1.

## 3. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **78 fichiers, 736 tests, 0 échec** |
| Suite Web | **20 fichiers, 174 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Contraste des commandes secondaires | **12,67:1**, mesuré dans le navigateur |

Quatre cas vérifient précisément ce qui a manqué : l'avancement reste renseigné après une passe —
c'est le travail qui est compté, pas l'exécution ; désactivé, rien n'est écouté mais les voisins
travaillent toujours ; l'activation se relit en base ; et éteindre pendant une passe l'arrête au lieu
d'attendre la fin — elle ne redemande pas de créneau.

## 4. Le lecteur Android est confirmé sur appareil

**Validé par l'utilisateur le 26 août 2026** en testant r72, dont l'application Android est identique à
celle de r69 — aucun code client n'a changé depuis. Sont donc confirmés sur mobile : le titre dans le
bandeau, la carte d'enchaînement en bas à droite avec sa jauge, et le bouton « Passer le générique ».

C'était la plus ancienne réserve encore ouverte de la série r67–r73.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **La cadence de r73 sur le NAS** | Le gain est raisonné sur des unités de coût mesurées ; la cadence réelle reste à constater. |
| Le lecteur sur téléviseur | Le mobile est validé ; la TV ne l'est pas encore. |
| Mesures de capacité au repos | rétabliront le plafond à 7 |

## 6. Ce que cette série aura appris

Trois défauts livrés en r71 et r72 — cent heures de traitement, un compteur qui repart de zéro, trois
témoins au lieu de quatre — ont tous été trouvés **en service, par la mesure**, jamais en relisant le
code. Et deux d'entre eux l'ont été parce qu'une question a été posée sur ce que l'écran montrait.
