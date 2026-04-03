namespace YobaPub.Proxy.Models;

public class LogsQuery
{
    public string? Level { get; init; }
    public string? Device { get; init; }
    public string? TraceId { get; init; }
    public string? Search { get; init; }
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 100;
}

public class LogsViewModel
{
    public required LogEntry[] Entries { get; init; }
    public required LogsQuery Query { get; init; }
    public int Total { get; init; }
    public int TotalPages { get; init; }
}
