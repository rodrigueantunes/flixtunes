using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace FlixTunes.Windows.Tests;

[TestClass]
public sealed class MediaItemTests
{
    private static MediaItem Item(string kind, int? season = null, int? episode = null, int? seasonCount = null) =>
        new("id", "catalog", "id", kind, "Titre", "titre", 2026, null, null, null, kind == "episode" ? "Série" : null, season, episode, 100, 0, false, seasonCount);

    [TestMethod] public void FormateEpisode() => Assert.AreEqual("S2 · E7", Item("episode", 2, 7).Meta);
    [TestMethod] public void FormateSaisons() { Assert.AreEqual("1 saison", Item("show", seasonCount: 1).Meta); Assert.AreEqual("3 saisons", Item("show", seasonCount: 3).Meta); }
    [TestMethod] public void AfficheAnneeFilm() => Assert.AreEqual("2026", Item("movie").Meta);
}
