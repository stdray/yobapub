using YobaPub.Proxy;

var builder = WebApplication.CreateBuilder(args);

var proxyConfig = builder.Configuration.GetSection("Proxy").Get<ProxyConfig>() ?? new ProxyConfig();

builder.Services.AddSingleton(proxyConfig);
builder.Services.AddHttpClient("proxy")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        AutomaticDecompression = System.Net.DecompressionMethods.All,
        AllowAutoRedirect = true
    });
builder.Services.AddReverseProxy().LoadFromMemory(
    ProxyRoutes.BuildRoutes(proxyConfig),
    ProxyRoutes.BuildClusters(proxyConfig));

var app = builder.Build();

app.UseMiddleware<UniversalProxyMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapReverseProxy();
app.MapFallbackToFile("index.html");
app.MapGet("/api/proxy-config", (ProxyConfig cfg) => Results.Json(new { cfg.ProxyAll, cfg.Upstream }));

app.MapGet("/hls/rewrite", async (string url, int audio, IHttpClientFactory factory) =>
{
    if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
        (uri.Scheme != "http" && uri.Scheme != "https"))
        return Results.BadRequest("Invalid url");

    using var client = factory.CreateClient("proxy");
    string manifest;
    try { manifest = await client.GetStringAsync(uri); }
    catch { return Results.StatusCode(502); }

    manifest = HlsRewriter.Rewrite(manifest, url, audio);

    return Results.Content(manifest, "application/vnd.apple.mpegurl");
});

app.MapGet("/.well-known/assetlinks.json", () => Results.Json(
    new[] {
        new {
            relation = new[] { "delegate_permission/common.handle_all_urls" },
            target = new {
                @namespace = "android_app",
                package_name = "su.p3o.yobapub",
                // TWA requires HTTPS; on HTTP only WebView fallback is used
                sha256_cert_fingerprints = new[] {
                    app.Configuration["Proxy:AndroidCertFingerprint"] ?? ""
                }
            }
        }
    }
));

app.Run();
