namespace YobaPub.Proxy;

public class ProxyConfig
{
    // The upstream host list is NOT here: it lives in the PetBox config binding `proxy/upstreams`
    // and is resolved at runtime by UpstreamSelector.
    public bool ProxyAll { get; set; }
}
