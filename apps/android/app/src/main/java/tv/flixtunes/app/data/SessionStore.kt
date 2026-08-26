package tv.flixtunes.app.data

import android.content.Context

/**
 * Le stockage Android : des préférences partagées, comme il se doit ici.
 *
 * Il met en œuvre [Reglages], dont le contrat ne dit rien de tout cela — c'est la frontière.
 */
class SessionStore(context: Context) : Reglages {
    private val prefs = context.getSharedPreferences("flixtunes", Context.MODE_PRIVATE)
    override var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) { prefs.edit().putString("server_url", value).apply() }
    override var profileId: String?
        get() = prefs.getString("profile_id", null)
        set(value) { prefs.edit().putString("profile_id", value).apply() }
    override var remoteToken: String?
        get() = prefs.getString("remote_token", null)
        set(value) { prefs.edit().putString("remote_token", value).apply() }
}
