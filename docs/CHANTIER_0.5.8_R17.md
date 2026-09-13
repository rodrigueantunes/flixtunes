# Chantier 0.5.8.r17 — le direct sans coupure, des chaînes regroupées, des sources classées

*13 septembre 2026. Ce document ne construit rien : il dit ce qui est **mesuré**, ce qui est
**proposé**, et ce qu'il faut décider avant d'écrire la première ligne.*

**Rien n'est engagé tant que le feu vert n'est pas donné.**

Les demandes se tiennent : le regroupement des chaînes (§4) multiplie les sources de chacune, ce qui
rend leur classement (§5) indispensable. Et un classement fondé sur une mesure fraîche suppose que la
grille se rafraîchisse quand le fichier de listes change (§3).

---

## 1. Une chaîne qui se fige doit repartir sans que personne ne s'en aperçoive

### Ce qui se passe aujourd'hui

Le Web (`LecteurDirect.tsx`) et Android (`LecteurDirectActivity.kt`) suivent la même logique :

| Moment | Réaction actuelle |
| --- | --- |
| ouverture | on vise `CIBLE_MAX_S` = 40 s derrière le direct, dans la limite de la fenêtre publiée moins 20 s de marge arrière |
| tampon sous 10 s, puis sous 5 s | la qualité baisse d'un cran, puis passe au plus bas |
| erreur réseau fatale sur un flux déjà stable | jusqu'à 3 reprises (`startLoad`), après 2, 5 puis 10 s |
| image figée 8 s (`IMAGE_FIGEE_MS`) ou blocages répétés | la qualité est plafonnée d'un cran si c'est possible ; sinon, **passage à la source suivante** (8 au plus) |

**Le constat qui explique la demande.** Relancer à la main repart **du bord du direct, sur la même
adresse, avec un manifeste neuf**, et c'est ce qui répare. Le lecteur automatique ne fait jamais ce
geste : il baisse la qualité ou change de source. Et il ne réagit qu'après huit secondes d'image
arrêtée, donc une fois la coupure déjà visible.

### Proposition

1. **Voir venir la panne au lieu de la constater.** Surveiller le **chargement** — un bord de tampon
   qui n'avance plus, un manifeste qui ne se renouvelle plus — pendant que l'image joue encore sur le
   tampon. Avec 40 s d'avance, il reste des dizaines de secondes pour agir.
2. **Relancer la même source en arrière-plan.** C'est le geste manuel, rendu automatique et invisible :
   recharger le manifeste et reprendre le chargement **sans vider le tampon**, pendant que la lecture
   continue sur ce qui est déjà téléchargé. Si la reprise en place ne suffit pas, on prépare un second
   lecteur caché au bord du direct, et l'on bascule dès qu'il a de l'image. On mesure sur hls.js et sur
   Media3 laquelle des deux techniques tient sans coupure avant d'en retenir une.
3. **Une avance qui s'adapte à la fiabilité, jusqu'à 60 s.** Une source stable reste proche du direct.
   Une source qui a déjà calé depuis l'ouverture, ou qui traîne des échecs passés, prend plus d'avance.

**La limite physique.** Un direct ne se met en réserve que sur ce que la chaîne a déjà publié :
60 s d'avance exigent une fenêtre d'au moins 80 s (60 s plus les 20 s de marge arrière). La fenêtre
médiane mesurée sur le corpus est de 61 s, et 92 % des chaînes publient entre 30 s et 2 min. **Sur
environ la moitié des chaînes, l'avance ne pourra pas dépasser 41 s** : elle y sera la plus grande
possible, pas 60 s.

### Cas limites

- **Chaîne réellement éteinte** : la relance silencieuse ne doit pas masquer une vraie panne. Après
  plusieurs relances sans image, on passe à la source suivante et on l'affiche, comme aujourd'hui.
- **Relance qui retombe sur un segment déjà joué ou manquant** : on reprend à la position la plus
  proche, sans saut arrière visible.
