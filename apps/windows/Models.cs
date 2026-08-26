using System.Text.Json.Serialization;

namespace FlixTunes.Windows;

public sealed record Profile(string Id, string Name, string AvatarColor, string Language)
{
    public override string ToString() => Name;
}

public sealed record MediaItem(
    string Id, string? CatalogId, string? PlayableMediaId, string Kind, string Title, string SortTitle, int? Year,
    string? Overview, string? PosterUrl, string? BackdropUrl, string? ShowTitle, int? SeasonNumber, int? EpisodeNumber,
    int? RuntimeSeconds, int ProgressPercent, bool Completed, int? SeasonCount)
{
    [JsonIgnore] public string DisplayTitle => ShowTitle ?? Title;
    [JsonIgnore] public string Meta => Kind switch
    {
        "episode" => $"S{SeasonNumber ?? 0} · E{EpisodeNumber ?? 0}",
        "show" => $"{SeasonCount ?? 0} saison{((SeasonCount ?? 0) > 1 ? "s" : "")}",
        _ => Year?.ToString() ?? "Film",
    };
    [JsonIgnore] public string? AbsolutePoster { get; set; }
}

public sealed record HomeResponse(
    Profile Profile, MediaItem? Featured, List<MediaItem> ContinueWatching, List<MediaItem> RecentlyAdded,
    List<MediaItem> Movies, List<MediaItem> Shows, List<MediaItem> Completed, List<MediaItem> WatchedRecently);
public sealed record SeasonDetails(string Id, int Number, string Title, string? Overview, string? PosterUrl, List<MediaItem> Episodes);
public sealed record MediaDetails(MediaItem Item, List<SeasonDetails> Seasons, List<MediaItem> Related);
public sealed record PlaybackSession(string? Id, string MediaId, string Mode, string Status, string? Url, string? VideoEncoder, string? AudioEncoder, string Reason, string? Error);
public sealed record PlaybackStream(int Index, string Type, string Codec, string? Title, string? Language, int? Channels, bool IsDefault, bool IsForced, string HdrFormat, bool DolbyAtmos, string? AudioTechnology);
public sealed record PlaybackInfo(string MediaId, string Container, double? DurationSeconds, List<PlaybackStream> Streams);
