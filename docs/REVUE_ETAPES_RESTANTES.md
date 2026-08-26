# Revue des étapes restantes — 57 à 62

*24 août 2026. État : étape 56 livrée (0.5.6.r49). Document de proposition — le plan n'a pas été
modifié.*

## 1. Méthode

Lecture des six dossiers restants de `docs/BEYOND_PLEX_PLAN.md`, confrontés à trois choses : ce qui
existe déjà dans le dépôt, l'usage réellement visé — « la famille, sans rien installer », établi au
§9 de `docs/AUDIT_ACCES_INTERNET.md` — et le coût de réalisation. Chaque étape est jugée sur
l'intérêt qu'elle a *pour ce projet-là*, pas dans l'absolu.

## 2. Évaluation, étape par étape

| Étape | Intérêt pour l'usage réel | Coût | Ce qui existe déjà |
| --- | --- | --- | --- |
| **57** Windows home cinéma | **faible à moyen** | **élevé** | client WPF + libVLC complet, qui lit déjà |
| **58a** contrôle, cast, transfert de session | **élevé** | moyen | `appareils.ts` : registre et file d'ordres |
| **58b** multiroom synchronisé | **faible** | élevé | rien |
| **58c** Live TV / DVR | **à justifier** | **très élevé** | rien |
| **59** analyse locale (intros, chapitres) | **élevé** | moyen à élevé | planches de vignettes de timeline |
| **60** résilience et mises à jour signées | **élevé, devenu prérequis** | moyen | rien |
| **61** sécurité, permissions, administration | **élevé** | moyen | PIN, jetons de profil, chiffrement des secrets |
| **62** preuve comparative finale | **élevé** (clôture) | moyen | corpus et bancs de mesure |

### 2.1 Étape 57 — le rapport coût/intérêt est le plus défavorable du plan

`apps/windows` contient déjà un client WPF complet : catalogue, fiche, lecteur, découverte du
serveur, et des tests. **Il lit déjà des médias, via libVLC.** L'étape 57 n'est donc pas une création
mais une **refonte du moteur de lecture** — libmpv/libplacebo, D3D11VA/Vulkan, HDR Windows, cadence
écran, bitstream HDMI vers un ampli, matrice GPU Intel/NVIDIA/AMD.

C'est un travail lourd, avec la matrice de tests matériels la plus large de tout le plan, pour le
client le moins utilisé de l'usage visé — où l'on regarde sur un téléviseur Android TV, un téléphone
ou un navigateur. Et sur un PC, le client Web fonctionne déjà : le gain réel se limite au bitstream
audio et au plein écran exclusif HDR.

### 2.2 Étape 58 — elle contient trois produits différents

C'est le vrai défaut de structure du plan restant. L'étape 58 réunit :

- **(a) contrôle à distance, cast et transfert de session.** Fort intérêt, et **déjà amorcé** :
  `appareils.ts` porte le registre d'appareils et la file d'ordres, avec un commentaire qui annonce
  explicitement que l'étape 58 reprendra ce socle pour le transfert de session ;
- **(b) multiroom synchronisé.** Horloge de synchronisation entre pièces, dérive mesurée. Coût
  élevé, intérêt faible pour un foyer ;
- **(c) Live TV et DVR.** Tuners, M3U/XMLTV, guide, timeshift, planificateur d'enregistrement,
  conflits de tuners, disque plein. **C'est un autre produit**, sans rapport avec la médiathèque de
  fichiers. C'est aussi, à lui seul, le plus gros morceau de tout ce qui reste — et le plan le
  qualifie déjà d'« optionnel ».

Les garder ensemble a une conséquence mécanique : **l'étape 58 ne peut pas être validée tant que le
DVR ne fonctionne pas.** Le contrôle et le cast, prêts et utiles, resteraient bloqués derrière un
module de télévision qui n'intéresse peut-être personne ici.

### 2.3 Étape 60 — elle a changé de statut cette semaine