- **Pause ou retour volontaire dans la fenêtre** : ce n'est pas une panne, et cela ne déclenche rien.

### Métrique d'acceptation

On la mesure sur les chaînes qui se figent aujourd'hui (liste à fournir) et sur des coupures réseau
provoquées de 5, 15 et 30 s. **Aucune image ne s'arrête tant que le tampon n'est pas épuisé**, la
reprise se fait sans aucune action, et cela sur le Web comme sur Android TV.

### Mesuré le 13 septembre 2026

Banc hors dépôt : hls.js 1.6.17 avec les réglages du lecteur Web, sur CNews (segments de 9 s, fenêtre de
5 min, seule chaîne française du corpus ouverte à toutes les origines), coupure réseau simulée dans le
navigateur. « Silence » : les requêtes restent sans réponse ; « erreur » : elles échouent aussitôt.
« Production » : les trois reprises d'aujourd'hui, puis abandon de la source. « Persistante » : reprise en
place tant qu'il reste du tampon, et relance en place quand aucun segment n'arrive plus.

| Stratégie | Coupure | Avance avant | Plus longue image figée | Reprise après la coupure | Abandon |
| --- | --- | --- | --- | --- | --- |
| production | 5 s, silence | 26,5 s | 0,1 s | 1,3 s | non |
| production | 15 s, silence | 24,5 s | 0,1 s | 5,4 s | non |
| production | 30 s, silence | 26,4 s | 8,1 s | 4,4 s | non |
| production | 60 s, silence | 26,5 s | 37,0 s | 3,2 s | non |
| production | 30 s, erreur | 30,5 s | 4,4 s | 5,1 s | non |
| persistante | 30 s, silence | 30,2 s | 2,7 s | 3,0 s | non |
| persistante | 60 s, silence | 36,1 s | 29,3 s | 5,5 s | non |
| persistante | 30 s, erreur | 20,6 s | 10,2 s | 0,7 s | non |
| persistante, six segments d'avance | 60 s, silence | 48,2 s | 19,3 s | 7,4 s | non |

**Ce que cela établit.**
- Sur une coupure réseau, hls.js **repart seul** : aucune erreur fatale, aucun abandon, jusqu'à 60 s de
  coupure. La relance en place proactive ne s'est jamais déclenchée — les segments reviennent avant.
- L'image ne se fige que lorsque le tampon est épuisé : **la plus longue image figée vaut à peu près la
  coupure moins l'avance**, plus quelques secondes de rechargement. Sur 60 s de coupure : 37 s figées
  avec 26 s d'avance, 29 s avec 36 s, 19 s avec 48 s.
- Le levier est donc l'avance, pas la relance. Et la coupure que la reprise en place ne répare pas est
  ailleurs : la session qui expire, que seul un nouveau manifeste maître renouvelle.
- `loadSource` sur une instance hls.js déjà chargée recrée la `MediaSource` : **le tampon est vidé**,
  l'image coupe. Recharger le manifeste maître en place est impossible ; `stopLoad`/`startLoad(-1)`
  reprend sans vider, mais sur les mêmes adresses de variantes.

**La session qui expire, mesurée ensuite sur le même banc.** L'instance en cours se voit refuser ses
playlists de variantes et ses segments (403), alors qu'un nouveau chargement du manifeste maître
repartirait. « Relève » : une seconde instance cachée sur la même adresse, calée sur le segment que la
première montre, échangée avec elle avant que son tampon ne s'épuise.

| Incident | Stratégie | Avance avant | Plus longue image figée | Issue |
| --- | --- | --- | --- | --- |
| session expirée | production | 24,5 s | 25,7 s, jusqu'à la fin | quatre erreurs fatales, source abandonnée au bout de 38,9 s |
| session expirée | relève | 26,4 s | 0,1 s | relève à la première erreur fatale, faite en 0,2 s, raccord à 0,05 s près ; tampon jamais sous 18,9 s |
| coupure de 45 s | relève | 30,2 s | 18,1 s | aucune relève à tort, aucune erreur fatale ; la reprise en place part, sans effet |

