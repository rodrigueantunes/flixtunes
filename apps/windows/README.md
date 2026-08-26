# Client Windows FlixTunes 0.5.6 — **expérimental**

Client WPF natif avec moteur VideoLAN libVLC embarqué. Il fonctionne sous Windows 10/11 x64 sans
installation séparée de VLC.

## Statut : expérimental, et ce que cela veut dire

Le statut est déclaré, pas subi. Les trois autres clients — Web, Android TV, Android mobile — suivent
les révisions du serveur au jour le jour et sont éprouvés à chacune ; celui-ci ne l'est pas au même
degré, et le dire vaut mieux que de laisser croire le contraire.

**Ce qui est vrai aujourd'hui :**

| | |
| --- | --- |
| Tests | **17**, sur les modèles, la découverte, l'adresse du serveur et les capacités déclarées |
| Négociation de lecture | éprouvée par ses tests, **pas** sur un parc d'écrans et d'amplificateurs |
| Accès distant | **non pris en charge** : le client n'envoie ni jeton d'API ni compte de session, donc il ne fonctionne que sur le réseau local |
| Interface | pas d'écran d'administration : bibliothèques, analyses et réglages serveur passent par le Web |

**Ce que cela n'est pas.** Ce n'est pas un client abandonné : la lecture directe, le remultiplexage,
la conversion, les pistes audio et sous-titres, la reprise et l'historique fonctionnent. C'est un
client dont on n'a pas la même certitude, et qui reçoit les correctifs de fond — la déclaration de
capacités en est un — sans passer par la même qualification.

## Capacités

- connexion au NAS local et mémorisation locale du serveur/profil ;
- accueil, recherche serveur, fiches films et séries, saisons/épisodes, reprise et historique ;
- Direct Play, remux et transcodage HLS négociés avec le serveur ;
- décodage matériel libVLC, lecture MKV/MP4/HLS, HEVC/AV1/VP9/H.264 ;
- pistes audio et sous-titres, clavier (`Espace`, `←`, `→`, `Échap`) ;
- tone mapping serveur prudent, avec passthrough HDR10/HDR10+/HLG/Dolby Vision activable ;
- **définition annoncée d'après l'écran** — mise à l'échelle de Windows comprise — et non plus 8K en toute circonstance ;
- **sortie audio déclarée à part du HDR** : stéréo par défaut, 5.1, 7.1 ou amplificateur. L'audio immersif et l'audio sans perte ne sont annoncés que dans le dernier cas, le seul où ils ont un sens.

## Vérification et paquet autonome

```powershell
dotnet build tests/FlixTunes.Windows.Tests.csproj -c Release
tests/bin/Release/net8.0-windows/FlixTunes.Windows.Tests.exe
dotnet publish FlixTunes.Windows.csproj -p:PublishProfile=Windows-x64 -o artifacts/windows
```
