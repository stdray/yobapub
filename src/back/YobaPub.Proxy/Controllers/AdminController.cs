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
}
