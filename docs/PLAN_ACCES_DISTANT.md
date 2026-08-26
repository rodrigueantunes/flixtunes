# Plan de développement — accès distant sécurisé

*24 août 2026. **Étape 58** (`0.5.8`), séquence arrêtée au §6 de `REVUE_ETAPES_RESTANTES.md`.
**Rien n'est implémenté — la mise en œuvre démarrera sur instruction explicite.***

**Préalable : l'étape 57** livre la vérification de signature et le retour arrière. Elle conditionne
celle-ci : on n'expose pas sur Internet un service qu'on ne sait pas corriger de façon vérifiable.

Sources : `AUDIT_ACCES_INTERNET.md` pour le constat et l'architecture,
`PREPARATION_REGLAGE_CONVERSIONS.md` pour un réglage connexe.

## 1. Objet

Rendre la médiathèque accessible depuis Internet à cinq ou six proches, **sans rien leur faire
installer**, sans exposer autre chose que la lecture, et sans modifier d'un octet le comportement sur
le réseau local.

### 1.1 Dans le périmètre

Deuxième écoute dédiée au WAN ; surface réduite en liste blanche ; session obligatoire sur toutes les
requêtes, flux vidéo compris ; durcissement du PIN ; journal des accès distants ; Caddy et Let's
Encrypt embarqués dans le paquet ; passage du service hors-root ; adaptation des clients Web et
Android.

### 1.2 Hors périmètre, explicitement

Rôles et ACL par bibliothèque, profils enfants filtrés côté serveur, SBOM, rotation des secrets,
tableau de bord d'exploitation — ils restent à l'étape 61. Mises à jour signées : étape 57.
Surveillance de dérive d'IP : lot C. Réglage du plafond de conversions : document séparé.

## 2. Prérequis à lever avant la première ligne de code

Aucun n'est un développement ; chacun peut invalider une partie du plan.

| # | À vérifier | Conséquence si non |
| --- | --- | --- |
| P1 | l'adresse publique de la Bbox correspond bien à l'IP fixe annoncée | CGNAT ⇒ **tout le plan tombe**, bascule sur un relais sortant |
| P2 | la box sait rediriger 80 → NAS:8080 et 443 → NAS:8444 | Caddy inatteignable ⇒ revoir §7 |
| P3 | l'ADM autorise un paquet à déclarer des ports supplémentaires | Caddy sort du paquet |
| P4 | `/volume1/FlixTunes` survit à une mise à jour de paquet | stockage des certificats à replacer, sinon quota Let's Encrypt épuisé |
| P5 | l'enregistrement `flixtunes.exemple.fr A` est créé chez IONOS | pas de certificat possible |

**P1 et P4 sont les deux qui coûtent le plus cher si on les découvre tard.**

## 3. Architecture cible

```
Internet ─80──box──► NAS:8080 ┐ Caddy (dans le paquet, compte non privilégié)
         ─443─box──► NAS:8444 ┘ TLS + Let's Encrypt, données dans /volume1/FlixTunes/caddy
                                    │
                                    ▼
                          127.0.0.1:4001   instance WAN   liste blanche + session obligatoire
                          0.0.0.0:4000     instance LAN   inchangée
```

Deux instances Fastify dans un seul processus, partageant les singletons de module — base,
coordinateur d'analyse, sessions de lecture. Un contrôle posé sur l'instance WAN ne peut pas être
contourné depuis le LAN, et réciproquement.

## 4. Décisions

- **Le LAN ne change pas.** Toute évolution se fait par ajout sur la seconde instance. C'est ce qui
  rend le risque de régression quasi nul, et c'est non négociable.
- **Liste blanche, jamais liste noire.** Une liste noire oublie la route ajoutée le mois suivant.
- **Refus en `404`, pas en `403`**, sur les routes interdites : ne pas confirmer ce qui existe.
- **Rien n'est actif par défaut.** `FLIXTUNES_WAN_DOMAIN` vide ⇒ ni Caddy, ni écoute WAN, ni port lié.
- **Échec au démarrage plutôt que repli silencieux** si la configuration WAN est incomplète.
- **La lecture seule est une propriété du système, pas une promesse du code** : d'où le hors-root et
  les médias montés en lecture seule.
- **Aucun jeton dans une URL.** Ils finissent dans les journaux et les historiques.

## 5. Lots de travail, dans l'ordre

