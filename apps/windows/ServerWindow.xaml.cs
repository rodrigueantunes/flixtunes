using System.Windows;

namespace FlixTunes.Windows;

public partial class ServerWindow : Window
{
    public string ServerAddress => AddressBox.Text;
    private CancellationTokenSource? discovery;
    public ServerWindow(string current) { InitializeComponent(); AddressBox.Text = current; AddressBox.SelectAll(); AddressBox.Focus(); Loaded += async (_, _) => await Discover(); Closed += (_, _) => discovery?.Cancel(); }
    private async Task Discover()
    {
        discovery?.Cancel(); discovery = new CancellationTokenSource(); ServerList.ItemsSource = new[] { "Recherche en cours…" };
        try { var servers = await ServerDiscovery.Find(discovery.Token); ServerList.ItemsSource = servers.Count > 0 ? servers : new[] { "Aucun serveur trouvé — saisie manuelle disponible" }; }
        catch (OperationCanceledException) { } catch { ServerList.ItemsSource = new[] { "Découverte indisponible — saisie manuelle disponible" }; }
    }
    private async void Discover_Click(object sender, RoutedEventArgs e) => await Discover();
    private void Server_Selected(object sender, System.Windows.Controls.SelectionChangedEventArgs e) { if (ServerList.SelectedItem is DiscoveredServer server) AddressBox.Text = server.Address; }
    private void Connect_Click(object sender, RoutedEventArgs e)
    {
        try { _ = FlixTunes.Windows.ServerAddress.Normalize(AddressBox.Text); DialogResult = true; }
        catch (Exception error) { MessageBox.Show(this, error.Message, "Adresse invalide", MessageBoxButton.OK, MessageBoxImage.Warning); }
    }
}
