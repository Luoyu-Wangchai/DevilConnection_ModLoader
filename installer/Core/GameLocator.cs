using System.Diagnostics;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace DevilConnectionModLoaderInstaller.Core;

public static class GameLocator
{
    public const string ExeName = "DevilConnection.exe";
    private const string ProcessName = "DevilConnection";
    private const string FolderName = "でびるコネクショん";

    public static List<string> FindAllGameExes()
    {
        var list = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string lib in EnumerateSteamLibraries())
        {
            string common = Path.Combine(lib, "steamapps", "common");
            if (!Directory.Exists(common)) continue;
            string exact = Path.Combine(common, FolderName, ExeName);
            if (File.Exists(exact) && seen.Add(Path.GetFullPath(exact))) { list.Add(exact); continue; }
            foreach (string sub in SafeDirs(common))
            {
                string exe = Path.Combine(sub, ExeName);
                if (File.Exists(exe) && seen.Add(Path.GetFullPath(exe))) list.Add(exe);
            }
        }
        return list;
    }

    public static string? FindGameExe() => FindAllGameExes().FirstOrDefault();

    public static string? DetectFromSelf()
    {
        try
        {
            string exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? "") ?? "";
            foreach (string p in new[] { exeDir, Path.GetDirectoryName(exeDir) ?? "" })
            {
                if (string.IsNullOrEmpty(p)) continue;
                string exe = Path.Combine(p, ExeName);
                if (File.Exists(exe)) return exe;
            }
        }
        catch { }
        return null;
    }

    public static Process[] GetGameProcesses() => Process.GetProcessesByName(ProcessName);
    public static bool IsGameRunning() => GetGameProcesses().Length > 0;

    public static void KillGameProcesses()
    {
        foreach (var p in GetGameProcesses())
        {
            try { p.Kill(entireProcessTree: true); p.WaitForExit(5000); } catch { }
        }
    }

    public static void LaunchDebug(string exePath, int port = 9222)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = Path.GetDirectoryName(exePath),
            UseShellExecute = false
        };
        psi.ArgumentList.Add($"--remote-debugging-port={port}");
        Process.Start(psi);
    }

    public static void Launch(string exePath)
    {
        var psi = new ProcessStartInfo
        {
            FileName = exePath,
            WorkingDirectory = Path.GetDirectoryName(exePath),
            UseShellExecute = true
        };
        Process.Start(psi);
    }

    private static IEnumerable<string> EnumerateSteamLibraries()
    {
        string? steam = GetSteamPath();
        if (steam is null) yield break;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (seen.Add(steam)) yield return steam;
        string vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
        if (File.Exists(vdf))
        {
            string text = File.ReadAllText(vdf);
            foreach (Match m in Regex.Matches(text, "\"path\"\\s*\"([^\"]+)\""))
            {
                string p = m.Groups[1].Value.Replace(@"\\", @"\");
                if (Directory.Exists(p) && seen.Add(p)) yield return p;
            }
        }
    }

    private static string? GetSteamPath()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
            if (k?.GetValue("SteamPath") is string p && Directory.Exists(p)) return p;
        foreach (string sub in new[] { @"SOFTWARE\WOW6432Node\Valve\Steam", @"SOFTWARE\Valve\Steam" })
            using (var k = Registry.LocalMachine.OpenSubKey(sub))
                if (k?.GetValue("InstallPath") is string p && Directory.Exists(p)) return p;
        return null;
    }

    private static IEnumerable<string> SafeDirs(string path)
    {
        try { return Directory.EnumerateDirectories(path); }
        catch { return Array.Empty<string>(); }
    }
}
