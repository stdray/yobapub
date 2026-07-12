namespace YobaPub.Proxy.PetBox;

// Values resolved from PetBox config (AddPetBoxConfig provider). Bound manually in
// Program.cs: binding paths contain slashes ("client-log/level") which IConfiguration
// treats as a single key segment, so GetSection-based binding can't reach them.
public class PetBoxConfValues
{
    public string? ClientLogLevel { get; set; }
    public string? VipLogins { get; set; }

    /// <summary>Comma-separated upstream base URLs, in priority order (`proxy/upstreams`).</summary>
    public string? Upstreams { get; set; }
}
