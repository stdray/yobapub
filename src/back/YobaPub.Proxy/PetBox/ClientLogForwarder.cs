using System.Text;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy.PetBox;

// Drains the relay channel and ships client log events to the PetBox `clients` log
// in CLEF batches (size/time bounded). Failed batches are retried a few times, then
// dropped with a local warning — client telemetry is best-effort; bounded memory
// matters more than completeness during a PetBox outage.
public sealed class ClientLogForwarder(
    ClientLogRelay relay,
    IHttpClientFactory httpClientFactory,
    IOptions<PetBoxOptions> options,
    ILogger<ClientLogForwarder> logger) : BackgroundService
{
    static readonly TimeSpan[] RetryDelays =
        [TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(15)];

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var opts = options.Value;
        var ingestPath = $"/api/ingest/{opts.ProjectKey}/{opts.ClientLogName}/clef";
        var batch = new List<ClientLogEvent>(opts.RelayBatchSize);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await FillBatchAsync(batch, opts, ct);
                if (batch.Count > 0) await SendAsync(ingestPath, batch, opts, ct);
                ReportDropped();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning("Client log forwarding failed: {Error}", ex.Message);
            }
            finally
            {
                batch.Clear();
            }
        }
    }

    // Blocks for the first event, then drains until the batch is full or the flush
    // window elapses — small batches under load, low latency when idle.
    async Task FillBatchAsync(List<ClientLogEvent> batch, PetBoxOptions opts, CancellationToken ct)
    {
        batch.Add(await relay.Reader.ReadAsync(ct));
        using var window = CancellationTokenSource.CreateLinkedTokenSource(ct);
        window.CancelAfter(TimeSpan.FromSeconds(opts.RelayFlushIntervalSeconds));
        try
        {
            while (batch.Count < opts.RelayBatchSize && await relay.Reader.WaitToReadAsync(window.Token))
                while (batch.Count < opts.RelayBatchSize && relay.Reader.TryRead(out var entry))
                    batch.Add(entry);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Flush window elapsed — ship what we have.
        }
    }

    async Task SendAsync(string path, List<ClientLogEvent> batch, PetBoxOptions opts, CancellationToken ct)
    {
        var payload = ClefWriter.Write(batch);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                var client = httpClientFactory.CreateClient(PetBoxHttp.ClientName);
                using var request = new HttpRequestMessage(HttpMethod.Post, path);
                request.Headers.TryAddWithoutValidation("X-Service-Key", opts.ServiceKey);
                request.Content = new StringContent(payload, Encoding.UTF8, "application/vnd.serilog.clef");
                using var response = await client.SendAsync(request, ct);
                response.EnsureSuccessStatusCode();
                return;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (attempt >= RetryDelays.Length)
                {
                    logger.LogWarning(
                        "Dropping batch of {Count} client log events after {Attempts} attempts: {Error}",
                        batch.Count, attempt + 1, ex.Message);
                    return;
                }
                await Task.Delay(RetryDelays[attempt], ct);
            }
        }
    }

    void ReportDropped()
    {
        var dropped = relay.TakeDropped();
        if (dropped > 0)
            logger.LogWarning("Client log relay overflow: dropped {Count} events", dropped);
    }
}
