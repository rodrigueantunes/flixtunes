using System.Net.Http.Json;
using System.Net.Http;
using System.IO;
using System.Text.Json;

namespace FlixTunes.Windows;

public sealed class FlixTunesApi : IDisposable
{
    private readonly HttpClient client;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public Uri Server { get; }

    public FlixTunesApi(string server)
    {
        Server = ServerAddress.Normalize(server);
        client = new HttpClient { BaseAddress = new Uri(Server, "/api/"), Timeout = TimeSpan.FromSeconds(45) };
    }

    public async Task<string> Health(CancellationToken token = default)
    {
        using var json = await Get<JsonDocument>("health", token);
        return json.RootElement.GetProperty("version").GetString() ?? "?";
    }
    public Task<List<Profile>> Profiles(CancellationToken token = default) => Get<List<Profile>>("profiles", token);
    public async Task<HomeResponse> Home(string profileId, CancellationToken token = default) => Hydrate(await Get<HomeResponse>($"home?profileId={Escape(profileId)}", token));
    public async Task<List<MediaItem>> Search(string query, string profileId, CancellationToken token = default) => Hydrate(await Get<List<MediaItem>>($"search?q={Escape(query)}&profileId={Escape(profileId)}", token));
    public async Task<MediaDetails> Details(string id, string profileId, CancellationToken token = default) => Hydrate(await Get<MediaDetails>($"catalog/{Escape(id)}/details?profileId={Escape(profileId)}", token));
    public Task<PlaybackInfo> PlaybackInfo(string mediaId, CancellationToken token = default) => Get<PlaybackInfo>($"media/{Escape(mediaId)}/playback-info", token);

    public async Task<PlaybackSession> StartPlayback(string mediaId, object capabilities, CancellationToken token = default)
    {
        var response = await Send<PlaybackSession>(HttpMethod.Post, $"media/{Escape(mediaId)}/playback", capabilities, token);
        for (var attempt = 0; response.Status == "starting" && response.Id != null && attempt < 60; attempt++)
        {
            await Task.Delay(500, token);
            response = await Get<PlaybackSession>($"playback/{Escape(response.Id)}", token);
        }
        return response;
    }

    public async Task SaveProgress(string mediaId, string profileId, double position, double duration, CancellationToken token = default) =>
        await Send<object>(HttpMethod.Put, $"media/{Escape(mediaId)}/progress?profileId={Escape(profileId)}", new { positionSeconds = Math.Max(0, position), durationSeconds = Math.Max(1, duration) }, token);
    public async Task DeleteProgress(string mediaId, string profileId, CancellationToken token = default)
    {
        using var response = await client.DeleteAsync($"media/{Escape(mediaId)}/progress?profileId={Escape(profileId)}", token);
        if (!response.IsSuccessStatusCode) await Read<object>(response, token);
    }
    public async Task StopPlayback(string id) { using var response = await client.DeleteAsync($"playback/{Escape(id)}"); }
    public Uri Resolve(string? path) => ServerAddress.Resolve(Server, path);

    private async Task<T> Get<T>(string path, CancellationToken token)
    {
        using var response = await client.GetAsync(path, token);
        return await Read<T>(response, token);
    }
    private async Task<T> Send<T>(HttpMethod method, string path, object body, CancellationToken token)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body, options: JsonOptions) };
        using var response = await client.SendAsync(request, token);
        if (response.StatusCode == System.Net.HttpStatusCode.NoContent) return default!;
        return await Read<T>(response, token);
    }
    private static async Task<T> Read<T>(HttpResponseMessage response, CancellationToken token)
    {
        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync(token);
            string? message = null;
            try { message = JsonDocument.Parse(text).RootElement.GetProperty("message").GetString(); } catch { }
            throw new HttpRequestException(message ?? $"Erreur serveur {(int)response.StatusCode}");
        }
        return (await response.Content.ReadFromJsonAsync<T>(JsonOptions, token)) ?? throw new InvalidDataException("Réponse serveur vide");
    }
    private HomeResponse Hydrate(HomeResponse home) { Hydrate(home.ContinueWatching); Hydrate(home.RecentlyAdded); Hydrate(home.Movies); Hydrate(home.Shows); Hydrate(home.Completed); Hydrate(home.WatchedRecently); if (home.Featured != null) Hydrate(home.Featured); return home; }
    private MediaDetails Hydrate(MediaDetails details) { Hydrate(details.Item); details.Seasons.ForEach(s => Hydrate(s.Episodes)); Hydrate(details.Related); return details; }
    private List<MediaItem> Hydrate(List<MediaItem> media) { media.ForEach(Hydrate); return media; }
    private void Hydrate(MediaItem media) { media.AbsolutePoster = media.PosterUrl is null ? null : Resolve(media.PosterUrl).ToString(); }
    private static string Escape(string value) => Uri.EscapeDataString(value);
    public void Dispose() => client.Dispose();
}