Les 0,2 s de la relève sont flattés par le cache du navigateur, qui avait déjà les segments : une
session renouvelée change d'adresses, et prendra davantage. Le tampon, lui, laissait 19 s de marge.

**Retenu, en conséquence.**
- **L'avance suit la fiabilité** (Web et Android) : 40 s pour une source qui n'a jamais calé, jusqu'à
  60 s pour une source qui a calé depuis qu'on la regarde ou que le serveur connaît pour ses échecs, dans
  la limite de sa fenêtre.
- **La relève cachée, sur le Web**, à la première erreur fatale de réseau d'un flux déclaré stable, avant
  les reprises en place d'aujourd'hui, qui restent le recours si elle échoue. Aucun déclencheur sur le
  silence des segments : une coupure repart seule, et une relève n'y chargerait rien.
- **Android garde la reprise en place** : un second lecteur sur Android TV est écarté par la décision 1,
  la plupart des boîtiers n'offrant qu'un décodeur matériel. `prepare()` y recharge déjà le manifeste
  maître, au prix de quelques secondes de chargement visibles.

**Constaté pendant la vérification dans le navigateur, et corrigé.**
- **Le lecteur Web a pu jouer collé au bord** : 1,7 s de tampon relevées sur une fenêtre de cinq
  minutes, à la première ouverture de CNews ; 22 à 28 s aux ouvertures suivantes. Le seuil « en direct »
  se comptait à 12 s du bord alors que le lecteur visait bien plus loin, si bien que « Revenir au
  direct » renvoyait au bord ; et le retour automatique pouvait agir pendant l'ouverture, la vidéo
  encore à zéro. « En direct » se mesure désormais à l'avance visée, y revenir la garde, et le retour
  automatique attend cinq secondes de lecture. Revérifié : 18 à 28 s de tampon, « EN DIRECT » affiché.
- **Sur Android**, le rattrapage du fond de la fenêtre se replaçait à 12 s du bord, et ExoPlayer faisait
  de ce saut sa nouvelle cible. Il revient à la position par défaut, et « EN DIRECT » s'y mesure.

---

## 2. Le bouton « épisode précédent » sur le Web

**Constat.** `Player.tsx` écrit ce bouton en texte, `|◀`, dans un `.player-icon-button` large de 38 px,
avec une police à 1,1 rem. Les deux caractères ne tiennent pas sur une ligne : le `|` passe au-dessus du
`◀` (capture du 13 septembre, *Lanterns* S1 E2). Seul le Web est concerné.

**Proposition.** Une icône SVG « précédent », du même dessin que les autres commandes et de taille
fixe. Tout autre bouton d'icône encore écrit en texte reçoit le même traitement. On vérifie par une
capture dans le navigateur, sur un écran large et sur un écran étroit.

---

## 3. Rafraîchir quand le fichier de listes est prêt, pas avant

**Constat.** FlixTunes relit le fichier toutes les `cadenceHeures` (12 h par défaut), ainsi qu'à la
demande par `POST /api/system/live/rafraichir`, qui ne double jamais une passe en cours. Or le fichier
est refait chaque matin : les chaînes du jour peuvent donc attendre jusqu'à douze heures.

**Proposition recommandée : surveiller le fichier réglé.** On utilise le surveillant déjà employé pour
les médiathèques (`chokidar`, avec `awaitWriteFinish`) : quand le fichier change et que son écriture est
terminée, on relit. Il n'y a aucune route à ouvrir ni aucun secret à partager, et tout outil qui produit
le fichier en profite. Un fichier illisible est ignoré, et la passe précédente reste en place. Pour
qu'une lecture ne tombe jamais sur un fichier à moitié écrit, le fichier doit être remplacé d'un bloc :
écrit à côté, puis renommé.

