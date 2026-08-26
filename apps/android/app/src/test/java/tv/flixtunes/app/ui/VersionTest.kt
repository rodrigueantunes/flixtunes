package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionTest {
    @Test
    fun `la revision se detache du numero de version`() {
        assertEquals("v0.5.6 r75", intituleVersion("0.5.6.r75"))
    }

    @Test
    fun `une construction locale n'invente pas de revision`() {
        // `build.gradle.kts` laisse le nom nu quand aucune révision n'est passée : l'affichage suit.
        assertEquals("v0.5.6", intituleVersion("0.5.6"))
    }

    @Test
    fun `un numero a deux chiffres de revision reste entier`() {
        assertEquals("v0.6.0 r103", intituleVersion("0.6.0.r103"))
    }
}
