import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { getWatchingMovies, getWatchingSerials } from '../api/watching';
import { WatchingSerialItem, WatchingMovieItem, WatchingSerialsResponse, WatchingMoviesResponse } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { storage } from '../utils/storage';
import { PageUtils } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

interface SectionData {
  items: Array<{ id: number; type: string }>;
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

class WatchingPage extends SidebarPage {
  private focusedSection = 0;
  private focusedIndex = 0;
  private sections: SectionData[] = [];
  private serialsData: WatchingSerialItem[] = [];
  private moviesData: WatchingMovieItem[] = [];

  constructor() { super('watching'); }

  protected onUnfocus(): void { this.updateFocus(); }

  protected onMount(params: RouteParams): void {
    const savedSection = params.focusedSection;
    const savedIndex = params.focusedIndex;
    PageUtils.showSpinnerIn(this.$root);

    $.when(getWatchingSerials(), getWatchingMovies()).then(
      (serialsRes: any, moviesRes: any) => {
        const sData: WatchingSerialsResponse = Array.isArray(serialsRes) ? serialsRes[0] : serialsRes;
        const mData: WatchingMoviesResponse = Array.isArray(moviesRes) ? moviesRes[0] : moviesRes;
        this.serialsData = (sData && sData.items) || [];
        this.moviesData = (mData && mData.items) || [];

        this.sections = [];
        if (this.moviesData.length > 0) {
          this.sections.push({ items: this.moviesData.map((m) => ({ id: m.id, type: m.type })) });
        }
        if (this.serialsData.length > 0) {
          this.sections.push({ items: this.serialsData.map((s) => ({ id: s.id, type: s.type })) });
        }

        if (typeof savedSection === 'number' && typeof savedIndex === 'number' && savedSection < this.sections.length) {
          this.focusedSection = savedSection;
          this.focusedIndex = Math.min(savedIndex, this.sections[savedSection].items.length - 1);
        } else {
          this.focusedSection = 0;
          this.focusedIndex = 0;
        }
        this.render();
      },
      () => {
        this.$root.html(tplLayout({ rows: tplEmptyText({ text: 'Ошибка загрузки' }) }));
      }
    );
  }

  protected onUnmount(): void {
    this.sections = [];
    this.serialsData = [];
    this.moviesData = [];
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
    let html = '';
    let sIdx = 0;

    if (this.moviesData.length > 0) {
      let mCards = '';
      for (let j = 0; j < this.moviesData.length; j++) {
        mCards += tplCard({
          id: this.moviesData[j].id,
          poster: storage.proxyPosterUrl(this.moviesData[j].posters.medium),
          title: this.moviesData[j].title,
          extra: ''
        });
      }
      html += tplSection({ title: 'Фильмы', idx: sIdx, cards: mCards });
      sIdx++;
    }

    if (this.serialsData.length > 0) {
      let cards = '';
      for (let i = 0; i < this.serialsData.length; i++) {
        const s = this.serialsData[i];
        cards += tplCard({
          id: s.id,
          poster: storage.proxyPosterUrl(s.posters.medium),
          title: s.title,
          extra: s.watched + ' / ' + s.total + (s.new > 0 ? ' +' + s.new : '')
        });
      }
      html += tplSection({ title: 'Сериалы', idx: sIdx, cards: cards });
    }

    if (this.serialsData.length === 0 && this.moviesData.length === 0) {
      html += tplEmptyText({ text: 'Список пуст' });
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

export const watchingPage = new WatchingPage();