**Alternative : un appel HTTP en fin d'écriture.** Il faudrait l'authentifier : la route existante vit
sous `/api/system`, et un producteur externe n'y a pas de session.

*Décidé le 13 septembre : l'appel HTTP, sans relecture périodique (§6).* Esquisse :
- une route dédiée à cette seule demande, protégée par un **jeton propre à cet usage**, généré et
  affiché dans les réglages du direct, révocable, et conservé en base sous forme d'empreinte ;
- elle répond tout de suite. Une demande qui arrive pendant une passe est rejouée **une fois**, à la
  fin de cette passe ;
- `cadenceHeures` et la relecture du démarrage sont retirées. Sur une installation neuve, la première
  passe se lance avec « Relire les listes », ou par une première demande ;
- si le serveur est injoignable au moment de l'appel, le producteur réessaie quelques fois. Au-delà,
  la grille garde la passe précédente jusqu'à l'appel suivant.

**Cas limites.**
- Le fichier change pendant une passe : on relit une fois à la fin de la passe.
- Plusieurs écritures s'enchaînent : une seule relecture.
- Le fichier est supprimé : rien n'est retiré de la grille.
- Le NAS redémarre : la cadence peut rester en filet de sécurité (décision 2).

**Métrique.** La grille reflète le nouveau fichier moins d'une minute après la fin de son écriture, sans
qu'aucune relecture ait lieu pendant l'écriture.

---

## 4. Des chaînes mieux regroupées — pour toutes les chaînes

**Constat.** La clé de fusion est le nom normalisé, numéro en tête retiré. « Talent TV » et « Talent TV
(720p) » sont donc deux chaînes, chacune avec ses propres sources.

**Mesuré sur la base du NAS** (copiée le 13 septembre, 99 902 chaînes présentes), avec un regroupement
qui retire les décorations : qualité, balises entre parenthèses ou crochets, préfixe de pays, symboles et
exposants.

| | Avant | Après |
| --- | --- | --- |
| Chaînes présentes | 99 902 | 79 494 |
| Chaînes rangées en France | 4 049 | 2 344 |
| Groupes qui réunissent plusieurs chaînes | — | 11 217 (31 625 chaînes) |
| Chaînes à plus de 8 adresses | 647 | 1 250 |
| Adresses de la chaîne la mieux fournie | 53 | 93 |

Échantillon tiré au hasard : « Talent TV | Talent TV (720p) », « Canal Motor | Canal Motor (720p) | Canal
Motor HD », « Pluto TV Kids Séries (360p) | Pluto TV Kids Séries (720p) », « ZICO TV (1080p) | ZICO TV
(720p) ».

**Pourquoi il faut un regroupement « intelligent ».** La version naïve fusionne aussi à tort :
- des **déclinaisons de langue ou de pays** : « NHK World TV (ESP) » avec « NHK World TV (FR) », « STAR
  Channel (Finland) » avec « STAR CHANNEL » ;
- des chaînes dont les **identifiants se contredisent** : 3 518 groupes réunissent des `tvg-id`
  différents. Ce sont souvent des numéros sans valeur (« 58335 »), mais parfois deux identifiants
  iptv-org distincts, qui prouvent qu'il s'agit de deux chaînes.

**Proposition.**
1. Ne retirer que les décorations **reconnues** : qualité (HD, FHD, UHD, 4K, 1080p, 720p…),
   `[Not 24/7]`, `[Geo-blocked]`, `(Backup)`, `(Opt-3)`, `(Opc. 1)`, préfixes `FR:` ou `|FR|`,
   exposants et drapeaux.
