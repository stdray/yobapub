import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getBookmarkFolders, getBookmarkItems } from '../api/bookmarks';
import { BookmarkFolder, Item } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { storage } from '../utils/storage';
import { sidebar } from '../sidebar';

const $root = $('#page-bookmarks');
const keys = new PageKeys();

type ViewMode = 'folders' | 'items';
let viewMode: ViewMode = 'folders';

let folders: BookmarkFolder[] = [];
let folderFocused = 0;

let currentFolderId = 0;
let currentFolderTitle = '';
let itemsData: Item[] = [];
let focusedIndex = 0;

const tplFolderItemCompiled = doT.template(`
  <div class="folder-item" data-id="{{=it.id}}">
    <div class="folder-item__icon">&#128194;</div>
    <div class="folder-item__info">
      <div class="folder-item__title">{{=it.title}}</div>
      <div class="folder-item__count">{{=it.count}}</div>
    </div>
  </div>
`);

const tplFolderItem = (data: { readonly id: number; readonly title: string; readonly count: string }): string =>
  tplFolderItemCompiled(data);

const tplFoldersPageCompiled = doT.template(`
  <div class="watching">
    <div class="watching__section-title">{{=it.title}}</div>
    <div class="folder-list">{{=it.items}}</div>
  </div>
`);

const tplFoldersPage = (data: { readonly title: string; readonly items: string }): string =>
  tplFoldersPageCompiled(data);

const tplItemsPageCompiled = doT.template(`
  <div class="watching">
    <div class="watching__section-title">{{=it.title}}</div>
    <div class="watching__grid">{{=it.cards}}</div>
  </div>
`);

const tplItemsPage = (data: { readonly title: string; readonly cards: string }): string =>
  tplItemsPageCompiled(data);

const renderFolders = (): void => {
  if (folders.length === 0) {
    $root.html('<div class="watching">' + tplEmptyText({ text: 'Нет папок' }) + '</div>');
    return;
  }
  let html = '';
  for (let i = 0; i < folders.length; i++) {
    html += tplFolderItem({
      id: folders[i].id,
      title: folders[i].title,
      count: folders[i].count + ' шт.'
    });
  }
  $root.html(tplFoldersPage({ title: 'Закладки', items: html }));
  updateFolderFocus();
};

const updateFolderFocus = (): void => {
  $root.find('.folder-item').removeClass('focused');
  if (folders.length > 0) {
    const $item = $root.find('.folder-item').eq(folderFocused);
    $item.addClass('focused');
    PageUtils.scrollIntoView($item[0], $root.find('.watching')[0]);
  }
};

const renderItems = (): void => {
  if (itemsData.length === 0) {
    $root.html('<div class="watching">' + tplEmptyText({ text: 'Папка пуста' }) + '</div>');
    return;
  }
  let cards = '';
  for (let i = 0; i < itemsData.length; i++) {
    cards += tplCard({
      id: itemsData[i].id,
      poster: storage.proxyPosterUrl(itemsData[i].posters.medium),
      title: itemsData[i].title
    });
  }
  $root.html(tplItemsPage({ title: currentFolderTitle, cards: cards }));
  updateItemFocus();
};

const updateItemFocus = (): void => {
  $root.find('.card').removeClass('focused');
  if (itemsData.length > 0 && focusedIndex < itemsData.length) {
    const $card = $root.find('.card').eq(focusedIndex);
    $card.addClass('focused');
    PageUtils.scrollIntoView($card[0], $root.find('.watching')[0]);
  }
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (viewMode === 'folders') {
    handleFolderKey(e);
  } else {
    handleItemKey(e);
  }
});

const handleFolderKey = (e: JQuery.Event): void => {
  switch (e.keyCode) {
    case TvKey.Up:
      if (folderFocused > 0) { folderFocused--; updateFolderFocus(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (folderFocused < folders.length - 1) { folderFocused++; updateFolderFocus(); }
      e.preventDefault(); break;
    case TvKey.Left:
      sidebar.focus();
      e.preventDefault(); break;
    case TvKey.Enter:
      if (folders.length > 0) {
        const folder = folders[folderFocused];
        currentFolderId = folder.id;
        currentFolderTitle = folder.title;
        openFolder(folder.id);
      }
      e.preventDefault(); break;
    default: sidebar.backOrFocus(e);
  }
};

const handleItemKey = (e: JQuery.Event): void => {
  const dir = e.keyCode === TvKey.Right ? 'right' as const
    : e.keyCode === TvKey.Left ? 'left' as const
    : e.keyCode === TvKey.Down ? 'down' as const
    : e.keyCode === TvKey.Up ? 'up' as const
    : null;
  if (dir) {
    if (dir === 'left') {
      const nl = sidebar.gridLeftOrFocus(focusedIndex, itemsData.length);
      if (nl >= 0) { focusedIndex = nl; updateItemFocus(); }
    } else {
      const next = gridMove(focusedIndex, itemsData.length, dir);
      if (next >= 0) { focusedIndex = next; updateItemFocus(); }
    }
    e.preventDefault();
    return;
  }

  switch (e.keyCode) {
    case TvKey.Enter:
      if (itemsData.length > 0) {
        const item = itemsData[focusedIndex];
        if (item) {
          router.setParams({ folderId: currentFolderId, folderTitle: currentFolderTitle, focusedIndex: focusedIndex });
          const isSerial = item.type === 'serial' || item.type === 'docuserial';
          router.navigate(isSerial ? 'serial' : 'movie', { id: item.id });
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
};

const openFolder = (folderId: number, keepFocus?: boolean): void => {
  viewMode = 'items';
  if (!keepFocus) { focusedIndex = 0; }
  PageUtils.showSpinnerIn($root);
  getBookmarkItems(folderId).then(
    (res: any) => {
      itemsData = (res && res.items) || [];
      if (focusedIndex >= itemsData.length) { focusedIndex = Math.max(0, itemsData.length - 1); }
      renderItems();
    },
    () => {
      $root.html('<div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div>');
    }
  );
};

export const bookmarksPage: Page = {
  mount(params: RouteParams) {
    keys.bind(handleKey);
    PageUtils.showSpinnerIn($root);

    sidebar.setUnfocusHandler(() => {
      if (viewMode === 'folders') { updateFolderFocus(); }
      else { updateItemFocus(); }
    });

    if (params.folderId) {
      currentFolderId = params.folderId;
      currentFolderTitle = params.folderTitle || '';
      focusedIndex = (typeof params.focusedIndex === 'number') ? params.focusedIndex : 0;

      getBookmarkFolders().then(
        (res: any) => {
          folders = (res && res.items) || [];
          for (let i = 0; i < folders.length; i++) {
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
      (res: any) => {
        folders = (res && res.items) || [];
        renderFolders();
      },
      () => {
        $root.html('<div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div>');
      }
    );
  },

  unmount() {
    keys.unbind();
    PageUtils.clearPage($root);
    sidebar.setUnfocusHandler(null);
    folders = [];
    itemsData = [];
  }
};
