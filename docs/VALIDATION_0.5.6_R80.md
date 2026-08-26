# Validation 0.5.6.r80 — les trois avertissements de sécurité Android

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Le service de lecture était joignable par n'importe quelle application

```
AndroidManifest.xml:32: Warning: Exported service does not require permission [ExportedService]
```

Le `MediaSessionService` **doit** être exporté : c'est ainsi que le système le découvre pour afficher
la notification de lecture, relayer les touches d'un casque Bluetooth ou brancher Android Auto. Mais
exporté sans garde, il était aussi joignable par n'importe quelle application installée sur l'appareil
— laquelle pouvait alors lire, mettre en pause, parcourir la file, et **voir ce qui est regardé**.

La correction que suggère l'avertissement — une permission dans le manifeste — ne convient pas : elle
fermerait la porte aux composants système qui doivent précisément entrer. Le contrôle se fait donc là
où Media3 le prévoit, **à la connexion** :

| Contrôleur | Décision |
| --- | --- |
| Notre application | accepté |
| Notre processus, quel que soit le nom annoncé | accepté — le nom vient du contrôleur, l'identifiant d'utilisateur vient du système |
| Notification de lecture, Android Auto, Automotive | accepté — ce sont eux qui rendent l'export nécessaire |
| Tout le reste | **refusé** |

Cinq cas de test tiennent la règle, dont un qui vérifie que la comparaison de nom est exacte :
`tv.flixtunes.app.faux` n'est pas `tv.flixtunes.app`.

## 2. Le sélecteur de pistes retenait le service entier

```
PlaybackService.kt:73: Warning: Do not place Android context classes in static fields [StaticFieldLeak]
```

Un `DefaultTrackSelector` porte un `Context`. Le garder dans un champ statique **fort** retenait le
service tant que rien ne remettait le champ à zéro. `onDestroy` le faisait — mais `onDestroy` n'est pas
garanti.

La référence est désormais **faible**. Le lecteur, lui, tient le sélecteur tant qu'il existe : la
référence vit donc exactement le temps qu'il faut, et pas une seconde de plus. Ce n'est pas une
suppression d'avertissement, c'est la disparition de la cause.

## 3. Le trafic en clair : un avertissement qu'on ne peut pas lever

```
network_security_config.xml:4: Warning: Insecure Base Configuration [InsecureBaseConfiguration]
```

Et il reste permis, délibérément. Le serveur vit sur le réseau local, joint par son adresse IP — celle
du NAS de chacun. Android ne sait exprimer une exception que **par nom d'hôte** : ni plage d'adresses,
ni « tout ce qui est privé ». Refuser le clair fermerait l'usage principal du produit, et il n'existe
aucune formulation intermédiaire.

Ce qui est réellement protégé l'est ailleurs, dans le code : `ServerUrl` impose `https://` dès que
l'adresse n'est pas locale, si bien que **l'accès depuis Internet ne peut pas retomber en clair**,
quelle que soit cette configuration.

L'avertissement est donc éteint avec sa raison écrite dans le fichier même. Un avertissement qu'on ne
peut pas lever et qu'on laisse crier devient du bruit ; celui qui est éteint avec son motif reste une
décision visible, que le prochain lecteur peut contester en connaissance de cause.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Avertissements lint Android | **47**, contre 50 — les trois de sécurité levés |
| `ExportedService`, `StaticFieldLeak`, `InsecureBaseConfiguration` | **plus aucun** dans le rapport |
| Tests JVM Android | **208**, 0 échec |
| Construction de l'APK | réussie |

Les 47 restants ne relèvent pas de la sécurité : API dépréciées, pluriels de traduction, attribut
inutilisé sous API 23.

## 5. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| Construire depuis un disque local | Le garde-fou refuse le partage ; le dépôt Git rend le clone facile. |
| Jeton d'API et compte de session côté Windows | Ce qui lèverait sa restriction au réseau local. |
| Les 47 avertissements restants | API dépréciées et PiP incomplet — travail de fond, sans urgence. |
| La cadence de r73 sur le NAS, le lecteur sur téléviseur | inchangés depuis r75 |
