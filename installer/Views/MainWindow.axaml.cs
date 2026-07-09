using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using DevilConnectionModLoaderInstaller.Core;

namespace DevilConnectionModLoaderInstaller.Views;

public partial class MainWindow : Window
{
    private string? _gameExe;
    private ModLoaderInstaller? _inst;
    private bool _busy;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await DetectAsync();
    }

    private async Task DetectAsync()
    {
        Log("正在定位游戏...");
        string? exe = await Task.Run(() => GameLocator.DetectFromSelf() ?? GameLocator.FindGameExe());
        if (exe is null)
        {
            PathText.Text = "未找到游戏，请点击「浏览...」手动指定 DevilConnection.exe";
            SetStatus(InstallStatus.Unknown, "未找到游戏");
            Log("未自动找到游戏。可把本工具放进游戏根目录，或手动浏览指定。");
            return;
        }
        SetGame(exe);
    }

    private void SetGame(string exe)
    {
        _gameExe = exe;
        _inst = new ModLoaderInstaller(exe);
        PathText.Text = _inst.GameRoot;
        var status = _inst.CheckStatus();
        SetStatus(status, status switch
        {
            InstallStatus.Installed => "ModLoader 已安装（可更新或卸载）",
            InstallStatus.NotInstalled => "原版游戏，尚未安装 ModLoader",
            _ => "目录异常：未找到 resources/app.asar"
        });
        UpdateVersionInfo(status);
        Log($"已定位游戏：{_inst.GameRoot}");
    }

    // 模组管理器版本检测：显示已装版本 vs 安装器内置版本，并给出升级/重装提示（版本号来自 version.json，显示加 RV 前缀）
    private void UpdateVersionInfo(InstallStatus status)
    {
        string? bundledRaw = ModLoaderInstaller.GetBundledVersion();
        string bundled = bundledRaw is null ? "未知" : "RV" + bundledRaw;
        if (_inst is not null && status == InstallStatus.Installed)
        {
            string? installedRaw = _inst.GetInstalledVersion();
            if (installedRaw is null)
            {
                VersionText.Text = $"已安装管理器（版本未知） · 安装器内置 {bundled}";
            }
            else
            {
                int cmp = ModLoaderInstaller.CompareVersions(installedRaw, bundledRaw ?? "");
                string rel = cmp < 0 ? "点「安装 / 更新」可升级"
                           : cmp > 0 ? "已安装版本更新，内置为旧版"
                           : "已是最新版本";
                VersionText.Text = $"已安装 RV{installedRaw} · 安装器内置 {bundled} —— {rel}";
            }
        }
        else if (status == InstallStatus.NotInstalled)
        {
            VersionText.Text = $"安装器内置管理器版本 {bundled}";
        }
        else
        {
            VersionText.Text = "";
        }
    }

    private void SetStatus(InstallStatus s, string hint)
    {
        (string txt, Color col) = s switch
        {
            InstallStatus.Installed => ("已安装", Color.Parse("#10b981")),
            InstallStatus.NotInstalled => ("未安装", Color.Parse("#f59e0b")),
            _ => ("未知", Color.Parse("#ef4444"))
        };
        StatusText.Text = txt;
        StatusBadge.Background = new SolidColorBrush(col);
        HintText.Text = hint;
        InstallBtn.IsEnabled = s != InstallStatus.Unknown && !_busy;
        UninstallBtn.IsEnabled = s == InstallStatus.Installed && !_busy;
    }

    private void Log(string msg)
    {
        Dispatcher.UIThread.Post(() =>
        {
            LogBox.Text = (LogBox.Text + "\n" + msg).TrimStart('\n');
            LogScroll.ScrollToEnd();
        });
    }

    private async void OnBrowse(object? sender, RoutedEventArgs e)
    {
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "选择 DevilConnection.exe",
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("DevilConnection.exe") { Patterns = new[] { "DevilConnection.exe" } },
                new FilePickerFileType("可执行文件") { Patterns = new[] { "*.exe" } }
            }
        });
        if (files.Count > 0)
        {
            string? p = files[0].TryGetLocalPath();
            if (p is not null) SetGame(p);
        }
    }

    private async void OnInstall(object? sender, RoutedEventArgs e)
    {
        if (_inst is null || _busy) return;
        if (GameLocator.IsGameRunning())
        {
            Log("⚠ 检测到游戏正在运行。请先关闭游戏。");
            return;
        }
        await RunBusy(async () =>
        {
            string msg = await Task.Run(() => _inst.Install(Log));
            Log("✅ " + msg);
        });
    }

    private async void OnUninstall(object? sender, RoutedEventArgs e)
    {
        if (_inst is null || _busy) return;
        await RunBusy(async () =>
        {
            string msg = await Task.Run(() => _inst.Uninstall(Log));
            Log("✅ " + msg);
        });
    }

    private async Task RunBusy(Func<Task> action)
    {
        _busy = true;
        InstallBtn.IsEnabled = UninstallBtn.IsEnabled = false;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            Log("❌ " + ex.Message);
        }
        finally
        {
            _busy = false;
            if (_inst is not null)
            {
                var s = _inst.CheckStatus();
                SetStatus(s, s switch
                {
                    InstallStatus.Installed => "ModLoader 已安装（可更新或卸载）",
                    InstallStatus.NotInstalled => "原版游戏，尚未安装 ModLoader",
                    _ => "目录异常：未找到 resources/app.asar"
                });
                UpdateVersionInfo(s);
            }
        }
    }

    private void OnLaunch(object? sender, RoutedEventArgs e)
    {
        if (_gameExe is null) { Log("未定位游戏。"); return; }
        try { GameLocator.Launch(_gameExe); Log("已启动游戏。游戏内按 F10 呼出模组管理面板。"); }
        catch (Exception ex) { Log("❌ 启动失败：" + ex.Message); }
    }

    private void OnOpenPlugins(object? sender, RoutedEventArgs e)
    {
        if (_inst is null) return;
        try
        {
            Directory.CreateDirectory(_inst.PluginsDir);
            Process.Start(new ProcessStartInfo { FileName = _inst.PluginsDir, UseShellExecute = true });
        }
        catch (Exception ex) { Log("❌ 打开失败：" + ex.Message); }
    }
}
