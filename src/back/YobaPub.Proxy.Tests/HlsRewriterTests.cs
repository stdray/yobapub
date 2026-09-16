namespace YobaPub.Proxy.Tests;

public class HlsRewriterTests
{
    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine("Fixtures", name));

    // ── hls4 master playlist (real data from HAR) ─────────────────────────

    [Fact]
    public void Hls4_SelectTrack2_KeepsOnlyA2Lines()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2);

        var audioLines = result.Split('\n')
            .Where(l => l.StartsWith("#EXT-X-MEDIA") && l.Contains("TYPE=AUDIO"))
            .ToList();

        Assert.All(audioLines, l => Assert.Contains("/index-a2.m3u8", l));
        Assert.All(audioLines, l => Assert.Contains("DEFAULT=YES", l));
        Assert.DoesNotContain(audioLines, l => l.Contains("/index-a1.m3u8"));
    }

    [Fact]
    public void Hls4_SelectTrack1_KeepsOnlyA1Lines()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 1);

        var audioLines = result.Split('\n')
            .Where(l => l.StartsWith("#EXT-X-MEDIA") && l.Contains("TYPE=AUDIO"))
            .ToList();

        Assert.All(audioLines, l => Assert.Contains("/index-a1.m3u8", l));
        Assert.All(audioLines, l => Assert.Contains("DEFAULT=YES", l));
        Assert.DoesNotContain(audioLines, l => l.Contains("/index-a2.m3u8"));
    }

    [Fact]
    public void Hls4_AllGroupsAreRewritten()
    {
        // fixture has 3 groups: audio1080, audio720, audio480 — each with a1 and a2
        // after rewrite only a2 lines remain (3 groups × 1 track = 3 lines)
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2);

        var audioLines = result.Split('\n')
            .Where(l => l.StartsWith("#EXT-X-MEDIA") && l.Contains("TYPE=AUDIO"))
            .ToList();

        Assert.Equal(3, audioLines.Count);
        Assert.All(audioLines, l => Assert.Contains("DEFAULT=YES", l));
    }

    [Fact]
    public void Hls4_VideoStreamLinesAreNotModified()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2);

        var streamInfLines = result.Split('\n')
            .Where(l => l.StartsWith("#EXT-X-STREAM-INF"))
            .ToList();

        Assert.NotEmpty(streamInfLines);
        Assert.All(streamInfLines, l => Assert.DoesNotContain("DEFAULT=", l));
    }

    [Fact]
    public void Hls4_AbsoluteUrlsArePreserved()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2);

        // video stream URLs (non-# lines) must still be absolute
        var urlLines = result.Split('\n')
            .Where(l => l.Length > 0 && l[0] != '#')
            .ToList();

        Assert.NotEmpty(urlLines);
        Assert.All(urlLines, l => Assert.Contains("://", l));
    }

    // ── hls2 master playlist (legacy muxed-audio segment names) ──────────

    [Fact]
    public void Hls2_SelectTrack2_RewritesVideoSegmentNames()
    {
        var manifest = Fixture("hls2_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls2/TOKEN/master-v1a1.m3u8?loc=ru", audioIndex: 2);

        Assert.Contains("index-v1a2.m3u8", result);
        Assert.Contains("index-v2a2.m3u8", result);
        Assert.DoesNotContain("index-v1a1.m3u8", result);
    }

    [Fact]
    public void Hls2_SelectTrack2_RewritesIframeSegmentNames()
    {
        var manifest = Fixture("hls2_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls2/TOKEN/master-v1a1.m3u8?loc=ru", audioIndex: 2);

        Assert.Contains("iframes-v1a2.m3u8", result);
        Assert.DoesNotContain("iframes-v1a1.m3u8", result);
    }

    [Fact]
    public void Hls2_MediaPlaylist_RewritesTsSegmentNames()
    {
        var manifest = Fixture("hls2_media_playlist.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls2/TOKEN/index-v1a1.m3u8?loc=ru", audioIndex: 2);

        Assert.Contains("seg-1-v1-a2.ts", result);
        Assert.Contains("seg-2-v1-a2.ts", result);
        Assert.DoesNotContain("seg-1-v1-a1.ts", result);
    }

    [Fact]
    public void Hls2_RelativeUrlsMadeAbsolute()
    {
        var manifest = Fixture("hls2_master.m3u8");
        var sourceUrl = "http://cdn2cdn.com/hls2/TOKEN/master-v1a1.m3u8?loc=ru";
        var result = HlsRewriter.Rewrite(manifest, sourceUrl, audioIndex: 1);

        var urlLines = result.Split('\n')
            .Where(l => l.Length > 0 && l[0] != '#')
            .ToList();

        Assert.NotEmpty(urlLines);
        Assert.All(urlLines, l => Assert.StartsWith("http://cdn2cdn.com/hls2/TOKEN/", l));
    }

    // ── edge cases ────────────────────────────────────────────────────────

    [Fact]
    public void Hls4_MediaPlaylistPassedThrough_NoDefaultSwap()
    {
        // A media playlist (not master) has no #EXT-X-MEDIA lines — rewrite should be a no-op for DEFAULT
        var manifest = Fixture("hls4_media_playlist.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn.example.com/hls/TOKEN/file.mp4/index-v1.m3u8?loc=ru", audioIndex: 2);

        Assert.DoesNotContain("DEFAULT=", result);
    }

    [Fact]
    public void Hls4_NoDoubleDefaultYes()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2);

        var yesCount = result.Split('\n')
            .Count(l => l.StartsWith("#EXT-X-MEDIA") && l.Contains("TYPE=AUDIO") && l.Contains("DEFAULT=YES"));

        // exactly one DEFAULT=YES per group (3 groups)
        Assert.Equal(3, yesCount);
    }

    // ── proxyUrls ─────────────────────────────────────────────────────────

    [Fact]
    public void ProxyUrls_Hls4_VideoStreamUrlsRewrittenToProxy()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2, proxyUrls: true);

        var urlLines = result.Split('\n')
            .Where(l => l.Length > 0 && l[0] != '#')
            .ToList();

        Assert.NotEmpty(urlLines);
        Assert.All(urlLines, l =>
        {
            if (l.Contains(".m3u8"))
                Assert.StartsWith("/hls/rewrite?url=", l);
            else
                Assert.StartsWith("/proxy?url=", l);
        });
        Assert.DoesNotContain(urlLines, l => l.Contains("://cdn"));
    }

    [Fact]
    public void ProxyUrls_Hls4_SubManifestsIncludeProxyTrue()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2, proxyUrls: true);

        var m3u8Lines = result.Split('\n')
            .Where(l => l.StartsWith("/hls/rewrite?"))
            .ToList();

        Assert.NotEmpty(m3u8Lines);
        Assert.All(m3u8Lines, l => Assert.Contains("&proxy=true", l));
    }

    [Fact]
    public void ProxyUrls_Hls4_AudioUriRewrittenToProxy()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2, proxyUrls: true);

        var audioLines = result.Split('\n')
            .Where(l => l.StartsWith("#EXT-X-MEDIA") && l.Contains("URI=\""))
            .ToList();

        Assert.NotEmpty(audioLines);
        Assert.All(audioLines, l =>
        {
            Assert.Contains("URI=\"/hls/rewrite?url=", l);
            Assert.Contains("&proxy=true", l);
        });
    }

    [Fact]
    public void ProxyUrls_Hls2_SegmentUrlsRewrittenToProxy()
    {
        var manifest = Fixture("hls2_media_playlist.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls2/TOKEN/index-v1a1.m3u8?loc=ru", audioIndex: 2, proxyUrls: true);

        var urlLines = result.Split('\n')
            .Where(l => l.Length > 0 && l[0] != '#')
            .ToList();

        Assert.NotEmpty(urlLines);
        Assert.All(urlLines, l => Assert.StartsWith("/proxy?url=", l));
    }

    [Fact]
    public void ProxyUrls_False_UrlsRemainAbsolute()
    {
        var manifest = Fixture("hls4_master.m3u8");
        var result = HlsRewriter.Rewrite(manifest,
            "http://cdn2cdn.com/hls4/TOKEN/137590.m3u8?loc=ru", audioIndex: 2, proxyUrls: false);

        var urlLines = result.Split('\n')
            .Where(l => l.Length > 0 && l[0] != '#')
            .ToList();

        Assert.NotEmpty(urlLines);
        Assert.All(urlLines, l => Assert.Contains("://", l));
        Assert.DoesNotContain(urlLines, l => l.StartsWith("/hls/"));
    }

    // ── plainHttp (Tizen 2.x ECC-cert workaround) ───────────────────────────

    [Fact]
    public void PlainHttp_MasterPlaylist_M3u8LinesRouteThroughRewrite()
    {
        // master -> level: nested .m3u8 references must re-enter /hls/rewrite (with
        // the ORIGINAL https url escaped inside) so the backend can fetch and rewrite
        // the level playlist server-side, rather than being downgraded in place.
        const string manifest =
            "#EXTM3U\n" +
            "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4201905,AUDIO=\"audio1080\"\n" +
            "https://cdn.cdntogo.net/hls/TOKEN/index-v1.m3u8?loc=ru\n" +
            "#EXT-X-I-FRAME-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=525238,URI=\"https://cdn.cdntogo.net/hls/TOKEN/iframes-v1.m3u8?loc=ru\"";

        var result = HlsRewriter.Rewrite(manifest,
            "https://cdn.cdntogo.net/hls/TOKEN/137590.m3u8?loc=ru", audioIndex: 2, plainHttp: true);

        var expectedStream = "/hls/rewrite?url=" +
            Uri.EscapeDataString("https://cdn.cdntogo.net/hls/TOKEN/index-v1.m3u8?loc=ru") + "&audio=2&plain=true";
        var expectedIframe = "URI=\"/hls/rewrite?url=" +
            Uri.EscapeDataString("https://cdn.cdntogo.net/hls/TOKEN/iframes-v1.m3u8?loc=ru") + "&audio=2&plain=true\"";

        Assert.Contains(expectedStream, result);
        Assert.Contains(expectedIframe, result);
        Assert.DoesNotContain("proxy=true", result);
        Assert.DoesNotContain("https://", result);
    }

    [Fact]
    public void PlainHttp_LevelPlaylist_SegmentLinesDowngradeToHttp()
    {
        // level playlist: the CDN's own absolute https:// segment urls (not seen by the
        // make-relative-absolute step, since they're already absolute) must still be
        // downgraded to http for the Tizen 2.x client to load them directly.
        const string manifest =
            "#EXTM3U\n" +
            "#EXT-X-TARGETDURATION:10\n" +
            "#EXT-X-VERSION:3\n" +
            "#EXT-X-MEDIA-SEQUENCE:1\n" +
            "#EXTINF:10.010,\n" +
            "https://cdn.cdntogo.net/hls/TOKEN/seg-1-v1-a1.ts\n" +
            "#EXTINF:10.010,\n" +
            "https://cdn.cdntogo.net/hls/TOKEN/seg-2-v1-a1.ts\n" +
            "#EXT-X-ENDLIST";

        var result = HlsRewriter.Rewrite(manifest,
            "https://cdn.cdntogo.net/hls/TOKEN/index-v1a1.m3u8?loc=ru", audioIndex: 1, plainHttp: true);

        Assert.Contains("http://cdn.cdntogo.net/hls/TOKEN/seg-1-v1-a1.ts", result);
        Assert.Contains("http://cdn.cdntogo.net/hls/TOKEN/seg-2-v1-a1.ts", result);
        Assert.DoesNotContain("https://", result);
    }

    [Fact]
    public void PlainHttp_WithProxyUrls_InnerUrlsStayHttps()
    {
        const string manifest =
            "#EXTM3U\n" +
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"rus\",URI=\"https://cdn.cdntogo.net/hls/TOKEN/index-a1.m3u8?loc=ru\"\n" +
            "#EXTINF:10.010,\n" +
            "https://cdn.cdntogo.net/hls/TOKEN/seg-1.ts\n" +
            "#EXT-X-ENDLIST";

        // proxyUrls=true must win: segments route through /proxy (or /hls/rewrite) with
        // the original https CDN url escaped inside, not downgraded to http
        var result = HlsRewriter.Rewrite(manifest,
            "https://cdn.cdntogo.net/hls/TOKEN/index-v1.m3u8?loc=ru", audioIndex: 1,
            proxyUrls: true, plainHttp: true);

        Assert.Contains("/proxy?url=" + Uri.EscapeDataString("https://cdn.cdntogo.net/hls/TOKEN/seg-1.ts"), result);
        Assert.Contains("URI=\"/hls/rewrite?url=" + Uri.EscapeDataString("https://cdn.cdntogo.net/hls/TOKEN/index-a1.m3u8?loc=ru"), result);
    }

    [Fact]
    public void PlainHttp_CommentLineNonUriHttpsUntouched()
    {
        const string manifest =
            "#EXTM3U\n" +
            "#EXT-X-COMMENT:see https://example.com/note for details\n" +
            "#EXTINF:10.010,\n" +
            "seg-1.ts\n" +
            "#EXT-X-ENDLIST";

        var result = HlsRewriter.Rewrite(manifest,
            "https://cdn.cdntogo.net/hls/TOKEN/index-v1.m3u8?loc=ru", audioIndex: 1, plainHttp: true);

        // comment lines are never touched by the rewriter (no full-line or URI="" match)
        Assert.Contains("#EXT-X-COMMENT:see https://example.com/note for details", result);
    }
}
