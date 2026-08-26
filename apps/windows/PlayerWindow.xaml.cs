using System.Windows;
using System.Windows.Input;
using LibVLCSharp.Shared;
using Microsoft.Win32;

namespace FlixTunes.Windows;

public partial class PlayerWindow : Window
{
    private readonly FlixTunesApi api; private readonly Profile profile; private readonly MediaItem item;
    private readonly LibVLC libVlc; private readonly MediaPlayer player; private PlaybackInfo? info; private string? sessionId; private Media? currentMedia;
    private double resumeSeconds;
    private readonly System.Windows.Threading.DispatcherTimer progressTimer = new() { Interval = TimeSpan.FromSeconds(10) };

    public PlayerWindow(FlixTunesApi api, Profile profile, MediaItem item)
    {
        InitializeComponent(); this.api = api; this.profile = profile; this.item = item; TitleText.Text = item.DisplayTitle;
        HdrToggle.IsChecked = Registry.CurrentUser.CreateSubKey("Software\\FlixTunes").GetValue("HdrPassthrough") as int? == 1;
        libVlc = new LibVLC("--network-caching=1800", "--avcodec-hw=any", "--audio-language=fr,fre,fra,en,eng", "--sub-language=fr,fre,fra,en,eng");
        player = new MediaPlayer(libVlc); Video.MediaPlayer = player;
        player.Playing += (_, _) => Dispatcher.Invoke(() => { LoadingPanel.Visibility = Visibility.Collapsed; if (resumeSeconds > 0 && player.Length > 0) { player.Time = Math.Min((long)(resumeSeconds * 1000), player.Length - 1000); resumeSeconds = 0; } else if (item.ProgressPercent is > 0 and < 90 && player.Length > 0) player.Time = player.Length * item.ProgressPercent / 100; });
        player.EncounteredError += (_, _) => Dispatcher.Invoke(() => { LoadingText.Text = "Lecture interrompue."; LoadingPanel.Visibility = Visibility.Visible; });
        progressTimer.Tick += async (_, _) => await SaveProgress(); progressTimer.Start();
        Loaded += async (_, _) => await Start(); Closed += async (_, _) => await Cleanup();
    }

    private async Task Start(bool preservePosition = false)
    {
        try
        {
            LoadingPanel.Visibility = Visibility.Visible; LoadingText.Text = "Négociation avec le serveur…";
            if (preservePosition && player.Time > 0) resumeSeconds = player.Time / 1000.0;
            if (sessionId != null) { await api.StopPlayback(sessionId); sessionId = null; }
            player.Stop(); currentMedia?.Dispose(); currentMedia = null;
            if (info == null) { info = await api.PlaybackInfo(item.Id); PopulateTracks(info); }
            var hdr = HdrToggle.IsChecked == true;
            var audioIndex = (AudioBox.SelectedItem as TrackChoice)?.Index;
            var subtitleIndex = (SubtitleBox.SelectedItem as TrackChoice)?.Index;
            var capabilities = new {
                containers = new[] { "mp4", "webm", "mpegts" }, videoCodecs = new[] { "h264", "hevc", "av1", "vp9", "vp8", "mpeg2video" },
                audioCodecs = new[] { "aac", "opus", "mp3", "ac3", "eac3", "truehd", "dts", "flac" }, hls = true,
                maxWidth = 7680, maxHeight = 4320, hdr, hdrFormats = hdr ? new[] { "hdr10", "hdr10plus", "hlg", "dolbyvision" } : Array.Empty<string>(),
                dolbyAtmos = hdr, immersiveAudioFormats = hdr ? new[] { "dolby-atmos", "dts-x", "auro-3d" } : Array.Empty<string>(), maxAudioChannels = hdr ? 16 : 2,
                losslessAudio = hdr, maxVideoBitrate = (int?)null, audioStreamIndex = audioIndex, subtitleStreamIndex = subtitleIndex is >= 0 ? subtitleIndex : null, burnSubtitles = false,
            };
            var session = await api.StartPlayback(item.Id, capabilities);
            if (session.Status == "failed" || session.Url == null) throw new InvalidOperationException(session.Error ?? "Lecture impossible");
            sessionId = session.Id; ModeText.Text = session.Mode == "direct" ? "DIRECT PLAY · VLC" : session.Mode == "remux" ? "REMUX HLS · VLC" : "TRANSCODAGE HLS · VLC";
            currentMedia = new Media(libVlc, api.Resolve(session.Url)); player.Media = currentMedia; player.Play();
        }
        catch (Exception error) { LoadingText.Text = error.Message; }
    }

    private void PopulateTracks(PlaybackInfo playback)
    {
        var audio = playback.Streams.Where(s => s.Type == "audio").Select(s => new TrackChoice(s.Index, $"{LanguageLabel(s.Language)} · {Technology(s)}", s.IsDefault)).ToList();
        AudioBox.ItemsSource = audio; AudioBox.DisplayMemberPath = "Label"; AudioBox.SelectedItem = audio.FirstOrDefault(t => t.IsDefault) ?? audio.FirstOrDefault();
        SubtitleBox.ItemsSource = new[] { new TrackChoice(-1, "Sous-titres désactivés", true) }.Concat(playback.Streams.Where(s => s.Type == "subtitle").Select(s => new TrackChoice(s.Index, LanguageLabel(s.Language), false))).ToList(); SubtitleBox.DisplayMemberPath = "Label"; SubtitleBox.SelectedIndex = 0;
    }
    private static string LanguageLabel(string? value) => value?.ToLowerInvariant() switch { "fr" or "fre" or "fra" => "Français", "en" or "eng" => "English", null or "" => "Langue inconnue", _ => value.ToUpperInvariant() };
    private static string Technology(PlaybackStream stream) => stream.DolbyAtmos ? "Dolby Atmos" : stream.AudioTechnology switch { "dts-x" => "DTS:X", "auro-3d" => "Auro-3D", _ => stream.Codec.ToUpperInvariant() };
    private async void ApplyTracks_Click(object sender, RoutedEventArgs e)
    {
        Registry.CurrentUser.CreateSubKey("Software\\FlixTunes").SetValue("HdrPassthrough", HdrToggle.IsChecked == true ? 1 : 0);
        await SaveProgress(); await Start(true);
    }
    private async Task SaveProgress() { if (player.Length > 0) try { await api.SaveProgress(item.Id, profile.Id, player.Time / 1000.0, player.Length / 1000.0); } catch { } }
    private async Task Cleanup() { progressTimer.Stop(); await SaveProgress(); player.Stop(); if (sessionId != null) await api.StopPlayback(sessionId); currentMedia?.Dispose(); player.Dispose(); libVlc.Dispose(); }
    private void Back_Click(object sender, RoutedEventArgs e) => Close();
    private void Window_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Escape) Close(); else if (e.Key == Key.Space) { if (player.IsPlaying) player.Pause(); else player.Play(); } else if (e.Key == Key.Right) player.Time += 10_000; else if (e.Key == Key.Left) player.Time = Math.Max(0, player.Time - 10_000); }
    private sealed record TrackChoice(int Index, string Label, bool IsDefault);
}