### Lot 1 — Hors-root et remesure de capacité *(le risque en premier)*

**Pourquoi d'abord :** les 7 sessions 1080p du §13 de l'audit ont été mesurées **en root**, avec
VA-API à 471 im/s. Si un compte non privilégié perd l'accès à `/dev/dri/renderD128`, on retombe à
151 im/s en logiciel — et toute la promesse « 5 à 6 personnes » s'effondre. Ce risque doit être levé
avant de construire quoi que ce soit dessus, pas après.

Compte de service dédié ; appartenance aux groupes `video`/`render` ; ACL ADM en **lecture seule** sur
les partages médias ; migration de propriété de `/volume1/FlixTunes` par `post-install.sh` sur une
installation **déjà peuplée**. Le diagnostic existe déjà : `start-stop.sh:130-133` journalise
l'utilisateur, ses groupes et la lisibilité du périphérique.

### Lot 2 — Deuxième écoute et liste blanche *(rien n'est exposé)*

`buildApp({ exposition })`, réglages WAN dans `config.ts`, seconde écoute sur `127.0.0.1`, liste
blanche des routes, `404` sur tout le reste. Entièrement vérifiable en local, sans redirection sur la
box et sans certificat. À ce stade la fonction n'est joignable de nulle part — c'est voulu.

### Lot 3 — Authentification

Jetons de déverrouillage **persistés** en base (aujourd'hui une `Map` mémoire, perdue à chaque
redémarrage et non révocable), avec libellé d'appareil, dernier usage et révocation. Cookie
`HttpOnly; Secure; SameSite=Strict` pour le navigateur — seul moyen d'authentifier `<video>`, `<img>`
et `<track>`, qui ne peuvent pas porter d'en-tête — et `X-FlixTunes-Profile-Token` pour Android, les
deux passant par un contrôle commun. PIN à six chiffres minimum sur le WAN, ancien PIN exigé pour en
changer, blocage progressif. Un profil sans PIN n'est ni listé ni joignable depuis le WAN.

### Lot 4 — Journal, limites et `trustProxy`

Journal des accès distants — date, IP, profil, résultat, appareil — dans le partage persistant.
Limitation de débit **sans** l'exemption `/api/(media|playback|artwork)/` du LAN, plafond distinct sur
la création de session de conversion, plafond de sessions distantes simultanées. `trustProxy` réglé
sur l'adresse du proxy **uniquement sur l'instance WAN** ; jamais `true`.

### Lot 5 — Caddy dans le paquet

Binaire embarqué ; `Caddyfile` engendrée depuis `FLIXTUNES_WAN_DOMAIN` ; données Caddy dans
`/volume1/FlixTunes/caddy` ; `start-stop.sh` pilotant deux processus, deux fichiers PID, ordre de
démarrage Node puis Caddy et arrêt inverse ; ports déclarés dans `config.json`.

### Lot 6 — Clients

Web : `credentials: "include"` sur le WAN, gestion du cookie, comportement à l'expiration. Android :
jeton porté aussi par la source HTTP d'ExoPlayer — pas seulement par l'API —, et
`network_security_config.xml` restreint au trafic en clair sur les **plages privées uniquement**,
TLS exigé partout ailleurs.

### Lot 7 — Recette, mesure et note de validation

Les sept points de validation obligatoires du plan, plus les métriques du §7.

### Dépendances

```
Lot 1 ──┐
Lot 2 ──┼──► Lot 3 ──► Lot 4 ──┐
        └──► Lot 5 ─────────────┼──► Lot 7
             Lot 6 ─────────────┘
```

Lots 1 et 2 sont indépendants et peuvent avancer en parallèle. Le lot 6 ne peut être jugé qu'après le
lot 3.

## 6. Cas limites

Certificat expiré ou renouvellement échoué ; Caddy mort pendant que Node vit ; jeton expiré **en
pleine lecture** ; deux appareils sur le même profil ; PIN changé pendant qu'une session distante est
active ; cookie refusé par le navigateur ; client distant en 4G qui exige une conversion alors que le
plafond est atteint ; coupure réseau pendant un segment ; redémarrage du NAS avec des sessions
distantes ouvertes ; horloge du NAS décalée — ACME y est sensible ; mise à jour du paquet pendant
qu'un proche regarde un film ; adresse publique changée malgré l'IP fixe.

