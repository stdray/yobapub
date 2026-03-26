import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getBookmarkFolders, getBookmarkItems } from '../api/bookmarks';
import { BookmarkFolder, Item } from '../types/api';
import { navigate, goBack, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';

var $root = $('#page-bookmarks');
var keys = pageKeys();

type ViewMode = 'folders' | 'items';
var viewMode: ViewMode = 'folders';

var folders: BookmarkFolder[] = [];
var folderFocused = 0;

var currentFolderId = 0;
var currentFolderTitle = '';
var itemsData: Item[] = [];
var focusedIndex = 0;

var tplFolderItem = doT.template(
  '<div class="folder-item" data-id="{{=it.id}}">' +
    '<div class="folder-item__icon">&#128194;</div>' +
    '<div class="folder-item__info">' +
      '<div class="folder-item__title">{{=it.title}}</div>' +
      '<div class="folder-item__count">{{=it.count}}</div>' +
    '</div>' +
  '</div>'
);

var tplCard = doT.template(
  '<div class="card" data-id="{{=it.id}}">' +
    '<div class="card__poster">' +
      '<img src="{{=it.poster}}" alt="">' +
    '</div>' +
    '<div class="card__title">{{=it.title}}</div>' +
  '</div>'
);

var tplFoldersPage = doT.template(
  '<div class="watching">' +
    '<div class="watching__section-title">{{=it.title}}</div>' +
    '<div class="folder-list">{{=it.items}}</div>' +
  '</div>'
);

var tplItemsPage = doT.template(
  '<div class="watching">' +
    '<div class="watching__section-title">{{=it.title}}</div>' +
    '<div class="watching__grid">{{=it.cards}}</div>' +
  '</div>'
);

var tplEmpty = doT.template(
  '<div class="watching">' +
    '<div class="watching__section-title" style="margin-top:200px;text-align:center;">{{=it.text}}</div>' +
  '</div>'
);

function renderFolders(): void {
  if (folders.length === 0) {
    $root.html(tplEmpty({ title: 'Закладки', text: 'Нет папок' }));
    return;
  }
  var html = '';
  for (var i = 0; i < folders.length; i++) {
    html += tplFolderItem({
      id: folders[i].id,
      title: folders[i].title,
      count: folders[i].count + ' шт.'
    });
  }
  $root.html(tplFoldersPage({ title: 'Закладки', items: html }));
  updateFolderFocus();
}

function updateFolderFocus(): void {
  $root.find('.folder-item').removeClass('focused');
  if (folders.length > 0) {
    var $item = $root.find('.folder-item').eq(folderFocused);
    $item.addClass('focused');
    scrollIntoView($item, $root.find('.watching'));
  }
}

function renderItems(): void {
  if (itemsData.length === 0) {
    $root.html(tplEmpty({ title: currentFolderTitle, text: 'Папка пуста' }));
    return;
  }
  var cards = '';
  for (var i = 0; i < itemsData.length; i++) {
    cards += tplCard({
      id: itemsData[i].id,
      poster: itemsData[i].posters.medium,
      title: itemsData[i].title
    });
  }
  $root.html(tplItemsPage({ title: currentFolderTitle, cards: cards }));
  updateItemFocus();
}

function updateItemFocus(): void {
  $root.find('.card').removeClass('focused');
  if (itemsData.length > 0 && focusedIndex < itemsData.length) {
    var $card = $root.find('.card').eq(focusedIndex);
    $card.addClass('focused');
    scrollIntoView($card, $root.find('.watching'));
  }
}

function scrollIntoView($el: JQuery, $container: JQuery): void {
  var el = $el[0];
  var container = $container[0];
  if (!el || !container) return;
  var elRect = el.getBoundingClientRect();
  var contRect = container.getBoundingClientRect();
  var elTop = elRect.top - contRect.top + container.scrollTop;
  var elBottom = elTop + elRect.height;
  var scrollTop = container.scrollTop;
  var viewH = container.clientHeight;
  if (elBottom > scrollTop + viewH - 40) {
    container.scrollTop = elBottom - viewH + 40;
  } else if (elTop < scrollTop + 40) {
    container.scrollTop = Math.max(0, elTop - 40);
  }
}

function handleKey(e: JQuery.Event): void {
  if (viewMode === 'folders') {
    handleFolderKey(e);
  } else {
    handleItemKey(e);
  }
}

function handleFolderKey(e: JQuery.Event): void {
  switch (e.keyCode) {
    case TvKey.Up:
      if (folderFocused > 0) { folderFocused--; updateFolderFocus(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (folderFocused < folders.length - 1) { folderFocused++; updateFolderFocus(); }
      e.preventDefault(); break;
    case TvKey.Enter:
      if (folders.length > 0) {
        var folder = folders[folderFocused];
        currentFolderId = folder.id;
        currentFolderTitle = folder.title;
        openFolder(folder.id);
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack(); e.preventDefault(); break;
  }
}

function handleItemKey(e: JQuery.Event): void {
  var col = focusedIndex % CARDS_PER_ROW;
  var row = Math.floor(focusedIndex / CARDS_PER_ROW);
  var totalRows = Math.ceil(itemsData.length / CARDS_PER_ROW);

  switch (e.keyCode) {
    case TvKey.Right:
      if (focusedIndex < itemsData.length - 1 && col < CARDS_PER_ROW - 1) {
        focusedIndex++; updateItemFocus();
      }
      e.preventDefault(); break;
    case TvKey.Left:
      if (col > 0) { focusedIndex--; updateItemFocus(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (row < totalRows - 1) {
        focusedIndex = Math.min((row + 1) * CARDS_PER_ROW + col, itemsData.length - 1);
        updateItemFocus();
      }
      e.preventDefault(); break;
    case TvKey.Up:
      if (row > 0) {
        focusedIndex = (row - 1) * CARDS_PER_ROW + col;
        updateItemFocus();
      }
      e.preventDefault(); break;
    case TvKey.Enter:
      if (itemsData.length > 0) {
        var item = itemsData[focusedIndex];
        if (item) {
          setParams({ folderId: currentFolderId, folderTitle: currentFolderTitle, focusedIndex: focusedIndex });
          var isSerial = item.type === 'serial' || item.type === 'docuserial';
          navigate(isSerial ? 'serial' : 'movie', { id: item.id });
        }
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      viewMode = 'folders';
      renderFolders();
      e.preventDefault(); break;
  }
}

function openFolder(folderId: number, keepFocus?: boolean): void {
  viewMode = 'items';
  if (!keepFocus) { focusedIndex = 0; }
  showSpinnerIn($root);
  getBookmarkItems(folderId).then(
    function (res: any) {
      itemsData = (res && res.items) || [];
      if (focusedIndex >= itemsData.length) { focusedIndex = Math.max(0, itemsData.length - 1); }
      renderItems();
    },
    function () {
      $root.html(tplEmpty({ title: currentFolderTitle, text: 'Ошибка загрузки' }));
    }
  );
}

export var bookmarksPage: Page = {
  mount: function (params: RouteParams) {
    keys.bind(handleKey);
    showSpinnerIn($root);

    if (params.folderId) {
      currentFolderId = params.folderId;
      currentFolderTitle = params.folderTitle || '';
      focusedIndex = (typeof params.focusedIndex === 'number') ? params.focusedIndex : 0;

      getBookmarkFolders().then(
        function (res: any) {
          folders = (res && res.items) || [];
          for (var i = 0; i < folders.length; i++) {
            if (folders[i].id === currentFolderId) { folderFocused = i; break; }
          }
        }
      );

      openFolder(currentFolderId, true);
      return;
    }

    folderFocused = 0;
    viewMode = 'folders';

    getBookmarkFolders().then(
      function (res: any) {
        folders = (res && res.items) || [];
        renderFolders();
      },
      function () {
        $root.html(tplEmpty({ title: 'Закладки', text: 'Ошибка загрузки' }));
      }
    );
  },

  unmount: function () {
    keys.unbind();
    clearPage($root);
    folders = [];
    itemsData = [];
  }
};
