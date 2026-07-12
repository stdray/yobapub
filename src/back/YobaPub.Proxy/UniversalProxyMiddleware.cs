using System.Net;

namespace YobaPub.Proxy;

public class UniversalProxyMiddleware(
    RequestDelegate next,
    IHttpClientFactory httpClientFactory,
    ProxyConfig config,
    ILogger<UniversalProxyMiddleware> logger)
{
    private static readonly string[] UpstreamPrefixes = ["/v1/", "/oauth2/"];

    /// <summary>Prefix of the de-facto proxy headers (X-Forwarded-Host/-For/-Proto/-Port/…).</summary>
    private const string ForwardedHeaderPrefix = "X-Forwarded-";

    /// <summary>
    /// Headers that describe the hop between the client and this proxy, not the request itself.
    /// They must never reach the upstream: KinoPub's nginx routes by X-Forwarded-Host, so leaking
    /// the header sends every /v1/* call to their website vhost (HTML 404) instead of the API.
    /// </summary>
    private static readonly string[] HopByHopHeaders =
    [
        "Host", "Connection", "Forwarded", "X-Real-IP",
        "Keep-Alive", "Proxy-Connection", "Upgrade", "TE", "Trailer",
    ];

    internal static bool IsHopByHopHeader(string name) =>
        name.StartsWith(ForwardedHeaderPrefix, StringComparison.OrdinalIgnoreCase)
        || HopByHopHeaders.Any(h => h.Equals(name, StringComparison.OrdinalIgnoreCase));

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        if (UpstreamPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            await ForwardToUpstream(context, config.Upstream.TrimEnd('/') + path + context.Request.QueryString);
            return;
        }

        if (path.Equals("/proxy", StringComparison.OrdinalIgnoreCase))
        {
            await HandleExplicitProxy(context);
            return;
        }

        await next(context);
    }

    private async Task HandleExplicitProxy(HttpContext context)
    {
        var rawUrl = context.Request.Query["url"].FirstOrDefault();
        if (string.IsNullOrEmpty(rawUrl) || !Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            return;
        }

        await ForwardToUpstream(context, rawUrl);
    }

    private async Task ForwardToUpstream(HttpContext context, string targetUrl)
    {
        using var client = httpClientFactory.CreateClient("proxy");
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUrl);

        context.Request.Headers
            .Where(header => !IsHopByHopHeader(header.Key))
            .ToList()
            .ForEach(header => request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()));

        if (context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            request.Content = new StreamContent(context.Request.Body);
            if (context.Request.ContentType != null)
                request.Content.Headers.TryAddWithoutValidation("Content-Type", context.Request.ContentType);
        }

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        }
        catch (Exception ex)
        {
            logger.LogError("Proxy exception: {msg} url={url}", ex.Message, targetUrl);
            context.Response.StatusCode = (int)HttpStatusCode.BadGateway;
            return;
        }

        try
        {
            context.Response.StatusCode = (int)response.StatusCode;

            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }

            context.Response.Headers["Access-Control-Allow-Origin"] = "*";

            await response.Content.CopyToAsync(context.Response.Body);
        }
        finally
        {
            response.Dispose();
        }
    }
}
