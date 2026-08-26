# Sécurité FlixTunes

FlixTunes fonctionne sans compte cloud et ne transmet ni historique ni recommandations à aucun
fournisseur. Il expose deux surfaces distinctes, et il est important de ne pas les confondre.

## 1. Deux écoutes, deux régimes

| | Réseau local | Accès distant |
| --- | --- | --- |
| Écoute | `0.0.0.0:4000`, en clair | `127.0.0.1:4001`, en clair **derrière un proxy TLS** |
| Joignable depuis | le LAN | Internet, via Caddy uniquement |
| Surface | complète | liste blanche de lecture |
| Session | facultative | **obligatoire sur chaque requête** |
| Activation | toujours | seulement si `FLIXTUNES_WAN_DOMAIN` est posé |

Le régime local est **inchangé** : c'est un réseau de confiance, et le confort d'usage y prime.
L'accès distant est un ajout strictement séparé — une seconde instance du serveur, avec ses propres
contrôles. Un réglage posé sur l'une n'affecte pas l'autre.

## 2. Mesures du régime local

- CORS limité aux origines locales, privées et `.local` ;
- écritures protégeables par `FLIXTUNES_API_TOKEN`, comparé en temps constant ;
- limitation de débit, taille de requête plafonnée et délais serveur ;
- chemins d'images, sous-titres, sauvegardes et transcodages validés avant accès ;
- secrets de fournisseurs chiffrés au repos en AES-256-GCM, clé hors base en `0600` ;
- secrets masqués dans les journaux ;
- SQLite avec clés étrangères, WAL, contrôle d'intégrité et sauvegardes rotatives ;
- appels externes avec délai, cache et coupe-circuit ;
- aucun scraping IMDb ou Allociné : connecteurs activés uniquement avec API officielle/licenciée.

**À savoir :** le CORS n'est pas une barrière. C'est une règle que le navigateur s'applique à
lui-même ; `curl`, un script ou un lecteur vidéo l'ignorent. Sur un LAN de confiance c'est sans
conséquence — c'est précisément pourquoi le port 4000 ne doit jamais être publié sur Internet.

## 3. Mesures du régime distant

### Surface

Liste blanche de motifs de routes, tenue dans `apps/server/src/wan-exposition.ts`. Tout ce qui n'y
figure pas répond **404** — et non 403 : de l'extérieur, une administration interdite doit être
indiscernable d'une administration inexistante.

Ne sont **jamais** joignables à distance : bibliothèques et configuration initiale, parcours du
système de fichiers, sauvegardes et restauration, analyses et corrections, fournisseurs de
métadonnées, diagnostic et capacité, télécommande, création et modification de profils.

Un test refuse toute route enregistrée qui n'aurait pas été explicitement ouverte ou refusée : une
route ajoutée par une évolution ultérieure est fermée d'office, et le test la signale.

### Session

- session obligatoire sur **toutes** les routes, y compris le flux vidéo, les jaquettes et les
  sous-titres ;
- jeton porté par en-tête `X-FlixTunes-Profile-Token` **ou** par cookie
  `HttpOnly; Secure; SameSite=Strict` — le cookie est indispensable, `<video>`, `<img>` et `<track>`
  ne pouvant porter aucun en-tête ;
- sessions enregistrées en base : elles survivent à un redémarrage et sont révocables. **Seule
  l'empreinte du jeton est stockée**, jamais le jeton : une sauvegarde qui sortirait de la maison ne
  donne accès à rien ;
- le profil est **imposé par la session** : un jeton ne donne aucun accès aux données d'un autre
  profil, quel que soit le paramètre de requête.

### Code PIN

- un profil n'est joignable à distance qu'avec un PIN d'**au moins six chiffres** ; les autres sont
  invisibles dans la liste, pour ne pas indiquer quels comptes existent ;
- cinq essais libres par source, puis une attente qui double — une heure à partir du onzième échec.
  Moins de vingt-cinq essais par jour depuis une même adresse ;
- le compteur est persisté : un redémarrage ne le remet pas à zéro ;
- changer un PIN exige de connaître l'ancien, et révoque toutes les sessions du profil.

