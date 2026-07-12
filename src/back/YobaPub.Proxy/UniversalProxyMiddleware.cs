using System.Net;

namespace YobaPub.Proxy;

public class UniversalProxyMiddleware(
    RequestDelegate next,
    IHttpClientFactory httpClientFactory,
    UpstreamSelector upstreams,
    ILogger<UniversalProxyMiddleware> logger)
{
    /// <summary>Paths served by the KinoPub API host, i.e. subject to upstream selection.</summary>
    private static readonly string[] UpstreamPrefixes = ["/v1/", "/oauth2/"];

    /// <summary>Paths whose answer must be JSON — an HTML body there means we reached the wrong vhost.</summary>
    private const string JsonAnswerPrefix = "/v1/";

    private const int ServerErrorStatus = 500;

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

    /// <summary>
    /// A status code alone is not a health signal: the outage of 12.07.2026 served an honest
    /// HTTP 404 with an HTML body, while a JSON 401/403/404 is a perfectly healthy API answer.
    /// So a host only counts as bad on a transport failure, a 5xx, or a non-JSON answer to /v1/*.
    /// </summary>
    private static bool IsHealthyAnswer(HttpResponseMessage response, bool jsonExpected) =>
        (int)response.StatusCode < ServerErrorStatus
        && (!jsonExpected || response.Content.Headers.ContentType?.MediaType?
            .EndsWith("json", StringComparison.OrdinalIgnoreCase) == true);

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        if (UpstreamPrefixes.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
        {
            // The request is never retried. A bad answer only advances the sticky host, so the
            // NEXT request lands on the next one in the cycle; this client keeps what came back.
            var host = upstreams.Current;
            var healthy = await ForwardToUpstream(
                context,
                host + path + context.Request.QueryString,
                path.StartsWith(JsonAnswerPrefix, StringComparison.OrdinalIgnoreCase));
            if (!healthy) upstreams.Advance(host);
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

        // An absolute URL chosen by the caller — it says nothing about the API host's health.
        await ForwardToUpstream(context, rawUrl, jsonExpected: false);
    }

    /// <summary>Forwards the request as-is and streams the answer back untouched. Returns false when
    /// the upstream answer marks the host as dead (see <see cref="IsHealthyAnswer"/>).</summary>
    private async Task<bool> ForwardToUpstream(HttpContext context, string targetUrl, bool jsonExpected)
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
            return false;
        }

        try
        {
            var healthy = IsHealthyAnswer(response, jsonExpected);
            context.Response.StatusCode = (int)response.StatusCode;

            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }

            context.Response.Headers["Access-Control-Allow-Origin"] = "*";

            await response.Content.CopyToAsync(context.Response.Body);
            return healthy;
        }
        finally
        {
            response.Dispose();
        }
    }
}
