namespace YobaPub.Proxy.Models;

public class LogsQuery
{
    public string? Level { get; init; }
    public string? Device { get; init; }
    public string? TraceId { get; init; }
    public string? Search { get; init; }
    public string? Before { get; init; }
    public string? After { get; init; }
    public int PageSize { get; init; } = 100;
}

public class LogsViewModel
{
    public required LogEntry[] Entries { get; init; }
    public required LogsQuery Query { get; init; }
    public int Total { get; init; }
    public bool HasMore { get; init; }
    public string? TopId { get; init; }
    public string? LastId { get; init; }
}
