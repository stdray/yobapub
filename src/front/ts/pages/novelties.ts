import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { Item } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { PageUtils } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { storage } from '../utils/storage';
import { getItems } from '../api/items';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

const SECTIONS_CONFIG = [
  { type: 'movie',      title: 'Новые фильмы' },
  { type: 'serial',     title: 'Новые сериалы' },
  { type: 'documovie',  title: 'Новые документальные фильмы' },
  { type: 'docuserial', title: 'Новые документальные сериалы' },
  { type: '3D',         title: 'Новое в 3D' },
  { type: 'tvshow',     title: 'Новые ТВ-шоу' },
  { type: 'concert',    title: 'Новые концерты' }
];

interface NoveltySectionItem {
  id: number;
  type: string;
  title: string;
  poster: string;
}

interface SectionData {
  title: string;
  items: NoveltySectionItem[];
}

const tplSectionCompiled = doT.template(`
  <div class="watching__section-title">{{=it.title}}</div>
  <div class="watching__grid" data-section="{{=it.idx}}">{{=it.cards}}</div>
`);

const tplSection = (data: { readonly title: string; readonly idx: number; readonly cards: string }): string =>
  tplSectionCompiled(data);

const tplLayoutCompiled = doT.template(`
  <div class="content"><div class="watching">{{=it.rows}}</div></div>
`);

const tplLayout = (data: { readonly rows: string }): string =>
  tplLayoutCompiled(data);

class NoveltiesPage extends SidebarPage {
  private sections: SectionData[] = [];
  private focusedSection = 0;
  private focusedIndex = 0;

  constructor() { super('novelties'); }

  protected onUnfocus(): void { this.updateFocus(); }

  protected onMount(params: RouteParams): void {
    const savedSection = params.focusedSection;
    const savedIndex = params.focusedIndex;
    PageUtils.showSpinnerIn(this.$root);

    const requests = [];
    for (let i = 0; i < SECTIONS_CONFIG.length; i++) {
      requests.push(getItems(SECTIONS_CONFIG[i].type, 'created-'));
    }

    ($.when as (...d: JQuery.Deferred<unknown>[]) => JQuery.Promise<unknown>)
      .apply($, requests).then((...args: unknown[]) => {
      this.sections = [];
      const n = SECTIONS_CONFIG.length;
      for (let i = 0; i < n; i++) {
        const raw = n === 1 ? args[0] : args[i];
        const res = Array.isArray(raw) ? raw[0] : raw;
        const items: Item[] = (res && res.items) || [];
        if (items.length > 0) {
          const sectionItems = items.map((it: Item) => ({
            id: it.id, type: it.type, title: it.title, poster: it.posters.medium
          }));
          this.sections.push({ title: SECTIONS_CONFIG[i].title, items: sectionItems });
        }
      }

      if (typeof savedSection === 'number' && typeof savedIndex === 'number' && savedSection < this.sections.length) {
        this.focusedSection = savedSection;
        this.focusedIndex = Math.min(savedIndex, this.sections[savedSection].items.length - 1);
      } else {
        this.focusedSection = 0;
        this.focusedIndex = 0;
      }

      this.render();
    });
  }

  protected onUnmount(): void {
    this.sections = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.sections.length === 0) { sidebar.handleEmptyState(e); return; }

    const currentItems = this.sections[this.focusedSection].items;
    const g = gridPos(this.focusedIndex, currentItems.length);

    switch (e.keyCode) {
      case TvKey.Right: {
        const nr = gridMove(this.focusedIndex, currentItems.length, 'right');
        if (nr >= 0) { this.focusedIndex = nr; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Left: {
        const nl = sidebar.gridLeftOrFocus(this.focusedIndex, currentItems.length);
        if (nl >= 0) { this.focusedIndex = nl; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Down: {
        const nd = gridMove(this.focusedIndex, currentItems.length, 'down');
        if (nd >= 0) { this.focusedIndex = nd; this.updateFocus(); }
        else if (this.focusedSection < this.sections.length - 1) {
          this.focusedSection++;
          this.focusedIndex = Math.min(g.col, this.sections[this.focusedSection].items.length - 1);
          this.updateFocus();
        }
        e.preventDefault(); break;
      }
      case TvKey.Up: {
        const nu = gridMove(this.focusedIndex, currentItems.length, 'up');
        if (nu >= 0) { this.focusedIndex = nu; this.updateFocus(); }
        else if (this.focusedSection > 0) {
          this.focusedSection--;
          const pg = gridPos(0, this.sections[this.focusedSection].items.length);
          this.focusedIndex = Math.min((pg.totalRows - 1) * CARDS_PER_ROW + g.col, this.sections[this.focusedSection].items.length - 1);
          this.updateFocus();
        }
        e.preventDefault(); break;
      }
      case TvKey.Enter: {
        const item = currentItems[this.focusedIndex];
        if (item) {
          router.setParams({ focusedSection: this.focusedSection, focusedIndex: this.focusedIndex });
          router.navigateItem(item);
        }
        e.preventDefault(); break;
      }
      default: sidebar.backOrFocus(e);
    }
  }

  private buildRows(): string {
    if (this.sections.length === 0) {
      return tplEmptyText({ text: 'Нет данных' });
    }
    let html = '';
    for (let i = 0; i < this.sections.length; i++) {
      let cards = '';
      for (let j = 0; j < this.sections[i].items.length; j++) {
        const item = this.sections[i].items[j];
        cards += tplCard({
          id: item.id,
          poster: storage.proxyPosterUrl(item.poster),
          title: item.title,
          extra: ''
        });
      }
      html += tplSection({ title: this.sections[i].title, idx: i, cards: cards });
    }
    return html;
  }

  private render(): void {
    this.$root.html(tplLayout({ rows: this.buildRows() }));
    this.updateFocus();
  }

  private updateFocus(): void {
    this.$root.find('.card').removeClass('focused');
    if (this.sections.length === 0) return;

    const $grid = this.$root.find('.watching__grid[data-section="' + this.focusedSection + '"]');
    const $cards = $grid.find('.card');
    if ($cards.length > 0 && this.focusedIndex < $cards.length) {
      const $card = $cards.eq(this.focusedIndex);
      $card.addClass('focused');
      PageUtils.scrollIntoView($card[0], this.$root.find('.watching')[0]);
    }
  }
}

export const noveltiesPage = new NoveltiesPage();
