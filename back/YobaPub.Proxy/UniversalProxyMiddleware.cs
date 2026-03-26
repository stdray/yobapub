using System.Net;

namespace YobaPub.Proxy;

public class UniversalProxyMiddleware(RequestDelegate next, IHttpClientFactory httpClientFactory)
{
    private const string Prefix = "/proxy/";

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value;
        if (path == null || !path.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        var rest = path[Prefix.Length..];
        var slashIdx = rest.IndexOf('/');
        if (slashIdx < 0)
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            return;
        }

        var scheme = rest[..slashIdx];
        if (scheme is not ("http" or "https"))
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            return;
        }

        var hostAndPath = rest[(slashIdx + 1)..];
        if (string.IsNullOrEmpty(hostAndPath))
        {
            context.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            return;
        }

        var targetUrl = $"{scheme}://{hostAndPath}";
        var qs = context.Request.QueryString;
        if (qs.HasValue)
            targetUrl += qs.Value;

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
