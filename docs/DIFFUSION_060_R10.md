# Diffusion 0.6.0 r10 — caster hors de chez soi

*3 octobre 2026. Plan et décisions : `PLAN_DIFFUSION_060_R10.md`.*

## Ce que fait la r10

Depuis l'accès distant, on caste vers un téléviseur **du réseau où l'on se trouve** — chez un proche,
en vacances — avec la même chaîne de diffusion qu'à la maison.

### Le relais

Le NAS ne voit pas un téléviseur chez un proche, et ce téléviseur ne connaît pas l'adresse locale du
NAS. Le téléphone, ou l'onglet Chrome, qui est à côté de lui, voit les deux. Il devient un **relais** :

1. Il annonce au NAS chaque téléviseur Cast qu'il découvre (`POST /api/diffusion/relais`). Ces
   téléviseurs apparaissent parmi les cibles du profil, marqués `relais`.
2. Il bat toutes les secondes pendant une diffusion, comme un lecteur FlixTunes, et rapporte l'état
   du téléviseur et l'adresse du média qu'il lit.
3. Il exécute les ordres du NAS avec le SDK Cast : ouvrir la session, sonder, charger, piloter,
   libérer — et rend un accusé portant le code d'erreur Cast.

Le NAS garde toute la décision, exactement comme à la maison : sonde des formats, plan de qualité,
analyse et variante du direct (r9), replis, progression, télécommande visible de tous les appareils du
profil. Côté serveur, un `TransportRelais` reprend l'interface du transport Cast ; la diffusion ne voit
pas la différence.

### Le flux à clé (décision D1)

Le téléviseur lit par le domaine de l'accès distant, en HTTPS, avec une clé de diffusion dans
l'adresse : c'est la seule exception à la session obligatoire sur Internet.

- Une clé aléatoire de 256 bits par diffusion, créée pour un téléviseur distant.
- Morte à l'arrêt, après deux minutes sans requête du téléviseur ni battement du relais, et au plus
  tard à la durée du média plus une heure (six heures pour un direct). Une réponse en cours d'envoi
  compte comme une activité : un fichier lu d'un trait n'est pas coupé.
- Depuis Internet, les clés du réseau local répondent `404`, tout aussi secrètes qu'elles soient.
- L'affiche du film passe par la même clé : `/api/artwork` exige une session que le téléviseur n'a pas.
- La clé est masquée du journal du serveur ; Caddy ne journalise pas ces requêtes (`log_skip`). Si ce
  Caddy refusait la directive, l'accès distant démarre sans elle et le signale.

### Les autres décisions

- **D3 — qualité.** Hors de chez soi, une source au-delà de 25 Mbit/s n'est pas copiée : la
  conversion 1080p passe d'abord, le réseau d'accueil étant inconnu et le lecteur Cast n'adaptant pas
  la qualité. La case « Qualité maximale » rend la copie.
- **D4 — la maison reste à la maison.** Depuis l'accès distant, les téléviseurs de la maison ne sont
  ni listés ni pilotables.
- **D5 — émetteurs.** Application Android (téléphone et tablette), Chrome sur le domaine, et
  AirPlay depuis Safari. Les lecteurs FlixTunes connectés au profil chez un proche (Android TV,
  navigateur) sont aussi des cibles, avec leur propre session.

### Liste blanche

Ajoutées à l'écoute distante, par décision explicite : `GET /api/diffusion/flux/:cle/:nom` et
`GET /api/diffusion/sonde/:dossier/:fichier` sans compte ni session ; sous compte et session, les
cibles, l'accusé d'un ordre, l'inscription et les battements des lecteurs, l'inscription d'un relais,
les commandes, et AirPlay. Toute autre route de diffusion reste `404`.

## Mesures

### Banc du relais, avec de vrais récepteurs

Le PC joue le téléphone : il exécute les ordres du NAS avec le client Cast du serveur. La Bbox ne
rebouclant pas l'adresse publique vers le réseau local, le relais du banc réécrit le domaine vers
l'adresse locale du PC avant chaque chargement ; tout le reste est réel.

| Récepteur | Contenu | Ordres reçus par le relais | Traitement | Démarrage | Tenue |
| --- | --- | --- | --- | --- | --- |
| Pixel Tablet | film HEVC 4K HDR (extrait) | vérifier, 3 sondes, charger | conversion 720p, choisie après la sonde relayée | 16,3 s | 30 s |
| Pixel Tablet | CNews | vérifier, charger | 720p25 copié | 7,3 s | 30 s |
| Pixel Tablet | TF1 | vérifier, charger | 720p25 désentrelacé | 11,4 s | 30 s |

Pause, reprise, déplacement (relance de la conversion par un nouveau chargement) et arrêt (ordre
`libérer`) réussis à chaque essai. Le 58PUS7304 était éteint pendant ce banc.

### Tests

- Serveur : relais de bout en bout par les vraies routes (inscription, ordres, accusés, repli au niveau
  suivant, capacités retenues par modèle, état d'un autre média), D3, D4, durée de vie des clés,
  affiche à clé, refus des clés locales sur le WAN, liste blanche et crochet WAN réel de l'application.
- Web : panneau hors de chez soi, case « Qualité maximale » transmise au NAS.
- Android : compilation contre le SDK Cast 22.3.1, tests JVM et lint.

## Reste à mesurer

- **Le chemin Internet réel** : un téléviseur hors du réseau de la maison, qui lit par le domaine, le
  certificat et Caddy. Banc prévu : Pixel Tablet et téléphone sur le partage de connexion 4G du
  téléphone.
- **Les émetteurs réels** : l'application Android avec le SDK Cast, et Chrome, sur un vrai téléviseur.
- **AirPlay depuis Safari** hors de chez soi, avec une Apple TV.
- **La directive `log_skip`** sur le Caddy du NAS, et l'absence de clé dans `caddy.log` (M2).

## Limites connues

- Le relais doit rester actif : un téléphone qui quitte le Wi-Fi ou se fait endormir par le système
  laisse le téléviseur lire — il lit depuis le NAS — mais ne rapporte plus ni l'état ni la
  progression, et les commandes des autres appareils échouent jusqu'à son retour. L'onglet Chrome doit
  rester ouvert.
- Un Wi-Fi qui isole ses clients (hôtels) ne laisse découvrir aucun téléviseur.
- Les téléviseurs affichent « Default Media Receiver » (décision D2).
- Le DLNA chez un proche viendra en r11.
