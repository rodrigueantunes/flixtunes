namespace FlixTunes.Windows;

public static class ServerAddress
{
    public static Uri Normalize(string input)
    {
        var value = input.Trim().TrimEnd('/');
        if (!value.Contains("://", StringComparison.Ordinal)) value = $"http://{value}";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) || string.IsNullOrWhiteSpace(uri.Host))
            throw new ArgumentException("Adresse du serveur invalide", nameof(input));
        return new Uri(uri.GetLeftPart(UriPartial.Authority));
    }

    public static Uri Resolve(Uri server, string? path) => Uri.TryCreate(path, UriKind.Absolute, out var absolute) ? absolute : new Uri(server, path ?? "/");
}
