# Audit — accès sécurisé depuis Internet et port d'écoute WAN distinct

*État audité : 0.5.6.r48 (étape 56). Document d'aide à la décision — aucune ligne de code n'a été modifiée.*

## 1. Ce qui a été examiné

Le chemin complet qu'emprunterait une requête venue d'Internet : l'écoute du serveur
(`apps/server/src/index.ts`, `config.ts`), les protections d'entrée (`app.ts`), les routes de
l'API (`routes.ts`), les deux clients qui parleraient au serveur à distance (`apps/web/src/api.ts`,
`apps/android/.../FlixTunesApi.kt`), et l'empaquetage qui déclare les ports au NAS
(`packaging/asustor/CONTROL/`). Le constat suivant décrit ce qui **est**, pas ce qui devrait être.

## 2. État actuel — la surface réelle

### 2.1 Une seule écoute, en clair

`config.ts:47-48` fixe `host = 0.0.0.0` et `port = 4000`, et `index.ts:33` appelle `app.listen` une
seule fois. Il n'existe **aucun support TLS dans le code** : `buildApp()` construit un Fastify sans
option `https`, et le mot « certificat » n'apparaît nulle part dans les sources. Aujourd'hui,
FlixTunes ne sait pas parler HTTPS. Tout ce qui sortirait sur Internet sortirait en clair : les
codes PIN de profil, les jetons de déverrouillage, les titres regardés, et la vidéo elle-même.

### 2.2 La lecture n'est protégée par rien

C'est le point central de cet audit. `app.ts:33-38` :

```
if (!config.apiToken || request.method === "GET" || request.method === "HEAD" || ...) return;
```

Le jeton `FLIXTUNES_API_TOKEN` ne protège **que les écritures**. Toutes les lectures sont ouvertes,
sans exception et quelle que soit la configuration. Concrètement, une adresse IP qui atteint le port
4000 obtient sans s'annoncer :

| Route | Ce qu'elle rend | Fichier |
| --- | --- | --- |
| `GET /api/catalog`, `/api/search`, `/api/home` | tout le catalogue, identifiants compris | `routes.ts:467, 819, 782` |
| `GET /api/media/:id/stream` | **le fichier vidéo entier**, avec reprise par plages | `routes.ts:878` |
| `GET /api/system/backups/:name` | **la base SQLite complète en téléchargement** | `routes.ts:170` |
| `GET /api/filesystem/directories?path=…` | l'arborescence des `/volumeN`, `/mnt`, `/media` du NAS | `routes.ts:625` |
| `GET /api/system/status`, `/api/system/metrics` | version, mémoire, santé base, télémétrie | `routes.ts:154, 167` |
| `GET /api/profiles` | la liste des profils et lesquels ont un PIN | `routes.ts:182` |

La sauvegarde SQLite est la plus grave : un seul `GET` non authentifié rend la base entière —
catalogue, profils, empreintes de PIN, chemins des bibliothèques, progressions. Le parcours de
système de fichiers vient juste après : il cartographie le NAS pour qui prépare autre chose.

Le PIN de profil (`routes.ts:76-88`) ne change rien à cela. Il ne garde que les routes qui appellent
`profileFromRequest` — recommandations, liste de lecture, progression. Le flux vidéo, les jaquettes,
le catalogue et la recherche ne le consultent jamais.

### 2.3 Le CORS n'est pas une barrière

`app.ts:12-18` restreint les origines à `localhost`, `.local` et aux plages privées. C'est correct,
mais le CORS est une règle que **le navigateur** applique à lui-même. `curl`, un script, ExoPlayer
ou n'importe quel client non-navigateur l'ignore entièrement. Ce contrôle protège contre une page
web hostile ouverte sur le LAN ; il ne protège en rien contre Internet.

### 2.4 Le PIN est cassable par force brute

`profileUnlockSchema` (`packages/contracts/src/index.ts:727`) accepte 4 à 8 chiffres, et l'interface
propose 4. La limitation de débit (`app.ts:24`) autorise 600 requêtes/minute : les 10 000
combinaisons d'un PIN à 4 chiffres tombent en **moins de 17 minutes**, sans blocage, sans délai
progressif, et sans qu'aucune trace ne soit écrite — il n'existe aujourd'hui aucun journal des
échecs d'authentification.

Deux détails aggravent : `PATCH/PUT /api/profiles/:id` (`routes.ts:232`) change le PIN **sans
demander l'ancien**, et `POST /api/profiles/:id/unlock` (`routes.ts:257`) rend `unlocked: true` pour
tout profil dépourvu de PIN.

### 2.5 La limitation de débit exempte précisément ce qui coûte cher

`app.ts:24` retire du comptage tout ce qui correspond à `/api/(media|playback|artwork)/`. Le motif
est juste sur un LAN — on ne veut pas étrangler un flux vidéo. Mais `POST /api/media/:id/playback`
correspond à ce motif, et **chaque appel démarre un FFmpeg**. Le plafond de conversions simultanées
(`transcodeConcurrency`, 2 par défaut) borne les dégâts, mais l'appel lui-même reste gratuit et
illimité pour n'importe qui.

Par ailleurs `trustProxy: false` (`app.ts:21`) : si un reverse proxy était placé devant, toutes les
requêtes porteraient l'IP du proxy et les 600/minute seraient partagées par le monde entier.

### 2.6 Les clients ne savent pas s'authentifier

Aucun des deux clients n'envoie de jeton serveur. `FlixTunesApi.kt:176-182` ne pose que
`Accept`, `Content-Type` et `X-FlixTunes-Profile-Token` ; `apps/web/src/api.ts:57-66` fait
exactement pareil.

**Conséquence à connaître avant toute chose : activer `FLIXTUNES_API_TOKEN` aujourd'hui casse les
clients.** Progression de lecture (`PUT /api/media/:id/progress`), création de session de conversion
(`POST /api/media/:id/playback`), modification de profil : toutes ces écritures reviendraient en
401. Le réglage est documenté comme disponible, mais il n'est utilisable par aucun client livré.

Côté Android, `network_security_config.xml` autorise le trafic en clair **partout**
(`<base-config cleartextTrafficPermitted="true" />`), et le manifeste porte `usesCleartextTraffic="true"`.
Rien n'empêcherait donc un client d'être ramené en HTTP sur une liaison distante.

### 2.7 Ce qui est déjà bien fait

Il faut le dire aussi, parce que cela réduit le travail restant :

- les secrets fournisseurs sont chiffrés au repos en AES-256-GCM, avec la clé hors base et en `0600`
  (`provider-settings.ts:19-46`), et `GET /api/metadata/providers` ne rend que des booléens — aucune
  clé ne fuite ;
- les comparaisons de secrets sont à temps constant (`security.ts`), le PIN est haché en `scrypt` ;
- les chemins sont validés : le flux vidéo part d'un identifiant en base et jamais d'un chemin client
  (`routes.ts:119-124`), les segments de conversion passent une liste blanche de noms puis un
  contrôle de confinement (`playback.ts:1857-1862`), le parcours de dossiers est borné à des racines
  découvertes (`filesystem-browser.ts:96`) ;
- `helmet` est actif, la taille de corps est plafonnée à 1 Mo, les délais serveur sont posés ;
- l'image Docker abandonne toutes les capacités, interdit l'élévation et monte les médias en lecture
  seule (`compose.yaml`).

### 2.8 Le verdict

`docs/SECURITY.md` conclut déjà : « ne jamais publier directement le port 4000 sur Internet ».
**Cet audit confirme ce texte sans réserve.** Une redirection du port 4000 depuis le routeur, dans
l'état actuel, revient à publier la médiathèque, la base de données et la carte du NAS. Le port
n'est pas le problème — l'absence d'authentification en lecture l'est.

## 3. Les trois voies possibles

