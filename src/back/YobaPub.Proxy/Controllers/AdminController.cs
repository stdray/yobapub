using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin")]
[Authorize]
public class AdminController(LogStore store, PlaybackErrorStore errorStore) : Controller
{
    [HttpGet("")]
    public IActionResult Index() => RedirectToAction(nameof(Logs));

    [HttpGet("logs")]
    public IActionResult Logs(LogsQuery query)
    {
        var pageSize = Math.Clamp(query.PageSize > 0 ? query.PageSize : 100, 1, 500);
        var (entries, total) = store.Query(query);
        return View(new LogsViewModel
        {
            Entries    = entries,
            Query      = query,
            Total      = total,
            TotalPages = (int)Math.Ceiling((double)total / pageSize)
        });
    }

    [HttpGet("logs/download")]
    public IActionResult DownloadLogs(LogsQuery query, int? limit)
    {
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        var tsv = FormatTsv(entries);
        var bytes = System.Text.Encoding.UTF8.GetBytes(tsv);
        var filename = $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.tsv";
        return File(bytes, "text/tab-separated-values", filename);
    }

    [HttpGet("logs/tsv")]
    public IActionResult LogsTsv(LogsQuery query, int? limit)
    {
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        return Content(FormatTsv(entries), "text/plain; charset=utf-8");
    }

    [HttpPost("logs/clear")]
    public IActionResult ClearLogs(LogsQuery query)
    {
        store.DeleteAll();
        return RedirectToAction(nameof(Logs), query);
    }

    [HttpGet("playback-errors")]
    public IActionResult PlaybackErrors()
    {
        var groups = errorStore.GetGroupedByDomain();
        return View(new PlaybackErrorsViewModel
        {
            Domains = groups,
            TotalEntries = groups.Sum(g => g.TotalErrors)
        });
    }

    [HttpPost("playback-errors/clear")]
    public IActionResult ClearPlaybackErrors()
    {
        errorStore.DeleteAll();
        return RedirectToAction(nameof(PlaybackErrors));
    }

    private static string FormatTsv(LogEntry[] entries)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Time\tDevice\tTraceId\tIP\tLevel\tCategory\tMessage\tStackTrace");
        foreach (var e in entries)
        {
            var st = e.StackTrace.Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");
            sb.AppendLine($"{e.ServerTs.ToLocalTime():yyyy-MM-dd HH:mm:ss}\t{e.DeviceId}\t{e.TraceId}\t{e.ClientIp}\t{e.Level}\t{e.Category}\t{e.Message}\t{st}");
        }
        return sb.ToString();
    }
}
