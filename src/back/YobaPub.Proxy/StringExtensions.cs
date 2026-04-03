namespace YobaPub.Proxy;

public static class StringExtensions
{
    public static string LevelAbbr(this string level) => level switch
    {
        "Error"       => "ERR",
        "Warning"     => "WRN",
        "Information" => "INF",
        "Verbose"     => "VRB",
        _             => "???"
    };

    public static string ShortName(this string s, int maxLength = 20)
    {
        var short_ = s.Contains('.') ? s[(s.LastIndexOf('.') + 1)..] : s;
        return short_.Length > maxLength ? short_[..maxLength] : short_;
    }
}
