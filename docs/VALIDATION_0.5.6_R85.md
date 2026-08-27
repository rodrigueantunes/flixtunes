# Validation 0.5.6.r85 — la coque du client de bureau tourne, avec le client Web dedans

*27 août 2026. Étape 2 du chantier « client de bureau ». Cette note ne rapporte que des résultats
**réellement exécutés**, captures d'écran à l'appui.*

## 1. Ce que la coque est, et ce qu'elle n'est pas

Elle ne dessine **qu'un seul écran** : celui qui demande l'adresse du serveur, parce qu'il faut bien
une adresse avant de pouvoir charger quoi que ce soit. Tout le reste vient du client Web servi par le
NAS — le même que dans un navigateur. C'est ce qui garantit qu'il n'y aura pas deux interfaces à tenir
à jour, et que le lecteur du bureau **sera** celui du Web.

Deux fenêtres, et la sonde de r84 explique pourquoi : une fenêtre du dessous, noire, qui ne sert qu'à
recevoir la vidéo de VLC, et une fenêtre du dessus, transparente et possédée par la première, qui
porte tout le client Web. Il n'y a pas de « mode lecteur » séparé.

## 2. Ce qui a été constaté à l'écran

| Étape | Résultat |
| --- | --- |
| La coque s'ouvre | fenêtre « FlixTunes », écran de connexion |
| L'adresse saisie au clavier, validée par Entrée | acceptée, normalisée, retenue |
| Le client Web se charge | **« Choisissez votre groupe » avec les trois familles réelles** |
| L'interface répond | oui — clics et navigation |

Le chemin a été éprouvé comme une personne l'aurait fait : un clic dans le champ, une saisie au
clavier, la touche Entrée. Écrire directement le fichier de réglages aurait vérifié bien moins de
choses — notamment pas le pont entre la page et la coque.

## 3. Le pont, et pourquoi il est minuscule

Trois fonctions, autour de la seule chose que la coque retienne : l'adresse du serveur. Le profil et
le jeton distant restent dans le client Web, qui sait déjà les garder ; moins la coque en sait, moins
elle a de raisons de diverger.

C'est aussi **par la présence de ce pont** que le client Web saura qu'il tourne dans la coque et
pourra confier la lecture à VLC. Aucune détection d'agent utilisateur, aucune variable de
compilation : la capacité s'annonce, elle ne se devine pas.

## 4. La règle qui compte dans la normalisation d'adresse

Sans schéma explicite, une adresse **locale** passe en `http` avec le port 4000 ; une adresse
**publique** passe en `https`. Un accès depuis Internet ne peut donc pas retomber en clair parce que
quelqu'un a tapé un nom sans préfixe — c'est la même règle que le client Android.

Sept cas la vérifient, dont le refus d'une saisie inutilisable plutôt qu'une devinette, et un fichier
de réglages abîmé qui n'empêche pas l'application de s'ouvrir.

## 5. L'enseigne sur l'écran de connexion

Le seul écran que la coque dessine porte le logo et la coupure du nom en deux couleurs — « Flix » en
blanc, « Tunes » en bleu `#79a8ff`. Les valeurs viennent de `.brand` dans la feuille de style du Web ;
l'enseigne est simplement agrandie, puisqu'elle y est seule.

Le logo est **embarqué dans la coque** et non chargé du serveur : à cet instant précis, on ne connaît
pas encore de serveur.

## 6. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Tests de la coque | **7**, 0 échec (normalisation d'adresse et persistance) |
| Compilation TypeScript | aucune erreur |
| Client Web chargé depuis le NAS | **constaté**, capture à l'appui |

Deux défauts rencontrés et corrigés en chemin : une boucle sur des noms d'événements de fenêtre que le
compilateur refusait — Electron type ses signatures une par une —, et un verrou de dépendances qui
ignorait le nouveau paquet, si bien qu'une installation gelée refusait de partir. Plus une
autorisation manquante : pnpm bloque les scripts d'installation, et Electron télécharge son exécutable
depuis le sien — l'installation « réussissait » sans binaire.

## 7. Suite

| Étape | Contenu |
| --- | --- |
| ~~1~~ | ~~sonde de superposition~~ — faite (r84) |
| ~~2~~ | ~~coque minimale~~ — **faite** |
| **3** | le pont de lecture : `Player.tsx` en mode bureau pilote VLC au lieu d'une balise `<video>` |
| 4 | capacités déclarées depuis la machine réelle, décodage matériel |
| 5 | empaquetage `.msi`, `.deb`, AppImage ; retrait du client WPF |
