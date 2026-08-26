package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reprise de la lecture, y compris après que le système a tué l'application.
 *
 * Cas limite nommé au dossier de l'étape 56. Il se produit sans que personne ne fasse rien de
 * particulier : le téléviseur se met en veille, la mémoire manque, l'application est détruite puis
 * recréée avec l'intention d'origine — celle d'il y a deux heures.
 */
class ResumePolicyTest {
    @Test
    fun `après destruction, la position sauvegardée prime sur celle de la fiche`() {
        // L'intention dit 10 % parce que c'est là qu'on en était en ouvrant le film. Deux heures plus
        // tard, la croire renverrait au début.
        val decision = decisionReprise(sauvegarde = 74, intentPourcentage = 10, mode = "continue")
        assertEquals(74, decision.pourcentage)
    }

    @Test
    fun `après destruction, la question de la reprise n'est pas reposée`() {
        // On y a déjà répondu avant la destruction. La reposer donnerait l'impression que
        // l'application a tout oublié — précisément ce qu'elle est en train d'éviter.
        assertFalse(decisionReprise(sauvegarde = 74, intentPourcentage = 10, mode = "ask").demander)
    }

    @Test
    fun `après destruction, un film presque fini reprend là où il en était`() {
        // La règle des 90 % sert à ne pas reprendre dans le générique d'un film déjà vu. Un film
        // interrompu à 95 % par la mort du processus n'a pas été regardé jusqu'au bout.
        assertEquals(95, decisionReprise(sauvegarde = 95, intentPourcentage = 0, mode = "continue").pourcentage)
    }

    @Test
    fun `une ouverture ordinaire suit la fiche`() {
        assertEquals(42, decisionReprise(sauvegarde = null, intentPourcentage = 42, mode = "continue").pourcentage)
    }

    @Test
    fun `une ouverture ordinaire repart du début au-delà de quatre-vingt-dix pour cent`() {
        // Le film est tenu pour vu : le rouvrir, c'est vouloir le revoir.
        assertEquals(0, decisionReprise(sauvegarde = null, intentPourcentage = 95, mode = "continue").pourcentage)
    }

    @Test
    fun `le réglage « demander » ne pose la question que s'il y a quelque chose à reprendre`() {
        // Demander « voulez-vous reprendre à 0 % ? » sur un film jamais commencé serait absurde.
        assertTrue(decisionReprise(sauvegarde = null, intentPourcentage = 30, mode = "ask").demander)
        assertFalse(decisionReprise(sauvegarde = null, intentPourcentage = 0, mode = "ask").demander)
        assertFalse(decisionReprise(sauvegarde = null, intentPourcentage = 95, mode = "ask").demander)
    }

    @Test
    fun `le réglage « recommencer » ignore toute progression`() {
        val decision = decisionReprise(sauvegarde = null, intentPourcentage = 60, mode = "restart")
        assertEquals(0, decision.pourcentage)
        assertFalse(decision.demander)
    }

    @Test
    fun `une sauvegarde aberrante est ramenée dans les bornes plutôt que rejetée`() {
        // Une durée mal mesurée peut produire un pourcentage hors normes. Refuser la reprise ferait
        // repartir du début ; la borner rend simplement la position la plus proche.
        assertEquals(99, decisionReprise(sauvegarde = 140, intentPourcentage = 0, mode = "continue").pourcentage)
        assertEquals(0, decisionReprise(sauvegarde = -5, intentPourcentage = 0, mode = "continue").pourcentage)
    }

    @Test fun `la reprise demande la session au point de lecture`() {
        // Sans cela, le serveur encode une fenetre qui part de zero et le saut tombe hors de cette
        // fenetre : il faut relancer une seconde session au bon endroit, ce qui double le travail du
        // NAS et fait attendre deux fois. Constate sur Android — la conversion repartait du debut meme
        // sur une reprise.
        val reprise = RepriseDecision(pourcentage = 50, demander = false)
        assertEquals(3595.0, departDemande(0.0, reprise, dureeSecondes = 7200.0, reculSecondes = 5), 0.001)
    }

    @Test fun `la seconde exacte prime sur le pourcentage arrondi`() {
        val reprise = decisionReprise(
            sauvegarde = null, intentPourcentage = 42, mode = "continue",
            intentSecondes = 3_047.8, intentDureeSecondes = 7_200.0,
        )
        assertEquals(3_042.8, departDemande(0.0, reprise, 7_200.0, 5), 0.001)
    }

    @Test fun `une activité recréée reprend sa seconde absolue même après quatre vingt dix pour cent`() {
        val reprise = decisionReprise(
            sauvegarde = 95, intentPourcentage = 10, mode = "continue",
            sauvegardeSecondes = 6_845.25,
        )
        assertEquals(6_840.25, departDemande(0.0, reprise, 7_200.0, 5), 0.001)
        assertFalse(reprise.demander)
    }

    @Test fun `une position exacte presque terminée suit la règle de nouvel ouverture`() {
        val reprise = decisionReprise(
            sauvegarde = null, intentPourcentage = 95, mode = "continue",
            intentSecondes = 6_900.0, intentDureeSecondes = 7_200.0,
        )
        assertEquals(0.0, departDemande(0.0, reprise, 7_200.0, 5), 0.001)
    }

    @Test fun `un saut explicite l emporte sur la reprise`() {
        // Une demande hors fenetre sait deja ou elle va ; la reprise d'origine n'a plus rien a dire.
        val reprise = RepriseDecision(pourcentage = 50, demander = false)
        assertEquals(1200.0, departDemande(1200.0, reprise, dureeSecondes = 7200.0, reculSecondes = 5), 0.001)
    }

    @Test fun `tant que la question n est pas posee, on part du debut`() {
        // Deviner ferait encoder le mauvais bout du film une fois sur deux.
        val reprise = RepriseDecision(pourcentage = 50, demander = true)
        assertEquals(0.0, departDemande(0.0, reprise, dureeSecondes = 7200.0, reculSecondes = 5), 0.001)
    }

    @Test fun `sans progression ni duree connue, on part du debut`() {
        assertEquals(0.0, departDemande(0.0, RepriseDecision(0, demander = false), 7200.0, 5), 0.001)
        assertEquals(0.0, departDemande(0.0, RepriseDecision(50, demander = false), 0.0, 5), 0.001)
    }

    @Test fun `le recul ne fait jamais passer avant le debut`() {
        assertEquals(0.0, departDemande(0.0, RepriseDecision(1, demander = false), 100.0, 30), 0.001)
    }
}
