using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin/settings")]
[Authorize]
public class SettingsController(DebugSettingsStore debugSettings, UserSettingsStore userSettings, LogShareStore shares) : Controller
{
    private string Login => User.Identity!.Name!;

    [HttpGet("")]
    public IActionResult Index() =>
        View(new SettingsViewModel
        {
            DebugEnabled    = debugSettings.IsEnabled,
            UserSettings    = userSettings.Get(Login),
            MaxLogEntries   = debugSettings.MaxLogEntries
        });

    [HttpPost("debug")]
    public IActionResult ToggleDebug()
    {
        debugSettings.SetEnabled(!debugSettings.IsEnabled);
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("max-log-entries")]
    public IActionResult SetMaxLogEntries(int max)
    {
        debugSettings.SetMaxLogEntries(Math.Max(100, max));
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("clear-shares")]
    public IActionResult ClearShares()
    {
        shares.DeleteAll();
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("timezone")]
    public IActionResult SetTimeZone(double offset)
    {
        var s = userSettings.Get(Login);
        s.TimeZoneOffsetHours = Math.Clamp(offset, -12, 14);
        userSettings.Save(s);
        return RedirectToAction(nameof(Index));
    }
}
