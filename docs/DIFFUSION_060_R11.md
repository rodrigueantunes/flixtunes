# Diffusion 0.6.0 r11 — un cast plus stable, à la maison comme chez un proche

*14 octobre 2026. Analyse des journaux du NAS en r10 (du 3 au 14 octobre), puis corrections.*

## Ce que disent les journaux

Relevé sur le journal du serveur, celui de Caddy et le journal des accès distants.

| Constat | Source |
| --- | --- |
| LCI et M6 vers le 58PUS7304 en DLNA sont sorties en « Conversion 720p25 » : le repli logiciel, et non le 1080p50 matériel de la r9 | « Lecture distante confirmée », 2 et 3 octobre |
| La conversion du direct en `h264_vaapi` débit variable n'avait jamais été mesurée sur le NAS : le calibrage ne mesurait que la qualité constante (`-qp 23`) | `capacity.ts` |
| LCI tournait en DLNA ; TF1 vers la Pixel Tablet a été refusée aussitôt, « Conversion occupée » : une seule conversion du direct à la fois | 3 octobre, 17 h 42 |
| LCI en Cast sur le 58PUS7304 : la copie 1080p50 n'a pas démarré, arrêt au bout de 23 s | 3 octobre, 17 h 43 |
| Depuis l'accès distant, l'application Android ne demande **aucun** logo de chaîne ; l'application de bureau en reçoit, mais 306 refus 429 pour 200 réussis | journal de Caddy, 4 au 13 octobre |
| Aucun relais de cast inscrit depuis la r10 | journaux du serveur et de Caddy |

Les messages de FFmpeg du direct n'étant écrits nulle part, la passe matérielle refusée ne pouvait
pas être distinguée d'une analyse ratée : les deux finissaient sur la même étiquette.

## Corrections

### Le direct, converti avec ce que la machine tient

- Le calibrage de la diffusion mesure désormais la conversion du direct telle qu'elle est lancée :
  un 1080p50 en débit variable, puis en qualité constante, et le désentrelacement trame par trame avec
  le réglage retenu. Le direct n'emploie le circuit vidéo que s'il a tenu au moins 55 images par
  seconde, et une source entrelacée n'y passe que si son désentrelacement a été qualifié. Sinon, il
  convertit en logiciel d'emblée, sans quinze secondes d'écran noir.
- Le verdict est lisible dans `GET /api/system/capacity` (`diffusion.retenue.direct`).
- Une passe qui s'arrête sans image écrit dans le journal ce que FFmpeg a dit, adresses retirées.

### Deux chaînes à la fois

Les copies ne comptent plus dans le plafond, et un circuit vidéo qualifié tient deux conversions du
direct de front (une sans lui ; `FLIXTUNES_LIVE_CONVERSIONS` le règle). Un refus dit maintenant
quoi faire : arrêter une autre chaîne.

### Une copie qui ne démarre pas

En Cast, une copie du direct non confirmée en 15 s (35 s auparavant) cède la place à une conversion
à pleine définition, puis seulement au 720p compatible. Ce niveau n'est tenté qu'après une copie.

### Les logos du direct depuis l'accès distant

- **Android** : le serveur remplace chaque logo par un lien relatif vers son relais ; l'application le
  passait tel quel au chargeur d'images, qui n'en faisait rien. Il est désormais résolu contre le
  serveur, et reçoit les jetons comme les jaquettes.
- **Serveur** : les logos ne partagent plus le plafond de 24 flux simultanés. Ils attendent leur tour
  (six téléchargements à la fois, dix secondes au plus) au lieu d'un refus, sont gardés douze heures
  en mémoire (24 Mio), et un logo absent chez son hébergeur est retenu dix minutes.

### Le cast hors de chez soi

- **DLNA chez un proche** (application Android). Le téléphone découvre les téléviseurs DLNA du Wi-Fi
  et en envoie la description au NAS. Le NAS compose toutes les commandes, comme pour un téléviseur de
  la maison ; le téléphone les poste, uniquement à l'adresse du téléviseur annoncé. Beaucoup de
  téléviseurs DLNA ne lisent pas le HTTPS : le téléphone tient un petit relais vidéo sur son Wi-Fi, qui
  ne sert que le chemin du flux à clé et ne le demande qu'au NAS, en HTTPS. Le NAS valide la
  description : adresses privées, même hôte pour toutes les commandes, relais vidéo sur une adresse
  privée du téléphone.
- **Relais plus robuste** : « hors de chez soi » est réévalué à chaque retour sur l'application et
  toutes les minutes, et le relais ne s'arrête plus tant qu'un écran est visible. Ouverte à la maison,
  l'application s'arrêtait de relayer au bout de deux minutes et demie, et ne reprenait pas.
- Le DLNA relayé ne dépend pas des services Google : il fonctionne aussi sans eux.

## Mesures

- Banc du direct sur la Pixel Tablet (PC, encodage logiciel) : CNews copiée en 5,7 s, TF1 convertie et
  désentrelacée en 6,9 s, LCI convertie en 7,7 s ; pause, reprise et arrêt réussis.
- Tests : calibrage du direct, traitement selon le circuit mesuré, plafond des conversions, file des
  logos (quarante logos simultanés servis sans refus, six téléchargements au plus, la deuxième grille
  depuis la mémoire), DLNA relayé de bout en bout par les vraies routes (description, commandes SOAP,
  relais vidéo, pause, arrêt) et refus des descriptions qui visent ailleurs.

## Reste à mesurer, sur le NAS et sur place

- Le verdict du calibrage du direct sur le NAS, après installation : `diffusion.retenue` de
  `/api/system/capacity`, et LCI ou TF1 vers le 58PUS7304 en DLNA, qui doit sortir en 1080p50.
- Le 58PUS7304 était éteint pendant cette révision : la copie de LCI en Cast n'a pas pu être rejouée.
- Le DLNA et le Cast chez un proche, sur un vrai réseau extérieur.
