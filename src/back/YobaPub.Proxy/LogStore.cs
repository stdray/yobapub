using LiteDB;
using Microsoft.Extensions.Options;
using System.Text.Json.Serialization;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy;

public class LogEntry
{
    [JsonIgnore]
    public ObjectId Id { get; set; } = ObjectId.NewObjectId();
    public DateTimeOffset ServerTs { get; set; }
    public long ClientTs { get; set; }
    public string Level { get; set; } = "";
    public string Category { get; set; } = "";
    public string Message { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string ClientIp { get; set; } = "";
    public string TraceId { get; set; } = "";
    public string StackTrace { get; set; } = "";
    public string Props { get; set; } = "{}";
}

public class LogStore : IDisposable
{
    private readonly LiteDatabase _db;
    private readonly ILiteCollection<LogEntry> _col;
    private const int Max = 2000;

    public LogStore(IOptions<AdminOptions> options)
    {
        var dbPath = options.Value.LogsDbPath;
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _db = new LiteDatabase(dbPath);
        _col = _db.GetCollection<LogEntry>("logs");
        _col.EnsureIndex(x => x.ServerTs);
        _col.EnsureIndex(x => x.DeviceId);
        _col.EnsureIndex(x => x.TraceId);
    }

    public void Add(LogEntry entry)
    {
        _col.Insert(entry);
        var count = _col.Count();
        if (count > Max)
        {
            var oldest = _col.Query()
                .OrderBy(x => x.ServerTs)
                .Limit(count - Max)
                .ToList()
                .ConvertAll(x => x.Id);
            _col.DeleteMany(x => oldest.Contains(x.Id));
        }
    }

    public LogEntry[] GetAll() =>
        _col.Query().OrderBy(x => x.ServerTs).ToArray();

    private static IEnumerable<LogEntry> ApplyFilters(IEnumerable<LogEntry> rows, LogsQuery q)
    {
        if (!string.IsNullOrEmpty(q.Level))
            rows = rows.Where(x => x.Level == q.Level);
        if (!string.IsNullOrEmpty(q.Device))
            rows = rows.Where(x => x.DeviceId.StartsWith(q.Device, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(q.TraceId))
            rows = rows.Where(x => q.TraceId.Equals(x.TraceId, StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(q.Search))
        {
            var s = q.Search;
            rows = rows.Where(x =>
                (x.Message ?? "").Contains(s, StringComparison.OrdinalIgnoreCase) ||
                (x.Category ?? "").Contains(s, StringComparison.OrdinalIgnoreCase) ||
                (x.DeviceId ?? "").Contains(s, StringComparison.OrdinalIgnoreCase) ||
                (x.ClientIp ?? "").Contains(s, StringComparison.OrdinalIgnoreCase) ||
                (x.TraceId ?? "").Contains(s, StringComparison.OrdinalIgnoreCase) ||
                (x.Level ?? "").Contains(s, StringComparison.OrdinalIgnoreCase));
        }
        return rows;
    }

    public (LogEntry[] Entries, int Total) Query(LogsQuery q)
    {
        var pageSize = Math.Clamp(q.PageSize > 0 ? q.PageSize : 100, 1, 500);
        var page     = Math.Max(1, q.Page);

        var rows = ApplyFilters(
            _col.Query().OrderByDescending(x => x.ServerTs).ToList(), q);

        var list    = rows.ToList();
        var total   = list.Count;
        var entries = list.Skip((page - 1) * pageSize).Take(pageSize).ToArray();
        return (entries, total);
    }

    public LogEntry? FindById(string id)
    {
        try { return _col.FindById(new ObjectId(id)); }
        catch { return null; }
    }

    public LogEntry[] QueryAll(LogsQuery q) =>
        ApplyFilters(
            _col.Query().OrderByDescending(x => x.ServerTs).ToList(), q).ToArray();

    public int DeleteOlderThan(DateTimeOffset cutoff) =>
        _col.DeleteMany(x => x.ServerTs < cutoff);

    public int DeleteAll() => _col.DeleteAll();

    public void Dispose() => _db.Dispose();
}
