# Plan — 0.6.0.r10 : caster hors de chez soi

*3 octobre 2026. **Rien n'est implémenté — la construction démarrera sur feu vert explicite**, une fois
les décisions du §4 tranchées.*

Sources : `PLAN_ACCES_DISTANT.md` (écoute WAN, liste blanche, Caddy), `WAN_R19.md` (liens distants),
`DIFFUSION_060_R7.md` à `DIFFUSION_060_R9.md` (chaîne de diffusion).

## 1. Objet

Depuis un téléphone connecté au NAS par l'accès distant, caster vers un téléviseur **du réseau où l'on
se trouve** — chez un proche, en vacances — avec la même qualité, les mêmes replis et la même
télécommande qu'à la maison. Le cast à la maison ne change pas d'un octet.

## 2. Constat

Relevé le 3 octobre 2026 sur le code et sur le NAS en r9.

| Fait | Conséquence |
| --- | --- |
| Toutes les routes `/api/diffusion/*` répondent `404` sur l'écoute WAN (`diffusion-routes.ts:82`) et sont absentes de la liste blanche (`wan-exposition.ts`) | aujourd'hui, aucun cast depuis l'extérieur, même vers la maison |
| Le cast est piloté par le NAS : découverte mDNS et SSDP sur **son** réseau, adresse locale `10.20.30.x` donnée au récepteur | hors de la maison, le NAS ne voit pas le téléviseur, et le téléviseur ne joint pas le NAS |
| L'accès distant fonctionne : 438 requêtes extérieures servies par Caddy dans la fin de son journal, certificat renouvelé seul | le NAS est joignable en HTTPS par son domaine, débit montant mesuré à 953 Mbit/s |
| Depuis la maison, l'adresse publique ne répond pas (connexion refusée en 2 s, Caddy pourtant actif) | la Bbox ne reboucle pas : un essai du chemin distant exige un récepteur **hors** du réseau de la maison |
| Sur le WAN, chaque route `/api` exige le compte distant puis la session de profil, flux vidéo compris — c'est la métrique M2 du plan d'accès distant | un téléviseur ne porte ni compte ni session : **il faut une exception, à décider (D1)** |
| Caddy journalise l'URI complète et les en-têtes de chaque requête dans `logs/caddy.log` | une clé dans une adresse y finirait en clair si rien n'est fait |
| Aucun SDK Cast dans les clients : ni `play-services-cast-framework` sur Android, ni `cast_sender.js` sur le Web | l'émetteur est à construire entièrement côté client |
| Le registre des lecteurs FlixTunes (Android, Android TV, Web) n'est que du HTTP vers le NAS (`diffusion-registre.ts`) | il ne dépend pas du réseau local, seulement de la liste blanche |
| Pas de CSP sur l'interface Web (`helmet`, `contentSecurityPolicy: false`) | le SDK Cast de Chrome se chargerait sans changement |

## 3. Architecture cible

À la maison, le NAS reste l'émetteur. Dehors, **le téléphone devient l'émetteur** : c'est lui qui voit
le téléviseur, sur le Wi-Fi où il se trouve. Le NAS garde tout le reste — choix de qualité, préparation,
replis de la r7 à la r9 — et sert la vidéo par son domaine public.

```
Chez un proche                                        Maison
Téléphone ──SDK Cast, Wi-Fi du proche──► Téléviseur
   │                                         │
   │ HTTPS + compte + session                │ HTTPS + clé de diffusion (D1)
   └───────────────► domaine ──► Caddy ──► instance WAN ──► prépare, sert, révoque
```

Déroulé d'un envoi :

1. Le téléphone demande `POST /api/diffusion/distant` avec sa session : contenu, position, modèle du
   récepteur annoncé par le SDK, capacités déjà connues de ce modèle.
2. Le NAS prépare exactement comme pour un cast local — plan de qualité, analyse du direct, copie ou
   conversion — mais avec le domaine public comme origine. Il rend l'adresse, le type, les métadonnées
   (titre, affiche, épisode, chaîne) et le niveau suivant à essayer en cas de refus.
3. Le téléphone envoie le `LOAD` au téléviseur, puis pilote pause, reprise, déplacement et volume par
   le SDK, avec la télécommande existante de la r8.
4. Le téléphone relaie l'état et la position au NAS : reprise, progression, et la diffusion reste
   visible depuis les autres appareils FlixTunes du profil.
5. Sur refus du téléviseur, le téléphone demande le niveau suivant, comme le fait le NAS à la maison.
6. À l'arrêt, le téléphone arrête le lecteur du téléviseur et le NAS révoque l'adresse.

## 4. Décisions

**Tranchées le 3 octobre 2026 :**

- **D1 : a)**, clé de diffusion dans l'adresse, avec tous les garde-fous ci-dessous. La décision
  « aucun jeton dans une URL » de `PLAN_ACCES_DISTANT.md` est amendée pour cette seule route.
