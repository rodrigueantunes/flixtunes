# Client Windows FlixTunes 0.2.0

Client WPF natif avec moteur VideoLAN libVLC embarqué. Il fonctionne sous Windows 10/11 x64 sans installation séparée de VLC.

## Capacités

- connexion au NAS local et mémorisation locale du serveur/profil ;
- accueil, recherche serveur, fiches films et séries, saisons/épisodes, reprise et historique ;
- Direct Play, remux et transcodage HLS négociés avec le serveur ;
- décodage matériel libVLC, lecture MKV/MP4/HLS, HEVC/AV1/VP9/H.264 ;
- pistes audio et sous-titres, clavier (`Espace`, `←`, `→`, `Échap`) ;
- tone mapping serveur prudent, avec passthrough HDR10/HDR10+/HLG/Dolby Vision et Atmos/DTS:X activable.

## Vérification et paquet autonome

```powershell
dotnet test tests/FlixTunes.Windows.Tests.csproj -c Release
dotnet publish FlixTunes.Windows.csproj -p:PublishProfile=Windows-x64 -o artifacts/windows
```
