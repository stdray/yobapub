using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace YobaPub.Proxy.Tests;

public class UniversalProxyMiddlewareTests
{
    private const string UpstreamPath = "/v1/items/fresh";

    /// <summary>Captures the outbound request instead of hitting the network.</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public HttpRequestMessage? Captured { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Captured = request;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(""),
            });
        }
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    /// <summary>Runs the middleware over a request carrying <paramref name="inboundHeaders"/>.</summary>
    private static async Task<HttpRequestMessage> ForwardAsync(
        params (string Key, string Value)[] inboundHeaders)
    {
        var handler = new CapturingHandler();
        var middleware = new UniversalProxyMiddleware(
            _ => Task.CompletedTask,
            new StubHttpClientFactory(handler),
            new ProxyConfig { Upstream = "https://api.example.com" },
            NullLogger<UniversalProxyMiddleware>.Instance);

        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = UpstreamPath;
        context.Response.Body = new MemoryStream();

        inboundHeaders.ToList().ForEach(h => context.Request.Headers[h.Key] = h.Value);

        await middleware.InvokeAsync(context);

        Assert.NotNull(handler.Captured);
        return handler.Captured!;
    }

    [Fact]
    public async Task ForwardedHeaders_AreStrippedFromUpstreamRequest()
    {
        var upstream = await ForwardAsync(
            ("X-Forwarded-Host", "yobapub.3po.su"),
            ("X-Forwarded-For", "203.0.113.7"),
            ("X-Forwarded-Proto", "https"),
            ("Forwarded", "host=yobapub.3po.su;proto=https"),
            ("X-Real-IP", "203.0.113.7"));

        Assert.False(upstream.Headers.Contains("X-Forwarded-Host"));
        Assert.False(upstream.Headers.Contains("X-Forwarded-For"));
        Assert.False(upstream.Headers.Contains("X-Forwarded-Proto"));
        Assert.False(upstream.Headers.Contains("Forwarded"));
        Assert.False(upstream.Headers.Contains("X-Real-IP"));
    }

    [Fact]
    public async Task HopByHopHeaders_AreStrippedFromUpstreamRequest()
    {
        var upstream = await ForwardAsync(
            ("Host", "yobapub.3po.su"),
            ("Connection", "keep-alive"),
            ("Keep-Alive", "timeout=5"),
            ("Proxy-Connection", "keep-alive"),
            ("Upgrade", "websocket"),
            ("TE", "trailers"),
            ("Trailer", "Expires"));

        Assert.False(upstream.Headers.Contains("Host"));
        Assert.False(upstream.Headers.Contains("Connection"));
        Assert.False(upstream.Headers.Contains("Keep-Alive"));
        Assert.False(upstream.Headers.Contains("Proxy-Connection"));
        Assert.False(upstream.Headers.Contains("Upgrade"));
        Assert.False(upstream.Headers.Contains("TE"));
        Assert.False(upstream.Headers.Contains("Trailer"));
    }

    [Fact]
    public async Task NormalHeaders_ReachUpstream()
    {
        var upstream = await ForwardAsync(
            ("Authorization", "Bearer token123"),
            ("X-Forwarded-Host", "yobapub.3po.su"),
            ("User-Agent", "YobaPub/1.0"));

        Assert.Equal("Bearer token123", Assert.Single(upstream.Headers.GetValues("Authorization")));
        Assert.Equal("YobaPub/1.0", Assert.Single(upstream.Headers.GetValues("User-Agent")));
        Assert.False(upstream.Headers.Contains("X-Forwarded-Host"));
        Assert.Equal("https://api.example.com" + UpstreamPath, upstream.RequestUri?.ToString());
    }

    [Fact]
    public async Task ForwardedHeaderMatching_IsCaseInsensitive()
    {
        var upstream = await ForwardAsync(("x-forwarded-host", "yobapub.3po.su"), ("forwarded", "host=x"));

        Assert.False(upstream.Headers.Contains("X-Forwarded-Host"));
        Assert.False(upstream.Headers.Contains("Forwarded"));
    }
}
