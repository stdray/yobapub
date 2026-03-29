namespace YobaPub.Proxy;

public static class HlsRewriter
{
    private static readonly System.Text.RegularExpressions.Regex _hls2VideoSeg =
        new(@"(index-v\d+)a\d+(\.m3u8)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex _hls2IframeSeg =
        new(@"(iframes-v\d+)a\d+(\.m3u8)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex _hls2TsSeg =
        new(@"(seg-\d+-v\d+)-a\d+(\.ts)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex _extMedia =
        new(@"(#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex _defaultAttr =
        new(@"DEFAULT=(YES|NO)", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static readonly System.Text.RegularExpressions.Regex _relativeUri =
        new(@"URI=""([^""]+)""", System.Text.RegularExpressions.RegexOptions.Compiled);

    public static string Rewrite(string manifest, string sourceUrl, int audioIndex)
    {
        manifest = manifest.Replace("\r\n", "\n").Replace('\r', '\n');
        var baseUrl = sourceUrl[..(sourceUrl.LastIndexOf('/') + 1)];
        var target = "a" + audioIndex;
        var audioSegPattern = new System.Text.RegularExpressions.Regex(
            @"/index-a" + audioIndex + @"\.m3u8");

        // hls2: muxed audio in segment names (index-v1a1.m3u8, seg-1-v1-a1.ts)
        manifest = _hls2VideoSeg.Replace(manifest, "$1" + target + "$2");
        manifest = _hls2IframeSeg.Replace(manifest, "$1" + target + "$2");
        manifest = _hls2TsSeg.Replace(manifest, "$1-" + target + "$2");

        // hls4: master playlist with #EXT-X-MEDIA — keep only target audio track, set DEFAULT=YES
        manifest = _extMedia.Replace(manifest, m =>
        {
            var line = m.Value;
            var isTarget = audioSegPattern.IsMatch(line);
            if (!isTarget) return string.Empty;
            return _defaultAttr.Replace(line, "DEFAULT=YES");
        });
        // remove blank lines left after dropping non-target EXT-X-MEDIA entries
        manifest = System.Text.RegularExpressions.Regex.Replace(manifest, @"\n{2,}", "\n");

        // make relative URLs absolute
        var lines = manifest.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (line.Length > 0 && line[0] != '#' && !line.Contains("://"))
                lines[i] = baseUrl + line;
            if (line.Contains("URI=\""))
                lines[i] = _relativeUri.Replace(lines[i], m =>
                    m.Groups[1].Value.Contains("://") ? m.Value : $"URI=\"{baseUrl}{m.Groups[1].Value}\"");
        }

        return string.Join('\n', lines);
    }
}
