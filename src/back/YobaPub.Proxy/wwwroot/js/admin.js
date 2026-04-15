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
    if (!el) return;
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

/* ── Row copy (single entry) ─────────────────────── */

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

/* ── Htmx hooks ──────────────────────────────────── */

document.addEventListener('htmx:sendError', () => {
  const el = document.getElementById('conn-error');
  if (el) el.classList.remove('hidden');
});
document.addEventListener('htmx:afterRequest', (e) => {
  if (e.detail.successful) {
    const el = document.getElementById('conn-error');
    if (el) el.classList.add('hidden');
  }
});

/* ── Click dispatcher ────────────────────────────── */

document.addEventListener('click', (e) => {
  if (Dropdowns.handleClick(e)) return;
  if (LogCopy.handleRowCopy(e)) return;
  LogCopy.handleEntryCopy(e);
});

/* ── Alpine: logs page ───────────────────────────── */

const FIELDS = ['Level', 'Category', 'DeviceId', 'TraceId', 'ClientIp'];

const emptyFilters = () => {
  const f = {};
  FIELDS.forEach((k) => { f[k] = { inc: [], exc: [] }; });
  return f;
};

const buildQuery = (comp, extra = {}) => {
  const store = window.Alpine.store('logs');
  const filters = FIELDS
    .filter((k) => store.filters[k].inc.length || store.filters[k].exc.length)
    .map((k) => ({ field: k, includes: store.filters[k].inc, excludes: store.filters[k].exc }));
  return {
    filters,
    search: comp.search,
    pageSize: comp.pageSize,
    ...extra,
  };
};

const postJson = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const logsStoreDef = {
  filters: emptyFilters(),
  addIncl(field, value) {
    const arr = this.filters[field].inc;
    if (!arr.includes(value)) arr.push(value);
    window.dispatchEvent(new CustomEvent('logs:filters-changed'));
  },
  addExcl(field, value) {
    const arr = this.filters[field].exc;
    if (!arr.includes(value)) arr.push(value);
    window.dispatchEvent(new CustomEvent('logs:filters-changed'));
  },
  removeChip(field, mode, value) {
    const arr = this.filters[field][mode];
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1);
    window.dispatchEvent(new CustomEvent('logs:filters-changed'));
  },
  resetAll() {
    this.filters = emptyFilters();
    window.dispatchEvent(new CustomEvent('logs:filters-changed'));
  },
};

const registerLogsStore = () => {
  if (!window.Alpine || !window.Alpine.store) return false;
  try { if (window.Alpine.store('logs')) return true; } catch (_) { /* not registered yet */ }
  window.Alpine.store('logs', logsStoreDef);
  return true;
};

document.addEventListener('alpine:init', registerLogsStore);
registerLogsStore();

window.logsPage = () => ({
    search: '',
    pageSize: 100,
    autoRefresh: false,
    status: '',
    topId: '',
    lastId: null,
    hasMore: false,
    loading: false,
    _timer: null,
    boot() {
      const el = document.getElementById('page-content');
      this.topId = el?.dataset.topId || '';
      this.lastId = el?.dataset.lastId || null;
      this.readSentinel();
      window.addEventListener('logs:filters-changed', () => this.doSearch());
      this.$watch('autoRefresh', () => this.tick());
      this.tick();
      this.observeLoadMore();
    },
    observeLoadMore() {
      const el = this.$refs?.loadMoreEl;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && this.hasMore && !this.loading) this.loadMore();
      });
      io.observe(el);
    },
    readSentinel() {
      const s = document.querySelector('#logs-tbody tr[data-top-id]');
      if (!s) return;
      this.topId = s.dataset.topId || this.topId;
      this.lastId = s.dataset.lastId || null;
      this.hasMore = s.dataset.hasMore === '1';
    },
    fieldChips(field) {
      const { inc, exc } = window.Alpine.store('logs').filters[field];
      const out = [];
      inc.forEach((value) => out.push({ key: `${field}:i:${value}`, field, mode: 'inc', value }));
      exc.forEach((value) => out.push({ key: `${field}:e:${value}`, field, mode: 'exc', value }));
      return out;
    },
    removeFilter(field, mode, value) {
      window.Alpine.store('logs').removeChip(field, mode === 'inc' ? 'inc' : 'exc', value);
    },
    reset() {
      window.Alpine.store('logs').resetAll();
    },
    async doSearch() {
      this.loading = true;
      try {
        const r = await postJson('/admin/logs/search', buildQuery(this));
        const html = await r.text();
        document.getElementById('logs-tbody').innerHTML = html;
        this.readSentinel();
      } finally { this.loading = false; }
    },
    async loadMore() {
      if (!this.lastId) return;
      this.loading = true;
      try {
        const r = await postJson('/admin/logs/search', buildQuery(this, { before: this.lastId }));
        const html = await r.text();
        const tbody = document.getElementById('logs-tbody');
        const tmp = document.createElement('tbody');
        tmp.innerHTML = html;
        const sentinel = tmp.querySelector('tr[data-top-id]');
        if (sentinel) {
          this.lastId = sentinel.dataset.lastId || null;
          this.hasMore = sentinel.dataset.hasMore === '1';
          sentinel.remove();
        }
        while (tmp.firstChild) tbody.appendChild(tmp.firstChild);
      } finally { this.loading = false; }
    },
    tick() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (!this.autoRefresh) return;
      this._timer = setInterval(() => this.refresh(), 10000);
    },
    async refresh() {
      if (!this.topId) return this.doSearch();
      const r = await postJson('/admin/logs/search', buildQuery(this, { after: this.topId }));
      const html = await r.text();
      const tmp = document.createElement('tbody');
      tmp.innerHTML = html;
      const sentinel = tmp.querySelector('tr[data-top-id]');
      if (sentinel) { this.topId = sentinel.dataset.topId || this.topId; sentinel.remove(); }
      const tbody = document.getElementById('logs-tbody');
      const firstReal = tbody.querySelector('tr:not([data-top-id])');
      while (tmp.lastChild) tbody.insertBefore(tmp.lastChild, firstReal);
    },
    async download(limit) {
      Dropdowns.closeAll();
      const r = await postJson('/admin/logs/download', { query: buildQuery(this), limit });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs_${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    },
    async copy(limit) {
      Dropdowns.closeAll();
      const r = await postJson('/admin/logs/tsv', { query: buildQuery(this), limit });
      const text = await r.text();
      Clipboard.copy(text);
      this.flashStatus('Скопировано!');
    },
    async share(ttlDays) {
      Dropdowns.closeAll();
      const r = await postJson('/admin/logs/share', { query: buildQuery(this), ttlDays });
      const res = await r.json();
      Clipboard.copy(`${res.url}/tsv`);
      this.flashStatus('TSV-ссылка скопирована');
    },
    async clearLogs() {
      await fetch('/admin/logs/clear', { method: 'POST' });
      this.doSearch();
    },
    flashStatus(text) {
      this.status = text;
      setTimeout(() => { if (this.status === text) this.status = ''; }, FLASH_DURATION);
    },
  });
