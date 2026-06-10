using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy.PetBox;

// Resolves the effective client log level for a device from PetBox config:
// GET /v1/conf?device={id} — a binding tagged device:{id} overrides the project
// default server-side (most specific tag-set wins). Per-device cache with TTL +
// ETag revalidation; serves stale values while PetBox is unreachable; falls back
// to the statically polled default level, then to PetBoxOptions.
public sealed class DeviceLogLevelService(
    IHttpClientFactory httpClientFactory,
    IOptionsMonitor<PetBoxConfValues> confValues,
    IOptions<PetBoxOptions> options,
    ILogger<DeviceLogLevelService> logger)
{
    sealed record CacheEntry(string Level, string? ETag, DateTimeOffset FreshUntil);

    const int MaxCachedDevices = 10_000;

    readonly ConcurrentDictionary<string, CacheEntry> cache = new();

    public async Task<string> GetLevelAsync(string deviceId, CancellationToken ct)
    {
        var key = deviceId.Trim();
        if (key.Length == 0 || options.Value.ApiKey.Length == 0) return DefaultLevel();
        return cache.TryGetValue(key, out var entry) && entry.FreshUntil > DateTimeOffset.UtcNow
            ? entry.Level
            : await RefreshAsync(key, cache.TryGetValue(key, out var stale) ? stale : null, ct);
    }

    async Task<string> RefreshAsync(string deviceId, CacheEntry? stale, CancellationToken ct)
    {
        var opts = options.Value;
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get, "/v1/conf?device=" + Uri.EscapeDataString(deviceId));
            if (stale?.ETag is { } etag)
                request.Headers.TryAddWithoutValidation("If-None-Match", etag);

            var client = httpClientFactory.CreateClient(PetBoxHttp.ClientName);
            using var response = await client.SendAsync(request, ct);

            var freshUntil = DateTimeOffset.UtcNow.AddSeconds(opts.DeviceLevelCacheTtlSeconds);
            if (response.StatusCode == HttpStatusCode.NotModified && stale is not null)
            {
                Store(deviceId, stale with { FreshUntil = freshUntil });
                return stale.Level;
            }

            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var level = doc.RootElement.TryGetProperty(opts.ClientLevelConfKey, out var value)
                ? value.GetString() ?? DefaultLevel()
                : DefaultLevel();
            Store(deviceId, new CacheEntry(level, response.Headers.ETag?.Tag, freshUntil));
            return level;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("PetBox conf query failed for device {DeviceId}: {Error}", deviceId, ex.Message);
            return stale?.Level ?? DefaultLevel();
        }
    }

    void Store(string deviceId, CacheEntry entry)
    {
        if (cache.Count >= MaxCachedDevices && !cache.ContainsKey(deviceId))
        {
            var now = DateTimeOffset.UtcNow;
            var expired = cache.Where(kv => kv.Value.FreshUntil <= now).Select(kv => kv.Key).ToList();
            expired.ForEach(k => cache.TryRemove(k, out _));
        }
        cache[deviceId] = entry;
    }

    string DefaultLevel() =>
        confValues.CurrentValue.ClientLogLevel ?? options.Value.FallbackClientLogLevel;
}