- **D2 : non.** Pas de lecteur Cast FlixTunes : les téléviseurs gardent le lecteur générique de
  Google. Le lot 6 sort du périmètre.
- **D4 : non.** Dehors, seuls les téléviseurs du réseau courant et les lecteurs FlixTunes du profil.
- **D5 :** Android, **Chrome** et **Safari/AirPlay** en r10.
- **D3 reste ouverte** ; la proposition ci-dessous vaut par défaut.

**Écart de construction, le 3 octobre 2026.** Le §3 prévoyait que le téléphone envoie lui-même le
`LOAD` et demande le niveau suivant en cas de refus. La r10 retient mieux : le téléphone, ou l'onglet
Chrome, devient un **relais**. Il inscrit au NAS chaque téléviseur Cast qu'il voit
(`POST /api/diffusion/relais`), bat comme un lecteur FlixTunes, et exécute les ordres du NAS — ouvrir
la session, sonder, charger, piloter, libérer. Le NAS garde ainsi exactement la diffusion de la maison :
sonde, plan de qualité, replis, progression, télécommande partagée. Aucune logique n'est dupliquée dans
les clients, et la route `POST /api/diffusion/distant` du §3 n'existe pas.

Les options, telles que présentées avant décision :

### D1 — Comment le téléviseur prouve son droit de lire

Le téléviseur ne peut pas envoyer la session du profil. Deux voies :

| | a) Clé de diffusion dans l'adresse | b) Clé en en-tête, par un lecteur Cast FlixTunes |
| --- | --- | --- |
| Principe | comme à la maison : une clé aléatoire de 256 bits dans le chemin du flux | la clé voyage dans le message `LOAD`, puis en en-tête de chaque requête, jamais dans l'adresse |
| Récepteurs | lecteur Cast générique de Google, AirPlay, et un futur DLNA | Cast seulement |
| Prérequis | aucun | D2 |
| Écart au plan d'accès distant | amende la décision « aucun jeton dans une URL », pour cette seule route | plus proche de l'esprit, sans s'y conformer : la clé reste un secret porteur |

Garde-fous communs : une clé par diffusion ; morte à l'arrêt, après deux minutes sans requête, et au
plus tard à la durée du média plus une heure ; une seule diffusion distante active par profil ; route
dédiée, la seule ouverte sans compte ni session, refusée en `404` pour toute clé inconnue ; clé masquée
dans `server.log` et dans `caddy.log` (filtre `request>uri` de Caddy) ; débit de requêtes plafonné.

**Recommandation : a) en r10**, parce que c'est ce qui fonctionne déjà à la maison et avec tous les
récepteurs ; b) en complément quand D2 sera tranchée. L'amendement serait daté dans
`PLAN_ACCES_DISTANT.md`.

### D2 — Un lecteur Cast « FlixTunes »

Les téléphones du réseau affichent aujourd'hui « Default Media Receiver », le nom du lecteur générique
de Google. Un lecteur propre apporterait le nom FlixTunes, un écran d'attente FlixTunes et la voie b)
de D1.

Ce qu'il demande, et qui relève de toi : un compte Google, l'inscription à la console des développeurs
Cast (5 $, une seule fois), puis la **publication** de l'application. Avant publication, seuls les
appareils déclarés par numéro de série la voient, donc pas les téléviseurs des proches. La page du
lecteur serait servie par le NAS lui-même, sur son domaine, sans session — comme l'interface Web.

À mesurer avant d'en dépendre : un lecteur servi en HTTPS peut-il lire les adresses HTTP de la maison
(contenu mixte) ? Si non, le cast à la maison garde le lecteur générique, et seul le cast distant
afficherait FlixTunes.

### D3 — La qualité par défaut hors de chez soi

Le débit du réseau du proche est inconnu, et le lecteur Cast n'adapte pas la qualité sur une liste à
une seule variante. Proposition : copie de la source jusqu'à 25 Mbit/s, conversion 1080p au-delà, et
choix explicite « qualité maximale » pour la 4K.

### D4 — Les téléviseurs de la maison, vus de l'extérieur

Lister et piloter les téléviseurs de la maison depuis l'extérieur ferait démarrer un film devant
quelqu'un d'autre. Proposition : **non par défaut** ; dehors, on ne voit que les téléviseurs du réseau
où l'on se trouve et les lecteurs FlixTunes du profil (lot 1).

### D5 — Les clients concernés

| Client | Proposition |
| --- | --- |
| Android (téléphone) | **r10** |
| Web dans Chrome, sur le domaine | **r10** : le SDK Cast Web exige HTTPS, déjà là |
| Safari et AirPlay | **r10** : extension au WAN de la voie AirPlay de la r6 |
| Windows et Linux (Electron) | hors périmètre : Electron n'embarque pas Cast |
| Android TV comme émetteur | hors périmètre, comme décidé en r7 |
| DLNA chez un proche | r11 : le téléphone deviendrait contrôleur DLNA, portage de `diffusion-dlna.ts` |

