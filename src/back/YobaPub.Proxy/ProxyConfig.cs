namespace YobaPub.Proxy;

public class ProxyConfig
{
    public string Upstream { get; set; } = "https://api.service-kp.com";
    public bool ProxyAll { get; set; }
    public IReadOnlyList<string> AllowedProxyHosts { get; set; } = ["m.pushbr.com"];
}
