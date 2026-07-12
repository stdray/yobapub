using Microsoft.Extensions.Options;
using YobaPub.Proxy.PetBox;

namespace YobaPub.Proxy;

/// <summary>
/// Holds the currently-selected upstream host out of an ordered, circular list that comes from the
/// PetBox config binding `proxy/upstreams` (a comma-separated string — PetBox list bindings are NOT
/// JSON arrays; `vip/logins` was burned by that already). No binding, no PetBox key → the built-in
/// <see cref="DefaultHosts"/>, so local dev works without PetBox.
///
/// The proxy stays a dumb pipe: a request goes to <see cref="Current"/> and its answer is returned
/// untouched — never retried elsewhere. A bad answer only moves the current host on as a side effect,
/// so the NEXT request goes to the next one. The first request after a host dies is deliberately
/// sacrificial; the client retries on its own.
///
/// The selection lives ONLY in memory — no persistence. After a restart we start from the head.
/// Because PetBox config reloads at runtime (~60s) the list can change under us, so the current host
/// is remembered as a URL, never as an index; a URL that disappears from the list falls back to the head.
/// </summary>
public sealed class UpstreamSelector(
    IOptionsMonitor<PetBoxConfValues> confValues, ILogger<UpstreamSelector> logger)
{
    /// <summary>Used when the `proxy/upstreams` binding is missing or empty.</summary>
    public static readonly string[] DefaultHosts = ["https://api.srvkp.com", "https://api.service-kp.com"];

    private readonly object gate = new();
    private string? current;

    /// <summary>The configured list, in priority order.</summary>
    public string[] Hosts => Parse(confValues.CurrentValue.Upstreams);

    /// <summary>The host every upstream request currently goes to.</summary>
    public string Current
    {
        get { lock (gate) return Resolve(Hosts); }
    }

    /// <summary>
    /// Moves to the next host in the cycle — but only if <paramref name="failedHost"/> is still the
    /// current one, so concurrent failures on the same host advance the selection exactly once.
    /// </summary>
    public void Advance(string failedHost)
    {
        lock (gate)
        {
            var hosts = Hosts;
            if (Resolve(hosts) != failedHost) return;

            var next = hosts[(Array.IndexOf(hosts, failedHost) + 1) % hosts.Length];
            current = next;
            logger.LogWarning("Upstream {failed} looks dead, switching to {next}", failedHost, next);
        }
    }

    /// <summary>Current host, re-pinned to the head whenever it is not (or no longer) in the list.</summary>
    private string Resolve(string[] hosts)
    {
        if (current is null || Array.IndexOf(hosts, current) < 0)
            current = hosts[0];
        return current;
    }

    private static string[] Parse(string? raw)
    {
        var hosts = (raw ?? "")
            .Split(',')
            .Select(h => h.Trim().TrimEnd('/'))
            .Where(h => h.Length > 0)
            .ToArray();
        return hosts.Length > 0 ? hosts : DefaultHosts;
    }
}
