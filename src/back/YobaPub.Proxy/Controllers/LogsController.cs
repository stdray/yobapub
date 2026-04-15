using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin/logs")]
[Authorize]
public class LogsController(LogStore store, LogShareStore shares) : Controller
{
    [HttpGet("")]
    public IActionResult Index()
    {
        var query = new LogsQuery();
        var (entries, hasMore) = store.QueryWithCursor(query);
        return View(new LogsViewModel
        {
            Entries = entries,
            Query   = query,
            HasMore = hasMore,
            TopId   = entries.Length > 0 ? entries[0].Id.ToString() : store.NewCursorId(),
            LastId  = entries.Length > 0 ? entries[^1].Id.ToString() : null
        });
    }

    [HttpPost("search")]
    public IActionResult Search([FromBody] LogsQuery query)
    {
        var (entries, hasMore) = store.QueryWithCursor(query);
        return PartialView("_Rows", new LogsViewModel
        {
            Entries = entries,
            Query   = query,
            HasMore = hasMore,
            TopId   = entries.Length > 0 ? entries[0].Id.ToString() : store.NewCursorId(),
            LastId  = entries.Length > 0 ? entries[^1].Id.ToString() : null
        });
    }

    [HttpGet("{id}")]
    public IActionResult Entry(string id)
    {
        var entry = store.FindById(id);
        if (entry == null) return NotFound();
        return View(entry);
    }

    [HttpGet("{id}/text")]
    public IActionResult EntryText(string id)
    {
        var entry = store.FindById(id);
        if (entry == null) return NotFound();
        return Content(LogFormatter.FormatEntry(entry), "text/plain; charset=utf-8");
    }

    [HttpPost("download")]
    public IActionResult Download([FromBody] DownloadRequest req)
    {
        var entries = store.QueryAll(req.Query ?? new LogsQuery());
        if (req.Limit is > 0)
            entries = entries.Take(req.Limit.Value).ToArray();
        var tsv = LogFormatter.FormatTsv(entries, includeIp: true);
        var bytes = System.Text.Encoding.UTF8.GetBytes(tsv);
        var filename = $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.tsv";
        return File(bytes, "text/tab-separated-values", filename);
    }

    [HttpPost("tsv")]
    public IActionResult Tsv([FromBody] DownloadRequest req)
    {
        var entries = store.QueryAll(req.Query ?? new LogsQuery());
        if (req.Limit is > 0)
            entries = entries.Take(req.Limit.Value).ToArray();
        return Content(LogFormatter.FormatTsv(entries, includeIp: true), "text/plain; charset=utf-8");
    }

    [HttpPost("share")]
    public IActionResult Share([FromBody] ShareRequest req)
    {
        TimeSpan? ttl = req.TtlDays is > 0 ? TimeSpan.FromDays(req.TtlDays.Value) : null;
        var share = shares.Create(req.Query ?? new LogsQuery(), ttl, User.Identity?.Name ?? "");
        var token = new ShortGuid(share.Id);
        var url = $"{Request.Scheme}://{Request.Host}/s/logs/{token}";
        return Json(new { token = token.ToString(), url, expiresAt = share.ExpiresAt });
    }

    [HttpPost("clear")]
    public IActionResult Clear()
    {
        store.DeleteAll();
        return NoContent();
    }

    public sealed record DownloadRequest(LogsQuery? Query, int? Limit);
    public sealed record ShareRequest(LogsQuery? Query, int? TtlDays);
}
