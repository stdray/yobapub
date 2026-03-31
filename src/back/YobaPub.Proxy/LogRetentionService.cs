using Microsoft.Extensions.Options;

namespace YobaPub.Proxy;

public class LogRetentionService(
    LogStore store,
    IOptions<AdminOptions> options,
    ILogger<LogRetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var cutoff = DateTimeOffset.UtcNow.AddDays(-options.Value.RetentionDays);
            var deleted = store.DeleteOlderThan(cutoff);
            if (deleted > 0)
                logger.LogInformation("Log retention: deleted {count} entries older than {cutoff:O}", deleted, cutoff);

            await Task.Delay(TimeSpan.FromDays(1), ct).ConfigureAwait(false);
        }
    }
}