La décision d'embarquer Caddy dans le paquet (§16 de l'audit) fait de FlixTunes le **responsable d'un
terminateur TLS exposé à Internet**. Une faille dans Caddy devient une révision du paquet à diffuser
vite.

Or « diffuser vite un correctif vérifiable » est exactement l'objet de l'étape 60. Elle cesse d'être
une étape de confort pour devenir **un prérequis de l'exposition**. Exposer sur Internet un service
qui se met à jour sans vérification de signature, en espérant pouvoir corriger vite, est l'ordre
inverse du bon.

### 2.4 Étape 61 — l'audit lui a pris la moitié de son contenu

Le lot B de `AUDIT_ACCES_INTERNET.md` couvre déjà : sessions bornées, TLS, limitation de débit,
journal d'accès, tests d'autorisation négatifs. Ce qui reste réellement à l'étape 61 :

- rôles et ACL **par bibliothèque** ;
- profils enfants filtrés **côté serveur** et non seulement dans l'interface ;
- inventaire SBOM et audit de dépendances ;
- rotation des secrets ;
- tableau de bord d'exploitation.

C'est encore une étape pleine, mais ce n'est plus la même. Laisser les deux périmètres se recouvrir
ferait refaire deux fois le même travail, ou pire, laisserait chacun supposer que l'autre l'a fait.

## 3. La règle du plan, et pourquoi cette proposition ne la viole pas

`BEYOND_PLEX_PLAN.md` est explicite, et la règle vient d'écarts constatés :

> Les plages numériques ne sont que des repères de lecture : elles ne constituent ni des lots, ni des
> validations groupées. Chaque étape 43 à 62 possède sa propre livraison, sa propre recette et sa
> propre décision de passage.

Et plus loin : « Aucune validation d'une étape ne peut être héritée, mutualisée ou reportée sur une
autre. »

**Cette règle interdit de fusionner des validations. Elle n'interdit pas de redécouper des
périmètres.** Ce qui suit ne groupe rien : au contraire, l'essentiel du travail consiste à
**séparer** ce qui avait été mis ensemble à tort (étape 58) et à **sortir du plan** ce qui n'a pas
sa place dans une progression versionnée. Chaque étape proposée garde sa livraison, sa recette et sa
décision de passage.

Un point demande en revanche un amendement explicite : **l'ordre change.** Le plan dit les étapes
strictement séquentielles ; réordonner est une décision à inscrire, pas un ajustement silencieux.

## 4. Découpage proposé

Six étapes, même horizon `0.6.2`, aucune étape supplémentaire.

| N° | Version | Contenu | Origine |
| --- | --- | --- | --- |
| **57** | 0.5.7 | **Résilience et mises à jour signées** | ex-60, remontée — prérequis d'exposition (§2.3) |
| **58** | 0.5.8 | **Accès distant sécurisé** — lot B de l'audit | nouveau, absorbe la moitié de l'ex-61 |
| **59** | 0.5.9 | **Contrôle, cast et transfert de session** | ex-58a seule, sans multiroom ni Live TV |
| **60** | 0.6.0 | **Analyse intelligente locale** | ex-59, inchangée |
| **61** | 0.6.1 | **Permissions, profils et administration** | ex-61 réduite au périmètre du §2.4 |
| **62** | 0.6.2 | **Preuve comparative finale** | inchangée |

### 4.1 Ce qui sort du plan numéroté

Ni abandonné, ni gelé : **traité à la demande, sans conditionner une version.**

| Sujet | Pourquoi il sort |
| --- | --- |
| **Client Windows home cinéma** (ex-57) | le client WPF existant couvre le besoin ; la refonte libmpv est le pire rapport coût/usage du plan |
| **Live TV / DVR** (ex-58c) | autre produit, plus gros morceau restant, déjà marqué optionnel |
| **Multiroom synchronisé** (ex-58b) | coût élevé, intérêt faible pour un foyer |

Chacun peut revenir comme étape à part entière le jour où un besoin réel le justifie. Ce qu'on
refuse, c'est qu'ils bloquent la livraison de fonctions prêtes.

