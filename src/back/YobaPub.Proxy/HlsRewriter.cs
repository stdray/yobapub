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

    // Builds a /hls/rewrite url that re-enters the backend for a nested playlist
    // (master -> level), carrying the ORIGINAL absolute uri so the backend can
    // fetch it server-side (TLS/https is fine there even when the client can't).
    private static string BuildPlaylistRewriteUrl(string uri, int audioIndex, string modeParam) =>
        "/hls/rewrite?url=" + Uri.EscapeDataString(uri) + "&audio=" + audioIndex + modeParam;

    public static string Rewrite(string manifest, string sourceUrl, int audioIndex, bool proxyUrls = false, bool plainHttp = false)
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

        // rewrite absolute URLs to go through proxy
        if (proxyUrls)
        {
            lines = lines.Select(l =>
            {
                var trimmed = l.Trim();
                if (trimmed.Length > 0 && trimmed[0] != '#' && trimmed.Contains("://"))
                {
                    return trimmed.Contains(".m3u8")
                        ? BuildPlaylistRewriteUrl(trimmed, audioIndex, "&proxy=true")
                        : "/proxy?url=" + Uri.EscapeDataString(trimmed);
                }
                if (trimmed.Contains("URI=\""))
                {
                    return _relativeUri.Replace(l, m =>
                    {
                        var uri = m.Groups[1].Value;
                        if (!uri.Contains("://")) return m.Value;
                        var rewritten = uri.Contains(".m3u8")
                            ? BuildPlaylistRewriteUrl(uri, audioIndex, "&proxy=true")
                            : "/proxy?url=" + Uri.EscapeDataString(uri);
                        return $"URI=\"{rewritten}\"";
                    });
                }
                return l;
            }).ToArray();
        }
        // CDN's ECC-only TLS cert (since 2026-09-02) is unsupported by the Tizen 2.x
        // TLS stack; the CDN also serves the same content over plain http with CORS.
        // Downgrade absolute https:// CDN URLs to http:// for legacy clients that have
        // media proxying off. Ignored when proxyUrls is set (segments go via /proxy).
        // Nested playlists (master -> level, hls2) are re-routed through
        // /hls/rewrite?...&plain=true instead of being downgraded in place: the CDN
        // serves ITS OWN absolute https:// segment urls inside a level playlist, which
        // the backend never sees unless it fetches and rewrites that playlist too.
        else if (plainHttp)
        {
            lines = lines.Select(l =>
            {
                var trimmed = l.Trim();
                if (trimmed.Length > 0 && trimmed[0] != '#' && trimmed.StartsWith("https://"))
                {
                    return trimmed.Contains(".m3u8")
                        ? BuildPlaylistRewriteUrl(trimmed, audioIndex, "&plain=true")
                        : l.Replace("https://", "http://");
                }
                if (trimmed.Contains("URI=\""))
                {
                    return _relativeUri.Replace(l, m =>
                    {
                        var uri = m.Groups[1].Value;
                        if (!uri.StartsWith("https://")) return m.Value;
                        var rewritten = uri.Contains(".m3u8")
                            ? BuildPlaylistRewriteUrl(uri, audioIndex, "&plain=true")
                            : "http://" + uri["https://".Length..];
                        return $"URI=\"{rewritten}\"";
                    });
                }
                return l;
            }).ToArray();
        }

        return string.Join('\n', lines);
    }
}
