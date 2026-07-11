using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace DevilConnectionModLoaderInstaller.Core;

public sealed class AutoConfig
{
    public string GameExe { get; set; } = "";
    public int WaitPid { get; set; }
    public bool Relaunch { get; set; } = true;
    public string Repo { get; set; } = "Luoyu-Wangchai/DevilConnection_ModLoader";
    public bool Beta { get; set; }
}

public static class AutoInstaller
{
    private static string LogPath => Path.Combine(Path.GetTempPath(), "dcml_autoupdate.log");

    public static int RunFromArgs(string[] args)
    {
        string? configPath = null;
        for (int i = 0; i < args.Length; i++)
            if (args[i] == "--config" && i + 1 < args.Length) configPath = args[i + 1];

        void Log(string m)
        {
            try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss") + "  " + m + "\n", Encoding.UTF8); } catch { }
        }
        try { File.WriteAllText(LogPath, "", Encoding.UTF8); } catch { }

        AutoConfig cfg;
        try
        {
            if (configPath is null || !File.Exists(configPath))
                throw new InvalidOperationException("缺少 --config 配置文件");
            cfg = JsonSerializer.Deserialize<AutoConfig>(File.ReadAllText(configPath))
                  ?? throw new InvalidOperationException("配置文件解析为空");
        }
        catch (Exception ex) { Log("❌ 读取配置失败: " + ex.Message); return 1; }

        try
        {
            Log($"自动更新开始 (waitPid={cfg.WaitPid}, beta={cfg.Beta})");
            Log("game=" + cfg.GameExe);

            WaitForPid(cfg.WaitPid, Log);
            WaitForGameExit(Log);

            var inst = new ModLoaderInstaller(cfg.GameExe);
            string cacheZip = Path.Combine(inst.GameRoot, ".dcml_cache", "installer_runtime.zip");
            string? runtimeZip = TryDownloadRuntime(cfg, Log);
            if (runtimeZip is not null)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(cacheZip)!);
                    File.Copy(runtimeZip, cacheZip, true);
                    Log("已缓存本次运行时（供下次云端失败时兜底，避免回退旧版）。");
                }
                catch (Exception ex) { Log("缓存运行时失败(不影响安装): " + ex.Message); }
            }
            else if (File.Exists(cacheZip))
            {
                Log("云端不可用，改用上次成功缓存的运行时。");
                runtimeZip = cacheZip;
            }
            string? toDelete = (runtimeZip is not null && runtimeZip != cacheZip) ? runtimeZip : null;
            try
            {
                string msg = inst.Install(Log, runtimeZip, checkRunning: false, allowDowngrade: false);
                Log("✅ " + msg);
            }
            finally { if (toDelete is not null) { try { File.Delete(toDelete); } catch { } } }

            if (cfg.Relaunch)
            {
                Log("正在重启游戏...");
                try { GameLocator.Launch(cfg.GameExe); } catch (Exception ex) { Log("重启失败: " + ex.Message); }
            }
            try { if (configPath is not null) File.Delete(configPath); } catch { }
            return 0;
        }
        catch (Exception ex)
        {
            Log("❌ 自动更新失败: " + ex);
            return 1;
        }
    }

    private static void WaitForPid(int pid, Action<string> log)
    {
        if (pid <= 0) return;
        try
        {
            var p = Process.GetProcessById(pid);
            log($"等待加载器进程 {pid} 退出...");
            if (!p.WaitForExit(60000)) log("等待超时，继续。");
        }
        catch { log($"进程 {pid} 已不存在。"); }
    }

    private static void WaitForGameExit(Action<string> log)
    {
        for (int i = 0; i < 60; i++)
        {
            if (!GameLocator.IsGameRunning()) return;
            Thread.Sleep(500);
        }
        log("⚠ 游戏进程仍在，强制结束以释放文件锁...");
        GameLocator.KillGameProcesses();
        Thread.Sleep(1500);
    }

    private static string? TryDownloadRuntime(AutoConfig cfg, Action<string> log)
    {
        try
        {
            log("正在从云端获取最新运行时...");
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            http.DefaultRequestHeaders.Add("User-Agent", "DevilConnection-ModLoader-Installer");
            string api = $"https://api.github.com/repos/{cfg.Repo}/releases?per_page=30";
            string json = http.GetStringAsync(api).GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(json);
            string? url = PickRuntimeUrl(doc.RootElement, cfg.Beta);
            if (url is null) { log("云端无 runtime.zip 资产，使用内置运行时。"); return null; }
            var bytes = http.GetByteArrayAsync(url).GetAwaiter().GetResult();
            string tmp = Path.Combine(Path.GetTempPath(), "dcml_runtime_" + Guid.NewGuid().ToString("N") + ".zip");
            File.WriteAllBytes(tmp, bytes);
            log($"云端运行时下载完成 ({bytes.Length / 1024} KB)。");
            return tmp;
        }
        catch (Exception ex) { log("云端获取失败，使用内置运行时: " + ex.Message); return null; }
    }

    // 选目标 release 的 runtime.zip 下载地址：按 beta 通道（tag 首字符 B = Beta）过滤，取最新一个带 runtime.zip 的
    private static string? PickRuntimeUrl(JsonElement releases, bool beta)
    {
        if (releases.ValueKind != JsonValueKind.Array) return null;
        foreach (var rel in releases.EnumerateArray())
        {
            string tag = rel.TryGetProperty("tag_name", out var t) ? (t.GetString() ?? "") : "";
            bool isBeta = tag.StartsWith("B", StringComparison.OrdinalIgnoreCase);
            if (!beta && isBeta) continue;
            if (!rel.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) continue;
            foreach (var a in assets.EnumerateArray())
            {
                string name = a.TryGetProperty("name", out var n) ? (n.GetString() ?? "") : "";
                if (name.Equals("runtime.zip", StringComparison.OrdinalIgnoreCase)
                    && a.TryGetProperty("browser_download_url", out var u))
                    return u.GetString();
            }
        }
        return null;
    }
}
