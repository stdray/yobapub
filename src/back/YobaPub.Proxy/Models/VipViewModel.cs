namespace YobaPub.Proxy.Models;

public class VipViewModel
{
    public required List<VipLoginEntry> Logins { get; init; }
    public string? Error { get; init; }
}
