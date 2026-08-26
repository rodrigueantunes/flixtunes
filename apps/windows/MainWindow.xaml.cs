using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using Microsoft.Win32;

namespace FlixTunes.Windows;

public partial class MainWindow : Window
{
    private FlixTunesApi? api;
    private Profile? profile;
    private MediaItem? featured;
    private CancellationTokenSource? searchCancellation;
    private const string ServerKey = "Software\\FlixTunes";

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await ConnectSavedOrPrompt();
        Closed += (_, _) => { searchCancellation?.Cancel(); api?.Dispose(); };
    }

    private async Task ConnectSavedOrPrompt()
    {
        var saved = Registry.CurrentUser.CreateSubKey(ServerKey).GetValue("Server") as string;
        if (string.IsNullOrWhiteSpace(saved)) { ShowServerDialog(); return; }
        await Connect(saved);
    }

    private async Task Connect(string address)
    {
        SetStatus("Connexion au serveur…");
        try
        {
            var next = new FlixTunesApi(address);
            await next.Health();
            var profiles = await next.Profiles();
            api?.Dispose(); api = next;
            Registry.CurrentUser.CreateSubKey(ServerKey).SetValue("Server", next.Server.ToString().TrimEnd('/'));
            ProfileBox.ItemsSource = profiles;
            var savedProfile = Registry.CurrentUser.CreateSubKey(ServerKey).GetValue("Profile") as string;
            ProfileBox.SelectedItem = profiles.FirstOrDefault(item => item.Id == savedProfile) ?? profiles.FirstOrDefault();
            SetStatus(null);
        }
        catch (Exception error) { SetStatus(error.Message, true); ShowServerDialog(); }
    }

    private async Task LoadHome()
    {
        if (api == null || profile == null) return;
        SetStatus("Actualisation du catalogue…");
        try
        {
            var home = await api.Home(profile.Id);
            featured = home.Featured;
            ContinueItems.ItemsSource = home.ContinueWatching; ContinueSection.Visibility = home.ContinueWatching.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            RecentItems.ItemsSource = home.RecentlyAdded; MovieItems.ItemsSource = home.Movies; ShowItems.ItemsSource = home.Shows; CompletedItems.ItemsSource = home.Completed;
            if (featured != null)
            {
                HeroTitle.Text = featured.DisplayTitle; HeroMeta.Text = $"{featured.Meta}  •  {(featured.RuntimeSeconds is > 0 ? $"{featured.RuntimeSeconds / 60} min" : "Dans votre médiathèque")}";
                HeroOverview.Text = featured.Overview ?? "Votre contenu est prêt sur le réseau local.";
                HeroEyebrow.Text = featured.ProgressPercent > 0 ? "À REPRENDRE" : "À DÉCOUVRIR";
                HeroImage.Source = LoadImage(api.Resolve(featured.BackdropUrl));
            }
            SetStatus(null);
        }
        catch (Exception error) { SetStatus(error.Message, true); }
    }

    private static BitmapImage? LoadImage(Uri uri)
    {
        if (uri.AbsolutePath == "/") return null;
        try { var image = new BitmapImage(); image.BeginInit(); image.UriSource = uri; image.CacheOption = BitmapCacheOption.OnDemand; image.EndInit(); return image; } catch { return null; }
    }

    private async void Profile_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (ProfileBox.SelectedItem is not Profile next) return;
        profile = next; Registry.CurrentUser.CreateSubKey(ServerKey).SetValue("Profile", next.Id); await LoadHome();
    }

    private void Server_Click(object sender, RoutedEventArgs e) => ShowServerDialog();
    private void ShowServerDialog()
    {
        // Aucune adresse par defaut : celle du NAS de developpement etait proposee a tout le monde.
        // Le champ vide laisse la decouverte Zeroconf remplir la liste, et la saisie manuelle reste la.
        var stored = Registry.CurrentUser.CreateSubKey(ServerKey).GetValue("Server") as string;
        var dialog = new ServerWindow(stored ?? string.Empty) { Owner = this };
        if (dialog.ShowDialog() == true) _ = Connect(dialog.ServerAddress);
    }

    private async void Search_Changed(object sender, TextChangedEventArgs e)
    {
        searchCancellation?.Cancel(); searchCancellation = new CancellationTokenSource();
        var query = SearchBox.Text.Trim();
        if (query.Length == 0) { SearchSection.Visibility = Visibility.Collapsed; return; }
        if (api == null || profile == null) return;
        try { await Task.Delay(250, searchCancellation.Token); SearchItems.ItemsSource = await api.Search(query, profile.Id, searchCancellation.Token); SearchSection.Visibility = Visibility.Visible; }
        catch (OperationCanceledException) { } catch (Exception error) { SetStatus(error.Message, true); }
    }

    private async void Media_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not MediaItem media || api == null || profile == null) return;
        try { new DetailsWindow(api, profile, await api.Details(media.CatalogId ?? media.Id, profile.Id), Play) { Owner = this }.ShowDialog(); await LoadHome(); }
        catch (Exception error) { SetStatus(error.Message, true); }
    }

    private void HeroPlay_Click(object sender, RoutedEventArgs e) { if (featured != null) Play(featured); }
    private async void HeroInfo_Click(object sender, RoutedEventArgs e) { if (featured == null || api == null || profile == null) return; try { new DetailsWindow(api, profile, await api.Details(featured.CatalogId ?? featured.Id, profile.Id), Play) { Owner = this }.ShowDialog(); } catch (Exception error) { SetStatus(error.Message, true); } }
    private void Play(MediaItem media)
    {
        if (api == null || profile == null) return;
        var id = media.PlayableMediaId ?? (media.Kind == "show" ? null : media.Id);
        if (id == null) return;
        new PlayerWindow(api, profile, media with { Id = id }) { Owner = this }.ShowDialog();
    }
    private void SetStatus(string? text, bool error = false) { StatusText.Text = text ?? ""; StatusText.Foreground = error ? System.Windows.Media.Brushes.LightCoral : System.Windows.Media.Brushes.White; StatusBar.Visibility = text == null ? Visibility.Collapsed : Visibility.Visible; }
}