## 5. Lots de travail

### Lot 1 — Lecteurs FlixTunes à distance *(aucune exception de sécurité)*

Ouvrir au WAN l'inscription des lecteurs, leurs battements, la liste des cibles réduite aux lecteurs
FlixTunes du profil, et les commandes vers eux. Une application FlixTunes connectée au profil chez un
proche — Android TV, navigateur — devient une cible, et lit avec sa propre session. C'est le lot le
moins coûteux et le seul qui ne demande aucune décision.

### Lot 2 — Route de flux distante *(serveur)*

`POST /api/diffusion/distant` (préparation pilotée par l'émetteur), route de flux selon D1, révocation,
plafonds, état et progression relayés, masquage dans les deux journaux. Liste blanche et test négatif
mis à jour par décision explicite, route par route.

### Lot 3 — Émetteur Cast Android

`play-services-cast-framework` et MediaRouter ; le bouton Cast montre les téléviseurs du réseau courant
quand l'application est connectée à distance ; `LOAD` avec les métadonnées de la r8 ; télécommande
existante branchée sur le SDK ; replis par niveau. Exige les services Google Play sur le téléphone ;
coût en taille de l'APK à mesurer.

### Lot 4 — Émetteur Chrome *(Web, sur le domaine)*

### Lot 5 — AirPlay depuis Safari à distance

### ~~Lot 6 — Lecteur Cast FlixTunes~~ *(écarté par D2)*

### Dépendances

```
Lot 1 ─────────────────────┐
Lot 2 ──┬──► Lot 3 ────────┤
        ├──► Lot 4 ────────┼──► recette
        └──► Lot 5 ────────┘
```

## 6. Cas limites

Wi-Fi d'hôtel isolant les clients (aucun téléviseur découvert : le dire clairement) ; téléphone qui se
verrouille ou quitte le Wi-Fi pendant la lecture (le téléviseur continue, il lit depuis le NAS ; la
position est relevée côté NAS d'après les segments demandés) ; clé expirée en pleine lecture d'un film
long ; Internet de la maison coupé ; NAS redémarré pendant un cast distant ; conversion de direct déjà
occupée (une seule à la fois sur le NAS) ; deux proches qui castent en même temps ; vieux récepteur qui
ne reconnaît pas le certificat Let's Encrypt ; réseau du proche trop lent pour la qualité choisie.

## 7. Métriques d'acceptation

| # | Métrique | Seuil |
| --- | --- | --- |
| M1 | réponses autres que `404` sur la route distante avec une clé fausse, expirée ou révoquée | **0** |
| M2 | occurrences d'une clé de diffusion dans `server.log` et `caddy.log` après la recette | **0** |
| M3 | délai entre l'arrêt et la révocation de l'adresse | **≤ 2 s** |
| M4 | démarrage d'un cast distant | mesuré et publié, comparé au cast local de la r9 |
| M5 | lecture tenue sans intervention | **30 min** d'un film et **30 min** de direct |
| M6 | non-régression du cast à la maison | banc de la r9 **inchangé** sur le 58PUS7304 et la Pixel Tablet |
| M7 | routes ajoutées à la liste blanche | exactement celles décidées, vérifiées par le test négatif |

## 8. Preuves

**Banc distant sans quitter la maison** : la Pixel Tablet et le PC rejoignent le partage de connexion
4G du téléphone. La tablette est alors hors du réseau de la maison, et la Bbox ne rebouclant pas, tout
passe réellement par Internet et par Caddy. Le PC joue d'abord le rôle du téléphone avec le client Cast
du banc existant, ce qui éprouve le lot 2 avant le lot 3 ; puis le téléphone lui-même. À vérifier en
premier : la découverte d'un récepteur branché sur le partage de connexion du téléphone émetteur.

Puis : tests négatifs de la route distante, recherche de la clé dans les deux journaux, coupure du Wi-Fi
du téléphone en pleine lecture, arrêt depuis un autre appareil du profil, et le banc de la r9 rejoué à
la maison.

## 9. Livrables

- **APK Android** et **APKG ASUSTOR x86-64**, comme à chaque étape ;
- `docs/DIFFUSION_060_R10.md` — résultats mesurés, et ce qui reste à mesurer ;
- amendement daté de `PLAN_ACCES_DISTANT.md` (D1 a), retenue le 3 octobre 2026) ;
- entrée `CHANGELOG.md`.

Aucun port supplémentaire n'est ouvert : tout passe par l'écoute WAN et Caddy existants.

## 10. Ce qui ne doit pas changer

Le cast à la maison, piloté par le NAS ; l'écoute LAN ; la liste blanche, hormis les routes décidées ;
les liens distants de la r19.
