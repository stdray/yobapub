using LiteDB;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy;

public class VipLoginEntry
{
    public ObjectId Id { get; set; } = ObjectId.NewObjectId();
    public string Login { get; set; } = "";
    public DateTimeOffset AddedAt { get; set; }
}

public class VipLoginStore : IDisposable
{
    private readonly LiteDatabase _db;
    private readonly ILiteCollection<VipLoginEntry> _col;

    public VipLoginStore(IOptions<AdminOptions> options)
    {
        var dbPath = options.Value.VipLoginsDbPath;
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _db = new LiteDatabase(dbPath);
        _col = _db.GetCollection<VipLoginEntry>("vipLogins");
        _col.EnsureIndex(x => x.Login, true);
    }

    public bool Add(string login)
    {
        login = login.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(login)) return false;
        if (_col.Exists(x => x.Login == login)) return false;
        _col.Insert(new VipLoginEntry { Login = login, AddedAt = DateTimeOffset.UtcNow });
        return true;
    }

    public bool Remove(string login)
    {
        login = login.Trim().ToLowerInvariant();
        return _col.DeleteMany(x => x.Login == login) > 0;
    }

    public List<VipLoginEntry> GetAll() =>
        _col.Query().OrderByDescending(x => x.AddedAt).ToList();

    public bool Contains(string login) =>
        _col.Exists(x => x.Login == login.Trim().ToLowerInvariant());

    public void Dispose() => _db.Dispose();
}
