import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { getBookmarkFolders, getBookmarkItems } from '../api/bookmarks';
import { BookmarkFolder, BookmarkFoldersResponse, BookmarkItemsResponse, Item } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { storage } from '../utils/storage';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

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

type ViewMode = 'folders' | 'items';

class BookmarksPage extends SidebarPage {
  private viewMode: ViewMode = 'folders';
  private folders: BookmarkFolder[] = [];
  private folderFocused = 0;
  private currentFolderId = 0;
  private currentFolderTitle = '';
  private itemsData: Item[] = [];
  private focusedIndex = 0;

  constructor() { super('bookmarks'); }

  protected onUnfocus(): void {
    if (this.viewMode === 'folders') { this.updateFolderFocus(); }
    else { this.updateItemFocus(); }
  }

  protected onMount(params: RouteParams): void {
    PageUtils.showSpinnerIn(this.$root);

    if (params.folderId) {
      this.currentFolderId = params.folderId;
      this.currentFolderTitle = params.folderTitle || '';
      this.focusedIndex = (typeof params.focusedIndex === 'number') ? params.focusedIndex : 0;

      getBookmarkFolders().then(
        (res: BookmarkFoldersResponse) => {
          this.folders = (res && res.items) || [];
          for (let i = 0; i < this.folders.length; i++) {
            if (this.folders[i].id === this.currentFolderId) { this.folderFocused = i; break; }
          }
        }
      );

      this.openFolder(this.currentFolderId, true);
      return;
    }

    this.folderFocused = 0;
    this.viewMode = 'folders';

    getBookmarkFolders().then(
      (res: BookmarkFoldersResponse) => {
        this.folders = (res && res.items) || [];
        this.renderFolders();
      },
      () => {
        this.$root.html('<div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div>');
      }
    );
  }

  protected onUnmount(): void {
    this.folders = [];
    this.itemsData = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.viewMode === 'folders') {
      this.handleFolderKey(e);
    } else {
      this.handleItemKey(e);
    }
  }

  private handleFolderKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up:
        if (this.folderFocused > 0) { this.folderFocused--; this.updateFolderFocus(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.folderFocused < this.folders.length - 1) { this.folderFocused++; this.updateFolderFocus(); }
        e.preventDefault(); break;
      case TvKey.Left:
        sidebar.focus();
        e.preventDefault(); break;
      case TvKey.Enter:
        if (this.folders.length > 0) {
          const folder = this.folders[this.folderFocused];
          this.currentFolderId = folder.id;
          this.currentFolderTitle = folder.title;
          this.openFolder(folder.id);
        }
        e.preventDefault(); break;
      default: sidebar.backOrFocus(e);
    }
  }

  private handleItemKey(e: JQuery.Event): void {
    const dir = e.keyCode === TvKey.Right ? 'right' as const
      : e.keyCode === TvKey.Left ? 'left' as const
      : e.keyCode === TvKey.Down ? 'down' as const
      : e.keyCode === TvKey.Up ? 'up' as const
      : null;
    if (dir) {
      if (dir === 'left') {
        const nl = sidebar.gridLeftOrFocus(this.focusedIndex, this.itemsData.length);
        if (nl >= 0) { this.focusedIndex = nl; this.updateItemFocus(); }
      } else {
        const next = gridMove(this.focusedIndex, this.itemsData.length, dir);
        if (next >= 0) { this.focusedIndex = next; this.updateItemFocus(); }
      }
      e.preventDefault();
      return;
    }

    switch (e.keyCode) {
      case TvKey.Enter:
        if (this.itemsData.length > 0) {
          const item = this.itemsData[this.focusedIndex];
          if (item) {
            router.setParams({ folderId: this.currentFolderId, folderTitle: this.currentFolderTitle, focusedIndex: this.focusedIndex });
            router.navigateItem(item);
          }
        }
        e.preventDefault(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        this.viewMode = 'folders';
        this.renderFolders();
        e.preventDefault(); break;
    }
  }

  private openFolder(folderId: number, keepFocus?: boolean): void {
    this.viewMode = 'items';
    if (!keepFocus) { this.focusedIndex = 0; }
    PageUtils.showSpinnerIn(this.$root);
    getBookmarkItems(folderId).then(
      (res: BookmarkItemsResponse) => {
        this.itemsData = (res && res.items) || [];
        if (this.focusedIndex >= this.itemsData.length) { this.focusedIndex = Math.max(0, this.itemsData.length - 1); }
        this.renderItems();
      },
      () => {
        this.$root.html('<div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div>');
      }
    );
  }

  private renderFolders(): void {
    if (this.folders.length === 0) {
      this.$root.html('<div class="watching">' + tplEmptyText({ text: 'Нет папок' }) + '</div>');
      return;
    }
    let html = '';
    for (let i = 0; i < this.folders.length; i++) {
      html += tplFolderItem({
        id: this.folders[i].id,
        title: this.folders[i].title,
        count: this.folders[i].count + ' шт.'
      });
    }
    this.$root.html(tplFoldersPage({ title: 'Закладки', items: html }));
    this.updateFolderFocus();
  }

  private updateFolderFocus(): void {
    this.$root.find('.folder-item').removeClass('focused');
    if (this.folders.length > 0) {
      const $item = this.$root.find('.folder-item').eq(this.folderFocused);
      $item.addClass('focused');
      PageUtils.scrollIntoView($item[0], this.$root.find('.watching')[0]);
    }
  }

  private renderItems(): void {
    if (this.itemsData.length === 0) {
      this.$root.html('<div class="watching">' + tplEmptyText({ text: 'Папка пуста' }) + '</div>');
      return;
    }
    let cards = '';
    for (let i = 0; i < this.itemsData.length; i++) {
      cards += tplCard({
        id: this.itemsData[i].id,
        poster: storage.proxyPosterUrl(this.itemsData[i].posters.medium),
        title: this.itemsData[i].title
      });
    }
    this.$root.html(tplItemsPage({ title: this.currentFolderTitle, cards: cards }));
    this.updateItemFocus();
  }

  private updateItemFocus(): void {
    this.$root.find('.card').removeClass('focused');
    if (this.itemsData.length > 0 && this.focusedIndex < this.itemsData.length) {
      const $card = this.$root.find('.card').eq(this.focusedIndex);
      $card.addClass('focused');
      PageUtils.scrollIntoView($card[0], this.$root.find('.watching')[0]);
    }
  }
}

export const bookmarksPage = new BookmarksPage();
