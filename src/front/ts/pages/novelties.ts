import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { Item, ItemsResponse } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { storage } from '../utils/storage';
import { getItemsFresh, getItemsHot, getItemsPopular } from '../api/items';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

const TYPE_TABS = [
  { type: 'movie',  title: 'Фильмы' },
  { type: 'serial', title: 'Сериалы' }
] as const;

const CATEGORY_TABS = [
  { fetch: getItemsPopular, title: 'Популярные' },
  { fetch: getItemsFresh,   title: 'Свежие' },
  { fetch: getItemsHot,     title: 'Горячие' }
] as const;

const enum FocusLevel {
  TypeTabs,
  CategoryTabs,
  Grid
}

interface CardItem {
  readonly id: number;
  readonly type: string;
  readonly title: string;
  readonly poster: string;
}

const tplTabsCompiled = doT.template(
  `<div class="novelties-tabs" data-level="{{=it.level}}">` +
  `{{~it.tabs :tab:i}}<div class="novelties-tabs__item{{? i === it.active}} active{{?}}" data-idx="{{=i}}">{{=tab}}</div>{{~}}` +
  `</div>`
);

const tplTabs = (data: { readonly level: string; readonly tabs: readonly string[]; readonly active: number }): string =>
  tplTabsCompiled(data);

const tplGridCompiled = doT.template(
  `<div class="watching__grid">{{=it.cards}}</div>`
);

const tplGrid = (data: { readonly cards: string }): string =>
  tplGridCompiled(data);

class NoveltiesPage extends SidebarPage {
  private cards: CardItem[] = [];
  private focusLevel: FocusLevel = FocusLevel.TypeTabs;
  private typeTab = 0;
  private categoryTab = 0;
  private focusedIndex = 0;
  private loading = false;

  constructor() { super('novelties'); }

  protected onUnfocus(): void { this.updateFocus(); }

  protected onMount(params: RouteParams): void {
    this.typeTab = typeof params.typeTab === 'number' ? params.typeTab : 0;
    this.categoryTab = typeof params.categoryTab === 'number' ? params.categoryTab : 0;
    this.focusedIndex = typeof params.focusedIndex === 'number' ? params.focusedIndex : 0;
    this.focusLevel = FocusLevel.TypeTabs;

    this.renderShell();
    this.loadCards();
  }

  protected onUnmount(): void {
    this.cards = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.loading) { e.preventDefault(); return; }

