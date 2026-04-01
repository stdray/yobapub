import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { HistoryEntry } from '../types/api';
import { navigate, goBack, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { proxyPosterUrl } from '../utils/storage';
import { getHistory } from '../api/history';
import { sidebar } from '../sidebar';

const $root = $('#page-history');
const keys = pageKeys();

let entries: HistoryEntry[] = [];
let focusedIndex = 0;
let currentPage = 1;
let totalPages = 1;
let loading = false;
let pendingFocusCol = -1;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const formatDate = (unix: number): string => {
  const d = new Date(unix * 1000);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
};

const tplLayoutCompiled = doT.template(`
  <div class="content"><div class="watching">
    <div class="watching__section-title">История просмотров</div>
    <div class="watching__grid" data-section="0">{{=it.cards}}</div>
    {{?it.pager}}<div class="history__pager">{{=it.pager}}</div>{{?}}
  </div></div>
`);

const tplLayout = (data: { readonly cards: string; readonly pager: string }): string =>
  tplLayoutCompiled(data);

const buildCards = (): string => {
  if (entries.length === 0) {
    return tplEmptyText({ text: 'История пуста' });
  }
  let html = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const isSerial = e.item.type === 'serial' || e.item.type === 'docuserial';
    let extra = formatDate(e.last_seen);
    if (isSerial && e.media.snumber != null && e.media.number != null) {
      extra = 'S' + e.media.snumber + 'E' + e.media.number + ' · ' + extra;
    }
    html += tplCard({
      id: e.item.id,
      poster: proxyPosterUrl(e.item.posters.medium),
      title: e.item.title,
      extra: extra
    });
  }
  return html;
};

const render = (): void => {
  const pager = totalPages > 1 ? 'Страница ' + currentPage + ' из ' + totalPages : '';
  $root.html(tplLayout({ cards: buildCards(), pager: pager }));
  updateFocus();
};

const updateFocus = (): void => {
  $root.find('.card').removeClass('focused');
  if (entries.length === 0) { return; }
  const idx = Math.min(focusedIndex, entries.length - 1);
  const $card = $root.find('.card').eq(idx);
  $card.addClass('focused');
  scrollIntoView($card[0], $root.find('.watching')[0]);
};

const loadPage = (page: number): void => {
  if (loading) { return; }
  loading = true;
  showSpinnerIn($root);
  getHistory(page).then(
    (res: any) => {
      const data = Array.isArray(res) ? res[0] : res;
      entries = (data && data.history) || [];
      const pagination = (data && data.pagination) || {};
      currentPage = pagination.current || page;
      totalPages = pagination.total || 1;
      loading = false;

      if (pendingFocusCol >= 0) {
        const pg = gridPos(0, entries.length);
        focusedIndex = Math.min((pg.totalRows - 1) * CARDS_PER_ROW + pendingFocusCol, entries.length - 1);
        pendingFocusCol = -1;
      } else if (focusedIndex >= entries.length) {
        focusedIndex = Math.max(0, entries.length - 1);
      }

      render();
    },
    () => {
      loading = false;
      $root.html(
        '<div class="content"><div class="watching">' +
        tplEmptyText({ text: 'Ошибка загрузки' }) +
        '</div></div>'
      );
    }
  );
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (loading || entries.length === 0) { sidebar.handleEmptyState(e); return; }

  switch (e.keyCode) {
    case TvKey.Right: {
      const nr = gridMove(focusedIndex, entries.length, 'right');
      if (nr >= 0) { focusedIndex = nr; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Left: {
      const nl = sidebar.gridLeftOrFocus(focusedIndex, entries.length);
      if (nl >= 0) { focusedIndex = nl; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Down: {
      const nd = gridMove(focusedIndex, entries.length, 'down');
      if (nd >= 0) {
        focusedIndex = nd;
        updateFocus();
      } else if (currentPage < totalPages) {
        focusedIndex = 0;
        pendingFocusCol = -1;
        loadPage(currentPage + 1);
      }
      e.preventDefault(); break;
    }
    case TvKey.Up: {
      const nu = gridMove(focusedIndex, entries.length, 'up');
      if (nu >= 0) {
        focusedIndex = nu;
        updateFocus();
      } else if (currentPage > 1) {
        pendingFocusCol = gridPos(focusedIndex, entries.length).col;
        loadPage(currentPage - 1);
      }
      e.preventDefault(); break;
    }
    case TvKey.Enter: {
      const entry = entries[focusedIndex];
      if (entry) {
        setParams({ historyPage: currentPage, historyFocusedIndex: focusedIndex });
        const isSerial = entry.item.type === 'serial' || entry.item.type === 'docuserial';
        if (isSerial) {
          navigate('serial', { id: entry.item.id, episodeId: entry.media.id });
        } else {
          navigate('movie', { id: entry.item.id });
        }
      }
      e.preventDefault(); break;
    }
    default: sidebar.backOrFocus(e);
  }
});

export const historyPage: Page = {
  mount(params: RouteParams) {
    const page = params.historyPage || 1;
    focusedIndex = params.historyFocusedIndex || 0;
    loading = false;
    pendingFocusCol = -1;
    sidebar.setUnfocusHandler(() => updateFocus());
    loadPage(page);
    keys.bind(handleKey);
  },

  unmount() {
    keys.unbind();
    clearPage($root);
    sidebar.setUnfocusHandler(null);
    entries = [];
    loading = false;
  }
};
