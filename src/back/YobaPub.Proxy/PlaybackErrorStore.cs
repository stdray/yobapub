using LiteDB;
using Microsoft.Extensions.Options;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy;

public class PlaybackErrorStore : IDisposable
{
    private readonly LiteDatabase _db;
    private readonly ILiteCollection<PlaybackErrorEntry> _col;
    private const int Max = 5000;

    public PlaybackErrorStore(IOptions<AdminOptions> options)
    {
        var dbPath = options.Value.PlaybackErrorsDbPath;
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _db = new LiteDatabase(dbPath);
        _col = _db.GetCollection<PlaybackErrorEntry>("playbackErrors");
        _col.EnsureIndex(x => x.Domain);
        _col.EnsureIndex(x => x.DeviceId);
        _col.EnsureIndex(x => x.ServerTs);
    }

    public void Add(PlaybackErrorEntry entry)
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

    public DomainErrorGroup[] GetGroupedByDomain()
    {
        var all = _col.Query().OrderByDescending(x => x.ServerTs).ToList();
        return all
            .GroupBy(x => x.Domain)
            .Select(g => new DomainErrorGroup
            {
                Domain = g.Key,
                TotalErrors = g.Count(),
                LastSeen = g.Max(x => x.ServerTs),
                Devices = g
                    .GroupBy(x => x.DeviceId)
                    .Select(dg =>
                    {
                        var latest = dg.First();
                        return new DeviceErrorInfo
                        {
                            DeviceId = dg.Key,
                            UserAgent = latest.UserAgent,
                            Count = dg.Count(),
                            LastSeen = dg.Max(x => x.ServerTs),
                            LastError = latest.ErrorDetails
                        };
                    })
                    .OrderByDescending(x => x.LastSeen)
                    .ToArray()
            })
            .OrderByDescending(x => x.LastSeen)
            .ToArray();
    }

    public int DeleteOlderThan(DateTimeOffset cutoff) =>
        _col.DeleteMany(x => x.ServerTs < cutoff);

    public int DeleteAll() => _col.DeleteAll();

    public void Dispose() => _db.Dispose();
}
