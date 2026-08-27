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

## 7. Découpage proposé

| N° | Contenu | Preuve de fin |
| --- | --- | --- |
| **1** | Sonde : Electron + VLC en processus fils, interface transparente par-dessus | les trois points du §6 constatés |
| **2** | Coque minimale : fenêtre, chargement du client Web, mode bureau détecté | le catalogue s'affiche et se parcourt |
| **3** | Le pont : `Player.tsx` en mode bureau pilote VLC au lieu d'une balise `<video>` | une lecture directe et une lecture convertie |
| **4** | Capacités déclarées depuis la machine réelle, décodage matériel | le NAS ne convertit plus ce qu'il ne devrait pas |
| **5** | Empaquetage `.msi`, `.deb`, AppImage ; retrait du client WPF | un installateur par système |

**Une à deux semaines**, contre trois à cinq pour la voie écartée — et sans toucher à Android.

## 8. Ce que j'attends

Un accord sur la coque — Electron — et sur l'ordre : la sonde d'abord.
