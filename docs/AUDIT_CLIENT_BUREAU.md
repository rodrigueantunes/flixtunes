# Audit — un client de bureau Windows et Linux, interface du Web et lecture par VLC

*27 août 2026. Voie retenue après arbitrage. Aucun code n'a été écrit pour ce document ; il décrit,
chiffre, et nomme la seule inconnue. La mise en œuvre attend un accord explicite.*

## 1. Ce qu'on veut, exactement

Un client de bureau pour **Windows et Linux** dont l'interface est celle du Web — donc celle
qu'Android transcrit — **y compris le lecteur**. C'est la contrainte qui commande tout le reste : il
n'est pas question d'un lecteur qui ressemble, mais d'un lecteur qui **est** celui du Web.

Et sous cette interface, **VLC décode**. Le navigateur ne lit ni MKV, ni HEVC, ni TrueHD ; VLC lit
tout. C'est ce qui permet la lecture directe, et donc un NAS qui ne convertit rien.

## 2. Le principe : l'interface par-dessus, la vidéo dessous

Une seule idée, et elle évite d'écrire quoi que ce soit deux fois :

```
┌─ fenêtre du client ─────────────────────────────┐
│  ┌───────────────────────────────────────────┐  │
│  │  interface Web, fond transparent          │  │  ← Player.tsx, tel quel
│  │  commandes, carte d'enchaînement,         │  │
│  │  bouton « passer le générique »           │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │  surface vidéo rendue par VLC             │  │  ← libVLC, décodage matériel
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

Le client Web possède déjà tout le lecteur — `Player.tsx`, 1 243 lignes : commandes, pistes,
sous-titres, carte d'enchaînement avec sa jauge, bouton de générique. En **mode bureau**, cette même
interface ne pilote plus une balise `<video>` mais la coque, qui pilote VLC. Rien n'est réécrit, et
toute évolution future du lecteur Web arrive gratuitement sur le bureau.

Il faut donc un pont, et il est petit : d'un côté « lis ceci », « mets en pause », « va à telle
seconde », « prends cette piste » ; de l'autre « voici où j'en suis », « je mets en mémoire tampon »,
« la lecture est finie ».

## 3. Quelle coque

Trois candidates, jugées sur ce projet-ci et non dans l'absolu.

| | Ce qu'elle apporte | Ce qu'elle coûte |
| --- | --- | --- |
| **Electron** | Le **même moteur** sur les deux systèmes, donc une interface qui se comporte pareil partout. Aucune langue nouvelle : la coque fait quelques centaines de lignes de TypeScript, et le projet en est déjà plein. `electron-builder` produit `.msi`, `.deb` et AppImage d'une seule configuration. | ~150 Mio par paquet, et un Chromium embarqué à tenir à jour |
| **Tauri** | Paquets minuscules, mêmes formats de sortie. | Ajoute **Rust** comme quatrième langue. Et surtout : il emploie le navigateur **du système** — WebView2 sous Windows, WebKitGTK sous Linux — donc deux moteurs qui diffèrent sur les codecs et le rendu. C'est exactement la divergence qu'on cherche à supprimer. |
| **Deux coques natives** | Aucun runtime ajouté. | Deux bases de code à maintenir : ce qu'on essaie précisément d'éviter. |

**Je recommande Electron**, pour une raison qui prime sur la taille : l'objectif est un client
identique, et un seul moteur de rendu est le seul moyen d'en être sûr. Cent cinquante mégaoctets ne
pèsent rien à côté d'un paquet NAS de 173 Mio.

## 4. Comment VLC entre dans la fenêtre

Pas de liaison native à écrire : **VLC s'exécute comme processus fils** et dessine dans une fenêtre
qu'on lui désigne — `--drawable-hwnd` sous Windows, `--drawable-xid` sous X11. On le pilote par son
interface de commande sur un tuyau local : lecture, pause, position, piste, volume.

C'est robuste, sans code natif, sans module compilé, et cela réutilise le moteur déjà embarqué par le
client WPF actuel — même version, mêmes comportements connus.

| | Windows | Linux |
| --- | --- | --- |
| libVLC | **embarqué**, comme aujourd'hui | **dépendance déclarée** du `.deb` (`vlc-plugin-base`) : la distribution le tient à jour, et l'embarquer irait contre les usages |
| Décodage matériel | D3D11VA | VA-API — le même chemin que le NAS, déjà éprouvé ici |
| Paquet | `.msi` | `.deb`, plus une AppImage pour le reste |

## 5. Ce que le client gagne, et ce qu'il perd

**Il gagne tout ce que le client actuel n'a pas** : les écrans d'administration — bibliothèques,
analyses, réglages serveur, diagnostic —, l'accès distant avec ses comptes de session, la liste
personnelle, l'historique, les préférences de profil. Rien de tout cela n'est à écrire : c'est le
client Web.

**Il perd** le statut expérimental et les dix-sept tests du client WPF, qui disparaît.

Et le dépôt perd une interface : il en restera **deux** — le Web, qui sert le navigateur *et* le
bureau, et Compose pour Android.

## 6. La seule inconnue, et comment la lever

Tout le reste est du travail connu. Une seule chose peut mal tourner :

> **Peut-on poser une interface Web à fond transparent au-dessus d'une surface vidéo rendue par un
> autre processus, dans la même fenêtre, sans scintillement ni décalage quand on la déplace ?**

C'est le même genre de question que celle de la sonde d'hier, et elle mérite le même traitement : un
essai jetable avant tout engagement. Trois points à constater, dans l'ordre :

1. la vidéo VLC s'affiche bien **dans** la fenêtre Electron, et non dans une fenêtre à part ;
2. les commandes HTML se dessinent **par-dessus**, cliquables, sans que la vidéo passe devant ;
3. déplacer et redimensionner la fenêtre ne désynchronise pas les deux couches.

Si l'un des trois échoue, la réponse de repli existe et n'est pas ruineuse : deux fenêtres tenues en
lockstep, ou le rendu de VLC dans la page — cette dernière ayant un coût que nous savons désormais
chiffrer.

**Je propose de faire cette sonde avant d'écrire une ligne du client.** Elle demande une soirée.

## 6 bis. La sonde a été faite — l'inconnue est levée

*27 août 2026, Electron 33, VLC 3.0.21 installé sur le poste, épisode 1080p lu depuis le NAS.*

### 6 bis.1 La façon évidente ne marche pas

Premier essai, le plus direct : VLC dessine dans la fenêtre Electron elle-même, et la page HTML se
met à fond transparent par-dessus.

**La vidéo s'affiche bien dans la fenêtre — et elle recouvre entièrement l'interface.** Aucun réglage
de transparence n'y change quoi que ce soit, parce que ce n'est pas une question d'alpha : VLC crée
une fenêtre **fille**, et sous Windows une fenêtre fille se dessine toujours au-dessus de ce que
peint son parent. Chromium peint dans le parent. Il passe donc dessous, définitivement.

### 6 bis.2 Deux couches, et tout tient

Second essai : une fenêtre pour la vidéo, et **une seconde fenêtre transparente possédée par la
première** pour l'interface. Une fenêtre possédée reste au-dessus de son propriétaire *et* se compose
avec lui, alpha compris.

| Ce qu'il fallait constater | Résultat |
| --- | --- |
| La vidéo apparaît dans la fenêtre, pas à côté | **oui** |
| Les commandes HTML se dessinent par-dessus | **oui**, et le dégradé de la barre laisse voir l'image à travers |
| Déplacement et redimensionnement gardent les couches ensemble | **écart 0, 0, 0, 0 pixel** |
| Un vrai clic du système atteint un bouton de l'interface | **oui** — le compteur de la page passe de 0 à 1 |

Le dernier point méritait d'être éprouvé et non supposé : une couche transparente peut très bien se
dessiner par-dessus tout en laissant filer les clics vers la fenêtre du dessous, auquel cas aucun
bouton du lecteur ne répondrait. Le clic a été envoyé par le système, pas simulé dans la page.

### 6 bis.3 Ce que la sonde a appris sur l'architecture

La conséquence est plus élégante que prévu : **l'interface entière — catalogue compris — vit dans la
couche du dessus**, et la fenêtre du dessous ne sert qu'à recevoir la vidéo. Elle reste noire quand
rien ne joue. Il n'y a donc pas un « mode lecteur » à part : c'est le client Web du début à la fin,
avec une surface vidéo qui s'allume derrière lui au moment voulu.

### 6 bis.4 Un défaut de banc, encore

La fenêtre vidéo n'avait aucune page chargée — elle n'a que la vidéo à montrer. Or sans contenu,
Electron n'émet jamais l'événement « prête à montrer », et c'est lui qui déclenchait le lancement de
VLC. J'ai donc vu une vidéo noire sous une interface correcte, et j'ai failli conclure que la couche
transparente était opaque. Ce qui l'a démenti : **aucun processus VLC n'existait**.

### 6 bis.5 Ce qui reste inconnu

**Linux.** Tout ce qui précède est mesuré sous Windows. Sous X11, `--drawable-xid` devrait se
comporter de la même façon ; sous **Wayland**, il n'y a pas d'identifiant de fenêtre à passer, et la
question devra être reposée. Ce sera la première chose à vérifier au moment d'empaqueter le `.deb`, et
non une découverte de fin de parcours.

Et un détail d'honnêteté : le déplacement de la fenêtre a été **programmé**, non glissé à la souris.
Un glissement émet des dizaines d'événements par seconde là où la sonde n'en a produit qu'un. Le
chemin de code éprouvé est le même, mais la fluidité d'un glissement reste à constater.

## 7. Découpage proposé

| N° | Contenu | Preuve de fin |
| --- | --- | --- |
| ~~**1**~~ | ~~Sonde : Electron + VLC en processus fils, interface transparente par-dessus~~ **Faite le 27 août 2026** — voir §6 bis | **les trois points constatés, plus un quatrième : le clic arrive** |
| **2** | Coque minimale : fenêtre, chargement du client Web, mode bureau détecté | le catalogue s'affiche et se parcourt |
| **3** | Le pont : `Player.tsx` en mode bureau pilote VLC au lieu d'une balise `<video>` | une lecture directe et une lecture convertie |
| **4** | Capacités déclarées depuis la machine réelle, décodage matériel | le NAS ne convertit plus ce qu'il ne devrait pas |
| **5** | Empaquetage `.msi`, `.deb`, AppImage ; retrait du client WPF | un installateur par système |

**Une à deux semaines**, contre trois à cinq pour la voie écartée — et sans toucher à Android.

## 8. Ce que j'attends

Un accord sur la coque — Electron — et sur l'ordre : la sonde d'abord.