### 4.2 Pourquoi cet ordre

- **57 avant 58** : on ne publie pas sur Internet un service qu'on ne sait pas corriger vite et de
  façon vérifiable (§2.3). C'est la seule vraie dépendance de tout le plan restant.
- **58 avant 61** : conforme à votre consigne, et logique — l'accès distant définit les sessions et
  le journal sur lesquels 61 posera ensuite les rôles et les ACL.
- **59 et 60** sont indépendants du reste et peuvent glisser sans casser quoi que ce soit.
- **62 reste dernier** : c'est la mesure de clôture, elle n'a de sens qu'après tout le reste.

## 5. Le point à trancher avant tout

**Faut-il vraiment faire 57 (mises à jour signées) avant l'accès distant ?**

C'est la question qui coûte le plus cher dans un sens comme dans l'autre.

- **Oui** : l'ordre est sain, on n'expose rien qu'on ne sache réparer. Mais l'accès distant, qui est
  la fonction attendue, est repoussé d'une étape entière.
- **Non** : l'accès distant arrive plus tôt, avec une procédure de mise à jour manuelle documentée
  comme filet. Acceptable pour un service que six personnes utilisent et que vous administrez
  vous-même — nettement moins si le cercle s'élargit.

Une voie intermédiaire existe : ne prendre de l'étape 57 que **la vérification de signature et le
retour arrière**, en laissant les canaux stable/bêta et les tests de chaos à leur place ultérieure.
Cela lèverait le risque principal sans payer l'étape entière.

**→ Voie intermédiaire retenue le 24 août 2026.** Conséquences au §6.

## 6. Séquence retenue

| N° | Version | Contenu |
| --- | --- | --- |
| **57** | 0.5.7 | **Signature et retour arrière** — le minimum extrait de l'ex-60 : manifeste signé, vérification avant activation, retour à la version précédente si la santé n'est pas obtenue |
| **58** | 0.5.8 | **Accès distant sécurisé** — `PLAN_ACCES_DISTANT.md` |
| **59** | 0.5.9 | **Contrôle, cast et transfert de session** — ex-58a seule |
| **60** | 0.6.0 | **Analyse intelligente locale** — ex-59 inchangée |
| **61** | 0.6.1 | **Permissions, profils et administration** — ex-61 réduite (§2.4) |
| **62** | 0.6.2 | **Résilience complète** — le reste de l'ex-60 : artefacts reproductibles, canaux stable/bêta, tests de chaos, centre de restauration sans terminal |
| **63** | 0.6.3 | **Preuve comparative finale** — ex-62 inchangée |

### 6.1 Une étape de plus, deux produits de moins

La séquence compte désormais **sept étapes au lieu de six**, et se termine en `0.6.3` plutôt qu'en
`0.6.2`. C'est la conséquence assumée du découpage : scinder l'ex-60 en un minimum vital (57) et un
solde (62) crée une étape.

Le volume total de travail baisse malgré tout, puisque **trois sujets quittent le plan numéroté**
(§4.1) : refonte du client Windows en home cinéma, Live TV/DVR, multiroom synchronisé. On échange une
étape de découpage contre deux produits entiers.

L'alternative — replier le solde de résilience dans la preuve comparative finale — a été écartée :
ce serait exactement la validation groupée que la règle du §3 interdit, et que le §2.2 reproche déjà
à l'ex-58.

### 6.2 Pourquoi 57 avant 58

FlixTunes embarque désormais un terminateur TLS exposé à Internet (§2.3). Savoir diffuser un
correctif vérifiable et revenir en arrière est le préalable à l'exposition, pas son complément. La
voie intermédiaire limite ce préalable au strict nécessaire : on paie la vérification de signature et
le retour arrière, pas les canaux ni les tests de chaos.

## 7. Reste ouvert

Les points 1 et 2 du §4 sont retenus, le point 3 est tranché ci-dessus. **Aucun développement n'est
engagé** : la mise en œuvre démarrera sur instruction explicite.
