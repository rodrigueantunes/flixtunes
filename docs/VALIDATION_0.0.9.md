# Validation FlixTunes 0.0.9

Date de recette : 12 août 2026. Environnement : Windows 11 x64, Node.js 24, pnpm 11.16, .NET SDK 10 ciblant .NET 8, Android SDK 36, Gradle 9.5, AGP 9.3, FFmpeg installé.

## Résultats

| Domaine | Recette | Résultat |
|---|---|---|
| Contrats / serveur / Web | TypeScript typecheck | Réussi |
| Serveur | 32 tests Vitest | 32 réussis |
| Web | 2 scénarios Testing Library | 2 réussis |
| Lecture | génération d’un média puis Direct Play, remux HLS et transcodage HLS réels | Réussi |
| NAS | serveur compilé, Web statique et logo servis sur le même port | Réussi |
| Base | `PRAGMA quick_check`, sauvegarde, demande de restauration, redémarrage et copie de sécurité | Réussi |
| Réseau | publication et résolution `_flixtunes._tcp.local` | Réussi |
| Bibliothèques | création de fichier surveillé puis scan automatique terminé | Réussi |
| Android | 6 tests unitaires, lint, compilation et APK | Réussi, 0 erreur lint |
| Windows | compilation Release et 8 tests MSTest, dont découverte mDNS réelle | 8 réussis |
| Windows exécutable | paquet autonome, DLL VLC natives, démarrage, catalogue non vide et fenêtre réactive | Réussi |
| Navigateur | interface de premier lancement chargée depuis le serveur 0.0.9 réel | Réussi |

## Points dépendant du matériel final

La négociation HDR10+, Dolby Vision, Dolby Atmos, DTS:X et Auro-3D est testée dans la logique et les capacités clientes. La restitution bitstream et l’accélération matérielle ne peuvent être certifiées qu’avec la TV, l’amplificateur et le GPU du NAS ciblés. En cas d’incompatibilité, FlixTunes demande automatiquement tone mapping et transcodage audio.

Le moteur Docker n’est pas installé sur la machine de recette ; le serveur de production a donc été validé directement avec Node/FFmpeg. Le `Dockerfile` et `compose.yaml` sont fournis pour la construction sur le NAS.
