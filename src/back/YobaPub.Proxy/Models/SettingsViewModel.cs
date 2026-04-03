namespace YobaPub.Proxy.Models;

public class SettingsViewModel
{
    public required bool DebugEnabled { get; init; }
    public required UserSettings UserSettings { get; init; }
    public required int MaxLogEntries { get; init; }
}
