using System.Windows;
using LibVLCSharp.Shared;
using System.IO;
using System.Runtime.InteropServices;
using System.Media;

namespace FlixTunes.Windows;

public partial class App : Application
{
    public App()
    {
        DispatcherUnhandledException += (_, args) =>
        {
            WriteCrashLog(args.Exception);
            MessageBox.Show($"Une erreur d'interface est survenue.\n\n{args.Exception.Message}\n\nLe diagnostic se trouve dans le dossier local FlixTunes.",
                "FlixTunes", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
        };
    }

    private static void WriteCrashLog(Exception error)
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FlixTunes");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "crash.log"), $"{DateTimeOffset.Now:O}\n{error}");
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        try
        {
            var architecture = RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "win-arm64" : "win-x64";
            Core.Initialize(Path.Combine(AppContext.BaseDirectory, "libvlc", architecture));
            var soundPath = Path.Combine(AppContext.BaseDirectory, "Assets", "flixtunes-startup.wav");
            if (File.Exists(soundPath)) new SoundPlayer(soundPath).Play();
            base.OnStartup(e);
        }
        catch (Exception error)
        {
            WriteCrashLog(error);
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FlixTunes");
            MessageBox.Show(
                $"Le moteur vidéo natif n'a pas pu démarrer.\n\n{error.Message}\n\nUn diagnostic a été enregistré dans {directory}.",
                "FlixTunes", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}