### Ressources et traçabilité

- l'exemption de limitation dont bénéficient les routes média sur le LAN **ne s'applique pas** à
  distance ;
- quota d'ouvertures de session de conversion par profil : chaque appel démarre un FFmpeg ;
- journal des accès distants — date, source, profil visé, verdict, route — dans
  `<données>/logs/wan-acces.log`. Il n'enregistre ni jeton, ni PIN, ni titre regardé.

## 4. Moindre privilège

Le service ne tourne plus sous `root`. Un compte `flixtunes` est créé à l'installation, ajouté aux
groupes `video`, `render` et `input`, et reçoit la propriété du partage persistant ; les médias lui
sont accordés **en lecture seule** par les ACL d'ADM.

Ce point n'est pas un durcissement parmi d'autres : c'est ce qui rend la lecture seule vérifiable par
le système d'exploitation. Auparavant, seule la bonne conduite du code empêchait le serveur d'effacer
la médiathèque. Sur un service joignable depuis Internet, la différence est celle entre une faille
contenue et une faille totale.

**La bascule ne peut pas coûter l'accélération matérielle en silence.** Une sonde vérifie, en se
plaçant sous le compte cible, que `/dev/dri/renderD128` reste lisible et que le partage reste
inscriptible. Un seul échec, et le service démarre sous `root` avec la raison inscrite dans
`<partage>/logs/privileges.log`. Si le démarrage non privilégié échoue malgré la sonde, le service
repart sous `root`. Le pire cas est le comportement antérieur, jamais une dégradation muette.

`FLIXTUNES_RUN_AS=root` rétablit explicitement l'ancien comportement, sans réinstaller.

## 5. Déploiement

### Réseau local seul (défaut)

Définir un jeton d'écriture si le LAN est partagé, limiter le port 4000 au LAN dans le pare-feu du
NAS, monter les médias en lecture seule. **Ne jamais publier le port 4000 sur Internet** : il donne
accès à la médiathèque, à la base et à l'arborescence du NAS sans authentification.

### Accès distant

L'accès distant se termine **toujours** par TLS, assuré par Caddy embarqué dans le paquet.

1. créer un enregistrement DNS pointant vers l'adresse publique du site ;
2. rediriger sur la box : **80 → NAS:8080** et **443 → NAS:8444**. Les ports publics doivent rester
   80 et 443, la validation Let's Encrypt s'y adressant ;
3. poser `FLIXTUNES_WAN_DOMAIN` dans la configuration, puis redémarrer le paquet ;
4. donner à chaque personne un profil avec **son propre** PIN d'au moins six chiffres.

Sans domaine posé, rien n'est activé : ni seconde écoute, ni port lié, ni certificat demandé. Une
mise à jour ne peut donc pas ouvrir l'accès distant par effet de bord.

**Un certificat auto-signé n'est pas une option prise en charge.** Il impose à chaque personne de
passer outre un avertissement de sécurité, c'est-à-dire d'apprendre exactement le geste qu'une
attaque par hameçonnage exploite — et sur un certificat que personne ne vérifie, une interception
devient indétectable.

### Derrière un proxy

`FLIXTUNES_WAN_PROXIES` liste les adresses dont l'en-tête `X-Forwarded-For` est cru, et vaut la
boucle locale par défaut. **Ne jamais y mettre une valeur qui reviendrait à tout accepter** : le
visiteur choisirait alors l'adresse sous laquelle il est compté, ce qui viderait de leur sens la
limitation de débit, le ralentissement du PIN et le journal.

## 6. Ce que l'accès distant ne protège pas

Il ne protège pas contre une fuite par les lectures autorisées : une personne authentifiée peut
télécharger ce qu'elle peut regarder. C'est inhérent au fait de donner accès.

Il ne couvre pas non plus la diffusion rapide d'un correctif de sécurité, qui relève des mises à jour
signées.

## 7. Signaler un problème

Les rapports de sécurité relatifs à ce dépôt sont traités en priorité sur toute autre demande.
