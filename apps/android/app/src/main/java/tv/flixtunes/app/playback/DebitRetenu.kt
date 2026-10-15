package tv.flixtunes.app.playback

import android.content.Context

/**
 * Le débit mesuré lors des dernières lectures du direct (r12), pour démarrer dans la qualité que
 * l'appareil tient.
 *
 * ExoPlayer part d'une estimation générique, faite pour un téléphone en données mobiles : la chaîne
 * s'ouvrait sur une petite variante, puis la qualité montait par paliers sous les yeux — un saut de
 * plus. Le client Web retient la même chose de son côté (`pilotage-direct.ts`).
 */
object DebitRetenu {
    private const val PREFERENCES = "flixtunes-direct"
    private const val CLE = "debit"
    private const val PLANCHER = 300_000L
    private const val PLAFOND = 200_000_000L

    /** Lissé : un réseau d'hôtel une soirée ne doit pas fixer le départ de toutes les suivantes. */
    fun lisser(avant: Long?, estimation: Long): Long? {
        if (estimation < PLANCHER) return avant
        val borne = estimation.coerceAtMost(PLAFOND)
        return if (avant == null) borne else (avant * 0.7 + borne * 0.3).toLong()
    }

    fun lire(context: Context): Long? = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getLong(CLE, 0L).takeIf { it >= PLANCHER }?.coerceAtMost(PLAFOND)

    fun retenir(context: Context, estimation: Long) {
        val lisse = lisser(lire(context), estimation) ?: return
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putLong(CLE, lisse).apply()
    }
}
