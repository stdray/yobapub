using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin")]
[Authorize]
public class AdminController(PlaybackErrorStore errorStore) : Controller
{
    [HttpGet("")]
    public IActionResult Index() => Redirect("/admin/logs");

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
}
