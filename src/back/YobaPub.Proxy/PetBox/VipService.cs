using System.Text.Json;
using Microsoft.Extensions.Options;

namespace YobaPub.Proxy.PetBox;

// VIP logins from the PetBox config binding `vip/logins` (JSON array of strings;
// comma-separated fallback). Reparses only when the raw binding value changes
// (the config provider polls PetBox and reloads on change).
public sealed class VipService(IOptionsMonitor<PetBoxConfValues> confValues)
{
    sealed record Parsed(string Raw, HashSet<string> Logins);

    Parsed? parsed;

    public bool Contains(string login)
    {
        var raw = confValues.CurrentValue.VipLogins ?? "";
        var current = parsed;
        if (current is null || current.Raw != raw)
        {
            current = new Parsed(raw, Parse(raw));
            parsed = current;
        }
        return current.Logins.Contains(login.Trim());
    }

    static HashSet<string> Parse(string raw)
    {
        var logins = ParseJsonArray(raw) ?? raw.Split(',');
        return new HashSet<string>(
            logins.Select(l => l.Trim()).Where(l => l.Length > 0),
            StringComparer.OrdinalIgnoreCase);
    }

    static string[]? ParseJsonArray(string raw)
    {
        try
        {
            return JsonSerializer.Deserialize<string[]>(raw);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
