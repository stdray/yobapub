using LiteDB;

namespace YobaPub.Proxy;

public class AppSettings
{
    [BsonId]
    public int Id { get; set; } = 1;
    public bool DebugEnabled { get; set; }
}

public class DebugSettingsStore
{
    private readonly ILiteCollection<AppSettings> _col;
    private volatile bool _enabled;

    public bool IsEnabled => _enabled;

    public DebugSettingsStore(MainDb db)
    {
        _col = db.GetCollection<AppSettings>("settings");
        _enabled = _col.FindById(1)?.DebugEnabled ?? false;
    }

    public void SetEnabled(bool enabled)
    {
        _enabled = enabled;
        var settings = _col.FindById(1) ?? new AppSettings();
        settings.DebugEnabled = enabled;
        _col.Upsert(settings);
    }
}
