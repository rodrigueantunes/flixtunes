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
        var reglages = Registry.CurrentUser.CreateSubKey("Software\\FlixTunes");
        HdrToggle.IsChecked = reglages.GetValue("HdrPassthrough") as int? == 1;
        // La sortie audio est un réglage à part, et non une conséquence du HDR : un écran HDR branché
        // sur les haut-parleurs d'un portable est un cas ordinaire, et l'inverse aussi.
        AudioSortieBox.SelectedIndex = ClientCapabilities.SortieDepuis(reglages.GetValue("SortieAudio") as string) switch
        {
            SortieAudio.Surround51 => 1, SortieAudio.Surround71 => 2, SortieAudio.Amplificateur => 3, _ => 0,
        };
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
            var (largeur, hauteur) = DefinitionDeLEcran();
            var capabilities = ClientCapabilities.Pour(largeur, hauteur, hdr, SortieChoisie(), audioIndex, subtitleIndex);
            var session = await api.StartPlayback(item.Id, capabilities);
            if (session.Status == "failed" || session.Url == null) throw new InvalidOperationException(session.Error ?? "Lecture impossible");
            sessionId = session.Id; ModeText.Text = session.Mode == "direct" ? "DIRECT PLAY · VLC" : session.Mode == "remux" ? "REMUX HLS · VLC" : "TRANSCODAGE HLS · VLC";
            currentMedia = new Media(libVlc, api.Resolve(session.Url)); player.Media = currentMedia; player.Play();
        }
        catch (Exception error) { LoadingText.Text = error.Message; }
    }

    private SortieAudio SortieChoisie() => AudioSortieBox.SelectedIndex switch
    {
        1 => SortieAudio.Surround51, 2 => SortieAudio.Surround71, 3 => SortieAudio.Amplificateur, _ => SortieAudio.Stereo,
    };

    /// <summary>
    /// La définition de l'écran, en pixels réels.
    ///
    /// `SystemParameters` rend des points d'affichage, pas des pixels : sur un écran à 150 %, un
    /// 2560 × 1440 s'annoncerait 1707 × 960, et le serveur convertirait des vidéos que la machine
    /// affiche parfaitement. La matrice de la cible d'affichage porte le facteur.
    /// </summary>
    private (int Largeur, int Hauteur) DefinitionDeLEcran()
    {
        var cible = PresentationSource.FromVisual(this)?.CompositionTarget;
        var echelleX = cible?.TransformToDevice.M11 ?? 1.0;
        var echelleY = cible?.TransformToDevice.M22 ?? 1.0;
        return ((int)Math.Round(SystemParameters.PrimaryScreenWidth * echelleX),
                (int)Math.Round(SystemParameters.PrimaryScreenHeight * echelleY));
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
        var cle = Registry.CurrentUser.CreateSubKey("Software\\FlixTunes");
        cle.SetValue("HdrPassthrough", HdrToggle.IsChecked == true ? 1 : 0);
        cle.SetValue("SortieAudio", ClientCapabilities.NomDe(SortieChoisie()));
        await SaveProgress(); await Start(true);
    }
    private async Task SaveProgress() { if (player.Length > 0) try { await api.SaveProgress(item.Id, profile.Id, player.Time / 1000.0, player.Length / 1000.0); } catch { } }
    private async Task Cleanup() { progressTimer.Stop(); await SaveProgress(); player.Stop(); if (sessionId != null) await api.StopPlayback(sessionId); currentMedia?.Dispose(); player.Dispose(); libVlc.Dispose(); }
    private void Back_Click(object sender, RoutedEventArgs e) => Close();
    private void Window_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Escape) Close(); else if (e.Key == Key.Space) { if (player.IsPlaying) player.Pause(); else player.Play(); } else if (e.Key == Key.Right) player.Time += 10_000; else if (e.Key == Key.Left) player.Time = Math.Max(0, player.Time - 10_000); }
    private sealed record TrackChoice(int Index, string Label, bool IsDefault);
}
