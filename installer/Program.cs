using Avalonia;
using DevilConnectionModLoaderInstaller.Core;

namespace DevilConnectionModLoaderInstaller;

sealed class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        if (Array.IndexOf(args, "--auto") >= 0)
        {
            Environment.Exit(AutoInstaller.RunFromArgs(args));
            return;
        }
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
