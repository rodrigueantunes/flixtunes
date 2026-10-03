-keep class androidx.media3.** { *; }
-dontwarn org.conscrypt.**

# Le SDK Cast ne connait la classe d'options que par son nom, ecrit dans le manifeste : R8 ne voit
# aucune reference et la supprimerait. Sans elle, le relais hors de chez soi ne demarre pas.
-keep class tv.flixtunes.app.playback.OptionsCast { *; }
