using Zeroconf;

namespace FlixTunes.Windows;

public sealed record DiscoveredServer(string Name, string Address)
{
    public override string ToString() => $"{Name} · {Address}";
}

public static class ServerDiscovery
{
    public static async Task<IReadOnlyList<DiscoveredServer>> Find(CancellationToken token = default)
    {
        var hosts = await ZeroconfResolver.ResolveAsync("_flixtunes._tcp.local.", TimeSpan.FromSeconds(3),
            retries: 1, retryDelayMilliseconds: 400, cancellationToken: token);
        return hosts.SelectMany(host => host.Services.Values.Select(service => new DiscoveredServer(
                host.DisplayName?.Replace("._flixtunes._tcp.local.", "") ?? "FlixTunes",
                $"http://{host.IPAddress}:{service.Port}")))
            .DistinctBy(server => server.Address).ToList();
    }
}
