package tv.flixtunes.app.data

import android.content.Context

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("flixtunes", Context.MODE_PRIVATE)
    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) { prefs.edit().putString("server_url", value).apply() }
    var profileId: String?
        get() = prefs.getString("profile_id", null)
        set(value) { prefs.edit().putString("profile_id", value).apply() }
    var remoteToken: String?
        get() = prefs.getString("remote_token", null)
        set(value) { prefs.edit().putString("remote_token", value).apply() }
}
