import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { HistoryEntry, HistoryResponse } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { PageUtils } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { storage } from '../utils/storage';
import { getHistory } from '../api/history';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

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

class HistoryPage extends SidebarPage {
  private entries: HistoryEntry[] = [];
  private focusedIndex = 0;
  private currentPage = 1;
  private totalPages = 1;
  private loading = false;
  private pendingFocusCol = -1;

  constructor() { super('history'); }

  protected onUnfocus(): void { this.updateFocus(); }

  protected onMount(params: RouteParams): void {
    const page = params.historyPage || 1;
    this.focusedIndex = params.historyFocusedIndex || 0;
    this.loading = false;
    this.pendingFocusCol = -1;
    this.loadPage(page);
  }

  protected onUnmount(): void {
    this.entries = [];
    this.loading = false;
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.loading || this.entries.length === 0) { sidebar.handleEmptyState(e); return; }

    switch (e.keyCode) {
      case TvKey.Right: {
        const nr = gridMove(this.focusedIndex, this.entries.length, 'right');
        if (nr >= 0) { this.focusedIndex = nr; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Left: {
        const nl = sidebar.gridLeftOrFocus(this.focusedIndex, this.entries.length);
        if (nl >= 0) { this.focusedIndex = nl; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Down: {
        const nd = gridMove(this.focusedIndex, this.entries.length, 'down');
        if (nd >= 0) {
          this.focusedIndex = nd;
          this.updateFocus();
        } else if (this.currentPage < this.totalPages) {
          this.focusedIndex = 0;
          this.pendingFocusCol = -1;
          this.loadPage(this.currentPage + 1);
        }
        e.preventDefault(); break;
      }
      case TvKey.Up: {
        const nu = gridMove(this.focusedIndex, this.entries.length, 'up');
        if (nu >= 0) {
          this.focusedIndex = nu;
          this.updateFocus();
        } else if (this.currentPage > 1) {
          this.pendingFocusCol = gridPos(this.focusedIndex, this.entries.length).col;
          this.loadPage(this.currentPage - 1);
        }
        e.preventDefault(); break;
      }
      case TvKey.Enter: {
        const entry = this.entries[this.focusedIndex];
        if (entry) {
          router.setParams({ historyPage: this.currentPage, historyFocusedIndex: this.focusedIndex });
          router.navigateItem(entry.item, entry.media.id);
        }
        e.preventDefault(); break;
      }
      default: sidebar.backOrFocus(e);
    }
  }

  private buildCards(): string {
    if (this.entries.length === 0) {
      return tplEmptyText({ text: 'История пуста' });
    }
    let html = '';
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const isSerial = e.item.type === 'serial' || e.item.type === 'docuserial';
      let extra = formatDate(e.last_seen);
      if (isSerial && e.media.snumber != null && e.media.number != null) {
        extra = 'S' + e.media.snumber + 'E' + e.media.number + ' · ' + extra;
      }
      html += tplCard({
        id: e.item.id,
        poster: storage.proxyPosterUrl(e.item.posters.medium),
        title: e.item.title,
        extra: extra
      });
    }
    return html;
  }

  private render(): void {
    const pager = this.totalPages > 1 ? 'Страница ' + this.currentPage + ' из ' + this.totalPages : '';
    this.$root.html(tplLayout({ cards: this.buildCards(), pager: pager }));
    this.updateFocus();
  }

  private updateFocus(): void {
    this.$root.find('.card').removeClass('focused');
    if (this.entries.length === 0) { return; }
    const idx = Math.min(this.focusedIndex, this.entries.length - 1);
    const $card = this.$root.find('.card').eq(idx);
    $card.addClass('focused');
    PageUtils.scrollIntoView($card[0], this.$root.find('.watching')[0]);
  }

  private loadPage(page: number): void {
    if (this.loading) { return; }
    this.loading = true;
    PageUtils.showSpinnerIn(this.$root);
    getHistory(page).then(
      (res: HistoryResponse) => {
        this.entries = (res && res.history) || [];
        const pagination = (res && res.pagination) || { current: page, total: 1 };
        this.currentPage = pagination.current || page;
        this.totalPages = pagination.total || 1;
        this.loading = false;

        if (this.pendingFocusCol >= 0) {
          const pg = gridPos(0, this.entries.length);
          this.focusedIndex = Math.min((pg.totalRows - 1) * CARDS_PER_ROW + this.pendingFocusCol, this.entries.length - 1);
          this.pendingFocusCol = -1;
        } else if (this.focusedIndex >= this.entries.length) {
          this.focusedIndex = Math.max(0, this.entries.length - 1);
        }

        this.render();
      },
      () => {
        this.loading = false;
        this.$root.html(
          '<div class="content"><div class="watching">' +
          tplEmptyText({ text: 'Ошибка загрузки' }) +
          '</div></div>'
        );
      }
    );
  }
}

export const historyPage = new HistoryPage();
