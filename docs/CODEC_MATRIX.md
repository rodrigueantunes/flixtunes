# Matrice de lecture FlixTunes 0.2.0

Le serveur inspecte chaque piste avec FFprobe. Le client déclare ses capacités et le serveur choisit la stratégie la moins coûteuse. « Négocié » signifie que le résultat exact dépend du décodeur matériel, de l’écran et de la sortie audio du client.

| Élément source | Web | Android / TV | Windows | Repli serveur |
|---|---|---|---|---|
| H.264 / AVC | Direct | Direct | Direct | H.264 HLS |
| HEVC / H.265 | Négocié | Direct si MediaCodec | Direct via libVLC | H.264 HLS |
| AV1 | Négocié | Direct si MediaCodec | Direct via libVLC | H.264 HLS |
| VP9 / VP8 | Direct WebM | Direct | Direct via libVLC | H.264 HLS |
| MPEG-2 / VC-1 | Transcodage | Négocié | Direct via libVLC | H.264 HLS |
| MKV | Remux ou direct selon client | Direct/remux | Direct | HLS fMP4 |
| MP4 | Direct | Direct | Direct | HLS fMP4 |
| M2TS / MPEG-TS | Remux | Direct/remux | Direct | HLS fMP4 |
| AAC / MP3 / Opus | Direct | Direct | Direct | AAC |
| AC-3 / E-AC-3 | Négocié | Négocié | Direct | AAC |
| TrueHD / Atmos | Transcodé Web | Passthrough si annoncé | Passthrough activable | AAC stéréo/multicanal |
| DTS / DTS:X / Auro-3D | Transcodé Web | Passthrough si annoncé | Passthrough activable | AAC |
| SRT / WebVTT | WebVTT | Piste native | Piste native | Extraction WebVTT |
| ASS / SSA | Incrustation si nécessaire | Piste native selon Media3 | Piste native libVLC | Incrustation vidéo |
| PGS / VobSub | Incrustation | Négocié | Piste native libVLC | Incrustation vidéo |
| HDR10 / HLG | Direct si écran annoncé | Direct si écran annoncé | Passthrough activable | HEVC 10 bits HDR10 puis tone mapping SDR |
| HDR10+ | Direct si écran annoncé | Direct si écran annoncé | Passthrough activable | Couche HDR10 puis tone mapping SDR |
| Dolby Vision 7 / 8.1 / 8.4 | Direct si codec/écran annoncé | Direct si profil pris en charge | Passthrough activable | Couche de base HDR10 ou HLG |
| Dolby Vision 5 | Direct si codec/écran annoncé | Direct si profil pris en charge | Passthrough activable | Tone mapping SDR, perte annoncée |

La présence d’une technologie est affichée même si le périphérique ne la restitue pas. Le mode prudent des clients demande alors au serveur un flux compatible SDR et audio standard.

Depuis 0.4.8, une conversion n’est engagée qu’après avoir cherché une couche de base rétrocompatible : un Dolby Vision profil 8.1 est lu en HDR10 par un téléviseur HDR10 sans transcodage, un profil 8.4 en HLG, un HDR10+ en HDR10. Seul un profil 5, dépourvu de couche rétrocompatible, impose une conversion SDR. Le chemin retenu, la luminance crête relevée et la perte éventuelle sont affichés dans « Infos lecture ».
