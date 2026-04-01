import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getWatchingMovies, getWatchingSerials } from '../api/watching';
import { WatchingSerialItem, WatchingMovieItem } from '../types/api';
import { navigate, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { clearTokens, proxyPosterUrl } from '../utils/storage';
import { unlinkDevice, getUserProfile } from '../api/device';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';

const $root = $('#page-watching');
const keys = pageKeys();

const MENU_ITEMS = ['Новинки', 'Я смотрю', 'История', 'Закладки', 'ТВ', 'Поиск', 'Настройки', 'Выход'];
let menuFocused = false;
let menuIndex = 0;
let focusedSection = 0;
let focusedIndex = 0;

interface SectionData {
  items: Array<{ id: number; type: string }>;
}

let sections: SectionData[] = [];
let serialsData: WatchingSerialItem[] = [];
let moviesData: WatchingMovieItem[] = [];

const tplMenuCompiled = doT.template(`
  <div class="sidebar">
    {{?it.profile}}
      <div class="sidebar__profile">
        <img class="sidebar__avatar" src="{{=it.profile.avatar}}" />
        <div class="sidebar__username">{{=it.profile.username}}</div>
        <div class="sidebar__sub">{{=it.profile.days}} дн.</div>
      </div>
    {{?}}
    {{~it.items :item:idx}}
      <div class="sidebar__item{{?item.active}} active{{?}}{{?item.focused}} focused{{?}}" data-menu="{{=idx}}">{{=item.label}}</div>
    {{~}}
  </div>
`);

interface MenuData {
  readonly items: Array<{ readonly label: string; readonly active: boolean; readonly focused: boolean }>;
  readonly profile: { readonly avatar: string; readonly username: string; readonly days: number } | null;
}

export const tplMenu = (data: MenuData): string => tplMenuCompiled(data);

const tplSectionCompiled = doT.template(`
  <div class="watching__section-title">{{=it.title}}</div>
  <div class="watching__grid" data-section="{{=it.idx}}">{{=it.cards}}</div>
`);

export const tplSection = (data: { readonly title: string; readonly idx: number; readonly cards: string }): string =>
  tplSectionCompiled(data);

const tplLayoutCompiled = doT.template(`
  <div class="layout">
    {{=it.menu}}
    <div class="content"><div class="watching">{{=it.rows}}</div></div>
  </div>
`);

export const tplLayout = (data: { readonly menu: string; readonly rows: string }): string =>
  tplLayoutCompiled(data);

function buildMenu(): string {
  const items = [];
  for (var i = 0; i < MENU_ITEMS.length; i++) {
    items.push({
      label: MENU_ITEMS[i],
      active: i === 1,
      focused: menuFocused && i === menuIndex
    });
  }
  const up = getUserProfile();
  const profile = up && up.avatar ? { avatar: up.avatar, username: up.username, days: up.subscriptionDays } : null;
  return tplMenu({ items, profile });
}

function buildRows(): string {
  let html = '';
  let sIdx = 0;

  if (moviesData.length > 0) {
    let mCards = '';
    for (var j = 0; j < moviesData.length; j++) {
      mCards += tplCard({
        id: moviesData[j].id,
        poster: proxyPosterUrl(moviesData[j].posters.medium),
        title: moviesData[j].title,
        extra: ''
      });
    }
    html += tplSection({ title: 'Фильмы', idx: sIdx, cards: mCards });
    sIdx++;
  }

  if (serialsData.length > 0) {
    let cards = '';
    for (var i = 0; i < serialsData.length; i++) {
      const s = serialsData[i];
      cards += tplCard({
        id: s.id,
        poster: proxyPosterUrl(s.posters.medium),
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
}

function render(): void {
  $root.html(tplLayout({ menu: buildMenu(), rows: buildRows() }));
  updateFocus();
}

function updateFocus(): void {
  $root.find('.sidebar__item').removeClass('focused');
  $root.find('.card').removeClass('focused');

  if (menuFocused) {
    $root.find('.sidebar__item').eq(menuIndex).addClass('focused');
    return;
  }

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
  if (menuFocused) { handleMenuKey(e); return; }
  handleContentKey(e);
}

function handleMenuKey(e: JQuery.Event): void {
  switch (e.keyCode) {
    case TvKey.Up:
      if (menuIndex > 0) { menuIndex--; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (menuIndex < MENU_ITEMS.length - 1) { menuIndex++; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (sections.length > 0) { menuFocused = false; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Enter:
      if (menuIndex === 0) { navigate('novelties'); }
      else if (menuIndex === 2) { navigate('history'); }
      else if (menuIndex === 3) { navigate('bookmarks'); }
      else if (menuIndex === 4) { navigate('tv'); }
      else if (menuIndex === 5) { navigate('search'); }
      else if (menuIndex === 6) { navigate('settings'); }
      else if (menuIndex === 7) { unlinkDevice().always(function () { clearTokens(); navigate('login'); }); }
      e.preventDefault(); break;
  }
}

function handleContentKey(e: JQuery.Event): void {
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
      else { menuFocused = true; updateFocus(); }
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
    case TvKey.Enter:
      const item = currentItems[focusedIndex];
      if (item) {
        setParams({ focusedSection: focusedSection, focusedIndex: focusedIndex });
        const isSerial = item.type === 'serial' || item.type === 'docuserial';
        navigate(isSerial ? 'serial' : 'movie', { id: item.id });
      }
      e.preventDefault(); break;
  }
}

export var watchingPage: Page = {
  mount: function (_params: RouteParams) {
    const savedSection = _params.focusedSection;
    const savedIndex = _params.focusedIndex;
    showSpinnerIn($root);

    $.when(getWatchingSerials(), getWatchingMovies()).then(
      function (serialsRes: any, moviesRes: any) {
        const sData = Array.isArray(serialsRes) ? serialsRes[0] : serialsRes;
        const mData = Array.isArray(moviesRes) ? moviesRes[0] : moviesRes;
        serialsData = (sData && sData.items) || [];
        moviesData = (mData && mData.items) || [];

        sections = [];
        if (moviesData.length > 0) {
          sections.push({ items: moviesData.map(function (m) { return { id: m.id, type: m.type }; }) });
        }
        if (serialsData.length > 0) {
          sections.push({ items: serialsData.map(function (s) { return { id: s.id, type: s.type }; }) });
        }

        if (typeof savedSection === 'number' && typeof savedIndex === 'number' && savedSection < sections.length) {
          focusedSection = savedSection;
          focusedIndex = Math.min(savedIndex, sections[savedSection].items.length - 1);
        } else {
          focusedSection = 0;
          focusedIndex = 0;
        }
        menuFocused = false;
        render();
      },
      function () {
        $root.html(tplLayout({ menu: buildMenu(), rows: tplEmptyText({ text: 'Ошибка загрузки' }) }));
      }
    );

    keys.bind(handleKey);
  },

  unmount: function () {
    keys.unbind();
    clearPage($root);
    sections = [];
    serialsData = [];
    moviesData = [];
  }
};
