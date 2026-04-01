using LiteDB;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy;

public class MainDb : IDisposable
{
    private readonly LiteDatabase _db;

    public MainDb(IOptions<AdminOptions> options)
    {
        var dbPath = options.Value.MainDbPath;
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
        _db = new LiteDatabase(dbPath);
    }

    public ILiteCollection<T> GetCollection<T>(string name) => _db.GetCollection<T>(name);

    public void Dispose() => _db.Dispose();
}
