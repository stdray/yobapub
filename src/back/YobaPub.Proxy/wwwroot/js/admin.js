/* ── Constants ────────────────────────────────────── */

const ICON_COPY = '\u2398';
const ICON_DONE = '\u2713';
const FLASH_DURATION = 2000;
const COPY_FLASH_DURATION = 1500;

/* ── Clipboard ───────────────────────────────────── */

class Clipboard {
  static copy(text) {
    if (navigator.clipboard) { navigator.clipboard.writeText(text); return; }
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  }

  static flashText(el, text, ms = FLASH_DURATION) {
    const prev = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = prev; }, ms);
  }
}

/* ── Dropdowns ───────────────────────────────────── */

class Dropdowns {
  static closeAll() {
    document.querySelectorAll('.dropdown-menu').forEach((m) => { m.style.display = ''; });
  }

  static handleClick(e) {
    const toggle = e.target.closest('.dropdown-toggle');
    if (toggle) {
      const menu = toggle.nextElementSibling;
      const wasOpen = menu.style.display === 'block';
      Dropdowns.closeAll();
      menu.style.display = wasOpen ? '' : 'block';
      return true;
    }
    if (!e.target.closest('.dropdown')) Dropdowns.closeAll();
    return false;
  }
}

/* ── Log copy actions ────────────────────────────── */

class LogCopy {
  static handleRowCopy(e) {
    const btn = e.target.closest('[data-copy-url]');
    if (!btn) return false;
    fetch(btn.dataset.copyUrl).then((r) => r.text()).then((t) => {
      Clipboard.copy(t);
      btn.textContent = ICON_DONE;
      setTimeout(() => { btn.textContent = ICON_COPY; }, COPY_FLASH_DURATION);
    });
    return true;
  }

  static handleBulkCopy(e) {
    const link = e.target.closest('[data-copy-logs]');
    if (!link) return false;
    e.preventDefault();
    Dropdowns.closeAll();
    const limit = parseInt(link.dataset.copyLogs, 10);
    const qs = document.getElementById('page-content').dataset.filterQs;
    const url = `/admin/logs/tsv?${qs}${limit ? `&limit=${limit}` : ''}`;
    fetch(url).then((r) => r.text()).then((text) => {
      Clipboard.copy(text);
      Clipboard.flashText(document.getElementById('status'), 'Скопировано!');
    });
    return true;
  }

  static handleEntryCopy(e) {
    const btn = e.target.closest('.copy-all-btn');
    if (!btn) return false;
    const el = document.getElementById('entry-data');
    if (!el) return false;
    fetch(`/admin/logs/${el.dataset.entryId}/text`).then((r) => r.text()).then((text) => {
      Clipboard.copy(text);
      Clipboard.flashText(btn, 'Скопировано!');
    });
    return true;
  }
}

/* ── Level filter ────────────────────────────────── */

class LevelFilter {
  static apply() {
    const checked = Array.from(document.querySelectorAll('.lvl-cb'))
      .filter((c) => c.checked)
      .map((c) => c.value);
    const sel = document.getElementById('level-select');
    Array.from(sel.options).forEach((o) => {
      o.selected = checked.includes(o.value);
    });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  static handleClick(e) {
    if (e.target.closest('#lvl-toggle')) {
      document.getElementById('lvl-dropdown').classList.toggle('lvl-dropdown--open');
      return true;
    }
    if (e.target.closest('.lvl')) return false;
    const dd = document.getElementById('lvl-dropdown');
    if (dd?.classList.contains('lvl-dropdown--open')) {
      dd.classList.remove('lvl-dropdown--open');
      LevelFilter.apply();
    }
    return false;
  }
}

/* ── Htmx hooks ──────────────────────────────────── */

class HtmxHooks {
  static init() {
    document.addEventListener('htmx:configRequest', (e) => {
      const params = e.detail.parameters;
      Object.keys(params).forEach((k) => {
        const v = params[k];
        if (v === '' || (Array.isArray(v) && v.length === 0)) delete params[k];
      });
    });
    document.addEventListener('htmx:sendError', () => {
      document.getElementById('conn-error').style.display = '';
    });
    document.addEventListener('htmx:afterRequest', (e) => {
      if (e.detail.successful) document.getElementById('conn-error').style.display = 'none';
    });
  }
}

/* ── Init ─────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  if (Dropdowns.handleClick(e)) return;
  if (LogCopy.handleRowCopy(e)) return;
  if (LogCopy.handleBulkCopy(e)) return;
  if (LogCopy.handleEntryCopy(e)) return;
  LevelFilter.handleClick(e);
});

HtmxHooks.init();
