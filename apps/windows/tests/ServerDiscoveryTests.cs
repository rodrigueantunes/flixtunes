using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace FlixTunes.Windows.Tests;

[TestClass]
public class ServerDiscoveryTests
{
    [TestMethod]
    public async Task DiscoveryMdnsTrouveLeServeurQuandLaRecetteEstActivee()
    {
        if (Environment.GetEnvironmentVariable("FLIXTUNES_MDNS_TEST") != "1") return;
        var servers = await ServerDiscovery.Find();
        Assert.IsTrue(servers.Any(server => server.Name.Contains("FlixTunes", StringComparison.OrdinalIgnoreCase)));
        Assert.IsTrue(servers.Any(server => server.Address.StartsWith("http://", StringComparison.OrdinalIgnoreCase)));
    }
}
