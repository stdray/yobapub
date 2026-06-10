using System.Text.Json;
using Microsoft.Extensions.Options;
using PetBox.Client.Config;
using YobaPub.Proxy;
using YobaPub.Proxy.PetBox;

var builder = WebApplication.CreateBuilder(args);

var proxyConfig = builder.Configuration.GetSection("Proxy").Get<ProxyConfig>() ?? new ProxyConfig();
var petBox = builder.Configuration.GetSection("PetBox").Get<PetBoxOptions>() ?? new PetBoxOptions();
var petBoxEnabled = petBox.ApiKey.Length > 0;

if (petBoxEnabled)
{
    // Workspace config (vip/logins, default client-log/level) — polled with ETags.
    builder.Configuration.AddPetBoxConfig(o =>
    {
        o.BaseUrl = petBox.BaseUrl;
        o.ApiKey = petBox.ApiKey;
        o.RefreshInterval = TimeSpan.FromSeconds(petBox.ConfigRefreshSeconds);
        o.Optional = true; // the proxy must come up even when PetBox is down
        o.WithTag("project", petBox.ProjectKey);
    });

    // Proxy self-logs → PetBox `backend` log. The Seq client appends api/events/raw
    // to the server URL, landing on PetBox's named-log Seq-compat ingest route
    // (/api/ingest/{p}/{log}/compat/seq, auth via X-Seq-ApiKey = regular API key).
    builder.Logging.AddSeq(
        $"{petBox.BaseUrl}/api/ingest/{petBox.ProjectKey}/{petBox.BackendLogName}/compat/seq",
        apiKey: petBox.ApiKey);
}

builder.Services.AddSingleton(proxyConfig);
builder.Services.AddOptions<PetBoxOptions>().BindConfiguration("PetBox");

// PetBox conf binding paths contain slashes ("client-log/level"), which IConfiguration
// keeps as single key segments — bind manually instead of GetSection.
builder.Services.AddOptions<PetBoxConfValues>().Configure<IConfiguration>((values, cfg) =>
{
    values.ClientLogLevel = cfg[petBox.ClientLevelConfKey];
    values.VipLogins = cfg[petBox.VipLoginsConfKey];
});
builder.Services.AddSingleton<IOptionsChangeTokenSource<PetBoxConfValues>>(
    new ConfigurationChangeTokenSource<PetBoxConfValues>(builder.Configuration));

builder.Services.AddSingleton<DeviceLogLevelService>();
builder.Services.AddSingleton<VipService>();
builder.Services.AddSingleton<ClientLogRelay>();
if (petBoxEnabled)
    builder.Services.AddHostedService<ClientLogForwarder>();

builder.Services.AddHttpClient(PetBoxHttp.ClientName, client =>
{
    client.BaseAddress = new Uri(petBox.BaseUrl);
    client.DefaultRequestHeaders.TryAddWithoutValidation("X-Api-Key", petBox.ApiKey);
    client.Timeout = TimeSpan.FromSeconds(10);
});
builder.Services.AddHttpClient("proxy")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        AllowAutoRedirect = true
    });

builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
        | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseMiddleware<UniversalProxyMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var path = ctx.File.Name;
        if (path == "index.html")
        {
            ctx.Context.Response.Headers[Microsoft.Net.Http.Headers.HeaderNames.CacheControl] = "no-cache, no-store";
        }
        else if (path.Contains('.') && (path.EndsWith(".js") || path.EndsWith(".css")))
        {
            // Hashed filenames (app.abc12345.js) — cache aggressively
            ctx.Context.Response.Headers[Microsoft.Net.Http.Headers.HeaderNames.CacheControl] = "public, max-age=31536000, immutable";
        }
    }
});
app.MapFallbackToFile("index.html");

app.MapGet("/api/about", () =>
{
    var path = Path.Combine(AppContext.BaseDirectory, "version.json");
    if (!File.Exists(path))
        return Results.Json(new { semVer = "dev" });
    var json = File.ReadAllText(path);
    return Results.Content(json, "application/json");
});

app.MapGet("/api/proxy-config", (ProxyConfig cfg) => Results.Json(new { cfg.ProxyAll, cfg.Upstream }));

app.MapGet("/api/vip-check", (string login, VipService vip) =>
    Results.Json(new { vip = vip.Contains(login) }));

// Effective log level for a device — fetched by the TV client at startup; the same
// value backstops the relay filter below. Managed via PetBox config bindings:
// client-log/level (project default) and client-log/level + tag device:{id} (override).
app.MapGet("/api/log-config", async (string deviceId, DeviceLogLevelService levels, CancellationToken ct) =>
    Results.Json(new { level = await levels.GetLevelAsync(deviceId, ct) }));

