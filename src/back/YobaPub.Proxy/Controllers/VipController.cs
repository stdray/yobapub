using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YobaPub.Proxy.Models;

namespace YobaPub.Proxy.Controllers;

[Route("admin/vip")]
[Authorize]
public class VipController(VipLoginStore store) : Controller
{
    [HttpGet("")]
    public IActionResult Index()
    {
        return View(new VipViewModel { Logins = store.GetAll() });
    }

    [HttpPost("add")]
    public IActionResult Add(string login)
    {
        if (string.IsNullOrWhiteSpace(login))
            return View("Index", new VipViewModel { Logins = store.GetAll(), Error = "Логин не может быть пустым" });

        if (!store.Add(login))
            return View("Index", new VipViewModel { Logins = store.GetAll(), Error = $"Логин \"{login}\" уже существует" });

        return RedirectToAction(nameof(Index));
    }

    [HttpPost("delete")]
    public IActionResult Delete(string login)
    {
        store.Remove(login);
        return RedirectToAction(nameof(Index));
    }
}
