using System.Net;

namespace YobaPub.Proxy;

public class UniversalProxyMiddleware(RequestDelegate next, IHttpClientFactory httpClientFactory, ProxyConfig config)
{
    private static readonly string[] UpstreamPrefixes = ["/v1/", "/oauth2/"];

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

        if (!config.AllowedProxyHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = (int)HttpStatusCode.Forbidden;
            return;
        }

        await ForwardToUpstream(context, rawUrl);
    }

    private async Task ForwardToUpstream(HttpContext context, string targetUrl)
    {
        using var client = httpClientFactory.CreateClient("proxy");
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUrl);

        foreach (var header in context.Request.Headers)
        {
            if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
            if (header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase)) continue;
            request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }

        if (context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            request.Content = new StreamContent(context.Request.Body);
            if (context.Request.ContentType != null)
                request.Content.Headers.TryAddWithoutValidation("Content-Type", context.Request.ContentType);
        }

        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);

        context.Response.StatusCode = (int)response.StatusCode;

        foreach (var header in response.Headers.Concat(response.Content.Headers))
        {
            if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
            context.Response.Headers[header.Key] = header.Value.ToArray();
        }

        context.Response.Headers["Access-Control-Allow-Origin"] = "*";

        await response.Content.CopyToAsync(context.Response.Body);
    }
}
