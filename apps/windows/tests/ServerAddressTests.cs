using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace FlixTunes.Windows.Tests;

[TestClass]
public sealed class ServerAddressTests
{
    [TestMethod] public void AjouteHttpEtRetireLeChemin() => Assert.AreEqual("http://192.0.2.10:4000/", ServerAddress.Normalize(" 192.0.2.10:4000/test/ ").ToString());
    [TestMethod] public void ConserveHttps() => Assert.AreEqual("https://nas.local/", ServerAddress.Normalize("https://nas.local/").ToString());
    [TestMethod] public void RejetteFtp() => Assert.ThrowsExactly<ArgumentException>(() => ServerAddress.Normalize("ftp://nas.local"));
    [TestMethod] public void ResoutUneRouteApi() => Assert.AreEqual("https://nas.local/api/artwork/42", ServerAddress.Resolve(new Uri("https://nas.local"), "/api/artwork/42").ToString());
}