| | Voie A — VPN | Voie B — relais tiers | Voie C — écoute WAN durcie |
| --- | --- | --- | --- |
| Principe | WireGuard sur le routeur ou le NAS ; le téléphone rejoint le LAN | Cloudflare Tunnel, Tailscale Funnel, EZ-Connect | second port TLS, surface réduite, session obligatoire |
| Exposé sur Internet | un port UDP qui ne répond pas sans clé | rien (connexion sortante) | un port TCP qui répond |
| Code à écrire | **aucun** | aucun | réel (voir §4) |
| Le proche non technique | doit installer et configurer un client VPN | idem selon la solution | ouvre une URL, saisit un code |
| Un tiers voit passer les flux | non | **oui, selon l'offre** | non |
| Sécurité | la meilleure | bonne, mais dépendante d'un tiers | correcte si §4 est fait en entier |

**Recommandation honnête, et elle dépend de l'objectif :**

- **Si l'accès distant, c'est vous, en déplacement** — la voie A gagne largement. Zéro ligne de code,
  zéro surface, disponible ce soir sur le routeur. Aucun développement ne fera mieux.
- **Si l'accès distant, c'est la famille ou des proches qui ne configureront jamais un VPN** — alors
  la voie C se justifie, mais seulement faite en entier. Un demi-durcissement ne vaut pas mieux
  qu'aucun.

La suite détaille la voie C, puisque c'est ce qui est demandé.

## 4. Proposition — une deuxième écoute, dédiée au WAN

### 4.1 Le principe : deux écoutes, un seul processus

`buildApp()` peut être appelé deux fois dans le même processus. Les modules — base, coordinateur
d'analyse, sessions de lecture, registre d'appareils — sont des singletons de module : les deux
instances les partagent naturellement, sans duplication ni synchronisation à écrire.

```
Processus FlixTunes
├── écoute LAN   0.0.0.0:4000   HTTP    surface complète   ← inchangée, zéro régression
└── écoute WAN   0.0.0.0:PORT   HTTPS   surface réduite    ← session obligatoire, nouvelle
```

Cette séparation est ce qui rend la proposition tenable : le LAN ne change pas d'un octet, donc rien
de ce qui fonctionne aujourd'hui ne peut se casser. Un contrôle placé sur l'écoute WAN ne peut pas
être contourné par une requête LAN, puisque ce sont deux instances Fastify distinctes avec des
crochets distincts.

Réglages proposés, tous vides par défaut — **l'écoute WAN n'existe pas tant qu'elle n'est pas
explicitement activée** :

```
FLIXTUNES_WAN_PORT=            # vide = désactivé
FLIXTUNES_WAN_TLS_CERT=        # chemin PEM
FLIXTUNES_WAN_TLS_KEY=         # chemin PEM
FLIXTUNES_WAN_SESSION_HOURS=12
```

### 4.2 Le port

**Ne pas réutiliser 4000, et ne pas prendre 8443 non plus.** Les deux sont dans la première page de
tout scanner. Proposition : un port tiré au hasard dans **49152–65535**, fixé à l'installation et
inscrit dans la configuration. Sur le routeur, faire porter la redirection sur un port externe
également aléatoire, différent du port interne.

À dire clairement : **cela n'apporte aucune sécurité**. Shodan balaie les 65 535 ports. Ce que cela
apporte est réel mais modeste — le journal cesse d'être noyé sous le bruit de fond des balayages
opportunistes, ce qui rend une tentative ciblée visible. La sécurité vient de §4.3 et §4.5, pas du
numéro.

Contraintes d'empaquetage à ne pas oublier : `packaging/asustor/CONTROL/config.json:35` déclare
`register.port: [4000]` — le port WAN doit y être ajouté, et `post-install.sh:71-82` doit écrire les
nouvelles variables dans `flixtunes.env` sans rien activer. Et **mDNS ne doit jamais annoncer le
port WAN** (`runtime-services.ts:27-34`) : la découverte locale reste locale.

### 4.3 TLS — obligatoire, et jamais désactivable sur cette écoute

Trois options, par ordre de préférence :

1. **Certificat Let's Encrypt sur un nom de domaine** (DDNS du NAS type `xxx.myasustor.com`, ou
   domaine personnel). Reconnu d'emblée par tous les navigateurs et par Android, sans exception à
   déclarer. Le gestionnaire de certificats d'ADM sait le renouveler ; FlixTunes n'a qu'à relire les
   fichiers PEM et à recharger le contexte TLS sans redémarrage. *À vérifier sur l'AS5404T : le
   chemin exact des PEM et les droits de lecture par le compte du paquet.*
2. **Reverse proxy** (Caddy ou Nginx sur le NAS) qui termine TLS et parle en clair au 4000 en local.
   Moins de code. **Mais** `trustProxy: false` (`app.ts:21`) doit alors devenir la liste des IP du
   proxy, sinon la limitation de débit s'effondre en un seul compteur global.
3. ~~**Auto-signé.**~~ **Écarté par la décision du §9.** Un certificat auto-signé impose un
   avertissement de sécurité à chaque navigateur. On ne peut pas demander à un proche de passer
   outre : outre l'inconfort, cela lui apprend exactement le geste qu'une attaque par hameçonnage
   exploite ensuite. Utilisable pour un essai en interne, jamais pour l'usage visé.

Quelle que soit l'option : refuser TLS 1.0/1.1, et **échouer au démarrage** si le port WAN est
défini sans certificat valide. Une écoute WAN qui démarre en clair parce qu'un certificat manquait
est le genre de repli silencieux qui annule tout le reste.

### 4.4 Surface réduite — liste blanche, jamais liste noire

Sur l'écoute WAN, tout est refusé sauf ce qui est nommé. Une liste noire oublie toujours la route
ajoutée le mois suivant.

**Autorisé** (ce dont un client distant a réellement besoin) : `/api/profiles` en liste,
`/api/profiles/:id/unlock`, `/api/home`, `/api/catalog`, `/api/catalog/browse`, `/api/search`,
`/api/media/:id` et ses dérivés (`stream`, `playback-info`, `subtitles`, `timeline-sheet`,
`progress`), `/api/artwork/:id`, `/api/playback/*`, et les fichiers statiques du Web.

**Refusé, en `404` et non en `403`** — ne pas confirmer ce qui existe : `/api/filesystem/*`,
`/api/setup`, `/api/libraries`, `/api/system/backups*`, `/api/system/status`, `/api/system/metrics`,
`/api/system/capacity/*`, `/api/system/conversion-preferences`, `/api/metadata/*`,
`/api/corrections`, `/api/scans*`, `/api/devices/*`. Administration, diagnostic, télécommande et
parcours de disque restent des affaires de LAN. `/api/health` reste ouvert mais réduit à
`{status:"ok"}` — sans version, qui sert surtout à cibler un défaut connu.

### 4.5 Authentification — la vraie difficulté, et elle est côté navigateur

Le mécanisme existe déjà à moitié : `POST /api/profiles/:id/unlock` rend un jeton de 12 h
(`routes.ts:69-74`). Ce qu'il faut en faire :

- **rendre le PIN obligatoire pour être joignable depuis le WAN.** Un profil sans PIN n'apparaît pas
  dans la liste WAN et ne peut pas être déverrouillé à distance ;
- **exiger la session sur toutes les routes WAN**, lectures et flux vidéo compris — c'est exactement
  ce que `app.ts:34` ne fait pas aujourd'hui ;
- **persister les jetons.** `profileUnlockTokens` est une `Map` mémoire (`routes.ts:66`) : tout le
  monde est déconnecté à chaque redémarrage du NAS, et rien n'est révocable. Il faut une table, un
  libellé d'appareil, une date de dernier usage et un bouton « révoquer » ;
