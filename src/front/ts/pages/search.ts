import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { Item, ItemsResponse, Pagination } from '../types/api';
import { searchItems } from '../api/items';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { storage } from '../utils/storage';
import { PageKeys, PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { renderRatings } from '../utils/templates';

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
    ['EN','⎵']
  ],
  en: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m','⌫'],
    ['RU','⎵']
  ]
};

const SEARCH_DEBOUNCE_MS = 500;
const SEARCH_PERPAGE = 20;

type FocusArea = 'keyboard' | 'results';

interface SearchState {
  query: string;
  results: Item[];
  focusedIndex: number;
  focusArea: FocusArea;
  kbRow: number;
  kbCol: number;
  currentLayout: 'ru' | 'en';
  noResults: boolean;
  pagination: Pagination | null;
}

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
    <div class="search__left">
      <div class="search__input-area">
        <div class="search-input"><span class="search-input__text"></span><span class="search-input__cursor">|</span></div>
        <div class="search__keyboard"></div>
      </div>
      <div class="search__preview"></div>
    </div>
    <div class="search__results"></div>
  </div>
`);

const tplLayout = (data: Record<string, never>): string =>
  tplLayoutCompiled(data);

const tplPreviewCompiled = doT.template(`
  <div class="search-preview">
    <div class="search-preview__title">{{=it.title}}</div>
    {{?it.titleEn}}<div class="search-preview__title-en">{{=it.titleEn}}</div>{{?}}
    <div class="search-preview__meta">{{=it.year}}{{?it.countries}} &bull; {{=it.countries}}{{?}}</div>
    {{?it.genres}}<div class="search-preview__meta">{{=it.genres}}</div>{{?}}
    {{?it.ratings}}<div class="search-preview__ratings">{{=it.ratings}}</div>{{?}}
    {{?it.plot}}<div class="search-preview__plot">{{=it.plot}}</div>{{?}}
  </div>
