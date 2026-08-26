using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;

namespace FlixTunes.Windows;

public partial class DetailsWindow : Window
{
    private readonly FlixTunesApi api; private readonly Profile profile; private readonly MediaDetails details; private readonly Action<MediaItem> play;
    public DetailsWindow(FlixTunesApi api, Profile profile, MediaDetails details, Action<MediaItem> play)
    {
        InitializeComponent(); this.api = api; this.profile = profile; this.details = details; this.play = play;
        var item = details.Item; Title = item.DisplayTitle; TitleText.Text = item.DisplayTitle; Kind.Text = item.Kind == "show" ? "SÉRIE" : item.Kind == "episode" ? "ÉPISODE" : "FILM"; Meta.Text = item.Meta; Overview.Text = item.Overview ?? "Aucun résumé disponible."; WatchedButton.Visibility = item.Kind == "show" ? Visibility.Collapsed : Visibility.Visible; WatchedButton.Content = item.Completed ? "Marquer non vu" : "✓ Marquer vu";
        if (item.BackdropUrl != null) Backdrop.Source = new BitmapImage(api.Resolve(item.BackdropUrl));
        SeasonBox.ItemsSource = details.Seasons; SeasonBox.DisplayMemberPath = "Title"; SeasonBox.SelectedIndex = details.Seasons.Count > 0 ? 0 : -1; SeasonBox.Visibility = details.Seasons.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }
    private void Play_Click(object sender, RoutedEventArgs e) => play(details.Item.Kind == "show" ? details.Seasons.SelectMany(s => s.Episodes).FirstOrDefault() ?? details.Item : details.Item);
    private void Episode_Click(object sender, RoutedEventArgs e) { if ((sender as Button)?.Tag is MediaItem media) play(media); }
    private void Season_Changed(object sender, SelectionChangedEventArgs e) { if (SeasonBox.SelectedItem is SeasonDetails season) EpisodeItems.ItemsSource = season.Episodes; }
    private async void Watched_Click(object sender, RoutedEventArgs e)
    {
        var item = details.Item; if (item.Kind == "show") return;
        try { if (item.Completed) await api.DeleteProgress(item.Id, profile.Id); else await api.SaveProgress(item.Id, profile.Id, 1, 1); Close(); } catch (Exception error) { MessageBox.Show(this, error.Message, "FlixTunes", MessageBoxButton.OK, MessageBoxImage.Warning); }
    }
    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
