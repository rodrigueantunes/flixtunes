package tv.flixtunes.app

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationCatalogueTest {
    @Test fun `le maintien bas parcourt les initiales dans l'ordre et se borne à Z`() {
        assertEquals("A", prochaineInitialeCatalogue("#"))
        assertEquals("B", prochaineInitialeCatalogue("A"))
        assertEquals("M", prochaineInitialeCatalogue("l"))
        assertEquals("Z", prochaineInitialeCatalogue("Z"))
    }
}
