using LiteDB;

namespace YobaPub.Proxy;

public class VipLoginEntry
{
    public ObjectId Id { get; set; } = ObjectId.NewObjectId();
    public string Login { get; set; } = "";
    public DateTimeOffset AddedAt { get; set; }
}

public class VipLoginStore
{
    private readonly ILiteCollection<VipLoginEntry> _col;

    public VipLoginStore(MainDb db)
    {
        _col = db.GetCollection<VipLoginEntry>("vipLogins");
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
}
