namespace YobaPub.Proxy;

public class AdminOptions
{
    public string Username { get; init; } = "admin";
    public string Password { get; init; } = "secret";
    public string LogsDbPath { get; init; } = "/logs/logs.litedb";
    public int RetentionDays { get; init; } = 60;
}
