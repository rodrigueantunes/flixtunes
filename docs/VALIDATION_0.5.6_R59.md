# Validation 0.5.6.r59 — accès distant sécurisé (socle serveur)

*24 août 2026. Cette note ne rapporte que des résultats **réellement exécutés**. Ce qui n'a pas pu
l'être figure au §5, avec sa raison.*

Périmètre couvert : lots 2, 3, 4 et 6 du plan `PLAN_ACCES_DISTANT.md`, plus la partie empaquetage du
lot 5 qui ne dépend pas du binaire Caddy. Les lots 1 (hors-root) et 5 (binaire Caddy) ne sont pas
engagés — voir §5.

## 1. Ce qui a été construit

| Élément | Fichier |
| --- | --- |
| Liste blanche d'exposition | `apps/server/src/wan-exposition.ts` |
| Sessions persistées, cookie, ralentissement du PIN | `apps/server/src/sessions-profil.ts` |
| Journal des accès distants | `apps/server/src/wan-journal.ts` |
| Seconde instance et garde | `apps/server/src/app.ts` |
| Seconde écoute | `apps/server/src/index.ts` |
| Migrations `pin_digits`, `profile_sessions`, `profile_unlock_failures` | `apps/server/src/database.ts` |
| Déverrouillage durci, profil imposé, ancien PIN exigé | `apps/server/src/routes.ts` |
| Cycle de vie Caddy, deux processus | `packaging/asustor/CONTROL/start-stop.sh` |
| Réglages WAN sans écrasement | `packaging/asustor/CONTROL/post-install.sh` |
| Ports déclarés | `packaging/asustor/CONTROL/config.json` |
| Jeton porté par le lecteur | `apps/android/.../playback/JetonSession.kt` |
| TLS imposé hors réseau local | `apps/android/.../data/ServerUrl.kt` |

## 2. Résultats mesurés

### Serveur

| Mesure | Résultat |
| --- | --- |
| Suite serveur complète | **63 fichiers, 604 tests, 0 échec**, 146 s |
| Typecheck TypeScript | aucune erreur |
| Tests nouveaux | 18 (6 exposition + 12 accès distant) |

### Android

| Mesure | Résultat |
| --- | --- |
| `typecheck.ps1` | 42 fichiers Kotlin, aucune erreur ; aapt2 aucune erreur |
| Gradle `testDebugUnitTest` | passé |
| Gradle `lintDebug`, `lintVitalRelease` | passés |
| Construction | `BUILD SUCCESSFUL`, 1 min 13 s |

## 3. Métriques d'acceptation du plan

| # | Métrique | Seuil | Résultat |
| --- | --- | --- | --- |
| M1 | routes hors liste blanche répondant autre chose que 404 | 0 | **0** — 88 routes énumérées, chacune ouverte ou refusée explicitement |
| M2 | réponses 2xx sans session sur le WAN | 0 | **0** — vérifié sur catalogue, accueil, recherche, flux vidéo et jaquettes |
| M3 | essais de PIN avant blocage | ≤ 5, puis < 60/h/IP | **5 essais**, blocage au 6ᵉ ; 32 min d'attente au 10ᵉ échec, 1 h à partir du 11ᵉ |
| M4 | débit VA-API après hors-root | ≥ 90 % de 471 im/s | **non exécuté** (§5) |
| M5 | première image WAN comparée au LAN | à publier | **non exécuté** (§5) |
| M6 | non-régression LAN | inchangé | **tenu** — 604 tests verts, et un test dédié vérifie que les routes refusées à distance restent servies en local |
| M7 | conversions simultanées depuis le WAN | 6 | **non exécuté** (§5) |

## 4. Points de conception éprouvés

**Le filtrage porte sur le motif de route, pas sur l'URL.** Fastify résout la route avant les
crochets : `request.routeOptions.url` rend `/api/media/:id/stream`. Aucune expression régulière ne
s'applique à une chaîne que le client contrôle, et **toute route ajoutée ultérieurement est refusée
d'office**.

**Le test d'inventaire a démontré son utilité pendant sa propre écriture** : il a signalé deux routes
que l'inventaire manuel avait manquées — `POST /api/devices/announce` et
`PUT /api/system/conversion-preferences`, déclarées sur plusieurs lignes et invisibles au filtrage
textuel.

**Aucune dépendance n'a été ajoutée.** La lecture et l'écriture du cookie sont écrites à la main : un
`pnpm install` sur le partage SMB est documenté comme destructeur pour `node_modules`. Le format d'un
cookie unique ne justifiait pas ce risque.