`);

const tplPreview = (data: {
  readonly title: string;
  readonly titleEn: string;
  readonly year: number;
  readonly countries: string;
  readonly genres: string;
  readonly ratings: string;
  readonly plot: string;
}): string =>
  tplPreviewCompiled(data);

class SearchPage implements Page {
  private readonly $root = $('#page-search');
  private readonly keys = new PageKeys();
  private query = '';
  private results: Item[] = [];
  private focusedIndex = 0;
  private loading = false;
  private loadingMore = false;
  private noResults = false;
  private searchTimer: number | null = null;
  private searchSeq = 0;
  private focusArea: FocusArea = 'keyboard';
  private kbRow = 0;
  private kbCol = 0;
  private currentLayout: 'ru' | 'en' = 'ru';
  private pagination: Pagination | null = null;

  mount(params: RouteParams): void {
    this.keys.bind((e) => this.handleKey(e));
    if (params._searchState) {
      const s = params._searchState as SearchState;
      this.query = s.query;
      this.results = s.results;
      this.focusedIndex = s.focusedIndex;
      this.focusArea = s.focusArea;
      this.kbRow = s.kbRow;
      this.kbCol = s.kbCol;
      this.currentLayout = s.currentLayout;
      this.noResults = s.noResults;
      this.pagination = s.pagination;
      this.loading = false;
      this.loadingMore = false;
      this.render();
    } else {
      this.query = params.searchQuery || '';
      this.results = [];
      this.focusedIndex = 0;
      this.focusArea = 'keyboard';
      this.kbRow = 0;
      this.kbCol = 0;
      this.currentLayout = 'ru';
      this.noResults = false;
      this.loading = false;
      this.loadingMore = false;
      this.pagination = null;
      this.render();
      if (this.query.length >= 3) this.doSearch();
    }
  }

  unmount(): void {
    if (this.searchTimer !== null) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
    this.results = [];
    this.pagination = null;
  }

  private saveState(): void {
    router.setParams({
      _searchState: {
        query: this.query,
        results: this.results,
        focusedIndex: this.focusedIndex,
        focusArea: this.focusArea,
        kbRow: this.kbRow,
        kbCol: this.kbCol,
        currentLayout: this.currentLayout,
        noResults: this.noResults,
        pagination: this.pagination
      } as SearchState
    });
  }

  private handleKey(e: JQuery.Event): void {
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
          label: char === '⌫' ? '<-' : char === '⎵' ? '' : char,
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

  private renderPreview(): void {
    const $el = this.$root.find('.search__preview');
    const item = this.results[this.focusedIndex];
    if (!item) {
      $el.empty();
      return;
    }
    const titles = item.title.split(' / ');
    $el.html(tplPreview({
      title: titles[0],
      titleEn: titles.length > 1 ? titles[1] : '',
      year: item.year,
      countries: item.countries.map((c) => c.title).join(', '),
      genres: item.genres.map((g) => g.title).join(', '),
      ratings: renderRatings(item),
      plot: item.plot || ''
    }));
  }

  private get hasMorePages(): boolean {
    if (!this.pagination) return false;
    return this.pagination.current < Math.ceil(this.pagination.total / this.pagination.perpage);
  }

  private switchToResults(resetIndex?: boolean): void {
    this.focusArea = 'results';
    if (resetIndex || this.focusedIndex >= this.results.length) {
      this.focusedIndex = 0;
    }
    this.updateKeyboardFocus();
    this.updateResultsFocus();
    this.renderPreview();
  }

  private switchToKeyboard(): void {
    this.focusArea = 'keyboard';
    this.updateKeyboardFocus();
    this.updateResultsFocus();
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
    this.renderPreview();
  }

  private scheduleSearch(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    if (this.query.length < 3) {
      this.results = [];
      this.noResults = false;
      this.pagination = null;
      this.renderResults();
      this.renderPreview();
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.doSearch();
    }, SEARCH_DEBOUNCE_MS) as unknown as number;
  }

  private doSearch(): void {
    const seq = ++this.searchSeq;
    this.loading = true;
    this.renderResults();
    searchItems(this.query, 1, SEARCH_PERPAGE).then(
      (res: ItemsResponse) => {
        if (seq !== this.searchSeq) return;
        this.loading = false;
        this.results = (res && res.items) || [];
        this.pagination = (res && res.pagination) || null;
        this.noResults = this.results.length === 0;
        this.focusedIndex = 0;
        this.renderResults();
        this.renderPreview();
      },
      () => {
        if (seq !== this.searchSeq) return;
        this.loading = false;
        this.results = [];
        this.pagination = null;
        this.noResults = true;
        this.renderResults();
        this.renderPreview();
      }
    );
  }

  private loadNextPage(): void {
    if (!this.hasMorePages || this.loadingMore || !this.pagination) return;
    const nextPage = this.pagination.current + 1;
    const seq = this.searchSeq;
    this.loadingMore = true;
    searchItems(this.query, nextPage, SEARCH_PERPAGE).then(
      (res: ItemsResponse) => {
        if (seq !== this.searchSeq) return;
        this.loadingMore = false;
        const newItems = (res && res.items) || [];
        this.results = this.results.concat(newItems);
        this.pagination = (res && res.pagination) || null;
        this.renderResults();
      },
      () => {
        if (seq !== this.searchSeq) return;
        this.loadingMore = false;
      }
    );
  }

  private pressKey(char: string): void {
    if (char === '⌫') {
      this.query = this.query.slice(0, -1);
    } else if (char === '⎵') {
      this.query += ' ';
    } else if (char === 'EN') {
      this.currentLayout = 'en';
      this.renderKeyboard();
      return;
    } else if (char === 'RU') {
      this.currentLayout = 'ru';
      this.renderKeyboard();
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
        else if (this.results.length > 0) { this.switchToResults(); }
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
          this.switchToResults();
        }
        e.preventDefault(); break;
      case TvKey.Enter:
        this.pressKey(row[this.kbCol]);
        e.preventDefault(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        router.navigateToStartPage();
        e.preventDefault(); break;
    }
  }

  private handleResultsKey(e: JQuery.Event): void {
    const $cards = this.$root.find('.search-grid .card');
    const total = $cards.length;

    switch (e.keyCode) {
      case TvKey.Right: {
        const nr = gridMove(this.focusedIndex, total, 'right');
        if (nr >= 0) { this.focusedIndex = nr; this.updateResultsFocus(); this.renderPreview(); }
        e.preventDefault(); break;
      }
      case TvKey.Left: {
        const nl = gridMove(this.focusedIndex, total, 'left');
        if (nl >= 0) { this.focusedIndex = nl; this.updateResultsFocus(); this.renderPreview(); }
        else { this.switchToKeyboard(); }
        e.preventDefault(); break;
      }
      case TvKey.Down: {
        const nd = gridMove(this.focusedIndex, total, 'down');
        if (nd >= 0) {
          this.focusedIndex = nd;
          this.updateResultsFocus();
          this.renderPreview();
        } else if (this.hasMorePages) {
          this.loadNextPage();
        }
        e.preventDefault(); break;
      }
      case TvKey.Up: {
        const nu = gridMove(this.focusedIndex, total, 'up');
        if (nu >= 0) { this.focusedIndex = nu; this.updateResultsFocus(); this.renderPreview(); }
        else { this.switchToKeyboard(); }
        e.preventDefault(); break;
      }
      case TvKey.Enter: {
        const item = this.results[this.focusedIndex];
        if (item) {
          this.saveState();
          router.navigateItem(item);
        }
        e.preventDefault(); break;
      }
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        router.navigateToStartPage();
        e.preventDefault(); break;
    }
  }
}

export const searchPage = new SearchPage();
