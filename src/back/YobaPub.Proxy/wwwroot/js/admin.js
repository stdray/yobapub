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

/* ── Log share ───────────────────────────────────── */

class LogShare {
  static handleClick(e) {
    const link = e.target.closest('[data-share-logs]');
    if (!link) return false;
    e.preventDefault();
    Dropdowns.closeAll();
    const ttlDays = parseInt(link.dataset.shareLogs, 10);
    const form = document.getElementById('log-filter-form');
    const data = new FormData(form);
    const sel = document.getElementById('level-select');
    Array.from(sel.selectedOptions).forEach((o) => data.append('level', o.value));
    if (ttlDays > 0) data.append('ttlDays', String(ttlDays));
    fetch('/admin/logs/share', { method: 'POST', body: data })
      .then((r) => r.json())
      .then((res) => { LogShare.showDialog(res.url); });
    return true;
  }

  static showDialog(url) {
    const dlg = document.createElement('dialog');
    dlg.className = 'share-dialog';
    const tsvUrl = `${url}/tsv`;
    const htmlUrl = url;
    dlg.innerHTML = `
      <div class="share-dialog-body">
        <div class="share-url">${htmlUrl}</div>
        <div class="share-label">Копировать ссылку</div>
        <div class="share-actions">
          <button type="button" data-share-copy="html">на HTML</button>
          <button type="button" data-share-copy="tsv">на TSV</button>
          <button type="button" data-share-close>Закрыть</button>
        </div>
      </div>
    `;
    dlg.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('[data-share-copy]');
      if (copyBtn) {
        const which = copyBtn.dataset.shareCopy;
        Clipboard.copy(which === 'tsv' ? tsvUrl : htmlUrl);
        dlg.close();
        return;
      }
      if (e.target.closest('[data-share-close]')) dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
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
  if (LogShare.handleClick(e)) return;
  LevelFilter.handleClick(e);
});

HtmxHooks.init();
