using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin")]
[Authorize]
public class AdminController(LogStore store) : Controller
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
    public IActionResult DownloadLogs(LogsQuery query)
    {
        var entries = store.QueryAll(query);
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Time\tDevice\tLevel\tCategory\tMessage");
        foreach (var e in entries)
            sb.AppendLine($"{e.ServerTs.ToLocalTime():yyyy-MM-dd HH:mm:ss}\t{e.DeviceId}\t{e.Level}\t{e.Category}\t{e.Message}");
        var bytes = System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        var filename = $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.tsv";
        return File(bytes, "text/tab-separated-values", filename);
    }

    [HttpPost("logs/clear")]
    public IActionResult ClearLogs(LogsQuery query)
    {
        store.DeleteAll();
        return RedirectToAction(nameof(Logs), query);
    }
}