app.MapPost("/api/log", async (HttpContext ctx, ClientLogRelay relay, DeviceLogLevelService levels) =>
{
    try
    {
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        var root = doc.RootElement;
        var entry = new ClientLogEvent(
            ServerTs: DateTimeOffset.UtcNow,
            ClientTs: root.TryGetProperty("clientTs", out var ts) && ts.TryGetInt64(out var tsVal) ? tsVal : 0,
            Level: root.TryGetProperty("level", out var level) ? level.GetString() ?? "" : "",
            Category: root.TryGetProperty("category", out var cat) ? cat.GetString() ?? "" : "",
            Message: root.TryGetProperty("message", out var msg) ? msg.GetString() ?? "" : "",
            DeviceId: root.TryGetProperty("deviceId", out var dev) ? dev.GetString() ?? "" : "",
            ClientIp: ctx.Connection.RemoteIpAddress?.ToString() ?? "",
            TraceId: root.TryGetProperty("traceId", out var trace) ? trace.GetString() ?? "" : "",
            Props: root.TryGetProperty("props", out var props) ? props.Clone() : null);

        var threshold = await levels.GetLevelAsync(entry.DeviceId, ctx.RequestAborted);
        if (LogLevels.IsEnabled(entry.Level, threshold))
            relay.Enqueue(entry);
    }
    catch { /* ignore malformed requests */ }
    return Results.Ok();
});

app.MapPost("/api/playback-error", async (HttpContext ctx, ClientLogRelay relay, DeviceLogLevelService levels) =>
{
    try
    {
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        var root = doc.RootElement;
        var url = root.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
        var domain = Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : "";
        if (string.IsNullOrEmpty(domain)) return Results.Ok();

        var deviceId = root.TryGetProperty("deviceId", out var dev) ? dev.GetString() ?? "" : "";
        var entry = new ClientLogEvent(
            ServerTs: DateTimeOffset.UtcNow,
            ClientTs: 0,
            Level: "Error",
            Category: "playback-error",
            Message: $"Playback error on {domain}",
            DeviceId: deviceId,
            ClientIp: ctx.Connection.RemoteIpAddress?.ToString() ?? "",
            TraceId: "",
            Props: JsonSerializer.SerializeToElement(new
            {
                url = url.Length > 500 ? url[..500] : url,
                domain,
                userAgent = root.TryGetProperty("userAgent", out var ua) ? ua.GetString() ?? "" : "",
                errorDetails = root.TryGetProperty("errorDetails", out var details) ? details.GetString() ?? "" : ""
            }));

        var threshold = await levels.GetLevelAsync(deviceId, ctx.RequestAborted);
        if (LogLevels.IsEnabled(entry.Level, threshold))
            relay.Enqueue(entry);
    }
    catch { /* ignore malformed requests */ }
    return Results.Ok();
});

app.MapGet("/hls/rewrite", async (string url, int audio, bool? proxy, IHttpClientFactory factory, HttpContext ctx) =>
{
    if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != "http" && uri.Scheme != "https"))
        return Results.BadRequest("Invalid url");

    app.Logger.LogInformation("HLS rewrite: audio={audio} url={url}", audio, url);

    using var client = factory.CreateClient("proxy");
    using var req = new HttpRequestMessage(HttpMethod.Get, uri);

    var skipHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Host", "Connection", "Transfer-Encoding" };
    foreach (var h in ctx.Request.Headers)
    {
        if (skipHeaders.Contains(h.Key)) continue;
        req.Headers.TryAddWithoutValidation(h.Key, h.Value.ToArray());
    }

    HttpResponseMessage response;
    try
    {
        response = await client.SendAsync(req);
    }
    catch (Exception ex)
    {
        app.Logger.LogError("HLS rewrite fetch exception: {msg} url={url}", ex.Message, url);
        return Results.StatusCode(502);
    }

    app.Logger.LogInformation("HLS rewrite CDN response: {status} url={url}", (int)response.StatusCode, url);

    if (!response.IsSuccessStatusCode)
    {
        var body = await response.Content.ReadAsStringAsync();
        app.Logger.LogWarning("HLS rewrite CDN error body: {body}", body.Length > 500 ? body[..500] : body);
        return Results.StatusCode((int)response.StatusCode);
    }

    var manifest = await response.Content.ReadAsStringAsync();

    if (string.IsNullOrWhiteSpace(manifest) || !manifest.StartsWith("#EXTM3U"))
    {
        var preview = manifest.Length > 200 ? manifest[..200] : manifest;
        app.Logger.LogWarning("HLS rewrite: CDN returned invalid manifest url={url} preview={preview}", url, preview);
        return Results.StatusCode(502);
    }

    manifest = HlsRewriter.Rewrite(manifest, url, audio, proxy == true);

    return Results.Content(manifest, "application/x-mpegurl");
});

#pragma warning disable CA1861 // constant arrays in one-shot endpoint
app.MapGet("/.well-known/assetlinks.json", () => Results.Json(
    new[] {
        new {
            relation = new[] { "delegate_permission/common.handle_all_urls" },
            target = new {
                @namespace = "android_app",
                package_name = "su.p3o.yobapub",
                sha256_cert_fingerprints = new[] {
                    app.Configuration["Proxy:AndroidCertFingerprint"] ?? ""
                }
            }
        }
    }
));

app.Run();
