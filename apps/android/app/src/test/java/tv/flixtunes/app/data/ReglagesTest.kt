package tv.flixtunes.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Ce que les contrats de plateforme servent à obtenir.
 *
 * `SessionStore` range dans les préférences partagées d'Android, `ServerDiscovery` interroge le
 * service NSD du système : ni l'un ni l'autre n'existe ailleurs. Tant que le reste du code nommait ces
 * classes-là, il ne pouvait pas quitter Android.
 *
 * Ces cas ne vérifient pas un comportement subtil — ils vérifient une **propriété de construction** :
 * l'entrepôt se monte sans plateforme, avec un stockage en mémoire. C'est exactement ce qu'un module
 * partagé aura besoin de faire, et c'est ce qui échouerait si quelqu'un remettait le type concret.
 */
class ReglagesTest {
    @Test
    fun `un stockage en memoire retient ce qu'on lui confie`() {
        val reglages: Reglages = ReglagesEnMemoire()
        assertNull(reglages.serverUrl)

        reglages.serverUrl = "http://192.168.1.50:4000"
        reglages.profileId = "principal"
        reglages.remoteToken = "jeton"

        assertEquals("http://192.168.1.50:4000", reglages.serverUrl)
        assertEquals("principal", reglages.profileId)
        assertEquals("jeton", reglages.remoteToken)
    }

    @Test
    fun `l'entrepot se monte sans Android`() {
        // Aucun `Context`, aucune préférence partagée : la couche données n'en a plus besoin.
        val entrepot = FlixTunesRepository(ReglagesEnMemoire(serverUrl = "http://nas:4000"))
        assertNull(entrepot.api)
    }

    @Test
    fun `une decouverte qui ne cherche rien reste utilisable`() {
        // Sur un système sans mDNS — ou dans un test — la découverte doit pouvoir ne rien faire sans
        // que l'appelant ait à le savoir.
        val decouverte: DecouverteServeurs = AucuneDecouverte
        decouverte.start()
        decouverte.stop()
    }
}
