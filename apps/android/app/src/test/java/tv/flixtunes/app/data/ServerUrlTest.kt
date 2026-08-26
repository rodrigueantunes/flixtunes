package tv.flixtunes.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ServerUrlTest {
    @Test fun `ajoute HTTP et retire le slash final`() {
        assertEquals("http://10.20.30.254:4000", ServerUrl.normalize(" 10.20.30.254:4000/ "))
    }

    @Test fun `conserve HTTPS et résout une route API`() {
        assertEquals("https://nas.local/api/artwork/42", ServerUrl.resolve("https://nas.local/", "/api/artwork/42"))
    }

    @Test fun `rejette les protocoles non web`() {
        assertThrows(IllegalArgumentException::class.java) { ServerUrl.normalize("ftp://nas.local") }
    }

    @Test fun `le reseau local garde le clair, comme avant`() {
        assertEquals("http://192.168.1.20:4000", ServerUrl.normalize("192.168.1.20:4000"))
        assertEquals("http://nas.local", ServerUrl.normalize("nas.local"))
        assertEquals("http://172.16.0.5", ServerUrl.normalize("http://172.16.0.5"))
        assertEquals("http://localhost:4000", ServerUrl.normalize("localhost:4000"))
    }

    @Test fun `une adresse publique passe en HTTPS par defaut`() {
        assertEquals("https://flixtunes.antunesbarata.fr", ServerUrl.normalize("flixtunes.antunesbarata.fr"))
    }

    @Test fun `le clair vers Internet est refuse`() {
        // Sinon PIN, jeton de session et film partiraient en lecture libre sur le chemin.
        assertThrows(IllegalArgumentException::class.java) {
            ServerUrl.normalize("http://flixtunes.antunesbarata.fr")
        }
    }

    @Test fun `172 point 32 n'est pas une plage privee`() {
        assertThrows(IllegalArgumentException::class.java) { ServerUrl.normalize("http://172.32.0.1") }
    }
}