2. **Garder distinct** ce qui, entre parenthèses, désigne une langue, un pays ou une ville.
3. **Faire du `tvg-id` un arbitre.** Deux identifiants iptv-org différents (forme `nom.pays`)
   interdisent la fusion. À l'inverse, un même identifiant réunit des écritures que le nom seul sépare :
   « 3cat » et « TV3 Cat » partagent `tv3cat.es`. 2 196 identifiants sont dans ce cas.
4. Ne jamais fusionner les **décalages horaires** (`+1`, `+2`).

**Cas limites.**
- Chaque chaîne a un numéro unique : une fusion garde celui de la chaîne survivante, en préférant le
  numéro posé à la main, puis le plus petit.
- Ce qui est rattaché à une chaîne (favoris, historique) doit suivre la survivante : à recenser.
- La migration peut être rejouée, et elle est vérifiée sur une copie de la vraie base avant livraison.

**Métrique.** Zéro fausse fusion sur un échantillon de groupes tirés au hasard et vérifiés à la main,
et le nombre de chaînes et d'adresses relevé avant et après.

**Construit le 13 septembre 2026.**

- **La clé** retire les décorations reconnues — définition, codage, cadence, `[Geo-blocked]`,
  `[Not 24/7]`, `(Opt-2)`, noms de domaine, symboles, exposants — et garde toute autre balise. Un mot de
  décoration en tête ne part que s'il reste deux mots derrière : « VIP TV » ne devient pas « TV ». Le
  préfixe de pays (`FR:`, `|FR|`) **n'est pas retiré** : « FR: TF1 » réunit déjà ses propres écritures,
  et ce préfixe sépare souvent une langue.
- **L'arbitre.** L'identifiant ne tranche que s'il ressemble au nom : 19 118 des 22 061 identifiants de
  forme iptv-org. La première déclaration d'un pays pour une clé la garde ; celle d'un autre pays écrit
  sa déclinaison à part (`canal family@pl`). Posé une fois, le pays de la clé ne bouge plus.
- **La France, sans rien exclure.** Une chaîne rangée en France réclame sa clé sans pouvoir en écarter
  une autre, et une chaîne réunie qui comptait une écriture visible en France y reste. Sans ces deux
  règles, 59 chaînes quittaient la France, dont Eurosport 1 et 2, Euronews et Canal+ Premier League.
- **Non retenu** : réunir deux noms différents parce qu'ils partagent un identifiant (« 3cat » et
  « TV3 Cat »). L'identité d'une chaîne dépendrait de la liste lue en premier.
- **La migration** va par lots de 300 chaînes, avec un cache de 64 Mio et des points de contrôle
  espacés le temps de la passe. Elle part 20 s après le démarrage, ou au début de la première relecture
  si celle-ci vient avant.

Mesuré sur une copie de la base du NAS, sur un poste de développement :

| | Avant | Après |
| --- | --- | --- |
| Chaînes présentes | 99 902 | 88 027 |
| Chaînes rangées en France | 4 049 | 2 519 |
| Chaînes à plus de 8 adresses | 647 | 889 |
| Adresses de la chaîne la mieux fournie | 53 | 81 |
| Déclinaisons d'un autre pays mises à part | — | 401 |
| Adresses, doublons retirés | 134 003 | 128 428 |

- Migration : 51 167 lignes réunies en 28 903 chaînes, en 11,6 s, jamais plus de 364 ms sans répondre
  (médiane 34 ms). D'un seul tenant, elle bloquait le serveur 9,2 s. Mémoire : +318 Mio le temps de la
  passe.
- Vérifié : numéros 1 à 30 et dernière chaîne regardée inchangés, clés étrangères et index de recherche
  intègres, chaque identifiant dérivé de sa clé, seconde passe sans rien déplacer ; 30 groupes tirés au
  hasard relus un à un, aucune fausse fusion.
- **À relever sur le NAS** : la durée réelle, écrite au journal avec le bilan de la passe.

---

## 5. Toutes les sources, les meilleures d'abord

