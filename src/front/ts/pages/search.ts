import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { Item, ItemsResponse } from '../types/api';
import { searchItems } from '../api/items';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { storage } from '../utils/storage';
import { PageKeys, PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';

const $root = $('#page-search');
const keys = new PageKeys();

let query = '';
let results: Item[] = [];
let focusedIndex = 0;
let loading = false;
let noResults = false;
let searchTimer: number | null = null;

type FocusArea = 'keyboard' | 'results';
let focusArea: FocusArea = 'keyboard';

let kbRow = 0;
let kbCol = 0;
let currentLayout: 'ru' | 'en' = 'ru';

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

interface KbKeyData {
  char: string;
  label: string;
  wide: boolean;
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
    <div class="search-input"><span class="search-input__text"></span><span class="search-input__cursor">|</span></div>
    <div class="search__body">
      <div class="search__keyboard"></div>
      <div class="search__results"></div>
    </div>
  </div>
`);

const tplLayout = (data: Record<string, never>): string =>
  tplLayoutCompiled(data);

const buildKeyboardRows = (): KbKeyData[][] => {
  const layout = KB_LAYOUTS[currentLayout];
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
};

const renderKeyboard = (): void => {
  $root.find('.search__keyboard').html(tplKeyboard({ rows: buildKeyboardRows() }));
  updateKeyboardFocus();
};

const updateKeyboardFocus = (): void => {
  $root.find('.kb__key').removeClass('focused');
  if (focusArea === 'keyboard') {
    $root.find('.kb__key[data-row="' + kbRow + '"][data-col="' + kbCol + '"]').addClass('focused');
  }
};

const renderInput = (): void => {
  $root.find('.search-input__text').text(query);
};

const renderResults = (): void => {
  const $el = $root.find('.search__results');
  if (loading) {
    $el.html('<div class="spinner"><div class="spinner__circle"></div></div>');
    return;
  }
  if (noResults) {
    $el.html(tplEmptyText({ text: 'Ничего не найдено' }));
    return;
  }
  if (results.length === 0) {
    $el.empty();
    return;
  }
  let html = '';
  for (let i = 0; i < results.length; i++) {
    html += tplCard({
      id: results[i].id,
      poster: storage.proxyPosterUrl(results[i].posters.medium),
      title: results[i].title,
      extra: ''
    });
  }
  $el.html('<div class="watching__grid search-grid">' + html + '</div>');
  if (focusArea === 'results') {
    updateResultsFocus();
  }
};

const updateResultsFocus = (): void => {
  const $cards = $root.find('.search-grid .card');
  $cards.removeClass('focused');
  if (focusArea === 'results' && focusedIndex < $cards.length) {
    const $card = $cards.eq(focusedIndex);
    $card.addClass('focused');
    PageUtils.scrollIntoView($card[0], $root.find('.search__results')[0]);
  }
};

const render = (): void => {
  $root.html(tplLayout({}));
  renderInput();
  renderKeyboard();
  renderResults();
};

const scheduleSearch = (): void => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  if (query.length < 3) {
    results = [];
    noResults = false;
    renderResults();
    return;
  }
  searchTimer = setTimeout(() => {
    doSearch();
  }, 1000) as unknown as number;
};

const doSearch = (): void => {
  loading = true;
  renderResults();
  searchItems(query).then(
    (res: ItemsResponse) => {
      loading = false;
      results = (res && res.items) || [];
      noResults = results.length === 0;
      focusedIndex = 0;
      renderResults();
    },
    () => {
      loading = false;
      results = [];
      noResults = true;
      renderResults();
    }
  );
};

const pressKey = (char: string): void => {
  if (char === '⌫') {
    query = query.slice(0, -1);
  } else if (char === '⎵' || char === '_') {
    query += ' ';
  } else if (char === 'EN') {
    currentLayout = 'en';
    renderKeyboard();
    return;
  } else if (char === 'RU') {
    currentLayout = 'ru';
    renderKeyboard();
    return;
  } else if (char === 'OK') {
    if (results.length > 0) {
      focusArea = 'results';
      focusedIndex = 0;
      updateKeyboardFocus();
      updateResultsFocus();
    }
    return;
  } else {
    query += char;
  }
  renderInput();
  scheduleSearch();
};

const handleKeyboardKey = (e: JQuery.Event): void => {
  const layout = KB_LAYOUTS[currentLayout];
  const row = layout[kbRow];

  switch (e.keyCode) {
    case TvKey.Left:
      if (kbCol > 0) { kbCol--; updateKeyboardFocus(); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (kbCol < row.length - 1) { kbCol++; updateKeyboardFocus(); }
      e.preventDefault(); break;
    case TvKey.Up:
      if (kbRow > 0) {
        kbRow--;
        kbCol = Math.min(kbCol, layout[kbRow].length - 1);
        updateKeyboardFocus();
      }
      e.preventDefault(); break;
    case TvKey.Down:
      if (kbRow < layout.length - 1) {
        kbRow++;
        kbCol = Math.min(kbCol, layout[kbRow].length - 1);
        updateKeyboardFocus();
      } else if (results.length > 0) {
        focusArea = 'results';
        focusedIndex = 0;
        updateKeyboardFocus();
        updateResultsFocus();
      }
      e.preventDefault(); break;
    case TvKey.Enter:
      pressKey(row[kbCol]);
      e.preventDefault(); break;
    default: sidebar.backOrFocus(e);
  }
};

const handleResultsKey = (e: JQuery.Event): void => {
  const $cards = $root.find('.search-grid .card');
  const total = $cards.length;

  switch (e.keyCode) {
    case TvKey.Right: {
      const nr = gridMove(focusedIndex, total, 'right');
      if (nr >= 0) { focusedIndex = nr; updateResultsFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Left: {
      const nl = gridMove(focusedIndex, total, 'left');
      if (nl >= 0) { focusedIndex = nl; updateResultsFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Down: {
      const nd = gridMove(focusedIndex, total, 'down');
      if (nd >= 0) { focusedIndex = nd; updateResultsFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Up: {
      const nu = gridMove(focusedIndex, total, 'up');
      if (nu >= 0) { focusedIndex = nu; updateResultsFocus(); }
      else {
        focusArea = 'keyboard';
        updateKeyboardFocus();
        updateResultsFocus();
      }
      e.preventDefault(); break;
    }
    case TvKey.Enter: {
      const item = results[focusedIndex];
      if (item) {
        router.navigateItem(item);
      }
      e.preventDefault(); break;
    }
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      focusArea = 'keyboard';
      updateKeyboardFocus();
      updateResultsFocus();
      e.preventDefault(); break;
  }
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (focusArea === 'keyboard') {
    handleKeyboardKey(e);
  } else {
    handleResultsKey(e);
  }
});

export const searchPage: Page = {
  mount(params: RouteParams) {
    query = params.searchQuery || '';
    results = [];
    focusedIndex = 0;
    focusArea = 'keyboard';
    kbRow = 0;
    kbCol = 0;
    currentLayout = 'ru';
    noResults = false;
    loading = false;
    sidebar.setUnfocusHandler(() => {
      if (focusArea === 'keyboard') { updateKeyboardFocus(); }
      else { updateResultsFocus(); }
    });
    render();
    keys.bind(handleKey);
    if (query.length >= 3) doSearch();
  },
  unmount() {
    if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
    keys.unbind();
    PageUtils.clearPage($root);
    sidebar.setUnfocusHandler(null);
    results = [];
  }
};
