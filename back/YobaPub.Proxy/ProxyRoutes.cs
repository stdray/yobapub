using Yarp.ReverseProxy.Configuration;

namespace YobaPub.Proxy;

public static class ProxyRoutes
{
    public static IReadOnlyList<RouteConfig> BuildRoutes(ProxyConfig cfg)
    {
        return
        [
            new RouteConfig
            {
                RouteId = "api",
                ClusterId = "upstream",
                Match = new RouteMatch { Path = "/v1/{**catch-all}" }
            },
            new RouteConfig
            {
                RouteId = "oauth",
                ClusterId = "upstream",
                Match = new RouteMatch { Path = "/oauth2/{**catch-all}" }
            }
        ];
    }

    public static IReadOnlyList<ClusterConfig> BuildClusters(ProxyConfig cfg)
    {
        return
        [
            new ClusterConfig
            {
                ClusterId = "upstream",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    ["default"] = new() { Address = cfg.Upstream }
                }
            }
        ];
    }
}
