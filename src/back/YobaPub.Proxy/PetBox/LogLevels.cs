namespace YobaPub.Proxy.PetBox;

// Level ranks shared by the relay backstop filter and /api/log-config. Mirrors the
// TV client's level union (Verbose..Error) plus Off/None as a per-device kill switch.
public static class LogLevels
{
    const int DefaultRank = 2; // Information
    const int OffRank = 6;

    static readonly Dictionary<string, int> Ranks = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Verbose"] = 0,
        ["Debug"] = 1,
        ["Information"] = 2,
        ["Warning"] = 3,
        ["Error"] = 4,
        ["Fatal"] = 5,
        ["Off"] = OffRank,
        ["None"] = OffRank,
    };

    public static bool IsEnabled(string eventLevel, string threshold) =>
        RankOf(threshold) < OffRank && RankOf(eventLevel) >= RankOf(threshold);

    static int RankOf(string level) => Ranks.TryGetValue(level, out var rank) ? rank : DefaultRank;
}
