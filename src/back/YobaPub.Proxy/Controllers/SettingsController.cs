using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin/settings")]
[Authorize]
public class SettingsController(DebugSettingsStore debugSettings) : Controller
{
    [HttpGet("")]
    public IActionResult Index() =>
        View(new SettingsViewModel { DebugEnabled = debugSettings.IsEnabled });

    [HttpPost("debug")]
    public IActionResult ToggleDebug()
    {
        debugSettings.SetEnabled(!debugSettings.IsEnabled);
        return RedirectToAction(nameof(Index));
    }
}
