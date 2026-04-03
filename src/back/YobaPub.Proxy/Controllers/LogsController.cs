using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin/logs")]
[Authorize]
public class LogsController(LogStore store) : Controller
{
    [HttpGet("")]
    public IActionResult Index(LogsQuery query)
    {
        var (entries, hasMore, total) = store.QueryWithCursor(query);
        return View(new LogsViewModel
        {
            Entries = entries,
            Query   = query,
            Total   = total,
            HasMore = hasMore,
            TopId   = entries.Length > 0 ? entries[0].Id.ToString() : store.NewCursorId(),
            LastId  = entries.Length > 0 ? entries[^1].Id.ToString() : null
        });
    }

    [HttpGet("more")]
    public IActionResult More(LogsQuery query)
    {
        var (entries, hasMore, _) = store.QueryWithCursor(query);
        var model = new LogsViewModel
        {
            Entries = entries,
            Query   = query,
            Total   = 0,
            HasMore = hasMore,
            TopId   = entries.Length > 0 ? entries[0].Id.ToString() : query.After,
            LastId  = entries.Length > 0 ? entries[^1].Id.ToString() : null
        };
        return PartialView("_Rows", model);
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
        return Content(FormatEntry(entry), "text/plain; charset=utf-8");
    }

    [HttpGet("download")]
    public IActionResult Download(LogsQuery query, int? limit)
    {
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        var tsv = FormatTsv(entries);
        var bytes = System.Text.Encoding.UTF8.GetBytes(tsv);
        var filename = $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.tsv";
        return File(bytes, "text/tab-separated-values", filename);
    }

    [HttpGet("tsv")]
    public IActionResult Tsv(LogsQuery query, int? limit)
    {
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        return Content(FormatTsv(entries), "text/plain; charset=utf-8");
    }

    [HttpPost("clear")]
    public IActionResult Clear(LogsQuery query)
    {
        store.DeleteAll();
        return RedirectToAction(nameof(Index), query);
    }

    private static string FormatTsv(LogEntry[] entries)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Time\tDevice\tTraceId\tIP\tLevel\tCategory\tMessage\tStackTrace");
        foreach (var e in entries)
        {
            var st = (e.StackTrace ?? "").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");
            sb.AppendLine($"{e.ServerTs.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}\t{e.DeviceId}\t{e.TraceId ?? ""}\t{e.ClientIp}\t{e.Level}\t{e.Category}\t{e.Message}\t{st}");
        }
        return sb.ToString();
    }

    private static string FormatEntry(LogEntry e)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Time: {e.ServerTs.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}");
        sb.AppendLine($"Device: {e.DeviceId}");
        if (!string.IsNullOrEmpty(e.TraceId)) sb.AppendLine($"TraceId: {e.TraceId}");
        sb.AppendLine($"IP: {e.ClientIp}");
        sb.AppendLine($"Level: {e.Level}");
        sb.AppendLine($"Category: {e.Category}");
        sb.AppendLine($"Message: {e.Message}");
        if (!string.IsNullOrEmpty(e.Props) && e.Props != "{}") sb.AppendLine($"Props: {e.Props}");
        if (!string.IsNullOrEmpty(e.StackTrace)) sb.AppendLine($"StackTrace:\n{e.StackTrace}");
        return sb.ToString();
    }
}
