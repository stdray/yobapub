using LiteDB;

namespace YobaPub.Proxy;

public class UserSettings
{
    [BsonId]
    public string Login { get; set; } = "";
    public double TimeZoneOffsetHours { get; set; } = 3;

    [BsonIgnore]
    public TimeSpan TimeZoneOffset => TimeSpan.FromHours(TimeZoneOffsetHours);
}

public class UserSettingsStore
{
    private readonly ILiteCollection<UserSettings> _col;

    public UserSettingsStore(MainDb db)
    {
        _col = db.GetCollection<UserSettings>("user_settings");
    }

    public UserSettings Get(string login) =>
        _col.FindById(login) ?? new UserSettings { Login = login };

    public void Save(UserSettings settings) =>
        _col.Upsert(settings);
}
