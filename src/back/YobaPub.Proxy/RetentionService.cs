using Microsoft.Extensions.Options;

namespace YobaPub.Proxy;

public class RetentionService(
    LogStore store,
    PlaybackErrorStore errorStore,
    LogShareStore shareStore,
    IOptions<AdminOptions> options,
    ILogger<RetentionService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var cutoff = DateTimeOffset.UtcNow.AddDays(-options.Value.RetentionDays);
            var deleted = store.DeleteOlderThan(cutoff);
            if (deleted > 0)
                logger.LogInformation("Log retention: deleted {count} entries older than {cutoff:O}", deleted, cutoff);

            var deletedErrors = errorStore.DeleteOlderThan(cutoff);
            if (deletedErrors > 0)
                logger.LogInformation("Playback error retention: deleted {count} entries older than {cutoff:O}", deletedErrors, cutoff);

            var deletedShares = shareStore.DeleteExpired();
            if (deletedShares > 0)
                logger.LogInformation("Log share retention: deleted {count} expired shares", deletedShares);

            await Task.Delay(TimeSpan.FromDays(1), ct).ConfigureAwait(false);
        }
    }
}
