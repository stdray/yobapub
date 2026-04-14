namespace YobaPub.Proxy;

public class ProxyConfig
{
    public string Upstream { get; set; } = "https://api.service-kp.com";
    public bool ProxyAll { get; set; }
}
