import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getWatchingMovies, getWatchingSerials } from '../api/watching';
import { WatchingSerialItem, WatchingMovieItem } from '../types/api';
import { navigate, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { clearTokens } from '../utils/storage';
import { unlinkDevice } from '../api/device';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';

var $root = $('#page-watching');
var keys = pageKeys();

var MENU_ITEMS = ['Я смотрю', 'Закладки', 'Поиск', 'Настройки', 'Выход'];
var menuFocused = false;
var menuIndex = 0;
var focusedSection = 0;
var focusedIndex = 0;

interface SectionData {
  items: Array<{ id: number; type: string }>;
}

var sections: SectionData[] = [];
var serialsData: WatchingSerialItem[] = [];
var moviesData: WatchingMovieItem[] = [];

var tplMenu = doT.template(
  '<div class="sidebar">' +
    '{{~it.items :item:idx}}' +
      '<div class="sidebar__item{{?item.active}} active{{?}}{{?item.focused}} focused{{?}}" data-menu="{{=idx}}">{{=item.label}}</div>' +
    '{{~}}' +
  '</div>'
);

var tplSection = doT.template(
  '<div class="watching__section-title">{{=it.title}}</div>' +
  '<div class="watching__grid" data-section="{{=it.idx}}">{{=it.cards}}</div>'
);

var tplLayout = doT.template(
  '<div class="layout">' +
    '{{=it.menu}}' +
    '<div class="content"><div class="watching">{{=it.rows}}</div></div>' +
  '</div>'
);

function buildMenu(): string {
  var items = [];
  for (var i = 0; i < MENU_ITEMS.length; i++) {
    items.push({
      label: MENU_ITEMS[i],
      active: i === 0,
      focused: menuFocused && i === menuIndex
    });
  }
  return tplMenu({ items: items });
}

function buildRows(): string {
  var html = '';
  var sIdx = 0;

  if (moviesData.length > 0) {
    var mCards = '';
    for (var j = 0; j < moviesData.length; j++) {
      mCards += tplCard({
        id: moviesData[j].id,
        poster: moviesData[j].posters.medium,
        title: moviesData[j].title,
        extra: ''
      });
    }
    html += tplSection({ title: 'Фильмы', idx: sIdx, cards: mCards });
    sIdx++;
  }

  if (serialsData.length > 0) {
    var cards = '';
    for (var i = 0; i < serialsData.length; i++) {
      var s = serialsData[i];
      cards += tplCard({
        id: s.id,
        poster: s.posters.medium,
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

  var $grid = $root.find('.watching__grid[data-section="' + focusedSection + '"]');
  var $cards = $grid.find('.card');
  if ($cards.length > 0 && focusedIndex < $cards.length) {
    var $card = $cards.eq(focusedIndex);
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
      if (menuIndex === 1) { navigate('bookmarks'); }
      else if (menuIndex === 3) { navigate('settings'); }
      else if (menuIndex === 4) { unlinkDevice().always(function () { clearTokens(); navigate('login'); }); }
      e.preventDefault(); break;
  }
}

function handleContentKey(e: JQuery.Event): void {
  if (sections.length === 0) return;

  var currentItems = sections[focusedSection].items;
  var g = gridPos(focusedIndex, currentItems.length);

  switch (e.keyCode) {
    case TvKey.Right: {
      var nr = gridMove(focusedIndex, currentItems.length, 'right');
      if (nr >= 0) { focusedIndex = nr; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Left: {
      var nl = gridMove(focusedIndex, currentItems.length, 'left');
      if (nl >= 0) { focusedIndex = nl; updateFocus(); }
      else { menuFocused = true; updateFocus(); }
      e.preventDefault(); break;
    }
    case TvKey.Down: {
      var nd = gridMove(focusedIndex, currentItems.length, 'down');
      if (nd >= 0) { focusedIndex = nd; updateFocus(); }
      else if (focusedSection < sections.length - 1) {
        focusedSection++;
        focusedIndex = Math.min(g.col, sections[focusedSection].items.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
    }
    case TvKey.Up: {
      var nu = gridMove(focusedIndex, currentItems.length, 'up');
      if (nu >= 0) { focusedIndex = nu; updateFocus(); }
      else if (focusedSection > 0) {
        focusedSection--;
        var pg = gridPos(0, sections[focusedSection].items.length);
        focusedIndex = Math.min((pg.totalRows - 1) * CARDS_PER_ROW + g.col, sections[focusedSection].items.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
    }
    case TvKey.Enter:
      var item = currentItems[focusedIndex];
      if (item) {
        setParams({ focusedSection: focusedSection, focusedIndex: focusedIndex });
        var isSerial = item.type === 'serial' || item.type === 'docuserial';
        navigate(isSerial ? 'serial' : 'movie', { id: item.id });
      }
      e.preventDefault(); break;
  }
}

export var watchingPage: Page = {
  mount: function (_params: RouteParams) {
    var savedSection = _params.focusedSection;
    var savedIndex = _params.focusedIndex;
    showSpinnerIn($root);

    $.when(getWatchingSerials(), getWatchingMovies()).then(
      function (serialsRes: any, moviesRes: any) {
        var sData = Array.isArray(serialsRes) ? serialsRes[0] : serialsRes;
        var mData = Array.isArray(moviesRes) ? moviesRes[0] : moviesRes;
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
