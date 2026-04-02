using System.Text.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using YobaPub.Proxy;

var builder = WebApplication.CreateBuilder(args);

var proxyConfig = builder.Configuration.GetSection("Proxy").Get<ProxyConfig>() ?? new ProxyConfig();

builder.Services.AddSingleton(proxyConfig);
builder.Services.AddOptions<AdminOptions>().BindConfiguration("Admin");
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(
        builder.Configuration["DataProtection:KeysPath"] ?? "/keys/dataprotection"));
builder.Services.AddSingleton<LogStore>();
builder.Services.AddSingleton<PlaybackErrorStore>();
builder.Services.AddSingleton<MainDb>();
builder.Services.AddSingleton<VipLoginStore>();
builder.Services.AddSingleton<DebugSettingsStore>();
builder.Services.AddHostedService<LogRetentionService>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(opt =>
    {
        opt.LoginPath = "/admin/login";
        opt.ExpireTimeSpan = TimeSpan.FromDays(30);
        opt.Cookie.Name = "YobaPub.Auth";
        opt.Cookie.HttpOnly = true;
        opt.Cookie.SameSite = SameSiteMode.Lax;
        opt.SlidingExpiration = true;
    });
builder.Services.AddControllersWithViews()
    .AddJsonOptions(o => o.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase);
builder.Services.AddHttpClient("proxy")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        AllowAutoRedirect = true
    });

var app = builder.Build();

app.UseMiddleware<UniversalProxyMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapFallbackToFile("index.html");

app.MapGet("/v1/about", () =>
{
    var path = Path.Combine(AppContext.BaseDirectory, "version.json");
    if (!File.Exists(path))
        return Results.Json(new { semVer = "dev" });
    var json = File.ReadAllText(path);
    return Results.Content(json, "application/json");
});

app.MapGet("/api/proxy-config", (ProxyConfig cfg) => Results.Json(new { cfg.ProxyAll, cfg.Upstream }));

app.MapGet("/api/vip-check", (string login, VipLoginStore vipStore) =>
    Results.Json(new { vip = vipStore.Contains(login) }));

app.MapPost("/api/log", async (HttpContext ctx, LogStore store, DebugSettingsStore debugSettings) =>
{
    if (!debugSettings.IsEnabled) return Results.Ok();
    try
    {
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        var root = doc.RootElement;
        var entry = new LogEntry
        {
            ServerTs = DateTimeOffset.UtcNow,
            ClientTs = root.TryGetProperty("clientTs", out var ts) && ts.TryGetInt64(out var tsVal) ? tsVal : 0,
            Level = root.TryGetProperty("level", out var level) ? level.GetString() ?? "" : "",
            Category = root.TryGetProperty("category", out var cat) ? cat.GetString() ?? "" : "",
            Message = root.TryGetProperty("message", out var msg) ? msg.GetString() ?? "" : "",
            DeviceId = root.TryGetProperty("deviceId", out var dev) ? dev.GetString() ?? "" : "",
            Props = root.TryGetProperty("props", out var props) ? props.GetRawText() : "{}"
        };
        store.Add(entry);
    }
    catch { /* ignore malformed requests */ }
    return Results.Ok();
});

app.MapPost("/api/playback-error", async (HttpContext ctx, PlaybackErrorStore store, DebugSettingsStore debugSettings) =>
{
    if (!debugSettings.IsEnabled) return Results.Ok();
    try
    {
        using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
        var root = doc.RootElement;
        var url = root.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
        var domain = "";
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
            domain = uri.Host;

        if (string.IsNullOrEmpty(domain)) return Results.Ok();

        var entry = new PlaybackErrorEntry
        {
            ServerTs = DateTimeOffset.UtcNow,
            Domain = domain,
            DeviceId = root.TryGetProperty("deviceId", out var dev) ? dev.GetString() ?? "" : "",
            UserAgent = root.TryGetProperty("userAgent", out var ua) ? ua.GetString() ?? "" : "",
            ErrorDetails = root.TryGetProperty("errorDetails", out var details) ? details.GetString() ?? "" : "",
            Url = url.Length > 500 ? url[..500] : url
        };
        store.Add(entry);
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

app.MapGet("/hls/proxy", async (string url, IHttpClientFactory factory, HttpContext ctx) =>
{
    if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != "http" && uri.Scheme != "https"))
    {
        ctx.Response.StatusCode = 400;
        return;
    }

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
        response = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
    }
    catch (Exception ex)
    {
        app.Logger.LogError("HLS proxy exception: {msg} url={url}", ex.Message, url);
        ctx.Response.StatusCode = 502;
        return;
    }

    using (response)
    {
        ctx.Response.StatusCode = (int)response.StatusCode;

        if (response.Content.Headers.ContentType != null)
            ctx.Response.ContentType = response.Content.Headers.ContentType.ToString();

        if (response.Content.Headers.ContentLength is { } len)
            ctx.Response.ContentLength = len;

        await response.Content.CopyToAsync(ctx.Response.Body);
    }
});

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
