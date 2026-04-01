import $ from 'jquery';
import { TvKey } from './platform';
import { BookmarkFolder } from '../types/api';
import { getBookmarkFolders, getItemFolders, toggleBookmarkItem, createBookmarkFolder } from '../api/bookmarks';

let focusedIndex = 0;
let folders: readonly BookmarkFolder[] = [];
let itemFolderIds: ReadonlySet<number> = new Set();
let currentItemId = 0;
let keyHandler: ((e: JQuery.Event) => void) | null = null;
let onDone: (() => void) | null = null;

const $picker = () => $('#bookmark-picker');

const renderList = (): void => {
  let html = '';
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i];
    const checked = itemFolderIds.has(f.id);
    html += '<div class="bpicker__item' + (i === focusedIndex ? ' focused' : '') + '" data-idx="' + i + '">' +
      '<span class="bpicker__check">' + (checked ? '\u2713' : '') + '</span>' +
      '<span class="bpicker__title">' + f.title + '</span>' +
      '</div>';
  }
  $picker().find('.bpicker__list').html(html);
};

const updateFocus = (): void => {
  $picker().find('.bpicker__item').removeClass('focused');
  $picker().find('.bpicker__item').eq(focusedIndex).addClass('focused');
};

const close = (): void => {
  $picker().addClass('hidden');
  if (keyHandler) {
    $(window).off('keydown', keyHandler);
    keyHandler = null;
  }
  if (onDone) onDone();
};

const toggleFolder = (): void => {
  const folder = folders[focusedIndex];
  if (!folder) return;

  toggleBookmarkItem(currentItemId, folder.id).done(() => {
    const mutable = new Set(itemFolderIds);
    if (mutable.has(folder.id)) {
      mutable.delete(folder.id);
    } else {
      mutable.add(folder.id);
    }
    itemFolderIds = mutable;
    renderList();
  });
};

const ensureDefaultFolder = (allFolders: readonly BookmarkFolder[]): JQueryDeferred<readonly BookmarkFolder[]> => {
  const d = $.Deferred<readonly BookmarkFolder[]>();
  if (allFolders.length > 0) {
    d.resolve(allFolders);
  } else {
    createBookmarkFolder('Favorites').done((resp) => {
      d.resolve(resp.items);
    }).fail(() => {
      d.resolve(allFolders);
    });
  }
  return d;
};

export const showBookmarkPicker = (itemId: number, done?: () => void): void => {
  currentItemId = itemId;
  onDone = done || null;
  focusedIndex = 0;
  $picker().removeClass('hidden');
  $picker().find('.bpicker__list').html('<div class="bpicker__loading">...</div>');

  $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
    ensureDefaultFolder(foldersResp.items).done((resolvedFolders) => {
      folders = resolvedFolders;
      itemFolderIds = new Set(itemFoldersResp.folders.map((f) => f.id));
      focusedIndex = 0;
      renderList();
    });
  });

  keyHandler = (e: JQuery.Event) => {
    switch (e.keyCode) {
      case TvKey.Up:
        if (focusedIndex > 0) { focusedIndex--; updateFocus(); }
        e.preventDefault(); e.stopImmediatePropagation(); break;
      case TvKey.Down:
        if (focusedIndex < folders.length - 1) { focusedIndex++; updateFocus(); }
        e.preventDefault(); e.stopImmediatePropagation(); break;
      case TvKey.Enter:
        toggleFolder();
        e.preventDefault(); e.stopImmediatePropagation(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        close();
        e.preventDefault(); e.stopImmediatePropagation(); break;
    }
  };
  $(window).on('keydown', keyHandler);
};
