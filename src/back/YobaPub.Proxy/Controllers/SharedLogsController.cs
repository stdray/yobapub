using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("s/logs")]
[AllowAnonymous]
public class SharedLogsController(LogStore store, LogShareStore shares) : Controller
{
    [HttpGet("{token:guid}")]
    public IActionResult Index(Guid token)
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

    [HttpGet("{token:guid}/json")]
    public IActionResult Feed(Guid token, int? limit)
    {
        var share = shares.Get(token);
        if (share == null) return NotFound();
        var query = LogShareStore.ToQuery(share);
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        else
            entries = entries.Take(query.PageSize).ToArray();

        return Json(new
        {
            query = new
            {
                level = share.Level,
                device = share.Device,
                traceId = share.TraceId,
                search = share.Search,
                pageSize = share.PageSize
            },
            expiresAt = share.ExpiresAt,
            count = entries.Length,
            entries = entries.Select(e => new
            {
                time = e.ServerTs.UtcDateTime,
                deviceId = e.DeviceId,
                traceId = e.TraceId,
                level = e.Level,
                category = e.Category,
                message = e.Message,
                props = e.Props,
                stackTrace = e.StackTrace
            })
        });
    }

    [HttpGet("{token:guid}/text")]
    public IActionResult Text(Guid token, int? limit)
    {
        var share = shares.Get(token);
        if (share == null) return NotFound();
        var query = LogShareStore.ToQuery(share);
        var entries = store.QueryAll(query);
        if (limit is > 0)
            entries = entries.Take(limit.Value).ToArray();
        else
            entries = entries.Take(query.PageSize).ToArray();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"# Shared logs (token {token})");
        if (share.ExpiresAt.HasValue)
            sb.AppendLine($"# Expires: {share.ExpiresAt.Value.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}");
        sb.AppendLine($"# Filter: device={share.Device} traceId={share.TraceId} search={share.Search} level={string.Join(",", share.Level)}");
        sb.AppendLine($"# Count: {entries.Length}");
        sb.AppendLine();
        foreach (var e in entries)
        {
            sb.AppendLine($"[{e.ServerTs.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}] {e.Level} {e.Category} device={e.DeviceId} trace={e.TraceId}");
            sb.AppendLine($"  {e.Message}");
            if (!string.IsNullOrEmpty(e.Props) && e.Props != "{}")
                sb.AppendLine($"  props: {e.Props}");
            if (!string.IsNullOrEmpty(e.StackTrace))
                sb.AppendLine($"  stack: {e.StackTrace.Replace("\n", "\n    ")}");
        }
        return Content(sb.ToString(), "text/plain; charset=utf-8");
    }
}