- **durcir le PIN sur le WAN** : 6 chiffres minimum, 5 essais puis délai exponentiel par profil *et*
  par IP, et exiger l'ancien PIN pour en changer (`routes.ts:232` ne le fait pas).

**Le point technique qui décide de la forme :** le lecteur Web charge la vidéo par
`<video>` + hls.js (`Player.tsx:429, 994`), les jaquettes par `<img src="/api/artwork/…">`, les
sous-titres par `<track>`. **Aucun de ces trois éléments ne peut porter un en-tête HTTP.** Un jeton
en en-tête protège donc l'API mais laisse la vidéo et les images ouvertes — c'est-à-dire l'essentiel
du problème.

Il faut donc, sur l'écoute WAN :

- **un cookie `HttpOnly; Secure; SameSite=Strict`** — le navigateur l'attache automatiquement aux
  requêtes `<video>`, `<img>` et `<track>`. **La décision du §9 en fait le chemin principal, et non
  l'un de deux chemins équivalents :** « sans rien installer » veut dire « dans un navigateur », donc
  le client distant par défaut est le Web ;
- **l'en-tête `X-FlixTunes-Profile-Token`** pour Android, qu'ExoPlayer sait poser sur sa source HTTP ;
- les deux acceptés indifféremment, un seul contrôle commun.

Conséquence de priorité : le lot B doit être **jugé et validé sur le client Web**, pas sur Android.
L'APK reste livré à chaque étape, mais il n'est plus ce qui décide si la fonction est bonne.

Le mode `direct` (lecture sans conversion, `video.src` pointant sur `/api/media/:id/stream`) rend le
cookie **indispensable** côté navigateur ; il n'y a pas d'alternative propre, hors jetons signés dans
l'URL — qui finissent dans les journaux et les historiques, et que je ne recommande pas.

### 4.6 Débit et ressources

Sur l'écoute WAN, ne **pas** reprendre l'exemption de `app.ts:24`. Proposition : plafond global plus
bas qu'en LAN, plafond distinct et strict sur `POST /api/media/:id/playback` (chaque appel est un
FFmpeg), et plafond du nombre de sessions distantes simultanées. Sur un N5105, deux conversions
saturent déjà la machine ; l'upload résidentiel saturera avant.

### 4.7 Journal

Aujourd'hui, un échec d'authentification ne laisse **aucune trace**. Sans journal, une attaque en
cours est invisible et une attaque réussie l'est encore plus. Proposition : un journal WAN dédié —
date, IP, profil visé, résultat, appareil — lisible depuis l'écran de diagnostic et conservé dans le
dossier partagé, à côté de `server.log`.

## 5. Ce qu'il faudrait modifier

| Fichier | Nature |
| --- | --- |
| `apps/server/src/config.ts` | 4 réglages WAN, vides par défaut |
| `apps/server/src/app.ts` | `buildApp({ exposition })` : liste blanche, session obligatoire, débit, TLS |
| `apps/server/src/index.ts` | seconde écoute conditionnelle + arrêt propre |
| `apps/server/src/routes.ts` | jetons persistés et révocables, PIN durci, ancien PIN exigé |
| *nouveau* `wan-journal.ts` | journal des accès distants |
| `apps/web/src/api.ts`, `Player.tsx` | `credentials: "include"` sur le WAN |
| `apps/android/.../FlixTunesApi.kt` + source ExoPlayer | jeton porté aussi sur le flux vidéo |
| `apps/android/.../network_security_config.xml` | clair réservé aux plages privées, TLS exigé ailleurs |
| `packaging/asustor/CONTROL/config.json`, `post-install.sh` | second port déclaré, réglages écrits, rien d'activé |
| `docs/SECURITY.md` | réécriture de la section déploiement |

Tests à écrire, en négatif d'abord : chaque route refusée répond 404 sur le WAN ; aucune route WAN ne
répond sans session ; le flux vidéo refuse un cookie absent ; le PIN se bloque au 6ᵉ essai ; le port
WAN sans certificat empêche le démarrage ; l'écoute LAN reste identique à l'octet près.

## 6. Risques résiduels — ce que cette proposition ne couvre pas

