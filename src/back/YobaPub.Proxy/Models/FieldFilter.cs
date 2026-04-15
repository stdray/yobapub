using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Reflection;

namespace YobaPub.Proxy.Models;

public interface IFieldFilter
{
    string Field { get; }
    bool Apply(LogEntry entry);
}

public sealed record FieldFilter<T>(string Field, T[] Includes, T[] Excludes) : IFieldFilter
{
    public bool Apply(LogEntry entry)
    {
        var accessor = FieldAccessorCache.Get<T>(Field);
        var value = accessor(entry);
        if (Includes.Length > 0 && Array.IndexOf(Includes, value) < 0) return false;
        if (Excludes.Length > 0 && Array.IndexOf(Excludes, value) >= 0) return false;
        return true;
    }
}

public static class FieldAccessorCache
{
    private static readonly ConcurrentDictionary<(Type, string), Delegate> _cache = new();

    private static readonly HashSet<string> _allowed = new(StringComparer.Ordinal)
    {
        nameof(LogEntry.Level),
        nameof(LogEntry.Category),
        nameof(LogEntry.DeviceId),
        nameof(LogEntry.TraceId),
        nameof(LogEntry.ClientIp),
    };

    public static Func<LogEntry, T> Get<T>(string field) =>
        (Func<LogEntry, T>)_cache.GetOrAdd((typeof(T), field), k => Build<T>(k.Item2));

    private static Func<LogEntry, T> Build<T>(string field)
    {
        if (!_allowed.Contains(field))
            throw new ArgumentException($"Field not filterable: {field}");
        var prop = typeof(LogEntry).GetProperty(field, BindingFlags.Public | BindingFlags.Instance)
            ?? throw new ArgumentException($"Unknown log field: {field}");
        var p = Expression.Parameter(typeof(LogEntry), "x");
        Expression body = Expression.Property(p, prop);
        if (prop.PropertyType != typeof(T))
            body = Expression.Convert(body, typeof(T));
        return Expression.Lambda<Func<LogEntry, T>>(body, p).Compile();
    }
}
