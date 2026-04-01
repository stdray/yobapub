import $ from 'jquery';
import { BookmarkFolder } from '../types/api';
import { toggleWatchlist } from '../api/watching';
import { getBookmarkFolders, getItemFolders, toggleBookmarkItem, createBookmarkFolder } from '../api/bookmarks';

export class DetailControls {
  private readonly $root: JQuery;
  private allFolders: readonly BookmarkFolder[] = [];
  private itemFolderIds: ReadonlySet<number> = new Set();
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
    '<span class="detail__bookmark-arrow">\u25C0</span> ' +
    'Закладки <span class="detail__rating-value detail__picker-name">-</span>' +
    ' <span class="detail__bookmark-arrow">\u25B6</span>' +
    '</span>' +
    '<span class="detail__bookmark-tags"></span>';

  // --- Bookmarks ---

  readonly loadBookmarks = (itemId: number): void => {
    this.itemId = itemId;
    $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
      if (foldersResp.items.length > 0) {
        this.allFolders = foldersResp.items;
        this.itemFolderIds = new Set(itemFoldersResp.folders.map((f) => f.id));
        const firstBookmarked = this.allFolders.findIndex((f) => this.itemFolderIds.has(f.id));
        this.pickerIdx = firstBookmarked >= 0 ? firstBookmarked : 0;
        this.emptyState = false;
        this.renderBookmarks();
      } else {
        this.allFolders = [];
        this.itemFolderIds = new Set();
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

    const tags = this.allFolders
      .filter((f) => this.itemFolderIds.has(f.id))
      .map((f) => '<span class="detail__bookmark-tag">' + f.title + '</span>')
      .join('');
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
            this.itemFolderIds = new Set([folder.id]);
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
      const updated = new Set(this.itemFolderIds);
      if (updated.has(folder.id)) {
        updated.delete(folder.id);
        // After removal, select next bookmarked folder if available
        const nextBookmarked = this.allFolders.findIndex((f, i) => i > this.pickerIdx && updated.has(f.id));
        const prevBookmarked = this.findLastIndex(this.allFolders, (f) => updated.has(f.id));
        if (nextBookmarked >= 0) {
          this.pickerIdx = nextBookmarked;
        } else if (prevBookmarked >= 0) {
          this.pickerIdx = prevBookmarked;
        }
      } else {
        updated.add(folder.id);
      }
      this.itemFolderIds = updated;
      this.renderBookmarks();
    });
  };

  private readonly findLastIndex = <T>(arr: readonly T[], pred: (item: T) => boolean): number => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (pred(arr[i])) return i;
    }
    return -1;
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
    this.itemFolderIds = new Set();
    this.pickerIdx = 0;
    this.emptyState = false;
  };
}
