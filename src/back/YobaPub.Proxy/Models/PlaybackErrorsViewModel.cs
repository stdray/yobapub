namespace YobaPub.Proxy.Models;

public class DomainErrorGroup
{
    public required string Domain { get; init; }
    public int TotalErrors { get; init; }
    public DateTimeOffset LastSeen { get; init; }
    public required DeviceErrorInfo[] Devices { get; init; }
}

public class DeviceErrorInfo
{
    public required string DeviceId { get; init; }
    public required string UserAgent { get; init; }
    public int Count { get; init; }
    public DateTimeOffset LastSeen { get; init; }
    public required string LastError { get; init; }
}

public class PlaybackErrorsViewModel
{
    public required DomainErrorGroup[] Domains { get; init; }
    public int TotalEntries { get; init; }
}