**Constat.** Sur le Web comme sur Android :
- la course d'ouverture sonde les 12 premières adresses (`COURSE_MAX`) ;
- le repli automatique s'arrête à 8 (`REPLIS`) ;
- le menu en montre 8, puis propose « voir plus » (`SOURCES_VISIBLES`).

Le serveur range les sources par `echecs`, définition, débit et `succes`, c'est-à-dire d'après ce que
les lecteurs ont eux-mêmes constaté, pas d'après une mesure indépendante. Et le regroupement du §4
fera passer de 647 à 1 250 le nombre de chaînes qui ont plus de 8 adresses.

**Proposition.**
1. **Supprimer « voir plus »** : toutes les sources sont listées et choisissables. Les doublons (même
   adresse à un jeton près) restent réunis, comme aujourd'hui.
2. **Le repli automatique parcourt toutes les sources**, par **courses successives** de 12 adresses
   sondées en parallèle plutôt qu'un essai de 12 s après l'autre. Parcourir 93 sources une à une
   ferait près de vingt minutes d'écran noir.
3. **Le classement tient compte d'un relevé de sondes fourni avec le fichier de listes** : pour chaque
   adresse, si elle répondait au dernier relevé, et quand. Ordre : les adresses joignables au dernier
   relevé, puis échecs constatés, définition, débit. Une adresse morte au relevé reste listée et
   choisissable, en fin de liste.

**Format du relevé.** Un fichier `sondes.json` à côté de `m3u.json` (adresse → état et date), lu à
chaque rafraîchissement. S'il est absent, le classement actuel s'applique. Il n'alourdit pas
`m3u.json`, que le serveur plafonne à 2 Mo.

**Cas limites.**
- Relevé de plus de 24 h : ignoré.
- Adresse absente du relevé : rang neutre.
- Chaîne à une seule source : rien ne change.

**Métrique.** Sur les chaînes qui ont plus de 8 sources, la source qui finit par jouer figure parmi les
8 premières, et le temps médian d'ouverture ne s'allonge pas.

**Construit le 13 septembre 2026.**

- **« Voir plus » disparaît** du Web et d'Android, et avec lui la borne de huit essais du repli. La
  course garde douze adresses par vague ; quand le repli atteint une vague qui n'a pas couru, elle court
  avant qu'on ouvre quoi que ce soit.
