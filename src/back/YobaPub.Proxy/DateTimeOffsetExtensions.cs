namespace YobaPub.Proxy;

public static class DateTimeOffsetExtensions
{
    public static string FormatTime(this DateTimeOffset dt, TimeSpan offset) =>
        dt.ToOffset(offset).ToString("HH:mm:ss");

    public static string FormatFull(this DateTimeOffset dt, TimeSpan offset) =>
        dt.ToOffset(offset).ToString("yyyy-MM-dd HH:mm:ss");

    public static string FormatShort(this DateTimeOffset dt, TimeSpan offset) =>
        dt.ToOffset(offset).ToString("dd.MM HH:mm");
}
