using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace DevilConnectionModLoaderInstaller.Core;

public static class AsarArchive
{

    public static void Pack(string srcDir, string outAsar)
    {
        srcDir = Path.GetFullPath(srcDir);
        var fileList = new List<(string fullPath, long size)>();
        var root = BuildNode(srcDir, fileList, out _);

        long offset = 0;
        var offsets = new Dictionary<string, long>();
        foreach (var (full, size) in fileList)
        {
            offsets[full] = offset;
            offset += size;
        }

        string json = SerializeNode(root, offsets);
        byte[] jsonBytes = Encoding.UTF8.GetBytes(json);
        int jsonLen = jsonBytes.Length;
        int payloadSize = Align4(4 + jsonLen);
        int pad = payloadSize - (4 + jsonLen);

        using var outStream = new FileStream(outAsar, FileMode.Create, FileAccess.Write);
        using var w = new BinaryWriter(outStream);

        int headerPickleLen = 4 + payloadSize;

        w.Write((uint)4);
        w.Write((uint)headerPickleLen);

        w.Write((uint)payloadSize);
        w.Write((uint)jsonLen);
        w.Write(jsonBytes);
        for (int i = 0; i < pad; i++) w.Write((byte)0);

        foreach (var (full, _) in fileList)
        {
            using var fs = new FileStream(full, FileMode.Open, FileAccess.Read);
            fs.CopyTo(outStream);
        }
    }

    private sealed class Node
    {
        public bool IsDir;
        public string FullPath = "";
        public long Size;
        public SortedDictionary<string, Node> Children = new(StringComparer.Ordinal);
    }

    private static Node BuildNode(string dir, List<(string, long)> fileList, out long _)
    {
        _ = 0;
        var node = new Node { IsDir = true };

        foreach (var entryPath in Directory.GetFileSystemEntries(dir).OrderBy(p => Path.GetFileName(p), StringComparer.Ordinal))
        {
            string name = Path.GetFileName(entryPath);
            if (Directory.Exists(entryPath))
            {
                node.Children[name] = BuildNode(entryPath, fileList, out _);
            }
            else
            {
                var fi = new FileInfo(entryPath);
                var child = new Node { IsDir = false, FullPath = entryPath, Size = fi.Length };
                node.Children[name] = child;
                fileList.Add((entryPath, fi.Length));
            }
        }
        return node;
    }

    private static string SerializeNode(Node node, Dictionary<string, long> offsets)
    {
        var sb = new StringBuilder();
        WriteNode(sb, node, offsets);
        return sb.ToString();
    }

    private static void WriteNode(StringBuilder sb, Node node, Dictionary<string, long> offsets)
    {
        sb.Append("{\"files\":{");
        bool first = true;
        foreach (var kv in node.Children)
        {
            if (!first) sb.Append(',');
            first = false;
            sb.Append(JsonString(kv.Key)).Append(':');
            var c = kv.Value;
            if (c.IsDir)
            {
                WriteNode(sb, c, offsets);
            }
            else
            {
                sb.Append("{\"size\":").Append(c.Size)
                  .Append(",\"offset\":\"").Append(offsets[c.FullPath]).Append('"').Append('}');
            }
        }
        sb.Append("}}");
    }

    private static string JsonString(string s)
    {
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                    else sb.Append(ch);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    private static int Align4(int n) => (n + 3) & ~3;

    public static (string json, long dataBase) ReadHeader(string asarPath)
    {
        using var fs = new FileStream(asarPath, FileMode.Open, FileAccess.Read);
        using var r = new BinaryReader(fs);
        r.ReadUInt32();
        uint headerPickleLen = r.ReadUInt32();
        r.ReadUInt32();
        uint jsonLen = r.ReadUInt32();
        byte[] jsonBytes = r.ReadBytes((int)jsonLen);
        long dataBase = 8 + headerPickleLen;
        return (Encoding.UTF8.GetString(jsonBytes), dataBase);
    }
}
