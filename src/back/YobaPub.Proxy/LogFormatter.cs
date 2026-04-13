using System.Text;

namespace YobaPub.Proxy;

public static class LogFormatter
{
    public static string FormatTsv(LogEntry[] entries, bool includeIp)
    {
        var sb = new StringBuilder();
        sb.Append("Time\tDevice\tTraceId\t");
        if (includeIp) sb.Append("IP\t");
        sb.AppendLine("Level\tCategory\tMessage\tStackTrace");
        foreach (var e in entries)
        {
            var st = (e.StackTrace ?? "").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");
            sb.Append($"{e.ServerTs.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}\t{e.DeviceId}\t{e.TraceId ?? ""}\t");
            if (includeIp) sb.Append($"{e.ClientIp}\t");
            sb.AppendLine($"{e.Level}\t{e.Category}\t{e.Message}\t{st}");
        }
        return sb.ToString();
    }

    public static string FormatEntry(LogEntry e)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Time: {e.ServerTs.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}");
        sb.AppendLine($"Device: {e.DeviceId}");
        if (!string.IsNullOrEmpty(e.TraceId)) sb.AppendLine($"TraceId: {e.TraceId}");
        sb.AppendLine($"IP: {e.ClientIp}");
        sb.AppendLine($"Level: {e.Level}");
        sb.AppendLine($"Category: {e.Category}");
        sb.AppendLine($"Message: {e.Message}");
        if (!string.IsNullOrEmpty(e.Props) && e.Props != "{}") sb.AppendLine($"Props: {e.Props}");
        if (!string.IsNullOrEmpty(e.StackTrace)) sb.AppendLine($"StackTrace:\n{e.StackTrace}");
        return sb.ToString();
    }
}
