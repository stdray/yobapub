import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { Item } from '../types/api';
import { navigate, setParams, goBack } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { proxyPosterUrl } from '../utils/storage';
import { getItems } from '../api/items';

const $root = $('#page-novelties');
const keys = pageKeys();

const SECTIONS_CONFIG = [
  { type: 'movie',      title: 'Новые фильмы' },
  { type: 'serial',     title: 'Новые сериалы' },
  { type: 'documovie',  title: 'Новые документальные фильмы' },
  { type: 'docuserial', title: 'Новые документальные сериалы' },
  { type: '3D',         title: 'Новое в 3D' },
  { type: 'tvshow',     title: 'Новые ТВ-шоу' },
  { type: 'concert',    title: 'Новые концерты' }
];

interface SectionData {
  title: string;
  items: Array<{ id: number; type: string }>;
}

let sections: SectionData[] = [];
let focusedSection = 0;
let focusedIndex = 0;

const tplSectionCompiled = doT.template(`
  <div class="watching__section-title">{{=it.title}}</div>
  <div class="watching__grid" data-section="{{=it.idx}}">{{=it.cards}}</div>
`);

export const tplSection = (data: { readonly title: string; readonly idx: number; readonly cards: string }): string =>
  tplSectionCompiled(data);

const tplLayoutCompiled = doT.template(`
  <div class="content"><div class="watching">{{=it.rows}}</div></div>
`);

export const tplLayout = (data: { readonly rows: string }): string =>
  tplLayoutCompiled(data);

function buildRows(): string {
  if (sections.length === 0) {
    return tplEmptyText({ text: 'Нет данных' });
  }
  let html = '';
  for (var i = 0; i < sections.length; i++) {
    let cards = '';
    for (var j = 0; j < sections[i].items.length; j++) {
      const item = sections[i].items[j] as any;
      cards += tplCard({
        id: item.id,
        poster: proxyPosterUrl(item.poster),
        title: item.title,
        extra: ''
      });
    }
    html += tplSection({ title: sections[i].title, idx: i, cards: cards });
  }
  return html;
}

function render(): void {
  $root.html(tplLayout({ rows: buildRows() }));
  updateFocus();
}

function updateFocus(): void {
  $root.find('.card').removeClass('focused');
  if (sections.length === 0) return;

  const $grid = $root.find('.watching__grid[data-section="' + focusedSection + '"]');
  const $cards = $grid.find('.card');
  if ($cards.length > 0 && focusedIndex < $cards.length) {
    const $card = $cards.eq(focusedIndex);
    $card.addClass('focused');
    scrollIntoView($card[0], $root.find('.watching')[0]);
  }
}

function handleKey(e: JQuery.Event): void {
  if (sections.length === 0) return;

  const currentItems = sections[focusedSection].items;
  const g = gridPos(focusedIndex, currentItems.length);

  switch (e.keyCode) {
    case TvKey.Right: {
      const nr = gridMove(focusedIndex, currentItems.length, 'right');
      if (nr >= 0) { focusedIndex = nr; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Left: {
      const nl = gridMove(focusedIndex, currentItems.length, 'left');
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
        setParams({ focusedSection: focusedSection, focusedIndex: focusedIndex });
        const isSerial = item.type === 'serial' || item.type === 'docuserial';
        navigate(isSerial ? 'serial' : 'movie', { id: item.id });
      }
      e.preventDefault(); break;
    }
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack();
      e.preventDefault(); break;
  }
}

export var noveltiesPage: Page = {
  mount: function (params: RouteParams) {
    const savedSection = params.focusedSection;
    const savedIndex = params.focusedIndex;
    showSpinnerIn($root);

    const requests = [];
    for (var i = 0; i < SECTIONS_CONFIG.length; i++) {
      requests.push(getItems(SECTIONS_CONFIG[i].type, 'created-'));
    }

    ($.when as any).apply($, requests).then(function () {
      sections = [];
      const args = arguments;
      const n = SECTIONS_CONFIG.length;
      for (var i = 0; i < n; i++) {
        const raw = n === 1 ? args[0] : args[i];
        const res = Array.isArray(raw) ? raw[0] : raw;
        const items: Item[] = (res && res.items) || [];
        if (items.length > 0) {
          const sectionItems = items.map(function (it: Item) {
            return { id: it.id, type: it.type, title: it.title, poster: it.posters.medium };
          });
          sections.push({ title: SECTIONS_CONFIG[i].title, items: sectionItems });
        }
      }

      if (typeof savedSection === 'number' && typeof savedIndex === 'number' && savedSection < sections.length) {
        focusedSection = savedSection;
        focusedIndex = Math.min(savedIndex, sections[savedSection].items.length - 1);
      } else {
        focusedSection = 0;
        focusedIndex = 0;
      }

      render();
    });

    keys.bind(handleKey);
  },

  unmount: function () {
    keys.unbind();
    clearPage($root);
    sections = [];
  }
};
