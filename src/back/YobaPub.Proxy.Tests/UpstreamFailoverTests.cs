using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using YobaPub.Proxy.PetBox;

namespace YobaPub.Proxy.Tests;

/// <summary>
/// The proxy never retries: a bad answer reaches the client untouched and only moves the current
/// host on, so the NEXT request goes elsewhere. The selection is in-memory only.
/// </summary>
public class UpstreamFailoverTests
{
    private const string First = "https://api.first.example";
    private const string Second = "https://api.second.example";
    private const string Third = "https://api.third.example";
    private const string ApiPath = "/v1/items/fresh";

    /// <summary>Stands in for the PetBox config provider; the value can be rewritten mid-test (runtime reload).</summary>
    private sealed class ConfStub : IOptionsMonitor<PetBoxConfValues>
    {
        public PetBoxConfValues CurrentValue { get; } = new();

        public PetBoxConfValues Get(string? name) => CurrentValue;

        public IDisposable? OnChange(Action<PetBoxConfValues, string?> listener) => null;
    }

    /// <summary>Answers with a scripted sequence and records every outbound URL.</summary>
    private sealed class ScriptedHandler(params Func<HttpResponseMessage>[] answers) : HttpMessageHandler
    {
        public List<string> Calls { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add(request.RequestUri!.ToString());
            return Task.FromResult(answers[Math.Min(Calls.Count - 1, answers.Length - 1)]());
        }
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static HttpResponseMessage Answer(HttpStatusCode status, string body, string contentType) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, contentType) };

    private static HttpResponseMessage Html(HttpStatusCode status) =>
        Answer(status, "<html><body>404 Not Found</body></html>", "text/html");

    private static HttpResponseMessage Json(HttpStatusCode status) =>
        Answer(status, """{"status":401}""", "application/json");

    private static HttpResponseMessage Boom() => throw new HttpRequestException("connection refused");

    /// <summary>A selector over a `proxy/upstreams` binding value; the stub lets a test rewrite it.</summary>
    private static (UpstreamSelector Selector, ConfStub Conf) NewSelector(string? upstreams)
    {
        var conf = new ConfStub();
        conf.CurrentValue.Upstreams = upstreams;
        return (new UpstreamSelector(conf, NullLogger<UpstreamSelector>.Instance), conf);
    }

    /// <summary>Runs one inbound request through the middleware; returns the client-visible answer.</summary>
    private static async Task<(int Status, string Body)> SendAsync(
        UpstreamSelector selector, HttpMessageHandler handler, string path = ApiPath)
    {
        var middleware = new UniversalProxyMiddleware(
            _ => Task.CompletedTask,
            new StubHttpClientFactory(handler),
            selector,
            NullLogger<UniversalProxyMiddleware>.Instance);

        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = path;
        var body = new MemoryStream();
        context.Response.Body = body;

        await middleware.InvokeAsync(context);

        return (context.Response.StatusCode, Encoding.UTF8.GetString(body.ToArray()));
    }

    [Theory]
    [InlineData(HttpStatusCode.OK)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task HtmlAnswer_ReachesClientUntouched_AndSwitchesTheNextRequest(HttpStatusCode status)
    {
        var handler = new ScriptedHandler(() => Html(status), () => Json(HttpStatusCode.OK));
        var (selector, _) = NewSelector($"{First},{Second}");

        var answer = await SendAsync(selector, handler);

        Assert.Equal((int)status, answer.Status);
        Assert.Contains("404 Not Found", answer.Body);
        Assert.Equal(First + ApiPath, Assert.Single(handler.Calls));

        await SendAsync(selector, handler);

        Assert.Equal(Second + ApiPath, handler.Calls[1]);
        Assert.Equal(2, handler.Calls.Count); // exactly one outbound call per inbound request
    }

    [Fact]
    public async Task JsonUnauthorized_IsAHealthyAnswer_AndKeepsTheHost()
    {
        var handler = new ScriptedHandler(() => Json(HttpStatusCode.Unauthorized));
        var (selector, _) = NewSelector($"{First},{Second}");

        var answer = await SendAsync(selector, handler);

        Assert.Equal((int)HttpStatusCode.Unauthorized, answer.Status);
        Assert.Equal(First, selector.Current);

        await SendAsync(selector, handler);

        Assert.Equal([First + ApiPath, First + ApiPath], handler.Calls);
    }

    [Fact]
    public async Task ServerError_SwitchesTheNextRequest()
    {
        var handler = new ScriptedHandler(() => Json(HttpStatusCode.BadGateway));
        var (selector, _) = NewSelector($"{First},{Second}");

        var answer = await SendAsync(selector, handler);

        Assert.Equal((int)HttpStatusCode.BadGateway, answer.Status);
        Assert.Equal(Second, selector.Current);
    }

    [Fact]
    public async Task NetworkError_Yields502_AndSwitchesTheNextRequest()
    {
        var handler = new ScriptedHandler(Boom);
        var (selector, _) = NewSelector($"{First},{Second}");

        var answer = await SendAsync(selector, handler);

        Assert.Equal((int)HttpStatusCode.BadGateway, answer.Status);
        Assert.Empty(answer.Body);
        Assert.Equal(First + ApiPath, Assert.Single(handler.Calls)); // never retried
        Assert.Equal(Second, selector.Current);
    }

    [Fact]
    public async Task Advance_IsCyclic_WrappingFromTheLastHostToTheFirst()
    {
        var handler = new ScriptedHandler(Boom);
        var (selector, _) = NewSelector($"{First},{Second}");

        await SendAsync(selector, handler);
        Assert.Equal(Second, selector.Current);

        await SendAsync(selector, handler);
        Assert.Equal(First, selector.Current);

        Assert.Equal(2, handler.Calls.Count);
    }

    [Fact]
    public async Task NonJsonAnswer_OnOAuthPath_DoesNotSwitch()
    {
        // Only /v1/* answers must be JSON; /oauth2/* is judged by status alone.
        var handler = new ScriptedHandler(() => Html(HttpStatusCode.OK));
        var (selector, _) = NewSelector($"{First},{Second}");

        await SendAsync(selector, handler, "/oauth2/device");

        Assert.Equal(First, selector.Current);
    }

    [Fact]
    public void MissingBinding_FallsBackToTheBuiltInDefaults()
    {
        Assert.Equal(UpstreamSelector.DefaultHosts, NewSelector(null).Selector.Hosts);
        Assert.Equal(UpstreamSelector.DefaultHosts, NewSelector("  ").Selector.Hosts);
        Assert.Equal(UpstreamSelector.DefaultHosts[0], NewSelector(null).Selector.Current);
    }

    [Fact]
    public void CommaSeparatedBinding_IsParsed_TrimmingSpacesAndTrailingSlashes()
    {
        var (selector, _) = NewSelector($" {First}/ , {Second} , ");

        Assert.Equal([First, Second], selector.Hosts);
    }

    [Fact]
    public void RuntimeListChange_KeepsTheCurrentHostWhenItSurvives()
    {
        var (selector, conf) = NewSelector($"{First},{Second}");
        selector.Advance(First);
        Assert.Equal(Second, selector.Current);

        // The binding is re-edited while the process runs: a new host appears ahead of ours.
        conf.CurrentValue.Upstreams = $"{Third},{First},{Second}";

        Assert.Equal(Second, selector.Current); // remembered by URL, not by index
        selector.Advance(Second);
        Assert.Equal(Third, selector.Current); // and the cycle follows the NEW list
    }

    [Fact]
    public void RuntimeListChange_DroppingTheCurrentHost_FallsBackToTheHead()
    {
        var (selector, conf) = NewSelector($"{First},{Second}");
        selector.Advance(First);
        Assert.Equal(Second, selector.Current);

        conf.CurrentValue.Upstreams = $"{Third},{First}";

        Assert.Equal(Third, selector.Current);
    }

    [Fact]
    public void Advance_IgnoresAStaleHost()
    {
        var (selector, _) = NewSelector($"{First},{Second}");

        selector.Advance(First);
        selector.Advance(First); // a concurrent failure on the host we already left

        Assert.Equal(Second, selector.Current);
    }
}
