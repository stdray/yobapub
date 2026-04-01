import $ from 'jquery';
import { BookmarkFolder } from '../types/api';
import { toggleWatchlist } from '../api/watching';
import { getBookmarkFolders, getItemFolders, toggleBookmarkItem, createBookmarkFolder } from '../api/bookmarks';

const BOOKMARKS_HTML = '<div class="detail__bookmarks"><span class="detail__bookmarks-label">Закладки:</span><span class="detail__bookmark-picker"><span class="detail__bookmark-arrow">\u25C0</span> <span class="icon-check">\u2713</span> <span class="detail__picker-name">-</span> <span class="detail__bookmark-arrow">\u25B6</span></span><span class="detail__bookmark-tags"></span></div>';

const watchlistHtml = (inWatchlist: boolean): string =>
  '<span class="detail__watchlist" data-action="watchlist">Я смотрю <span class="icon-check' + (inWatchlist ? ' checked' : '') + '">\u2713</span></span>';

export class DetailControls {
  private readonly $root: JQuery;
  private allFolders: readonly BookmarkFolder[] = [];
  private itemFolderIds: ReadonlySet<number> = new Set();
  private pickerIdx = 0;
  private itemId = 0;

  constructor($root: JQuery) {
    this.$root = $root;
  }

  // --- Templates ---

  readonly bookmarksTpl = (): string => BOOKMARKS_HTML;

  readonly watchlistTpl = (inWatchlist: boolean): string => watchlistHtml(inWatchlist);

  // --- Bookmarks ---

  readonly loadBookmarks = (itemId: number): void => {
    this.itemId = itemId;
    $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
      if (foldersResp.items.length > 0) {
        this.allFolders = foldersResp.items;
        this.itemFolderIds = new Set(itemFoldersResp.folders.map((f) => f.id));
        const firstBookmarked = this.allFolders.findIndex((f) => this.itemFolderIds.has(f.id));
        this.pickerIdx = firstBookmarked >= 0 ? firstBookmarked : 0;
        this.renderBookmarks();
      } else {
        createBookmarkFolder('Favorites').done((resp) => {
          this.allFolders = resp.items;
          this.itemFolderIds = new Set();
          this.pickerIdx = 0;
          this.renderBookmarks();
        });
      }
    });
  };

  readonly renderBookmarks = (): void => {
    const tags = this.allFolders
      .filter((f) => this.itemFolderIds.has(f.id))
      .map((f) => '<span class="detail__bookmark-tag">' + f.title + '</span>')
      .join('');
    this.$root.find('.detail__bookmark-tags').html(tags);

    const folder = this.allFolders[this.pickerIdx];
    if (folder) {
      this.$root.find('.detail__picker-name').text(folder.title);
      this.$root.find('.detail__bookmark-picker .icon-check').toggleClass('checked', this.itemFolderIds.has(folder.id));
    } else {
      this.$root.find('.detail__picker-name').text('-');
      this.$root.find('.detail__bookmark-picker .icon-check').removeClass('checked');
    }
  };

  readonly prevFolder = (): void => {
    if (this.pickerIdx > 0) { this.pickerIdx--; this.renderBookmarks(); }
  };

  readonly nextFolder = (): void => {
    if (this.pickerIdx < this.allFolders.length - 1) { this.pickerIdx++; this.renderBookmarks(); }
  };

  readonly toggleBookmark = (): void => {
    const folder = this.allFolders[this.pickerIdx];
    if (!folder) return;
    toggleBookmarkItem(this.itemId, folder.id).done(() => {
      const updated = new Set(this.itemFolderIds);
      if (updated.has(folder.id)) { updated.delete(folder.id); } else { updated.add(folder.id); }
      this.itemFolderIds = updated;
      this.renderBookmarks();
    });
  };

  // --- Watchlist ---

  readonly toggleWatchlist = (itemId: number): void => {
    toggleWatchlist(itemId).done((resp) => {
      this.$root.find('.detail__watchlist .icon-check').toggleClass('checked', resp.watching);
    });
  };

  // --- Reset ---

  readonly reset = (): void => {
    this.allFolders = [];
    this.itemFolderIds = new Set();
    this.pickerIdx = 0;
  };
}