## 7. Métriques d'acceptation

Le plan exige des seuils chiffrés, pas des observations.

| # | Métrique | Seuil |
| --- | --- | --- |
| M1 | routes hors liste blanche répondant autre chose que `404` sur le WAN | **0**, sur l'énumération exhaustive des routes |
| M2 | réponses `2xx` sans session valide sur le WAN, flux et jaquettes compris | **0** |
| M3 | essais de PIN avant blocage | **≤ 5**, puis **< 60 tentatives/heure/IP** — soit plus d'un an et demi pour épuiser 10⁶ combinaisons |
| M4 | débit VA-API après passage hors-root | **≥ 90 %** des 471 im/s mesurées en root ; en deçà, le lot 1 est en échec |
| M5 | première image en WAN comparée au LAN, même réseau | écart médian **à mesurer** et publié ; aucune valeur supposée |
| M6 | non-régression LAN | mesures de lecture de r46 **inchangées** |
| M7 | conversions simultanées soutenues depuis le WAN | **6**, température restant sous 85 °C |

**M4 est le point de bascule du plan.** S'il n'est pas tenu, le hors-root doit être revu avant de
poursuivre — et si aucune solution n'est trouvée, l'arbitrage entre lecture seule réelle et
accélération matérielle remonte à la décision.

## 8. Preuves

**Tests négatifs d'abord**, c'est l'esprit de l'étape 61 et c'est ce qui garde une liste blanche
honnête : pour chaque route de l'API, un test qui vérifie qu'elle répond `404` sur le WAN si elle
n'est pas listée. Ce test doit **échouer automatiquement quand une route est ajoutée** sans décision
explicite — sinon la liste blanche se dégradera silencieusement.

Puis : session absente sur chaque route autorisée ; cookie forgé ; jeton d'un autre profil ; jeton
expiré ; force brute sur le PIN ; requête directe sur `127.0.0.1:4001` depuis le LAN ;
`X-Forwarded-For` fabriqué par le client ; instance LAN comparée avant/après sur la suite complète.

Sur le NAS : renouvellement de certificat forcé, Caddy tué en pleine lecture, mise à jour de paquet
avec une session distante ouverte, redémarrage du NAS, et la remesure de capacité du lot 1.

## 9. Livrables

- **APK Android** et **APKG ASUSTOR x86-64**, comme à chaque étape ;
- `docs/VALIDATION_0.5.8.md` — résultats réellement mesurés, et « Reste à exécuter » pour le reste ;
- `docs/SECURITY.md` réécrit : sa section déploiement dit aujourd'hui l'inverse de ce qui sera livré ;
- procédure d'exposition pas à pas : DNS, box, activation, premier proche ;
- entrée `CHANGELOG.md`, **après** la note de validation, jamais avant.

## 10. Ce qui ne doit pas changer

L'écoute LAN, à l'octet près. Le chemin de lecture de r46 — Dolby Vision, HDR10+, HDR10, HLG, SDR,
Dolby Atmos, reprise et seeks. Aucune migration destructive : médias, profils, progressions, états
vus, personnes, crédits et réglages conservés.

## 11. Risques et points de bascule

| Risque | Probabilité | Bascule |
| --- | --- | --- |
| VA-API perdu hors-root | moyenne | **arrêt du lot 1**, arbitrage à remonter (M4) |
| `/volume1/FlixTunes` effacé par une mise à jour | faible | déplacer le stockage Caddy, sinon quota ACME épuisé |
| ADM refuse les ports du paquet | faible | Caddy hors paquet, en Docker |
| Débit montant insuffisant | **écartée** | 953 Mbit/s mesurés |
| CGNAT | **écartée** | IPv4 fixe confirmée |

## 12. Ce que cette étape ne protège pas

Elle ne protège pas contre une **fuite** par les lectures autorisées : un proche authentifié peut
télécharger ce qu'il peut regarder. C'est inhérent au fait de donner accès, et c'est la raison pour
laquelle la liste blanche et la session comptent plus que la lecture seule (§11.1 de l'audit).

Elle ne couvre pas non plus la diffusion rapide d'un correctif de sécurité : **c'est l'objet de
l'étape 57, désormais placée devant** (voie intermédiaire retenue le 24 août 2026 — vérification de
signature et retour arrière seulement, canaux et tests de chaos reportés en 62).