- **La sonde du serveur** part après la déclaration de flux stable (quinze secondes d'image), par
  `POST /api/live/channels/:id/sondes` : douze à la fois, quatre secondes, corps jamais lu, mémoire de
  cinq minutes, une passe par chaîne, réponse au plus tard en vingt secondes. Un nom introuvable rend la
  source muette ; un hôte du réseau local, ou une redirection vers lui, la laisse inconnue — jamais
  muette. La route reste fermée à l'accès distant.
- **Le point à confirmer de la décision 4 est retenu tel que proposé** : une source muette sort du
  repli automatique et reste au menu, en fin de liste, avec « ne répond pas ».
- **Le relevé `sondes.json`**, version 1 — date, adresses joignables, adresses muettes —, est lu à chaque
  rafraîchissement et rangé avec chaque adresse. Ordre des sources : joignables, non mentionnées,
  muettes, puis échecs, définition, débit, succès. Ignoré au-delà d'un jour.
- **Défaut corrigé sur Android** : les groupes du menu étaient calculés dans l'ordre du serveur et le
  repli suivait l'ordre de la course ; une ligne pouvait ouvrir une autre adresse que celle qu'elle
  décrivait. Le menu se calcule maintenant sur l'ordre réel.
- **À relever à l'usage, sur le NAS** : la place de la source qui finit par jouer, et le temps
  d'ouverture.

---

## 6. Ce qu'il faut décider

1. **Avance** : jusqu'à 60 s là où la fenêtre le permet, et mesure des deux techniques de relance avant
   d'en retenir une. D'accord ?
2. **Rafraîchissement** : surveillance du fichier (recommandée) ou appel HTTP ? Et la cadence de 12 h
   reste-t-elle en filet de sécurité ?
3. **Regroupement** : garder distinctes les déclinaisons de langue et de pays ?
4. **Repli** : parcourir toutes les sources par courses de 12 adresses en parallèle ?
5. **Ordre de construction proposé** : bouton (§2) → rafraîchissement (§3) → regroupement et migration
   (§4) → sources (§5) → relance silencieuse (§1), la plus longue à mettre au point et à mesurer.

### Décisions du 13 septembre 2026

1. **Avance et relance : ce qui est préconisé, sans alourdir — la lecture doit rester fluide.** La
   reprise en place, sur le lecteur existant, est la voie par défaut. Un second lecteur caché n'est
   retenu que si la mesure prouve qu'on ne peut pas s'en passer, **et** qu'il ne se ressent pas sur
   Android TV.
2. **Appel HTTP en fin d'écriture, sans relecture périodique.** C'est le producteur du fichier qui
   demande le rafraîchissement. La cadence de 12 h disparaît, et aucune surveillance du fichier n'est
   ajoutée. Au démarrage du serveur, rien n'est relu : la grille garde sa dernière passe (§3).
3. **Les déclinaisons de langue et de pays restent des chaînes distinctes.**
4. **Repli par courses de 12 adresses, une seule source ouverte.** Les sondes d'une course s'arrêtent
   dès qu'une adresse répond, et c'est la seule qu'on ouvre et qu'on lit.
5. **Ordre de construction retenu** : bouton (§2) → rafraîchissement (§3) → regroupement et migration
   (§4) → sources (§5) → relance silencieuse (§1).

*Corrigé le même jour, décision 4.* La remarque ne voulait pas dire « une seule source ouverte » : elle
portait sur le **nombre**. Une chaîne regroupée peut porter bien plus de 12 sources, jusqu'à 93 pour la
mieux fournie. **Le repli n'est donc pas borné à 12** : toutes les sources d'une chaîne y entrent. Reste
à trancher comment on les essaie : par vagues de 12 sondées en parallèle, qui passent quand même sur
toutes les sources, ou toutes d'un coup.

*Arrêté le même jour, décision 4, sur proposition du propriétaire.* On cherche d'abord **une** source
qui joue. Dès qu'elle joue, on sonde **toutes** les autres en parallèle, et celles qui ne répondent pas
sortent du repli. Pour que ce soit léger :
- **la sonde part du serveur**, pas du lecteur : Android TV n'y dépense ni bande passante ni processeur,
  le navigateur n'a pas de CORS à franchir, et les gardes anti-SSRF du relais s'appliquent déjà ;
- elle lit les premiers octets d'une adresse, puis coupe : un manifeste pèse quelques kilo-octets ;
- douze sondes au plus à la fois, quatre secondes chacune : les 93 sources de la chaîne la mieux
  fournie tiennent en une demi-minute ;
- un résultat vaut quelques minutes, pour que zapper d'une chaîne à l'autre ne relance pas tout ;
- la source qui joue n'est pas sondée ;
- *à confirmer* : une source qui ne répond pas quitte le **repli automatique**, mais reste dans le
  menu, en fin de liste, avec la mention « ne répond pas ». Elle reste choisissable, comme demandé plus
  haut (« tout sélectionnable, pas caché »).

Cas limite : un client qui regarde depuis l'extérieur n'emprunte pas le même chemin réseau que le NAS.
La sonde du serveur dit ce que le NAS atteint ; le repli du lecteur garde le dernier mot.

---

## 7. Livrables

- Client Web : §1, §2, §5.
- Android TV et mobile : §1 et §5, alignés sur le Web.
- Serveur : §3, §4 (clé de fusion et migration), §5 (lecture du relevé, classement).
- Entrée 0.5.8.r17 du CHANGELOG, puis l'APK et l'APKG de la révision.