    switch (this.focusLevel) {
      case FocusLevel.TypeTabs:     this.handleTypeTabs(e); break;
      case FocusLevel.CategoryTabs: this.handleCategoryTabs(e); break;
      case FocusLevel.Grid:         this.handleGrid(e); break;
    }
  }

  private handleTypeTabs(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Right:
        if (this.typeTab < TYPE_TABS.length - 1) {
          this.typeTab++;
          this.onTabChanged();
        }
        e.preventDefault(); break;
      case TvKey.Left: {
        if (this.typeTab > 0) {
          this.typeTab--;
          this.onTabChanged();
          e.preventDefault();
        } else {
          sidebar.focus();
        }
        break;
      }
      case TvKey.Down:
        this.focusLevel = FocusLevel.CategoryTabs;
        this.updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter:
        this.focusLevel = FocusLevel.CategoryTabs;
        this.updateFocus();
        e.preventDefault(); break;
      default: sidebar.backOrFocus(e);
    }
  }

  private handleCategoryTabs(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Right:
        if (this.categoryTab < CATEGORY_TABS.length - 1) {
          this.categoryTab++;
          this.onCategoryChanged();
        }
        e.preventDefault(); break;
      case TvKey.Left:
        if (this.categoryTab > 0) {
          this.categoryTab--;
          this.onCategoryChanged();
        } else {
          sidebar.focus();
        }
        e.preventDefault(); break;
      case TvKey.Up:
        this.focusLevel = FocusLevel.TypeTabs;
        this.updateFocus();
        e.preventDefault(); break;
      case TvKey.Down:
      case TvKey.Enter:
        if (this.cards.length > 0) {
          this.focusLevel = FocusLevel.Grid;
          this.focusedIndex = 0;
          this.updateFocus();
        }
        e.preventDefault(); break;
      default: sidebar.backOrFocus(e);
    }
  }

  private handleGrid(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Right: {
        const nr = gridMove(this.focusedIndex, this.cards.length, 'right');
        if (nr >= 0) { this.focusedIndex = nr; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Left: {
        const nl = sidebar.gridLeftOrFocus(this.focusedIndex, this.cards.length);
        if (nl >= 0) { this.focusedIndex = nl; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Down: {
        const nd = gridMove(this.focusedIndex, this.cards.length, 'down');
        if (nd >= 0) { this.focusedIndex = nd; this.updateFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Up: {
        const nu = gridMove(this.focusedIndex, this.cards.length, 'up');
        if (nu >= 0) { this.focusedIndex = nu; this.updateFocus(); }
        else {
          this.focusLevel = FocusLevel.CategoryTabs;
          this.updateFocus();
        }
        e.preventDefault(); break;
      }
      case TvKey.Enter: {
        const item = this.cards[this.focusedIndex];
        if (item) {
          router.setParams({ typeTab: this.typeTab, categoryTab: this.categoryTab, focusedIndex: this.focusedIndex });
          router.navigateItem(item);
        }
        e.preventDefault(); break;
      }
      default: sidebar.backOrFocus(e);
    }
  }

  private onTabChanged(): void {
    this.categoryTab = 0;
    this.focusedIndex = 0;
    this.renderTabs();
    this.loadCards();
  }

  private onCategoryChanged(): void {
    this.focusedIndex = 0;
    this.renderCategoryTabs();
    this.loadCards();
  }

  private loadCards(): void {
    this.loading = true;
    this.renderGridArea('<div class="spinner"><div class="spinner__circle"></div></div>');

    const type = TYPE_TABS[this.typeTab].type;
    const fetcher = CATEGORY_TABS[this.categoryTab].fetch;

    fetcher(type).then(
      (res: ItemsResponse) => {
        this.cards = (res.items || []).map((it: Item) => ({
          id: it.id, type: it.type, title: it.title, poster: it.posters.medium
        }));
        this.loading = false;
        this.renderGrid();
        this.updateFocus();
      },
      () => {
        this.cards = [];
        this.loading = false;
        this.renderGridArea(tplEmptyText({ text: 'Ошибка загрузки' }));
      }
    );
  }

  private renderShell(): void {
    const typeTabs = tplTabs({
      level: 'type',
      tabs: TYPE_TABS.map((t) => t.title),
      active: this.typeTab
    });
    const categoryTabs = tplTabs({
      level: 'category',
      tabs: CATEGORY_TABS.map((t) => t.title),
      active: this.categoryTab
    });

    this.$root.html(
      '<div class="content"><div class="watching">' +
      typeTabs + categoryTabs +
      '<div class="novelties-grid-area"></div>' +
      '</div></div>'
    );
  }

  private renderTabs(): void {
    this.$root.find('.novelties-tabs[data-level="type"]').replaceWith(
      tplTabs({ level: 'type', tabs: TYPE_TABS.map((t) => t.title), active: this.typeTab })
    );
    this.$root.find('.novelties-tabs[data-level="category"]').replaceWith(
      tplTabs({ level: 'category', tabs: CATEGORY_TABS.map((t) => t.title), active: this.categoryTab })
    );
  }

  private renderCategoryTabs(): void {
    this.$root.find('.novelties-tabs[data-level="category"]').replaceWith(
      tplTabs({ level: 'category', tabs: CATEGORY_TABS.map((t) => t.title), active: this.categoryTab })
    );
  }

  private renderGridArea(html: string): void {
    this.$root.find('.novelties-grid-area').html(html);
  }

  private renderGrid(): void {
    if (this.cards.length === 0) {
      this.renderGridArea(tplEmptyText({ text: 'Нет данных' }));
      return;
    }
    let cardsHtml = '';
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      cardsHtml += tplCard({ id: c.id, poster: storage.proxyPosterUrl(c.poster), title: c.title, extra: '' });
    }
    this.renderGridArea(tplGrid({ cards: cardsHtml }));
  }

  private updateFocus(): void {
    this.$root.find('.novelties-tabs__item').removeClass('focused');
    this.$root.find('.card').removeClass('focused');

    switch (this.focusLevel) {
      case FocusLevel.TypeTabs: {
        const $items = this.$root.find('.novelties-tabs[data-level="type"] .novelties-tabs__item');
        $items.eq(this.typeTab).addClass('focused');
        break;
      }
      case FocusLevel.CategoryTabs: {
        const $items = this.$root.find('.novelties-tabs[data-level="category"] .novelties-tabs__item');
        $items.eq(this.categoryTab).addClass('focused');
        break;
      }
      case FocusLevel.Grid: {
        const $cards = this.$root.find('.card');
        if ($cards.length > 0 && this.focusedIndex < $cards.length) {
          const $card = $cards.eq(this.focusedIndex);
          $card.addClass('focused');
          PageUtils.scrollIntoView($card[0], this.$root.find('.watching')[0]);
        }
        break;
      }
    }
  }
}

export const noveltiesPage = new NoveltiesPage();