**Le client Web n'a pas été modifié, délibérément.** `apiRoot` vaut `/api` en production — même
origine — donc le cookie posé au déverrouillage part déjà avec `fetch`, dont le mode par défaut est
`same-origin`. Ajouter `credentials: "include"` aurait **cassé le mode développement**, où l'API est
servie sur un autre port sans en-tête `Allow-Credentials`.

**Android n'exprime pas de plages d'adresses dans `network_security_config`.** Restreindre le trafic
en clair « aux plages privées » n'y est pas formulable. Le contrôle a donc été placé dans
`ServerUrl.normalize`, où il est exact : une adresse locale garde `http` — comportement historique
inchangé —, une adresse publique passe en `https` et un `http://` explicite y est refusé.

### Trois défauts trouvés par vérification, pas par hasard

Ils méritent d'être notés parce qu'aucun n'aurait été trouvé par les tests unitaires.

**`/api/health` rendait encore la version à distance.** Le commentaire de la liste blanche annonçait
une réponse réduite ; le code ne la réduisait pas. Découvert en interrogeant les deux écoutes en vrai
HTTP, et non par `inject()`. Corrigé, avec un test qui vérifie les deux versants : réduit à distance,
complet en local — l'écran de diagnostic en dépend.

**Le bloc `match` de la compression Caddy ne pouvait jamais s'appliquer.** Caddy combine les critères
d'un même bloc en **ET** : quatre lignes `header Content-Type` réclamaient quatre types simultanés.
Remplacé par une exclusion de chemins, forme documentée et sans ambiguïté.

**Le document Caddy était sujet à substitution de commande.** Le heredoc qui l'engendre est
volontairement non quoté — il doit développer le domaine et les ports —, si bien que les accents
graves d'un commentaire ont été exécutés par le shell. Visible dans le rendu (« dans un bloc , Caddy »)
et dans deux `command not found`. Sans conséquence ici, mais un futur commentaire contenant une vraie
commande se serait exécuté au démarrage du service. Accents graves retirés, et une assertion de
construction refuse désormais tout accent grave ou `$(` dans le corps du document.

## 5. Reste à exécuter

| Sujet | Raison |
| --- | --- |
| **Lot 1 — hors-root** | non engagé : migration de propriété sur un NAS en production, dont l'échec ferait perdre VA-API (471 → 151 im/s). Décision demandée avant exécution. |
| **M4** | dépend du lot 1 |
| **Binaire Caddy** | absent du dépôt, doit être téléchargé. Accord non obtenu à la date de cette note. Le code gère l'absence : `start_caddy` journalise et n'échoue pas. |
| **M5, M7** | demandent le paquet installé et le service redémarré |
| **Chaîne complète avec certificat réel** | demande l'enregistrement DNS, la redirection sur la box et le binaire Caddy |
| **Cycle de vie Caddy sur le NAS** | mort de Caddy en pleine lecture, renouvellement forcé, mise à jour de paquet avec session ouverte |
| **`FLIXTUNES_TRANSCODE_CONCURRENCY=6`** | écrit dans `flixtunes.env` le 24 août, **inactif** faute de redémarrage du service |
| **APK release signé** | `build-apk.ps1` produit un debug signé par la clé locale et un release **non signé**. La signature de diffusion n'est pas automatisée dans ce script. |
| **`caddy validate`** | le document engendré n'a pas été soumis au binaire Caddy, absent. Son rendu a été vérifié à blanc, sa syntaxe non. |
| **Installation du paquet et redémarrage** | non exécutés : aucun accès authentifié au NAS depuis ce poste (SSH ouvert, identifiants non détenus). |

## 6. Absence de migration destructive

Trois ajouts de schéma, tous additifs : colonne `pin_digits` sur `profiles` (`NULL` pour l'existant),
tables `profile_sessions` et `profile_unlock_failures`. Aucune colonne supprimée, aucune donnée
réécrite. Médias, profils, progressions, états vus, personnes, crédits et réglages r58 sont
conservés.

**Conséquence à connaître :** `pin_digits` étant `NULL` pour tous les profils existants, **aucun
profil n'est joignable à distance tant que son code n'a pas été reposé**. C'est délibéré — exposer un
profil depuis Internet doit être un geste, pas un héritage.

## 7. Lecture

Le chemin de lecture n'est pas modifié. Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise
et seeks restent ceux de r58. Le seul changement côté lecteur Android est l'ajout d'un en-tête sur la
pile HTTP, sans effet lorsqu'aucune session n'est ouverte.
