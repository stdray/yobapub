import $ from 'jquery';
import { BookmarkFolder } from '../types/api';
import { toggleWatchlist } from '../api/watching';
import { getBookmarkFolders, getItemFolders, toggleBookmarkItem, createBookmarkFolder } from '../api/bookmarks';
import { NumberSet } from './number-set';

const findIndex = <T>(arr: readonly T[], pred: (item: T, idx: number) => boolean): number => {
  for (let i = 0; i < arr.length; i++) {
    if (pred(arr[i], i)) return i;
  }
  return -1;
};

const findLastIndex = <T>(arr: readonly T[], pred: (item: T) => boolean): number => {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
};

export class DetailControls {
  private readonly $root: JQuery;
  private allFolders: readonly BookmarkFolder[] = [];
  private itemFolderIds = new NumberSet();
  private pickerIdx = 0;
  private itemId = 0;
  private emptyState = false;

  constructor($root: JQuery) {
    this.$root = $root;
  }

  // --- Templates ---

  readonly watchlistTpl = (inWatchlist: boolean): string =>
    '<span class="detail__rating focusable" data-action="watchlist"><span class="detail__watchlist-text">' + (inWatchlist ? 'Смотрю' : 'Не смотрю') + '</span></span>';

  readonly bookmarksTpl = (): string =>
    '<span class="detail__rating focusable" data-action="bookmark">' +
    'Закладки <span class="detail__bookmark-arrow">\u25C0</span> ' +
    '<span class="detail__rating-value detail__picker-name">-</span>' +
    ' <span class="detail__bookmark-arrow">\u25B6</span>' +
    '</span>' +
    '<span class="detail__bookmark-tags"></span>';

  // --- Bookmarks ---

  readonly loadBookmarks = (itemId: number): void => {
    this.itemId = itemId;
    $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
      if (foldersResp.items.length > 0) {
        this.allFolders = foldersResp.items;
        this.itemFolderIds = new NumberSet(itemFoldersResp.folders.map((f) => f.id));
        const first = findIndex(this.allFolders, (f) => this.itemFolderIds.has(f.id));
        this.pickerIdx = first >= 0 ? first : 0;
        this.emptyState = false;
        this.renderBookmarks();
      } else {
        this.allFolders = [];
        this.itemFolderIds = new NumberSet();
        this.pickerIdx = 0;
        this.emptyState = true;
        this.renderBookmarks();
      }
    });
  };

  readonly renderBookmarks = (): void => {
    if (this.emptyState) {
      this.$root.find('.detail__bookmark-tags').html('');
      this.$root.find('.detail__picker-name').text('Добавить в Favorites');
      return;
    }

    let tags = '';
    for (let i = 0; i < this.allFolders.length; i++) {
      const f = this.allFolders[i];
      if (this.itemFolderIds.has(f.id)) {
        tags += '<span class="detail__bookmark-tag">' + f.title + '</span>';
      }
    }
    this.$root.find('.detail__bookmark-tags').html(tags);

    const folder = this.allFolders[this.pickerIdx];
    if (folder) {
      const isIn = this.itemFolderIds.has(folder.id);
      this.$root.find('.detail__picker-name').text((isIn ? '\u2713 ' : '') + folder.title);
    } else {
      this.$root.find('.detail__picker-name').text('-');
    }
  };

  readonly prevFolder = (): void => {
    if (this.pickerIdx > 0) { this.pickerIdx--; this.renderBookmarks(); }
  };

  readonly nextFolder = (): void => {
    if (this.pickerIdx < this.allFolders.length - 1) { this.pickerIdx++; this.renderBookmarks(); }
  };

  readonly toggleBookmark = (): void => {
    if (this.emptyState) {
      createBookmarkFolder('Favorites').done((resp) => {
        if (resp.items.length > 0) {
          const folder = resp.items[0];
          toggleBookmarkItem(this.itemId, folder.id).done(() => {
            this.allFolders = resp.items;
            this.itemFolderIds = new NumberSet([folder.id]);
            this.pickerIdx = 0;
            this.emptyState = false;
            this.renderBookmarks();
          });
        }
      });
      return;
    }
    const folder = this.allFolders[this.pickerIdx];
    if (!folder) return;
    toggleBookmarkItem(this.itemId, folder.id).done(() => {
      const updated = this.itemFolderIds.clone();
      if (updated.has(folder.id)) {
        updated.delete(folder.id);
        const next = findIndex(this.allFolders, (f, i) => i > this.pickerIdx && updated.has(f.id));
        const prev = findLastIndex(this.allFolders, (f) => updated.has(f.id));
        if (next >= 0) {
          this.pickerIdx = next;
        } else if (prev >= 0) {
          this.pickerIdx = prev;
        }
      } else {
        updated.add(folder.id);
      }
      this.itemFolderIds = updated;
      this.renderBookmarks();
    });
  };

  // --- Watchlist ---

  readonly toggleWatchlist = (itemId: number): void => {
    toggleWatchlist(itemId).done((resp) => {
      this.$root.find('.detail__watchlist-text').text(resp.watching ? 'Смотрю' : 'Не смотрю');
    });
  };

  // --- Reset ---

  readonly reset = (): void => {
    this.allFolders = [];
    this.itemFolderIds = new NumberSet();
    this.pickerIdx = 0;
    this.emptyState = false;
  };
}
