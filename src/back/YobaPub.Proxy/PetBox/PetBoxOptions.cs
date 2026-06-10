namespace YobaPub.Proxy.PetBox;

public class PetBoxOptions
{
    public string BaseUrl { get; init; } = "https://petbox.3po.su";

    // Secret; supplied via env PetBox__ApiKey. Empty key disables all PetBox integrations
    // (local dev without telemetry).
    public string ApiKey { get; init; } = "";

    public string ServiceKey { get; init; } = "yobapub-proxy";
    public string ProjectKey { get; init; } = "yobapub";
    public string ClientLogName { get; init; } = "clients";
    public string BackendLogName { get; init; } = "backend";

    // PetBox config binding paths (slash-keyed, see PetBoxConfValues).
    public string ClientLevelConfKey { get; init; } = "client-log/level";
    public string VipLoginsConfKey { get; init; } = "vip/logins";

    public int DeviceLevelCacheTtlSeconds { get; init; } = 60;
    public int ConfigRefreshSeconds { get; init; } = 60;
    public string FallbackClientLogLevel { get; init; } = "Information";

    public int RelayQueueCapacity { get; init; } = 5000;
    public int RelayBatchSize { get; init; } = 200;
    public int RelayFlushIntervalSeconds { get; init; } = 2;
}

public static class PetBoxHttp
{
    // Named HttpClient with BaseAddress + X-Api-Key preconfigured (see Program.cs).
    public const string ClientName = "petbox";
}
