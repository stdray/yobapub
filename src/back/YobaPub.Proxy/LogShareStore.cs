using LiteDB;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy;

public class LogShareStore
{
    private readonly ILiteCollection<LogShare> _col;

    public LogShareStore(MainDb db)
    {
        _col = db.GetCollection<LogShare>("log_shares");
        _col.EnsureIndex(x => x.Id, unique: true);
    }

    public LogShare Create(LogsQuery query, TimeSpan? ttl, string createdBy)
    {
        var now = DateTimeOffset.UtcNow;
        var share = new LogShare
        {
            Id = Guid.NewGuid(),
            Filters = query.Filters ?? [],
            Search = query.Search ?? "",
            PageSize = query.PageSize > 0 ? query.PageSize : 100,
            CreatedAt = now,
            ExpiresAt = ttl.HasValue ? now.Add(ttl.Value) : null,
            CreatedBy = createdBy
        };
        _col.Insert(share);
        return share;
    }

    public int DeleteExpired()
    {
        var now = DateTimeOffset.UtcNow;
        return _col.DeleteMany(x => x.ExpiresAt.HasValue && x.ExpiresAt.Value < now);
    }

    public int DeleteAll() => _col.DeleteAll();

    public LogShare? Get(Guid token)
    {
        var share = _col.FindOne(x => x.Id == token);
        if (share == null) return null;
        if (share.ExpiresAt.HasValue && share.ExpiresAt.Value < DateTimeOffset.UtcNow)
            return null;
        return share;
    }

    public static LogsQuery ToQuery(LogShare share) => new()
    {
        Filters = share.Filters ?? [],
        Search = share.Search,
        PageSize = share.PageSize
    };
}
