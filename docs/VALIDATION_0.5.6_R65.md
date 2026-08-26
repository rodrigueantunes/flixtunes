# Validation 0.5.6.r65 — un profil sans code entre aussi depuis Android

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §4 liste le reste.*

## 1. « Session requise » sur mobile — le même défaut, sur le troisième client

Le mobile affichait « **Session requise · Les contenus déjà chargés restent disponibles** » sur
l'accueil, en 5G, profil sélectionné.

C'est le défaut de r64, sur un autre client. Sur le réseau local aucune lecture ne réclame de session,
si bien qu'un profil **sans code** n'en demandait jamais et que personne ne s'en apercevait. Depuis
l'accès distant, chaque lecture en exige une : le profil se retrouve enfermé dehors.

Le serveur acceptait déjà d'ouvrir une session sans code depuis r64 — c'est le client Android qui ne
la demandait pas.

- `unlockProfile` accepte désormais un code facultatif ;
- `selectProfile` s'assure d'une session avant de charger l'accueil ;
- un profil **protégé** en est écarté : il passe par son écran de code, comme avant.

**Vérifié dans la source :** `store.profileId` est écrit mais jamais relu — Android ne restaure pas de
profil au lancement, tout passe par le sélecteur. Le correctif couvre donc la seule voie existante,
contrairement au Web où une seconde voie existait (§2).

L'ordre compte et il a été vérifié : `repository.selectProfile` **efface** le jeton pour un profil non
protégé ; la demande de session vient après, et non avant.

## 2. Web : la voie oubliée, corrigée en même temps

Sur le Web, la demande avait été posée à la **sélection** seulement. Or un profil **restauré au
démarrage** depuis le stockage local n'est jamais « sélectionné » : il partait lire sans session.

Sans effet sur le réseau local, mais le même écran d'erreur serait revenu à distance à la prochaine
ouverture d'onglet. La demande vit désormais dans `loadHome`, par où **toutes** les voies passent :
sélection, restauration, changement de groupe.

## 3. Pourquoi le correctif de r64 semblait ne rien faire

Un **service worker**. Le paquet embarque un `sw.js` qui préenregistre la coquille de l'application ;
il se met à jour seul — `skipWaiting` et `clientsClaim` sont présents dans le fichier livré — mais le
premier chargement après une mise à jour sert encore la version en cache.

Constaté sans le chercher : à une première visite la page chargeait `index-rv1wknA4.js`, à la suivante
`index-le2Czw9-.js`. Le navigateur exécutait donc un client r62/r63 contre un serveur r64.

**Conséquence de méthode :** après chaque installation, un **second rechargement** avant de conclure à
un défaut. Sans cela on diagnostique un symptôme déjà corrigé — ce qui est arrivé ici, et a coûté un
aller-retour complet.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **69 fichiers, 648 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

Mesuré sur le service en fonctionnement, via le domaine public et un compte d'essai créé puis
supprimé : déverrouillage sans code → **200**, `/api/home` avec jeton → **200**, et **200** également
sans en-tête, le cookie suffisant. Le compte d'essai n'existe plus ; seul celui de l'utilisateur reste.

### 4.1 Un défaut apparu trois fois

Le même oubli s'est manifesté sur trois chemins en quelques heures : profil sélectionné sur le Web
(r64), profil restauré sur le Web (r65), profil sélectionné sur Android (r65). La cause est
structurelle — le réseau local ne réclamant aucune session, rien ne signale l'oubli tant qu'on ne sort
pas de la maison.

Quatre tests de cohérence lisent désormais les deux clients et vérifient que chacun demande une
session, que le code y est facultatif, et qu'aucun n'en ouvre une pour un profil protégé. Un
quatrième client — Windows, ou un autre à venir — sera signalé par ces mêmes tests.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| Mobile en 5G, après installation | le correctif n'a pas été observé sur l'appareil |
| **Décalage audio après un saut** (r64) | toujours pas observé corrigé sur une tablette |
| Décalage des sous-titres (r63) | même réserve |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |
