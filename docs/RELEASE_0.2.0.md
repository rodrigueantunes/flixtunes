# FlixTunes 0.2.0 — phases 10 à 20

Cette version transforme le prototype 0.0.9 en plateforme multimédia locale complète : centre d'analyse, détection avancée, métadonnées multi-fournisseurs, revue des correspondances, inventaire technique, lecture adaptative, préférences de pistes, expérience premium, recommandations locales et exploitation NAS observable.

## Compatibilité

- Serveur : Windows ou Linux/NAS, Node.js 24, FFmpeg/FFprobe ;
- Web/PWA : navigateurs modernes avec HLS natif ou MediaSource ;
- Windows : Windows 10/11 x64, moteur libVLC embarqué ;
- Android : API 23+, téléphone, tablette et Android TV.

## Garantie sur les codecs

La stratégie n'affirme pas que chaque appareil décode tout matériellement. Elle garantit une négociation en trois niveaux : lecture directe quand le client sait décoder, remux sans réencoder la vidéo quand seul le conteneur gêne, puis transcodage FFmpeg avec repli logiciel. La qualité HDR/audio dépend toujours des capacités réelles de l'écran, de l'amplificateur, du client et de FFmpeg.
