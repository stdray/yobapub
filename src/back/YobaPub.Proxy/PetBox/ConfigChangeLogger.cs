using Microsoft.Extensions.Options;

namespace YobaPub.Proxy.PetBox;

// Observability for runtime config refresh. PetBox.Client.Config polls every
// ConfigRefreshSeconds and raises OnReload() on change; both VipService and
// DeviceLogLevelService consume via IOptionsMonitor.CurrentValue, so changes
// apply without a restart. This logs each applied change so a deploy can be
// verified and any future "config didn't update" report is diagnosable.
public sealed class ConfigChangeLogger(
    IOptionsMonitor<PetBoxConfValues> confValues,
    ILogger<ConfigChangeLogger> log) : IHostedService
{
    private IDisposable? subscription;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        subscription = confValues.OnChange(v =>
            log.LogInformation(
                "PetBox config reloaded: client-log/level={Level} vip/logins={Vip}",
                v.ClientLogLevel, v.VipLogins));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        subscription?.Dispose();
        return Task.CompletedTask;
    }
}
