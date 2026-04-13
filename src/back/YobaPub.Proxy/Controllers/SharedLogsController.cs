using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("s/logs")]
[AllowAnonymous]
public class SharedLogsController(LogStore store, LogShareStore shares) : Controller
{
    [HttpGet("{token}")]
    public IActionResult Index(ShortGuid token)
    {
        var share = shares.Get(token);
        if (share == null) return NotFound();
        var query = LogShareStore.ToQuery(share);
        var (entries, hasMore) = store.QueryWithCursor(query);
        return View(new SharedLogsViewModel
        {
            Entries = entries,
            Query = query,
            Token = token,
            ExpiresAt = share.ExpiresAt,
            HasMore = hasMore
        });
    }

    [HttpGet("{token}/tsv")]
    public IActionResult Tsv(ShortGuid token, int? limit)
    {
        var share = shares.Get(token);
        if (share == null) return NotFound();
        var query = LogShareStore.ToQuery(share);
        var entries = store.QueryAll(query);
        var take = limit is > 0 ? limit.Value : query.PageSize;
        entries = entries.Take(take).ToArray();
        return Content(LogFormatter.FormatTsv(entries, includeIp: false), "text/plain; charset=utf-8");
    }
}
