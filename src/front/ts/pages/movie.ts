import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, BookmarkFolder, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings } from '../utils/templates';
import { formatDuration } from '../utils/format';
import { storage } from '../utils/storage';
import { toggleWatchlist } from '../api/watching';
import { getBookmarkFolders, getItemFolders, toggleBookmarkItem, createBookmarkFolder } from '../api/bookmarks';

const $root = $('#page-movie');
const keys = new PageKeys();

type FocusArea = 'bookmark' | 'watchlist' | 'play';
let focusArea: FocusArea = 'play';
let currentItem: Item | null = null;
let watchingInfo: WatchingInfoItem | null = null;

let allFolders: readonly BookmarkFolder[] = [];
let itemFolderIds: ReadonlySet<number> = new Set();
let selectedFolderIdx = 0;

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta detail__row"><span>{{=it.year}} &bull; {{=it.countries}}</span><span class="detail__inline-action" data-action="bookmark"><span class="icon-check">\u2713</span> <span class="detail__folder-name"></span></span></div>
      <div class="detail__meta">{{=it.genres}}</div>
      {{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}
      <div class="detail__ratings detail__row">{{=it.ratings}}<span class="detail__inline-action{{?it.inWatchlist}} active{{?}}" data-action="watchlist"><span class="icon-check">\u2713</span> Я смотрю</span></div>
      <div class="detail__actions">{{=it.buttons}}</div>
      <div class="detail__plot">{{=it.plot}}</div>
    </div>
  </div>
`);

const tplDetail = (data: {
  readonly poster: string;
  readonly titleRu: string;
  readonly titleEn: string;
  readonly year: number;
  readonly countries: string;
  readonly genres: string;
  readonly duration: string;
  readonly quality: number;
  readonly ratings: string;
  readonly buttons: string;
  readonly plot: string;
  readonly inWatchlist: boolean;
}): string =>
  tplDetailCompiled(data);

const updateFolderLabel = (): void => {
  const folder = allFolders[selectedFolderIdx];
  const name = folder ? folder.title : '-';
  const isIn = folder ? itemFolderIds.has(folder.id) : false;
  $root.find('.detail__folder-name').text(name);
  $root.find('.detail__inline-action[data-action="bookmark"]').toggleClass('active', isIn);
};

const loadBookmarks = (itemId: number): void => {
  $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
    if (foldersResp.items.length > 0) {
      allFolders = foldersResp.items;
      itemFolderIds = new Set(itemFoldersResp.folders.map((f) => f.id));
      selectedFolderIdx = 0;
      updateFolderLabel();
    } else {
      createBookmarkFolder('Favorites').done((resp) => {
        allFolders = resp.items;
        itemFolderIds = new Set();
        selectedFolderIdx = 0;
        updateFolderLabel();
      });
    }
  });
};

const render = (item: Item): void => {
  const title = item.title.split(' / ');
  let resumeTime = 0;
  if (watchingInfo && watchingInfo.videos && watchingInfo.videos.length > 0) {
    const v = watchingInfo.videos[0];
    if (v.status === 0 && v.time > 0 && v.time < v.duration - 10) { resumeTime = v.time; }
  }

  const buttons = '<div class="btn" data-action="play">' +
    (resumeTime > 0 ? 'Продолжить с ' + formatDuration(resumeTime) : 'Смотреть') + '</div>';

  const ratings = renderRatings(item);

  $root.html(tplDetail({
    poster: storage.proxyPosterUrl(item.posters.big),
    titleRu: title[0],
    titleEn: title.length > 1 ? title[1] : '',
    year: item.year,
    countries: item.countries.map((c) => c.title).join(', '),
    genres: item.genres.map((g) => g.title).join(', '),
    duration: item.duration ? formatDuration(item.duration.average) : '',
    quality: item.quality,
    ratings: ratings,
    buttons: buttons,
    plot: item.plot || '',
    inWatchlist: item.in_watchlist
  }));

  focusArea = 'play';
  selectedFolderIdx = 0;
  updateFocus();

  loadBookmarks(item.id);
};

const updateFocus = (): void => {
  $root.find('.btn').removeClass('focused');
  $root.find('.detail__inline-action').removeClass('focused');

  if (focusArea === 'bookmark') {
    $root.find('.detail__inline-action[data-action="bookmark"]').addClass('focused');
  } else if (focusArea === 'watchlist') {
    $root.find('.detail__inline-action[data-action="watchlist"]').addClass('focused');
  } else {
    $root.find('.btn').eq(0).addClass('focused');
  }
};

const handleKey = (e: JQuery.Event): void => {
  switch (e.keyCode) {
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      router.goBack(); e.preventDefault(); return;
  }

  if (focusArea === 'bookmark') {
    switch (e.keyCode) {
      case TvKey.Left:
        if (selectedFolderIdx > 0) { selectedFolderIdx--; updateFolderLabel(); }
        e.preventDefault(); break;
      case TvKey.Right:
        if (selectedFolderIdx < allFolders.length - 1) { selectedFolderIdx++; updateFolderLabel(); }
        e.preventDefault(); break;
      case TvKey.Down:
        focusArea = 'watchlist'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter: {
        const folder = allFolders[selectedFolderIdx];
        if (folder && currentItem) {
          toggleBookmarkItem(currentItem.id, folder.id).done(() => {
            const updated = new Set(itemFolderIds);
            if (updated.has(folder.id)) { updated.delete(folder.id); } else { updated.add(folder.id); }
            itemFolderIds = updated;
            updateFolderLabel();
          });
        }
        e.preventDefault(); break;
      }
    }
  } else if (focusArea === 'watchlist') {
    switch (e.keyCode) {
      case TvKey.Up:
        focusArea = 'bookmark'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Down:
        focusArea = 'play'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) {
          toggleWatchlist(currentItem.id).done((resp) => {
            $root.find('.detail__inline-action[data-action="watchlist"]').toggleClass('active', resp.watching);
          });
        }
        e.preventDefault(); break;
    }
  } else {
    switch (e.keyCode) {
      case TvKey.Up:
        focusArea = 'watchlist'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) {
          router.navigateMoviePlayer(currentItem.id);
        }
        e.preventDefault(); break;
    }
  }
};

export const moviePage: Page = {
  mount(params: RouteParams) {
    currentItem = null;
    watchingInfo = null;
    allFolders = [];
    itemFolderIds = new Set();
    PageUtils.showSpinnerIn($root);
    const id = params.id!;

    loadItemWithWatching(id,
      (item, watching) => {
        currentItem = item;
        watchingInfo = watching;
        render(currentItem);
      },
      () => {
        $root.html('<div class="detail"><div class="detail__info"><div class="detail__title">Ошибка загрузки</div></div></div>');
      }
    );
    keys.bind(handleKey);
  },
  unmount() {
    keys.unbind();
    PageUtils.clearPage($root);
    currentItem = null;
    watchingInfo = null;
  }
};
