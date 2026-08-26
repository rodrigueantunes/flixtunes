package tv.flixtunes.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParentalProfileTest {
    @Test fun `parse le groupe et la limite enfant`() {
        val profile = parseProfile(JSONObject("""{
          "id":"p1","groupId":"g1","name":"Lina","avatarColor":"#10b981","language":"fr-FR",
          "protected":false,"isChild":true,"age":9
        }"""))
        assertEquals("g1", profile.groupId)
        assertTrue(profile.isChild)
        assertEquals(9, profile.age)
    }

    @Test fun `parse la classification du catalogue`() {
        val media = parseMedia(JSONObject("""{
          "id":"m1","catalogId":"c1","kind":"movie","title":"Film","progressPercent":0,
          "completed":false,"ageRating":12,"ratingLabel":"-12"
        }"""))
        assertEquals(12, media.ageRating)
        assertEquals("-12", media.ratingLabel)
    }
}