- **Le serveur ASUSTOR tourne en root.** `start-stop.sh` le dit explicitement. Sur un service exposé,
  une faille devient totale au lieu d'être contenue. Le cas Docker est bien meilleur (`cap_drop:
  ALL`). À traiter, idéalement avant d'ouvrir quoi que ce soit.
- **Les exceptions non captées sont volontairement avalées** (`index.ts:25-30`). Ce choix est juste
  pour ne pas couper un film, mais sur le WAN il signifie qu'une attaque qui provoque des erreurs ne
  fait pas tomber le service *et ne se voit pas*. Il faudra alerter sur le taux d'exceptions.
- **Pas de CSP** (`contentSecurityPolicy: false`, `app.ts:23`) : à reprendre pour une interface
  atteignable depuis Internet.
- **Les mises à jour signées sont prévues à l'étape 60.** Un service exposé qui se met à jour sans
  vérification de signature est un risque de chaîne d'approvisionnement.
- **La bande passante montante** décidera de la qualité réellement atteignable — c'est une mesure à
  faire, pas une estimation.

## 7. Découpage proposé

- **Lot A — décision.** Ce document. Rien à construire.
- **Lot B — socle WAN.** §4.1 à §4.7 en entier, plus la question root du §6. Livrables habituels :
  APK Android et APKG ASUSTOR x86-64.
- **Lot C — confort.** Renouvellement automatique du certificat, écran d'administration des appareils
  autorisés, révocation depuis l'interface.

Le lot B ne se découpe pas davantage : une écoute WAN avec TLS mais sans session, ou avec session
mais sans journal, donne une fausse impression de sécurité — ce qui est pire que de savoir qu'on
n'en a pas.

Le tout appartient naturellement au **dossier de l'étape 61 — sécurité, confidentialité et
administration** (`docs/BEYOND_PLEX_PLAN.md:729-735`), qui prévoit déjà sessions bornées, TLS local,
journal d'audit et tests d'autorisation négatifs. L'anticiper est possible ; le diluer ne l'est pas.

## 8. Décision demandée

1. **Voie A (VPN), B (relais) ou C (écoute WAN durcie) ?** Si l'usage distant est personnel, la voie
   A est objectivement supérieure et gratuite. → *tranché, voir §9.*
2. Si voie C : **maintenant, ou à l'étape 61 comme prévu ?** → *ouvert.*
3. Si maintenant : **le passage hors-root du paquet ASUSTOR entre-t-il dans le lot B ?** Ma
   recommandation est oui. → *ouvert.*

## 9. Décision du 24 août 2026 — voie C retenue

**Usage visé, énoncé par le propriétaire du projet : « la famille, sans rien installer ».** La voie A
(VPN) est écartée non pas parce qu'elle est moins sûre — elle l'est davantage — mais parce qu'elle
demande à chaque proche une installation et une configuration, ce que l'usage exclut.

Cette phrase n'est pas un simple choix de voie : elle fixe trois choses qui étaient ouvertes.

**a. Le client de référence du WAN devient le navigateur.** « Sans rien installer » veut dire « une
URL, rien d'autre ». Le cookie du §4.5 cesse d'être une option parmi deux et devient le mécanisme
principal ; la validation du lot B se fait sur le Web, pas sur l'APK.

**b. Un vrai certificat devient obligatoire, donc un nom de domaine aussi.** L'auto-signé est écarté
(§4.3) : on ne demande pas à un proche de passer outre un avertissement de sécurité, parce que c'est
précisément le geste qu'une attaque par hameçonnage exploite ensuite. Il faut donc un DDNS ou un
domaine, et Let's Encrypt derrière.

**c. Le PIN devient l'unique secret qui protège la médiathèque depuis Internet.** Et c'est la
faiblesse structurelle de cet usage : un PIN familial est court, retenu de tête, souvent partagé, et
il ne sera jamais changé. Les mesures du §4.5 — six chiffres, blocage après cinq essais, délai
exponentiel par profil et par IP, journal — ne sont pas des durcissements optionnels dans ce
contexte : elles sont ce qui sépare la fonction d'une porte ouverte. Un profil par personne, chacun
son PIN, plutôt qu'un PIN commun.

### La question que cet usage fait apparaître, et qui doit être tranchée avant d'écrire du code

**Le débit montant de la ligne.** Plusieurs proches qui regardent en même temps, c'est plusieurs flux
sortants simultanés — et la contrainte n'est pas le NAS, c'est l'upload résidentiel.

Ordres de grandeur : une conversion 1080p de qualité correcte demande 4 à 8 Mbit/s ; un flux 1080p
lu sans conversion, 8 à 15 ; un 4K sans conversion, 40 à 80. Deux personnes en 1080p converti
réclament donc 10 à 16 Mbit/s **montants**, en continu. Sur une fibre, c'est sans objet. Sur du VDSL,
c'est la limite pour une seule personne. Sur de l'ADSL, la fonction ne peut pas exister, quel que
soit le soin mis au code.

S'y ajoute le plafond du NAS : `FLIXTUNES_TRANSCODE_CONCURRENCY` vaut 2 par défaut et l'AS5404T
(N5105) ne fait pas mieux — la troisième personne attend. C'est une décision de produit à assumer et
à afficher, pas un défaut à découvrir en soirée.

**Proposition : mesurer avant de construire.** Un relevé du débit montant réel de la ligne aux heures
d'usage, et le nombre de personnes visées simultanément. C'est une demi-heure, et cela décide du
plafond de qualité à imposer par session distante — voire, dans le pire cas, si le lot B vaut la
peine d'être écrit. Le projet mesure déjà avant de trancher partout ailleurs ; il n'y a pas de raison
d'y déroger sur le seul point qui peut invalider l'ensemble. → *mesuré, voir §10.*

## 10. Mesure du 24 août 2026 — la ligne est hors de cause, le NAS devient le sujet

**Relevé : 2 090 Mbit/s descendants, 953 Mbit/s montants, ping 4 ms** (Bouygues fibre, mesuré depuis
le poste de travail). Cible annoncée : 5 à 6 personnes simultanément.

### 10.1 Le débit n'est plus une contrainte — et cela change la stratégie

Six flux 4K lus **sans conversion**, au pire des cas à 80 Mbit/s chacun, demandent 480 Mbit/s
montants. La ligne les absorbe avec de la marge. L'hypothèse pessimiste du §9 — ADSL ou VDSL qui
aurait tué la fonction — est levée.

Deux réserves à garder en tête, aucune bloquante :

- la mesure vient du **poste**, pas du NAS. L'AS5404T dispose de liens 2,5 GbE : le chemin NAS →
  routeur n'est pas le facteur limitant à ces débits, mais la vérifier depuis le NAS coûte une
  commande ;
- le **débit descendant de chaque proche** devient le nouveau plafond, et il n'est pas sous notre
  contrôle. Un téléphone en 4G ou une connexion faible ne prendra pas un flux 4K sans conversion.
  C'est ce cas-là, et lui seul, qui ramène le NAS dans la boucle.

**Conséquence stratégique, et c'est le point le plus important de cette mesure : avec 953 Mbit/s
montants, la bonne stratégie WAN est d'éviter la conversion, pas de l'optimiser.** Un flux direct ne
coûte presque rien au N5105 et la ligne l'avale sans effort. Six personnes en lecture directe : tout
à fait atteignable. Six personnes en conversion simultanée : impossible, quelle que soit la
configuration. Le travail du lot B est donc de **maximiser la lecture directe** pour les clients
distants — pas d'ajouter des conversions.

### 10.2 Le facteur limitant est le NAS, et la mesure existe déjà

`FLIXTUNES_TRANSCODE_CONCURRENCY` vaut 2 par défaut, mais ce n'est qu'un plafond de configuration
posé au-dessus d'un budget réellement mesuré : `capacity.ts` calibre un micro-banc sur la machine
(`budgetFromBenchmark`, `capacity.ts:89`) et **`GET /api/system/capacity` rend déjà le champ
`simultaneous`** — le nombre de sessions soutenables en 1080p H.264, en 1080p HDR converti en SDR et
en 4K (`capacity.ts:609-615`).

**La mesure réclamée au §9 n'est donc pas à écrire : elle est à lire.** Un appel à
`/api/system/capacity` sur le NAS, une fois la calibration faite, donne le nombre exact de
conversions simultanées que l'AS5404T soutient avec Quick Sync actif. C'est ce chiffre — et non le 2
par défaut — qui doit fixer le plafond de sessions distantes.

*Note de contexte : l'adresse IP publique apparaît sur le relevé, et une IP résidentielle Bouygues
peut changer. C'est une raison de plus pour passer par un DDNS ou un domaine (§4.3) plutôt que par
une adresse en dur.*

## 11. « En externe, on est en lecture seule » — portée réelle et définition

C'est la bonne intention, et elle est retenue. Mais elle demande d'être précise sur deux points,
sinon elle protège moins qu'elle n'en a l'air et casse la lecture.

### 11.1 Ce que la lecture seule ne protège pas

**Le risque principal identifié au §2.2 passe entièrement par des `GET`.** La base SQLite
téléchargeable, l'arborescence du NAS, les médias aspirables : tout cela, ce sont des lectures. Une
écoute « en lecture seule » les laisserait grandes ouvertes.

Autrement dit : la lecture seule ne protège pas contre la **fuite** — ce sont la liste blanche du
§4.4 et la session obligatoire du §4.5 qui s'en chargent. Elle protège contre autre chose, et c'est
utile : l'**altération** et la **destruction**. Les deux mesures sont complémentaires, aucune ne
remplace l'autre.

### 11.2 Trois rangs, parce que la lecture a besoin de quelques écritures

Un refus de toute méthode d'écriture rendrait la fonction inutilisable : l'authentification
elle-même est un `POST`. Définition proposée :

**Rang 1 — interdit, en 404.** Bibliothèques, configuration initiale, analyses, corrections,
métadonnées et fournisseurs, sauvegardes et restauration, parcours de disque, préférences de
conversion, télécommande. Rien de ce qui touche à la médiathèque, à la machine ou aux réglages n'est
joignable depuis Internet.

**Rang 2 — les seules écritures autorisées, bornées au profil authentifié.**

| Route | Pourquoi elle est indispensable |
| --- | --- |
| `POST /api/profiles/:id/unlock` | c'est l'authentification elle-même |
| `POST /api/media/:id/playback` | ouvre la session quand la lecture directe n'est pas possible |
| `DELETE /api/playback/:id` | ferme la session ; sans elle, un FFmpeg traîne jusqu'au délai d'inactivité |
| `PUT /api/media/:id/progress` | la reprise — « je continue où j'en étais » |
| `PUT/DELETE /api/catalog/:id/watchlist` | la liste de lecture, si on la veut à distance |

Chacune ne touche que les lignes du profil authentifié, jamais le catalogue ni les fichiers.

**Rang 3 — les lectures autorisées du §4.4**, toutes sous session.

On peut durcir davantage en retirant progression et liste de lecture du rang 2. Mon avis : les
garder. La reprise est ce qui sépare « ça marche » de « ça agace », et une progression écrite dans
la ligne d'un profil ne met rien en danger.

### 11.3 Le point non résolu : la lecture directe demande un `POST`

`POST /api/media/:id/playback` est nécessaire pour toute lecture non directe. Or le §10.1 conclut
qu'il faut **maximiser la lecture directe** en WAN. Il vaut donc la peine de vérifier, au lot B,
combien de médias de la bibliothèque se lisent en direct depuis un navigateur distant sans passer
par cette route du tout — c'est-à-dire combien de sessions distantes pourraient fonctionner en
lecture strictement seule, au sens le plus littéral. C'est une mesure, pas une supposition.

## 12. Hors-root : la conséquence, en clair

La question posée est « quelle est la conséquence du hors-root ». Réponse en deux temps, parce
qu'elle croise directement la demande de lecture seule.

### 12.1 Ce que cela apporte — et le lien direct avec le §11

**Aujourd'hui, le paquet ASUSTOR tourne en root. Rien, au niveau du système, n'empêche FlixTunes
d'effacer la médiathèque entière — seule la bonne conduite du code l'en empêche.** Une lecture seule
définie dans le code est une promesse ; la même lecture seule adossée à un compte qui n'a que le
droit de lire les fichiers est une propriété du système, qu'aucun défaut de code ne peut contourner.

**Le hors-root est donc exactement ce qui rend votre point 3 réel plutôt que déclaratif.** Le côté
Docker le fait déjà : `/media:ro` et `cap_drop: ALL` dans `compose.yaml`. C'est le paquet ASUSTOR,
celui qui tourne réellement sur l'AS5404T, qui ne l'a pas.

S'y ajoute le bénéfice classique : sur un service joignable depuis Internet, une faille donne les
droits d'un compte de service au lieu des droits de la machine — pas d'accès aux autres partages,
pas de persistance installable, pas de pivot vers les autres services d'ADM.

### 12.2 Ce que cela coûte — les cinq points de friction

1. **Quick Sync — le seul risque sérieux.** `/dev/dri/renderD128` doit rester lisible par le nouveau
   compte (appartenance aux groupes `video`/`render`). Raté, on retombe en encodage logiciel : 29
   images par seconde mesurées sur le N5105 et une seule conversion possible — ce sont vos propres
   commentaires dans `start-stop.sh:56-57`. **Mais le diagnostic est déjà écrit** :
   `start-stop.sh:130-133` journalise l'utilisateur, ses groupes et le fait que `renderD128` soit
   lisible ou non par le service. L'échec se verrait au premier démarrage, pas un dimanche soir.
2. **Lecture des partages médias.** Le compte doit être autorisé par les ACL d'ADM sur les dossiers
   de la médiathèque — en lecture seule, ce qui est précisément le but.
3. **Migration d'une installation existante.** `/volume1/FlixTunes` — base, journaux, PID, données —
   doit changer de propriétaire. `post-install.sh` s'exécute en root et peut le faire, mais c'est une
   étape à écrire et à éprouver sur une installation déjà peuplée, pas sur une installation neuve.
4. **Le certificat Let's Encrypt, et c'est là que ça frotte.** Les PEM du magasin d'ADM sont
   typiquement `root` en `0600` : un compte non privilégié ne les lira pas. Il faut soit une copie
   avec changement de propriétaire à chaque renouvellement, soit basculer sur le reverse proxy du
   §4.3 option 2. **C'est le seul vrai conflit entre le hors-root et le §4.3, et il doit être tranché
   avant le lot B.**
5. **Liaison du port : aucun problème.** Le port WAN est supérieur à 1024 par construction (§4.2), un
   choix fait pour d'autres raisons qui se trouve servir ici. Le 4000 du LAN l'est aussi.

### 12.3 Verdict

Le hors-root n'est pas un durcissement de plus à côté de la lecture seule : c'en est le fondement.
Son unique risque sérieux est Quick Sync, et ce risque est déjà instrumenté. Le point à trancher
n'est pas *si*, mais *comment le certificat sera lu* (point 4 ci-dessus, et §14.4).

## 13. Relevé de capacité du NAS — 24 août 2026

Relevé sur l'AS5404T via `GET /api/system/capacity`, serveur en `0.5.6` révision **r49**, calibrage
issu d'une **mesure** réelle et non d'une estimation.

| | |
| --- | --- |
| Processeur | Intel Celeron N5105, 4 cœurs |
| Mémoire | 16,5 Go, dont 12,5 Go libres |
| Température | 27,8 °C (limite configurée : 85 °C) |
| Charge (1 min) | 1,04, aucune session active |
| Encodeur retenu | **VA-API `h264_vaapi`** |
| Budget mesuré | 7,5 unités, réserve 0,6 |

**Accélérateurs éprouvés** (le banc essaie et mesure, il ne se fie pas à la présence d'un fichier) :

| Accélérateur | État | Débit | Face au logiciel |
| --- | --- | --- | --- |
| VA-API `h264_vaapi` | **utilisable, retenu** | 471 im/s | ×3,12 |
| Intel Quick Sync `h264_qsv` | utilisable | 366 im/s | ×2,42 |
| Logiciel x264 | utilisable | 151 im/s | ×1 |
| NVENC, AMF, V4L2 M2M | absents ou refusés | — | — |

### 13.1 Le chiffre demandé

**Sessions simultanées soutenables, mesurées :**

| Type de session | Sessions |
| --- | --- |
| **1080p H.264** | **7** |
| 1080p HDR converti en SDR | 5 |
| 4K H.264 | 2 |

**La cible de 5 à 6 personnes est donc tenue par la machine**, même dans le cas défavorable où
chacune exige une conversion 1080p — et sans compter la lecture directe, qui ne consomme
pratiquement rien.

### 13.2 Mais le plafond configuré est à 2, et c'est lui qui bloquerait

`GET /api/system/playback` rend `maximumTranscodes: 2`. Ce plafond vient de
`FLIXTUNES_TRANSCODE_CONCURRENCY` (défaut 2, `config.ts`) et s'applique **par-dessus** le budget
mesuré : `capacity.ts:205-207` refuse toute nouvelle session au-delà, avec le message « Limite de 2
conversions simultanées atteinte sur ce serveur ».

Autrement dit : **la machine soutient 7 conversions 1080p, la configuration en autorise 2.** La
troisième personne serait refusée alors que le NAS a de la marge. Ce n'est pas un défaut — la valeur
par défaut est prudente et date d'avant le calibrage VA-API — mais c'est le réglage à corriger, et
c'est une ligne de configuration, pas du code.

### 13.3 Réserves honnêtes sur ces chiffres

- le budget dérive d'un micro-banc **720p** extrapolé en sessions 1080p25. Un contenu réel coûte
  davantage : décodage HEVC 10 bits, incrustation de sous-titres image, désentrelacement ;
- `toneMapping` revient **vide** dans le relevé : le « 5 » du HDR→SDR repose donc sur une estimation
  de coût, pas sur une sonde mesurée. À confirmer avant de s'y fier ;
- la mesure a été prise **au repos** (charge 1,04, 27,8 °C). Sous six conversions, la température
  montera ; le garde-fou thermique existe (`thermalLimitCelsius`, 85 °C) et cesse d'ouvrir de
  nouvelles sessions au-delà, mais le comportement réel sous charge soutenue reste à observer ;
- le plafond de qualité par session distante reste à fixer : 6 personnes en 4K converti est
  impossible (2 sessions), 6 personnes en 1080p converti passe, 6 personnes en lecture directe passe
  largement.

**Conclusion des §10 et §13 réunis : ni la ligne ni le NAS ne s'opposent à la cible de 5-6
personnes.** Ce qui s'y oppose aujourd'hui est un défaut de configuration à 2, et l'absence
d'authentification du §2.2.

## 14. Certificat : « accepter une fois et ne plus jamais redemander »

C'est le bon objectif. Mais il faut le dire nettement : **le certificat auto-signé est précisément
le chemin qui ne le tient pas.** Quatre raisons, dont une propre à FlixTunes.

### 14.1 HSTS rend l'acceptation impossible, pas seulement pénible

`helmet` est actif (`app.ts:23`) et n'est désactivé que pour la CSP et la politique de ressources.
**Il envoie donc `Strict-Transport-Security` par défaut.** Aujourd'hui cela ne se voit pas : tout est
en HTTP, et l'en-tête est ignoré. Sur une écoute WAN en HTTPS, il serait honoré — et pour un domaine
marqué HSTS, les navigateurs **retirent le bouton « continuer malgré tout »**. L'avertissement
devient un mur.

« Accepter une fois » exigerait donc de désactiver HSTS sur l'écoute WAN, c'est-à-dire de renoncer
volontairement à une protection sur la seule écoute exposée à Internet. On paierait une régression
de sécurité pour obtenir un confort qui, de toute façon, ne fonctionnerait pas — voir ci-dessous.

### 14.2 « Une fois » n'est pas ce que font les navigateurs

L'exception permanente n'existe vraiment que sur Firefox. Ailleurs :

- **Chrome et Edge sur ordinateur** : la dérogation est retenue par hôte, mais elle n'est pas
  durable — elle disparaît au redémarrage du navigateur ou après une mise à jour ;
- **Chrome sur Android** : l'avertissement revient ;
- **Safari sur iPhone** : il faut installer un profil de configuration **puis** aller activer la
  confiance à la main dans Réglages → Général → Informations → Réglages de confiance des
  certificats. C'est bien davantage qu'« installer quelque chose », et personne ne le trouve seul.

Pour une famille répartie sur des téléphones, des tablettes et des ordinateurs, la promesse « une
seule fois » deviendrait « à chaque fois, chez la moitié d'entre vous ».

### 14.3 Et cela apprend le mauvais réflexe

Un proche à qui l'on demande de passer outre un avertissement de sécurité apprend exactement le
geste qu'une attaque par hameçonnage exploite ensuite. Pire, sur un certificat que personne ne
vérifie, une interception devient **indétectable** : l'avertissement qu'on lui a appris à écarter
était le seul signal qui existait.

### 14.4 Ce qui tient réellement la promesse — et résout aussi le §12.2

**Un certificat Let's Encrypt sur un DDNS ou un domaine ne demande rien à personne. Jamais. Pas même
une première fois.** L'objectif « qu'on ne le redemande plus » est atteint plus complètement par le
chemin qui se trouve aussi être le sûr. Le coût d'installation est unique, sur le NAS, et il est
porté par vous — pas par la famille.

Et il existe une variante qui règle du même coup le point de friction du §12.2 : **un reverse proxy
Caddy sur le NAS obtient et renouvelle le certificat tout seul, et termine TLS lui-même.** FlixTunes
n'a alors jamais à lire les PEM de root — le conflit entre hors-root et lecture du certificat
disparaît. Contrepartie déjà notée au §4.3 : `trustProxy` (`app.ts:21`) doit être réglé sur les IP du
proxy, sinon la limitation de débit s'effondre en un compteur unique.

**Si aucun nom de domaine n'est possible**, la seule chose qui tienne vraiment « une fois et plus
jamais » est l'installation d'une autorité de certification privée sur chaque appareil — c'est-à-dire
installer quelque chose sur chaque appareil, ce que l'usage visé au §9 exclut, et qui sur Android
impose en plus un verrouillage d'écran et le magasin d'autorités utilisateur.

### 14.5 Recommandation

Garder l'exigence — « on ne redemande jamais rien à personne » — et changer le moyen : DDNS ou
domaine, plus Let's Encrypt, de préférence via Caddy. L'auto-signé reste utile pour vos propres
essais sur le LAN, jamais pour les proches.

Si vous préférez malgré tout l'auto-signé, c'est votre décision et je l'appliquerai — mais il faudra
alors accepter explicitement de désactiver HSTS sur l'écoute WAN (§14.1) et d'accompagner chaque
appareil iPhone à la main. Le document doit dire ce que cela coûte, il ne dit pas ce qu'il faut
faire. → *tranché : Let's Encrypt via Caddy, voir §15.*

## 15. Architecture retenue — Caddy, Let's Encrypt, `flixtunes.exemple.fr`

**Décision du 24 août 2026.** Ce chapitre remplace les §4.2 et §4.3 partout où ils divergent ; les
sections antérieures sont conservées telles quelles, comme trace du raisonnement.

### 15.1 Ce que Caddy change — et c'est beaucoup

Le choix retire trois problèmes d'un coup :

- **FlixTunes n'a plus besoin de savoir parler HTTPS.** Caddy termine TLS. Aucun code TLS, aucune
  lecture de PEM, aucun rechargement de contexte à écrire. Le §4.3 devient sans objet.
- **Le conflit hors-root du §12.2 point 4 disparaît.** C'était « le seul vrai conflit » : les PEM
  d'ADM en `root:0600` qu'un compte non privilégié ne pouvait pas lire. Caddy possède son
  certificat, FlixTunes ne le voit jamais. Le hors-root devient franc.
- **L'écoute WAN devient triviale à sécuriser** : plus besoin de port exotique ni de TLS propre.

### 15.2 La forme réelle

```
Internet ──443──► Caddy (NAS)  ──► 127.0.0.1:4001  instance WAN  (HTTP, boucle locale)
             │     TLS + Let's Encrypt
             └──80──► redirection HTTPS + défi ACME

