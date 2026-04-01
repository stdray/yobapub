import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { Item, ItemsResponse } from '../types/api';
import { searchItems } from '../api/items';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { storage } from '../utils/storage';
import { PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

interface KbKeyData {
  char: string;
  label: string;
  wide: boolean;
}

const KB_LAYOUTS: Record<'ru' | 'en', string[][]> = {
  ru: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['й','ц','у','к','е','н','г','ш','щ','з','х','ъ'],
    ['ф','ы','в','а','п','р','о','л','д','ж','э'],
    ['я','ч','с','м','и','т','ь','б','ю','⌫'],
    ['EN','_','⎵','⎵','⎵','⎵','⎵','⎵','OK']
  ],
  en: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m','⌫'],
    ['RU','_','⎵','⎵','⎵','⎵','⎵','⎵','OK']
  ]
};

const tplKeyboardCompiled = doT.template(`
  <div class="kb">
    {{~it.rows :row:ri}}
      <div class="kb__row">
        {{~row :key:ci}}
          <div class="kb__key{{?key.wide}} kb__key--wide{{?}}" data-row="{{=ri}}" data-col="{{=ci}}">{{=key.label}}</div>
        {{~}}
      </div>
    {{~}}
  </div>
`);

const tplKeyboard = (data: { readonly rows: Array<{ readonly label: string; readonly wide: boolean }[]> }): string =>
  tplKeyboardCompiled(data);

const tplLayoutCompiled = doT.template(`
  <div class="search">
    <div class="search-input"><span class="search-input__text"></span><span class="search-input__cursor">|</span></div>
    <div class="search__body">
      <div class="search__keyboard"></div>
      <div class="search__results"></div>
    </div>
  </div>
`);

const tplLayout = (data: Record<string, never>): string =>
  tplLayoutCompiled(data);

type FocusArea = 'keyboard' | 'results';

class SearchPage extends SidebarPage {
  private query = '';
  private results: Item[] = [];
  private focusedIndex = 0;
  private loading = false;
  private noResults = false;
  private searchTimer: number | null = null;
  private focusArea: FocusArea = 'keyboard';
  private kbRow = 0;
  private kbCol = 0;
  private currentLayout: 'ru' | 'en' = 'ru';

  constructor() { super('search'); }

  protected onUnfocus(): void {
    if (this.focusArea === 'keyboard') { this.updateKeyboardFocus(); }
    else { this.updateResultsFocus(); }
  }

  protected onMount(params: RouteParams): void {
    this.query = params.searchQuery || '';
    this.results = [];
    this.focusedIndex = 0;
    this.focusArea = 'keyboard';
    this.kbRow = 0;
    this.kbCol = 0;
    this.currentLayout = 'ru';
    this.noResults = false;
    this.loading = false;
    this.render();
    if (this.query.length >= 3) this.doSearch();
  }

