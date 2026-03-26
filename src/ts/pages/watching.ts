import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getWatchingMovies, getWatchingSerials } from '../api/watching';
import { WatchingSerialItem, WatchingMovieItem } from '../types/api';
import { navigate, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { clearTokens } from '../utils/storage';

var $root = $('#page-watching');
var keyHandler: ((e: JQuery.Event) => void) | null = null;

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

var tplCard = doT.template(
  '<div class="card" data-id="{{=it.id}}">' +
    '<div class="card__poster">' +
      '<img src="{{=it.poster}}" alt="">' +
      '{{?it.extra}}<div class="card__badge">{{=it.extra}}</div>{{?}}' +
    '</div>' +
    '<div class="card__title">{{=it.title}}</div>' +
  '</div>'
);

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

var tplEmpty = doT.template(
  '<div class="watching__section-title" style="margin-top:200px;text-align:center;">{{=it.text}}</div>'
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
    html += tplEmpty({ text: 'Список пуст' });
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

    var cardEl = $card[0];
    var container = $root.find('.watching')[0];
    if (cardEl && container) {
      var cardRect = cardEl.getBoundingClientRect();
      var contRect = container.getBoundingClientRect();
      var cardTop = cardRect.top - contRect.top + container.scrollTop;
      var cardBottom = cardTop + cardRect.height;
      var scrollTop = container.scrollTop;
      var viewH = container.clientHeight;
      if (cardBottom > scrollTop + viewH - 40) {
        container.scrollTop = cardBottom - viewH + 40;
      } else if (cardTop < scrollTop + 40) {
        container.scrollTop = Math.max(0, cardTop - 40);
      }
    }
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
      if (menuIndex === 3) { navigate('settings'); }
      else if (menuIndex === 4) { clearTokens(); navigate('login'); }
      e.preventDefault(); break;
  }
}

function handleContentKey(e: JQuery.Event): void {
  if (sections.length === 0) return;

  var currentItems = sections[focusedSection].items;
  var col = focusedIndex % CARDS_PER_ROW;
  var row = Math.floor(focusedIndex / CARDS_PER_ROW);
  var totalRows = Math.ceil(currentItems.length / CARDS_PER_ROW);

  switch (e.keyCode) {
    case TvKey.Right:
      if (focusedIndex < currentItems.length - 1 && col < CARDS_PER_ROW - 1) { focusedIndex++; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Left:
      if (col > 0) { focusedIndex--; updateFocus(); }
      else { menuFocused = true; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (row < totalRows - 1) {
        focusedIndex = Math.min((row + 1) * CARDS_PER_ROW + col, currentItems.length - 1);
        updateFocus();
      } else if (focusedSection < sections.length - 1) {
        focusedSection++;
        focusedIndex = Math.min(col, sections[focusedSection].items.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
    case TvKey.Up:
      if (row > 0) {
        focusedIndex = (row - 1) * CARDS_PER_ROW + col;
        updateFocus();
      } else if (focusedSection > 0) {
        focusedSection--;
        var prevItems = sections[focusedSection].items;
        var prevTotalRows = Math.ceil(prevItems.length / CARDS_PER_ROW);
        focusedIndex = Math.min((prevTotalRows - 1) * CARDS_PER_ROW + col, prevItems.length - 1);
        updateFocus();
      }
      e.preventDefault(); break;
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
    $root.html('<div class="spinner"><div class="spinner__circle"></div></div>');

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
        $root.html(tplLayout({ menu: buildMenu(), rows: tplEmpty({ text: 'Ошибка загрузки' }) }));
      }
    );

    keyHandler = handleKey;
    $(window).on('keydown', keyHandler);
  },

  unmount: function () {
    if (keyHandler) { $(window).off('keydown', keyHandler); keyHandler = null; }
    $root.empty();
    sections = [];
    serialsData = [];
    moviesData = [];
  }
};
