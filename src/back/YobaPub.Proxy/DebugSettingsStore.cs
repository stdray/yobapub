using LiteDB;

namespace YobaPub.Proxy;

public class AppSettings
{
    [BsonId]
    public int Id { get; set; } = 1;
    public bool DebugEnabled { get; set; }
    public int MaxLogEntries { get; set; } = 2000;
}

public class DebugSettingsStore
{
    private readonly ILiteCollection<AppSettings> _col;
    private volatile bool _enabled;
    private volatile int _maxLogEntries;

    public bool IsEnabled => _enabled;
    public int MaxLogEntries => _maxLogEntries;

    public DebugSettingsStore(MainDb db)
    {
        _col = db.GetCollection<AppSettings>("settings");
        var s = _col.FindById(1) ?? new AppSettings();
        _enabled = s.DebugEnabled;
        _maxLogEntries = s.MaxLogEntries;
    }

    public void SetEnabled(bool enabled)
    {
        _enabled = enabled;
        Update(s => s.DebugEnabled = enabled);
    }

    public void SetMaxLogEntries(int max)
    {
        _maxLogEntries = max;
        Update(s => s.MaxLogEntries = max);
    }

    private void Update(Action<AppSettings> apply)
    {
        var s = _col.FindById(1) ?? new AppSettings();
        apply(s);
        _col.Upsert(s);
    }
}