  protected onUnmount(): void {
    if (this.searchTimer !== null) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.results = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.focusArea === 'keyboard') {
      this.handleKeyboardKey(e);
    } else {
      this.handleResultsKey(e);
    }
  }

  private buildKeyboardRows(): KbKeyData[][] {
    const layout = KB_LAYOUTS[this.currentLayout];
    const rows: KbKeyData[][] = [];
    for (let ri = 0; ri < layout.length; ri++) {
      const rowChars = layout[ri];
      const rowKeys: KbKeyData[] = [];
      for (let ci = 0; ci < rowChars.length; ci++) {
        const char = rowChars[ci];
        rowKeys.push({
          char: char,
          label: char === '⎵' ? ' ' : char,
          wide: char === '⎵'
        });
      }
      rows.push(rowKeys);
    }
    return rows;
  }

  private renderKeyboard(): void {
    this.$root.find('.search__keyboard').html(tplKeyboard({ rows: this.buildKeyboardRows() }));
    this.updateKeyboardFocus();
  }

  private updateKeyboardFocus(): void {
    this.$root.find('.kb__key').removeClass('focused');
    if (this.focusArea === 'keyboard') {
      this.$root.find('.kb__key[data-row="' + this.kbRow + '"][data-col="' + this.kbCol + '"]').addClass('focused');
    }
  }

  private renderInput(): void {
    this.$root.find('.search-input__text').text(this.query);
  }

  private renderResults(): void {
    const $el = this.$root.find('.search__results');
    if (this.loading) {
      $el.html('<div class="spinner"><div class="spinner__circle"></div></div>');
      return;
    }
    if (this.noResults) {
      $el.html(tplEmptyText({ text: 'Ничего не найдено' }));
      return;
    }
    if (this.results.length === 0) {
      $el.empty();
      return;
    }
    let html = '';
    for (let i = 0; i < this.results.length; i++) {
      html += tplCard({
        id: this.results[i].id,
        poster: storage.proxyPosterUrl(this.results[i].posters.medium),
        title: this.results[i].title,
        extra: ''
      });
    }
    $el.html('<div class="watching__grid search-grid">' + html + '</div>');
    if (this.focusArea === 'results') {
      this.updateResultsFocus();
    }
  }

  private updateResultsFocus(): void {
    const $cards = this.$root.find('.search-grid .card');
    $cards.removeClass('focused');
    if (this.focusArea === 'results' && this.focusedIndex < $cards.length) {
      const $card = $cards.eq(this.focusedIndex);
      $card.addClass('focused');
      PageUtils.scrollIntoView($card[0], this.$root.find('.search__results')[0]);
    }
  }

  private render(): void {
    this.$root.html(tplLayout({}));
    this.renderInput();
    this.renderKeyboard();
    this.renderResults();
  }

  private scheduleSearch(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    if (this.query.length < 3) {
      this.results = [];
      this.noResults = false;
      this.renderResults();
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.doSearch();
    }, 1000) as unknown as number;
  }

  private doSearch(): void {
    this.loading = true;
    this.renderResults();
    searchItems(this.query).then(
      (res: ItemsResponse) => {
        this.loading = false;
        this.results = (res && res.items) || [];
        this.noResults = this.results.length === 0;
        this.focusedIndex = 0;
        this.renderResults();
      },
      () => {
        this.loading = false;
        this.results = [];
        this.noResults = true;
        this.renderResults();
      }
    );
  }

  private pressKey(char: string): void {
    if (char === '⌫') {
      this.query = this.query.slice(0, -1);
    } else if (char === '⎵' || char === '_') {
      this.query += ' ';
    } else if (char === 'EN') {
      this.currentLayout = 'en';
      this.renderKeyboard();
      return;
    } else if (char === 'RU') {
      this.currentLayout = 'ru';
      this.renderKeyboard();
      return;
    } else if (char === 'OK') {
      if (this.results.length > 0) {
        this.focusArea = 'results';
        this.focusedIndex = 0;
        this.updateKeyboardFocus();
        this.updateResultsFocus();
      }
      return;
    } else {
      this.query += char;
    }
    this.renderInput();
    this.scheduleSearch();
  }

  private handleKeyboardKey(e: JQuery.Event): void {
    const layout = KB_LAYOUTS[this.currentLayout];
    const row = layout[this.kbRow];

    switch (e.keyCode) {
      case TvKey.Left:
        if (this.kbCol > 0) { this.kbCol--; this.updateKeyboardFocus(); }
        e.preventDefault(); break;
      case TvKey.Right:
        if (this.kbCol < row.length - 1) { this.kbCol++; this.updateKeyboardFocus(); }
        e.preventDefault(); break;
      case TvKey.Up:
        if (this.kbRow > 0) {
          this.kbRow--;
          this.kbCol = Math.min(this.kbCol, layout[this.kbRow].length - 1);
          this.updateKeyboardFocus();
        }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.kbRow < layout.length - 1) {
          this.kbRow++;
          this.kbCol = Math.min(this.kbCol, layout[this.kbRow].length - 1);
          this.updateKeyboardFocus();
        } else if (this.results.length > 0) {
          this.focusArea = 'results';
          this.focusedIndex = 0;
          this.updateKeyboardFocus();
          this.updateResultsFocus();
        }
        e.preventDefault(); break;
      case TvKey.Enter:
        this.pressKey(row[this.kbCol]);
        e.preventDefault(); break;
      default: sidebar.backOrFocus(e);
    }
  }

  private handleResultsKey(e: JQuery.Event): void {
    const $cards = this.$root.find('.search-grid .card');
    const total = $cards.length;

    switch (e.keyCode) {
      case TvKey.Right: {
        const nr = gridMove(this.focusedIndex, total, 'right');
        if (nr >= 0) { this.focusedIndex = nr; this.updateResultsFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Left: {
        const nl = gridMove(this.focusedIndex, total, 'left');
        if (nl >= 0) { this.focusedIndex = nl; this.updateResultsFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Down: {
        const nd = gridMove(this.focusedIndex, total, 'down');
        if (nd >= 0) { this.focusedIndex = nd; this.updateResultsFocus(); }
        e.preventDefault(); break;
      }
      case TvKey.Up: {
        const nu = gridMove(this.focusedIndex, total, 'up');
        if (nu >= 0) { this.focusedIndex = nu; this.updateResultsFocus(); }
        else {
          this.focusArea = 'keyboard';
          this.updateKeyboardFocus();
          this.updateResultsFocus();
        }
        e.preventDefault(); break;
      }
      case TvKey.Enter: {
        const item = this.results[this.focusedIndex];
        if (item) {
          router.navigateItem(item);
        }
        e.preventDefault(); break;
      }
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        this.focusArea = 'keyboard';
        this.updateKeyboardFocus();
        this.updateResultsFocus();
        e.preventDefault(); break;
    }
  }
}

export const searchPage = new SearchPage();
