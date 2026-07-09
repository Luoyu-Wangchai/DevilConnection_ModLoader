using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DevilConnectionModLoaderInstaller.Core;

public enum InstallStatus { NotInstalled, Installed, Unknown }

public sealed class ModLoaderInstaller
{
    public string GameRoot { get; }
    public string ResourcesDir => Path.Combine(GameRoot, "resources");
    public string AsarPath => Path.Combine(ResourcesDir, "app.asar");
    public string PluginsDir => Path.Combine(ResourcesDir, "plugins");
    public string BackupPath => Path.Combine(PluginsDir, "app.bak.asar");
    private string ModLoaderJs => Path.Combine(ResourcesDir, "ModLoader.js");
    private string ManagerJs => Path.Combine(ResourcesDir, "Manager.js");
    private string ManagerDir => Path.Combine(ResourcesDir, "manager");
    private string VersionJson => Path.Combine(ResourcesDir, "version.json");

    public ModLoaderInstaller(string gameRootOrExe)
    {

        if (File.Exists(gameRootOrExe) && gameRootOrExe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            GameRoot = Path.GetDirectoryName(gameRootOrExe)!;
        else
            GameRoot = gameRootOrExe;
    }

    public InstallStatus CheckStatus()
    {
        if (File.Exists(BackupPath)) return InstallStatus.Installed;
        if (File.Exists(AsarPath)) return InstallStatus.NotInstalled;
        return InstallStatus.Unknown;
    }

    // ---- 模组管理器版本检测（版本号单一真源 = version.json 的 "version"，如 1.2.1；显示时加 RV 前缀）----

    // 当前已部署到游戏的管理器版本（读 resources/version.json 的 version 数字，如 "1.2.1"）；未安装/读不到返回 null
    public string? GetInstalledVersion()
    {
        try { return File.Exists(VersionJson) ? ReadVersionFromJson(File.ReadAllText(VersionJson)) : null; }
        catch { return null; }
    }

    // 安装器内置（即将安装）的管理器版本（读内嵌 runtime.zip 里 external/version.json 的 version）
    public static string? GetBundledVersion()
    {
        try
        {
            var asm = Assembly.GetExecutingAssembly();
            string? resName = asm.GetManifestResourceNames()
                .FirstOrDefault(n => n.EndsWith("runtime.zip", StringComparison.OrdinalIgnoreCase));
            if (resName is null) return null;
            using var s = asm.GetManifestResourceStream(resName)!;
            using var zip = new ZipArchive(s, ZipArchiveMode.Read);
            // Compress-Archive 生成的条目是反斜杠路径，归一化后再匹配
            var entry = zip.Entries.FirstOrDefault(e => e.FullName.Replace('\\', '/') == "external/version.json");
            if (entry is null) return null;
            using var r = new StreamReader(entry.Open());
            return ReadVersionFromJson(r.ReadToEnd());
        }
        catch { return null; }
    }

    private static string? ReadVersionFromJson(string jsonText)
    {
        try
        {
            using var doc = JsonDocument.Parse(jsonText);
            if (doc.RootElement.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.String)
                return v.GetString();
        }
        catch { }
        return null;
    }

    // 比较两个版本串（容忍 RV/v 前缀，抽数字段逐段比）：a<b→-1, a>b→1, 相等→0
    public static int CompareVersions(string? a, string? b)
    {
        int[] pa = ParseVer(a), pb = ParseVer(b);
        int len = Math.Max(pa.Length, pb.Length);
        for (int i = 0; i < len; i++)
        {
            int x = i < pa.Length ? pa[i] : 0;
            int y = i < pb.Length ? pb[i] : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        return 0;
    }

    private static int[] ParseVer(string? s)
    {
        var m = Regex.Match(s ?? "", @"\d+(?:\.\d+)*");
        return m.Success
            ? m.Value.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray()
            : new[] { 0 };
    }

    public delegate void Progress(string message);

    public string Install(Progress? log = null)
    {
        log ??= _ => { };
        if (GameLocator.IsGameRunning())
            throw new InvalidOperationException("检测到游戏正在运行，请先完全关闭游戏后再安装。");

        var status = CheckStatus();
        if (status == InstallStatus.Unknown)
            throw new InvalidOperationException($"未找到游戏核心文件 app.asar：\n{AsarPath}");

        Directory.CreateDirectory(PluginsDir);

        string temp = Path.Combine(Path.GetTempPath(), "dcml_payload_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            log("正在释放运行时资源...");
            ExtractEmbeddedRuntime(temp);
            string shellDir = Path.Combine(temp, "shell");
            string externalDir = Path.Combine(temp, "external");
            if (!Directory.Exists(shellDir) || !File.Exists(Path.Combine(shellDir, "main.js")))
                throw new InvalidOperationException("内嵌运行时资源损坏（缺少 shell/main.js）。");

            if (status == InstallStatus.NotInstalled)
            {
                log("正在备份原版 app.asar → plugins/app.bak.asar（大文件，请耐心等待）...");
                try
                {
                    File.Move(AsarPath, BackupPath);
                }
                catch (IOException ex) when (IsLocked(ex))
                {
                    throw new InvalidOperationException("无法备份：app.asar 被占用，请确认游戏已完全关闭。");
                }
            }

            log("正在打包加载器壳 app.asar ...");
            string tmpAsar = AsarPath + ".tmp";
            AsarArchive.Pack(shellDir, tmpAsar);
            if (File.Exists(AsarPath)) File.Delete(AsarPath);
            File.Move(tmpAsar, AsarPath);

            log("正在部署 ModLoader.js / Manager.js / 管理面板 ...");
            File.Copy(Path.Combine(externalDir, "ModLoader.js"), ModLoaderJs, true);
            File.Copy(Path.Combine(externalDir, "Manager.js"), ManagerJs, true);
            CopyDir(Path.Combine(externalDir, "manager"), ManagerDir);
            string versionSrc = Path.Combine(externalDir, "version.json");
            if (File.Exists(versionSrc)) File.Copy(versionSrc, VersionJson, true);

            log("完成。");
            return status == InstallStatus.Installed ? "ModLoader 已更新。" : "ModLoader 安装成功。";
        }
        finally
        {
            TryDeleteDir(temp);
        }
    }

    public string Uninstall(Progress? log = null)
    {
        log ??= _ => { };
        if (GameLocator.IsGameRunning())
            throw new InvalidOperationException("检测到游戏正在运行，请先完全关闭游戏后再卸载。");

        if (!File.Exists(BackupPath))
            throw new InvalidOperationException("未发现备份 plugins/app.bak.asar，无需还原。");

        log("正在还原原版 app.asar ...");
        try
        {
            if (File.Exists(AsarPath)) File.Delete(AsarPath);
            File.Move(BackupPath, AsarPath);
        }
        catch (IOException ex) when (IsLocked(ex))
        {
            throw new InvalidOperationException("无法还原：文件被占用，请确认游戏已完全关闭。");
        }

        log("正在清除加载器文件 ...");
        TryDelete(ModLoaderJs);
        TryDelete(ManagerJs);
        TryDeleteDir(ManagerDir);
        TryDelete(VersionJson);
        TryDelete(Path.Combine(ResourcesDir, "mod_loader.log"));

        log("完成。");
        return "已还原原版游戏。";
    }

    private static void ExtractEmbeddedRuntime(string destDir)
    {
        var asm = Assembly.GetExecutingAssembly();
        string resName = asm.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("runtime.zip", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("未找到内嵌 runtime.zip 资源。");
        using var s = asm.GetManifestResourceStream(resName)!;
        using var zip = new ZipArchive(s, ZipArchiveMode.Read);
        zip.ExtractToDirectory(destDir, true);
    }

    private static void CopyDir(string src, string dst)
    {
        if (Directory.Exists(dst)) Directory.Delete(dst, true);
        Directory.CreateDirectory(dst);
        foreach (string dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(dir.Replace(src, dst));
        foreach (string file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            File.Copy(file, file.Replace(src, dst), true);
    }

    private static bool IsLocked(IOException ex)
    {
        string m = ex.Message.ToLowerInvariant();
        return m.Contains("being used by another process") || m.Contains("拒绝访问")
            || m.Contains("access") || m.Contains("denied") || m.Contains("占用") || m.Contains("sharing violation");
    }

    private static void TryDelete(string p) { try { if (File.Exists(p)) File.Delete(p); } catch { } }
    private static void TryDeleteDir(string p) { try { if (Directory.Exists(p)) Directory.Delete(p, true); } catch { } }
}
