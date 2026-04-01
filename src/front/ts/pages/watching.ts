import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getWatchingMovies, getWatchingSerials } from '../api/watching';
import { WatchingSerialItem, WatchingMovieItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { storage } from '../utils/storage';
import { PageKeys, PageUtils } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';

const $root = $('#page-watching');
const keys = new PageKeys();

let focusedSection = 0;
let focusedIndex = 0;

interface SectionData {
  items: Array<{ id: number; type: string }>;
}

let sections: SectionData[] = [];
let serialsData: WatchingSerialItem[] = [];
let moviesData: WatchingMovieItem[] = [];

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

const buildRows = (): string => {
  let html = '';
  let sIdx = 0;

  if (moviesData.length > 0) {
    let mCards = '';
    for (let j = 0; j < moviesData.length; j++) {
      mCards += tplCard({
        id: moviesData[j].id,
        poster: storage.proxyPosterUrl(moviesData[j].posters.medium),
        title: moviesData[j].title,
        extra: ''
      });
    }
    html += tplSection({ title: 'Фильмы', idx: sIdx, cards: mCards });
    sIdx++;
  }

  if (serialsData.length > 0) {
    let cards = '';
    for (let i = 0; i < serialsData.length; i++) {
      const s = serialsData[i];
      cards += tplCard({
        id: s.id,
        poster: storage.proxyPosterUrl(s.posters.medium),
        title: s.title,
        extra: s.watched + ' / ' + s.total + (s.new > 0 ? ' +' + s.new : '')
      });
    }
    html += tplSection({ title: 'Сериалы', idx: sIdx, cards: cards });
  }

  if (serialsData.length === 0 && moviesData.length === 0) {
    html += tplEmptyText({ text: 'Список пуст' });
  }

  return html;
};

const render = (): void => {
  $root.html(tplLayout({ rows: buildRows() }));
  updateFocus();
};

const updateFocus = (): void => {
  $root.find('.card').removeClass('focused');

  if (sections.length === 0) return;

  const $grid = $root.find('.watching__grid[data-section="' + focusedSection + '"]');
  const $cards = $grid.find('.card');
  if ($cards.length > 0 && focusedIndex < $cards.length) {
    const $card = $cards.eq(focusedIndex);
    $card.addClass('focused');
    PageUtils.scrollIntoView($card[0], $root.find('.watching')[0]);
  }
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (sections.length === 0) { sidebar.handleEmptyState(e); return; }

  const currentItems = sections[focusedSection].items;
  const g = gridPos(focusedIndex, currentItems.length);

  switch (e.keyCode) {
    case TvKey.Right: {
      const nr = gridMove(focusedIndex, currentItems.length, 'right');
      if (nr >= 0) { focusedIndex = nr; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Left: {
      const nl = sidebar.gridLeftOrFocus(focusedIndex, currentItems.length);
      if (nl >= 0) { focusedIndex = nl; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Down: {
      const nd = gridMove(focusedIndex, currentItems.length, 'down');
      if (nd >= 0) { focusedIndex = nd; updateFocus(); }
      else if (focusedSection < sections.length - 1) {
        focusedSection++;
        focusedIndex = Math.min(g.col, sections[focusedSection].items.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
    }
    case TvKey.Up: {
      const nu = gridMove(focusedIndex, currentItems.length, 'up');
      if (nu >= 0) { focusedIndex = nu; updateFocus(); }
      else if (focusedSection > 0) {
        focusedSection--;
        const pg = gridPos(0, sections[focusedSection].items.length);
        focusedIndex = Math.min((pg.totalRows - 1) * CARDS_PER_ROW + g.col, sections[focusedSection].items.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
    }
    case TvKey.Enter: {
      const item = currentItems[focusedIndex];
      if (item) {
        router.setParams({ focusedSection: focusedSection, focusedIndex: focusedIndex });
        router.navigateItem(item);
      }
      e.preventDefault(); break;
    }
    default: sidebar.backOrFocus(e);
  }
});

export const watchingPage: Page = {
  mount(_params: RouteParams) {
    const savedSection = _params.focusedSection;
    const savedIndex = _params.focusedIndex;
    PageUtils.showSpinnerIn($root);

    sidebar.setUnfocusHandler(() => updateFocus());

    $.when(getWatchingSerials(), getWatchingMovies()).then(
      (serialsRes: any, moviesRes: any) => {
        const sData = Array.isArray(serialsRes) ? serialsRes[0] : serialsRes;
        const mData = Array.isArray(moviesRes) ? moviesRes[0] : moviesRes;
        serialsData = (sData && sData.items) || [];
        moviesData = (mData && mData.items) || [];

        sections = [];
        if (moviesData.length > 0) {
          sections.push({ items: moviesData.map((m) => ({ id: m.id, type: m.type })) });
        }
        if (serialsData.length > 0) {
          sections.push({ items: serialsData.map((s) => ({ id: s.id, type: s.type })) });
        }

        if (typeof savedSection === 'number' && typeof savedIndex === 'number' && savedSection < sections.length) {
          focusedSection = savedSection;
          focusedIndex = Math.min(savedIndex, sections[savedSection].items.length - 1);
        } else {
          focusedSection = 0;
          focusedIndex = 0;
        }
        render();
      },
      () => {
        $root.html(tplLayout({ rows: tplEmptyText({ text: 'Ошибка загрузки' }) }));
      }
    );

    keys.bind(handleKey);
  },

  unmount() {
    keys.unbind();
    PageUtils.clearPage($root);
    sidebar.setUnfocusHandler(null);
    sections = [];
    serialsData = [];
    moviesData = [];
  }
};