LAN ─────────────► 192.168.1.50:4000              instance LAN  (HTTP, inchangée)
```

**Point critique : l'instance WAN doit écouter sur `127.0.0.1`, jamais sur `0.0.0.0`.** Sinon le port
WAN en clair est joignable depuis le LAN, et surtout une erreur de redirection sur la box
l'exposerait en clair sur Internet. Le réglage du §4.1 devient :

```
FLIXTUNES_WAN_HOST=127.0.0.1   # jamais 0.0.0.0
FLIXTUNES_WAN_PORT=4001        # boucle locale : le numéro n'a plus d'enjeu de sécurité
```

Votre demande initiale — « un port d'écoute différent pour le WAN » — est donc tenue, et mieux que
prévu : le port existe bien, mais il n'est atteignable que depuis la machine elle-même.

Les réglages `FLIXTUNES_WAN_TLS_CERT` et `FLIXTUNES_WAN_TLS_KEY` du §4.1 sont abandonnés.

### 15.3 `trustProxy` — le piège à ne pas manquer

Derrière Caddy, **toutes les requêtes arrivent de `127.0.0.1`**. Avec `trustProxy: false`
(`app.ts:21`), trois mécanismes du présent audit s'effondrent en silence :

- la limitation de débit compte tout Internet sur **un seul compteur** — 600 requêtes par minute pour
  la planète entière, ou pour personne ;
- le blocage anti-force-brute du §4.5, prévu « par profil *et* par IP », bloquerait **tout le monde à
  la fois** dès le cinquième essai raté de n'importe qui ;
- le journal du §4.7 n'enregistrerait que `127.0.0.1` — inexploitable, donc inutile.

Il faut donc `trustProxy` réglé sur **l'adresse du proxy uniquement**, jamais sur `true` (qui ferait
confiance à n'importe quel `X-Forwarded-For` fabriqué par le visiteur). Et — argument de plus pour
les deux instances du §4.1 — **seule l'instance WAN doit avoir ce réglage** ; l'instance LAN garde
`trustProxy: false`.

Corollaire utile : avec `trustProxy` correct, Fastify lit `X-Forwarded-Proto`, ce dont dépend la pose
de l'attribut `Secure` sur le cookie du §4.5.

### 15.4 Le domaine — état constaté et ce qu'il reste à faire

Vérifié le 24 août 2026 :

| Nom | État |
| --- | --- |
| `exemple.fr` | existe, pointe sur `198.51.100.7` (plage IONOS) |
| `flixtunes.exemple.fr` | **n'existe pas encore** |

Bonne nouvelle : l'apex est hébergé ailleurs et **n'est pas touché**. On ne crée qu'un
sous-domaine ; le site existant ne court aucun risque.

**Le vrai sujet est l'IP dynamique.** L'adresse publique Bouygues peut changer, et un enregistrement
figé chez IONOS casserait l'accès sans prévenir — un dimanche soir, sans message d'erreur
compréhensible. Deux voies :

1. **CNAME vers un DDNS** — `flixtunes.exemple.fr` en `CNAME` vers le nom DDNS du NAS. Le client
   DDNS de l'ADM garde ce nom à jour, et **l'enregistrement IONOS ne bouge plus jamais**. C'est la
   voie que je recommande : elle découple le registrar de l'IP dynamique, et Let's Encrypt suit les
   CNAME sans difficulté en HTTP-01.
2. **Enregistrement A tenu à jour par l'API IONOS** (service DynDNS d'IONOS). Fonctionne, mais fait
   dépendre l'accès d'un jeton d'API supplémentaire à stocker et à faire tourner.

**Décision : enregistrement A fixe**, sous réserve des deux vérifications du §15.4.1. La voie CNAME
vers DDNS reste le repli documenté si l'une des deux échoue.

C'est le bon choix quand la condition est remplie : moins de pièces mobiles, pas de client DDNS à
maintenir, pas d'indirection à diagnostiquer. Mais la condition doit être vérifiée, pas supposée.

#### 15.4.1 Condition remplie

**IPv4 fixe confirmée par le propriétaire du projet le 24 août 2026.** La condition est satisfaite et
l'enregistrement A est retenu sans réserve.

Cela règle du même coup la question du CGNAT, qui aurait été la vérification la plus lourde de
conséquences du document : une adresse IPv4 fixe fournie contractuellement est nécessairement une
adresse publique routable. La redirection de ports est donc possible, et les architectures des §15 et
§16 tiennent.

L'enregistrement à créer chez IONOS :

```
flixtunes.exemple.fr.   A   203.0.113.42
```

*L'adresse provient du relevé de débit du 24 août 2026 : à confirmer dans l'interface de la Bbox
avant création, plutôt qu'à recopier depuis une capture d'écran.*

Rien d'autre n'est touché : l'apex `exemple.fr` et ses services restent en place chez IONOS.

#### 15.4.2 Un filet de sécurité qui reste utile, à moindre priorité

Une IPv4 fixe rend le scénario improbable, mais pas impossible — un changement d'offre, une migration
d'infrastructure ou un remplacement de box peuvent encore la faire bouger. Or le mode de panne est
particulièrement désagréable :

- les proches tombent sur une erreur, ou pire, sur la box d'un inconnu qui a hérité de l'adresse ;
- **le renouvellement Let's Encrypt échoue**, parce que le défi HTTP-01 est envoyé à la mauvaise
  machine. Et cet échec est **silencieux pendant des semaines** — jusqu'à l'expiration du certificat
  à 90 jours, qui coupe alors tout d'un coup, sans lien apparent avec la cause.

D'où un contrôle qui ne coûte presque rien : **comparer périodiquement l'adresse publique réelle à
celle que résout `flixtunes.exemple.fr`, et alerter dès qu'elles divergent.** FlixTunes tourne
déjà en permanence sur le NAS et sait journaliser : c'est l'endroit naturel.

**Priorité basse**, désormais : avec une IP fixe, c'est une assurance contre un événement rare, pas
une pièce du socle. À inscrire au lot C plutôt qu'au lot B — mais à inscrire, parce que le jour où
elle servira, elle évitera plusieurs jours de panne inexpliquée.

*Note pour plus tard, hors périmètre : la fibre Bouygues fournit aussi de l'IPv6. Un enregistrement
AAAA n'est pas nécessaire — les clients basculeront en IPv4 — mais la question mérite d'être reprise
si l'IPv4 se révèle instable.*

### 15.5 Ports — constat sur le NAS, et ce qu'il faut ouvrir

Sondage du 24 août 2026 sur `192.168.1.50` :

| Port | État | Occupant |
| --- | --- | --- |
| 80 | **libre** | — |
| 443 | **libre** | — |
| 8000 / 8001 | occupés | interface ADM |
| 4000 | occupé | FlixTunes |

Caddy peut donc prendre 80 et 443 sans rien déloger. À rediriger sur la box : **80 → NAS:80** et
**443 → NAS:443**.

Le port 80 est nécessaire et sans risque : Caddy n'y sert que le défi ACME et une redirection vers
HTTPS. Sans lui, plus de renouvellement automatique — et le certificat expirerait au bout de 90 jours.

**Conséquence à assumer sur votre demande initiale de port non standard :** la validation Let's
Encrypt exige que le défi arrive sur 80 (HTTP-01) ou 443 (TLS-ALPN-01). Garder un port public
exotique imposerait le défi **DNS-01**, donc des identifiants d'API IONOS confiés à Caddy *et* une
compilation de Caddy avec le greffon DNS correspondant (`xcaddy`). C'est faisable, mais c'est un
coût permanent pour un bénéfice nul : le §4.2 disait déjà que le numéro de port n'apporte aucune
sécurité. **Recommandation : 80 et 443 standards.**

### 15.6 Caddy hors-root, malgré les ports privilégiés

Lier un port inférieur à 1024 demande un privilège — ce qui semble contredire le §12. La réponse
standard existe : `setcap cap_net_bind_service=+ep` sur le binaire Caddy, qui lui permet de lier 80
et 443 **tout en tournant sous un compte non privilégié**. Pas de compromis à faire.

### 15.7 Esquisse de configuration

```
flixtunes.exemple.fr {
    reverse_proxy 127.0.0.1:4001
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }
}
```

Caddy obtient et renouvelle le certificat seul, et redirige 80 vers 443 par défaut. La compression
est laissée à Caddy ; **elle ne doit pas s'appliquer aux flux vidéo**, déjà compressés — à vérifier à
la mise en œuvre, une double compression coûterait du processeur pour rien.

À noter : `Strict-Transport-Security` est ici posé par Caddy *et* par `helmet` côté FlixTunes. Avec un
vrai certificat, c'est désormais souhaitable (§14.1) — il faudra simplement s'assurer que l'en-tête
n'est pas envoyé en double.

### 15.8 Où vit Caddy — question ouverte

Deux voies, et elle n'est pas tranchée :

- **Dans le paquet APKG**, à côté du runtime Node et de FFmpeg déjà embarqués. Cohérent avec la
  philosophie d'empaquetage du projet, et rien à installer côté administrateur. **Mais** le paquet
  devient propriétaire des ports 80/443 et du cycle de vie du certificat, et `config.json` doit les
  déclarer.
- **À côté, en Docker ou en binaire autonome.** FlixTunes reste un serveur d'application et ignore
  tout de TLS. Plus propre en séparation des rôles, mais c'est une pièce d'infrastructure de plus à
  installer et à maintenir à la main.

Mon avis penche pour la première : le projet embarque déjà son Node, son FFmpeg et ses pilotes VA-API
précisément pour que rien ne soit à installer. Mais c'est une décision d'architecture qui engage
l'empaquetage, et elle mérite d'être prise explicitement.

### 15.9 État des décisions

| Sujet | État |
| --- | --- |
| Voie retenue | écoute WAN durcie (§9) |
| Certificat | Let's Encrypt via Caddy (§14.5) |
| Domaine | `flixtunes.exemple.fr` |
| TLS dans FlixTunes | abandonné — Caddy s'en charge |
| Écoute WAN | `127.0.0.1:4001`, en clair, boucle locale |
| Lecture seule WAN | trois rangs du §11.2 |
| Hors-root | retenu, plus de conflit certificat |
| Ports publics | 80 et 443 recommandés |
| Enregistrement DNS | **tranché : A fixe, IPv4 fixe confirmée (§15.4.1)** |
| Caddy dans l'APKG ou à côté | **tranché : dans le paquet, voir §16** |
| Plafond de conversions | **appliqué : 6 (§13.4)** |
| **Ouvert** | calendrier : maintenant ou étape 61 |

### 13.4 Plafond relevé à 6 — appliqué le 24 août 2026

`FLIXTUNES_TRANSCODE_CONCURRENCY=6` ajouté à `/volume1/FlixTunes/config/flixtunes.env`
(sauvegarde : `flixtunes.env.bak-20260824`). La variable était absente, c'est donc bien le défaut de
2 qui s'appliquait.

**Pourquoi 6 et pas 7 :** le budget mesuré vaut 7,5 unités et une session 1080p en coûte environ une.
Six laisse une marge au-dessus du plafond plutôt que de viser la dernière unité disponible, et
correspond exactement à la cible annoncée de 5-6 personnes.

**Ce que le changement ne retire pas :** le compteur n'était qu'une limite artificielle posée
par-dessus le vrai garde-fou. Le budget continue de refuser ce qui ne tient pas — deux sessions 4K
coûtent à elles seules 7,5 unités et resteront refusées par le budget, pas par le compteur. La
protection thermique (85 °C) et la réserve de 40 % pour l'interface et les analyses sont également
intactes.

**Le défaut livré reste à 2, délibérément.** 7,5 unités sont le budget *de cette machine*, mesuré sur
son VA-API. Un NAS plus faible qui hériterait d'un défaut à 6 ouvrirait six conversions qu'il ne peut
pas soutenir. Le réglage appartient à la configuration de l'installation, pas au code livré.

À observer à la première charge réelle : la température sous six conversions simultanées — la mesure
du §13 a été prise à 27,8 °C au repos, et le comportement soutenu reste à constater.

## 16. Caddy embarqué dans l'APKG — conséquences

**Décision du 24 août 2026 : Caddy est embarqué dans le paquet ASUSTOR**, comme le sont déjà le
runtime Node, FFmpeg et les pilotes VA-API. Rien à installer côté administrateur. Ce chapitre
remplace le §15.6 sur la question des ports privilégiés.

### 16.1 Le setcap devient inutile — et c'est mieux ainsi

Le §15.6 proposait `cap_net_bind_service` pour que Caddy lie 80 et 443 sans être root. Cette
complication tombe, parce que **la box fait déjà une traduction de ports** :

```
Internet :80  ──box──► NAS:8080  ┐
Internet :443 ──box──► NAS:8444  ┘  Caddy, ports non privilégiés, compte non root
```

**Ports retenus côté NAS : 8080 et 8444**, relevés libres le 24 août 2026 :

| Port | Routeur `192.168.1.1` | NAS `192.168.1.50` |
| --- | --- | --- |
| 8080 | libre | **libre — retenu (HTTP/ACME)** |
| 8443 | **occupé** | libre |
| 8444 | libre | **libre — retenu (HTTPS)** |

Précision technique, parce qu'elle resservira : un service sur `192.168.1.1:8443` **n'interdit pas**
au NAS d'écouter sur `192.168.1.50:8443` — un port appartient à une machine, pas à un réseau. Le
8443 aurait donc fonctionné. Mais deux services portant le même numéro sur le même réseau rendent
tout diagnostic ambigu — « le 8443 ne répond pas » ne désignerait plus rien de précis — et 8444 ne
coûte rien. Le choix est retenu pour la lisibilité, pas par nécessité.

Les serveurs de Let's Encrypt se connectent à **l'IP publique sur 80 ou 443** ; ce qui se passe
derrière la box leur est indifférent. Caddy prévoit exactement ce cas avec ses options globales
`http_port` et `https_port`.

Trois bénéfices en une fois : plus de privilège à accorder, plus de dépendance aux attributs étendus
du système de fichiers — dont la disponibilité sur ADM restait à vérifier —, et **plus de port
privilégié à déclarer** dans `config.json`. Le hors-root du §12 devient franc de bout en bout.

Les ports **publics** restent 80 et 443, imposés par la validation ACME (§15.5). Ce sont les ports
côté NAS qui deviennent libres — et votre demande initiale d'un port d'écoute non standard se trouve
satisfaite là où elle ne coûte rien.

### 16.2 Le piège qui casserait l'accès : où vivent les certificats

Caddy stocke le certificat **et la clé de compte ACME** dans son dossier de données. Celui-ci doit
impérativement vivre dans le partage persistant — `/volume1/FlixTunes/caddy` — et **jamais** sous
`$APKG_PKG_DIR`, qui est remplacé à chaque mise à jour du paquet.

Ce n'est pas une précaution théorique. Let's Encrypt limite à **cinq certificats identiques par
semaine**. Le projet a livré r47, r48 et r49 en quelques jours : avec un stockage placé dans le
dossier du paquet, cinq mises à jour dans la même semaine épuiseraient le quota et **l'accès distant
tomberait pour plusieurs jours**, sans rapport apparent avec la mise à jour qui l'a causé. C'est
exactement le genre de panne qu'on ne diagnostique pas le soir même.

### 16.3 `start-stop.sh` pilote désormais deux processus

Conséquences à écrire :

- **ordre de démarrage** : Node d'abord, Caddy ensuite — TLS ne doit pas accepter de connexions avant
  que le serveur d'application ne réponde ; **ordre d'arrêt** inverse ;
- **deux fichiers PID**, et `is_running` doit distinguer les deux états : Node vivant avec Caddy mort
  signifie « le LAN marche, le WAN est tombé », ce qui doit se voir ;
- **la mort de Caddy est silencieuse** aujourd'hui par construction : personne ne s'en aperçoit tant
  qu'un proche n'essaie pas de se connecter. Il faut un journal dédié et une reprise ;
- une mise à jour du paquet redémarre Caddy, donc **coupe brièvement l'accès distant**. Acceptable,
  mais à annoncer.

### 16.4 Configuration engendrée, et désactivée par défaut

La `Caddyfile` est engendrée depuis `flixtunes.env`, à partir d'un seul réglage :

```
FLIXTUNES_WAN_DOMAIN=          # vide = pas d'accès distant du tout
```

**Vide par défaut : Caddy ne démarre pas, aucun port n'est lié, l'instance WAN n'existe pas.** C'est
la règle posée au §4.1 et elle ne change pas — l'accès distant reste une décision explicite, jamais
un effet de bord d'une mise à jour.

`config.json` déclare alors les ports côté NAS (8080, 8444) en plus du 4000 existant.

### 16.5 Ce que le paquet accepte comme responsabilité

Il faut le dire clairement, parce que c'est le revers de la décision : **FlixTunes devient
responsable d'un terminateur TLS exposé à Internet.** Une faille dans Caddy cesse d'être l'affaire
d'un composant tiers installé par l'administrateur et devient une révision du paquet à publier.

Cela ne remet pas la décision en cause — l'argument « rien à installer » reste le bon pour l'usage
visé au §9 — mais cela **renforce l'importance de l'étape 60** (mises à jour signées, retour arrière
automatique) : le mécanisme qui permettra de diffuser vite un correctif de sécurité. Le lien entre
les deux étapes mérite d'être noté dans la feuille de route.

Poids ajouté au paquet : un binaire Caddy statique x86-64 est de l'ordre de 45 Mo — à mesurer à la
construction plutôt qu'à estimer, mais négligeable devant le runtime FFmpeg déjà embarqué.

### 16.6 À vérifier sur le NAS avant construction

- que l'ADM n'interdit pas à un paquet de déclarer des ports d'écoute supplémentaires ;
- que la traduction de ports 80→8080 et 443→8444 est faisable sur la box Bouygues ;
- que le partage `/volume1/FlixTunes` survit bien à une mise à jour de paquet — c'est l'hypothèse sur
  laquelle repose tout le §16.2, et elle mérite d'être éprouvée une fois plutôt que supposée.
