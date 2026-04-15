namespace YobaPub.Proxy.Models;

public class LogShare
{
    public Guid Id { get; set; }
    public FieldFilter<string>[] Filters { get; set; } = [];
    public string Search { get; set; } = "";
    public int PageSize { get; set; } = 100;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

public class SharedLogsViewModel
{
    public required LogEntry[] Entries { get; init; }
    public required LogsQuery Query { get; init; }
    public required ShortGuid Token { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public bool HasMore { get; init; }
}
