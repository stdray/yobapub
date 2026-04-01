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

type FocusArea = 'watchlist' | 'play' | 'bookmarks';
let focusArea: FocusArea = 'play';
let currentItem: Item | null = null;
let watchingInfo: WatchingInfoItem | null = null;

let allFolders: readonly BookmarkFolder[] = [];
let itemFolderIds: ReadonlySet<number> = new Set();
let pickerIdx = 0;

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>
      <div class="detail__meta">{{=it.genres}}</div>
      {{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}
      <div class="detail__ratings">{{=it.ratings}}<span class="detail__watchlist" data-action="watchlist">Я смотрю <span class="icon-check{{?it.inWatchlist}} checked{{?}}">\u2713</span></span></div>
      <div class="detail__actions">{{=it.buttons}}</div>
      <div class="detail__bookmarks"><span class="detail__bookmarks-label">Закладки:</span><span class="detail__bookmark-tags"></span><span class="detail__bookmark-picker"><span class="detail__bookmark-arrow">\u25C0</span> <span class="detail__picker-name">-</span> <span class="icon-check">\u2713</span> <span class="detail__bookmark-arrow">\u25B6</span></span></div>
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

const renderBookmarks = (): void => {
  const tags = allFolders
    .filter((f) => itemFolderIds.has(f.id))
    .map((f) => '<span class="detail__bookmark-tag">' + f.title + '</span>')
    .join('');
  $root.find('.detail__bookmark-tags').html(tags);

  const folder = allFolders[pickerIdx];
  if (folder) {
    $root.find('.detail__picker-name').text(folder.title);
    $root.find('.detail__bookmark-picker .icon-check').toggleClass('checked', itemFolderIds.has(folder.id));
  } else {
    $root.find('.detail__picker-name').text('-');
    $root.find('.detail__bookmark-picker .icon-check').removeClass('checked');
  }
};

const loadBookmarks = (itemId: number): void => {
  $.when(getBookmarkFolders(), getItemFolders(itemId)).done((foldersResp, itemFoldersResp) => {
    if (foldersResp.items.length > 0) {
      allFolders = foldersResp.items;
      itemFolderIds = new Set(itemFoldersResp.folders.map((f) => f.id));
      pickerIdx = 0;
      renderBookmarks();
    } else {
      createBookmarkFolder('Favorites').done((resp) => {
        allFolders = resp.items;
        itemFolderIds = new Set();
        pickerIdx = 0;
        renderBookmarks();
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

  $root.html(tplDetail({
    poster: storage.proxyPosterUrl(item.posters.big),
    titleRu: title[0],
    titleEn: title.length > 1 ? title[1] : '',
    year: item.year,
    countries: item.countries.map((c) => c.title).join(', '),
    genres: item.genres.map((g) => g.title).join(', '),
    duration: item.duration ? formatDuration(item.duration.average) : '',
    quality: item.quality,
    ratings: renderRatings(item),
    buttons: buttons,
    plot: item.plot || '',
    inWatchlist: item.in_watchlist
  }));

  focusArea = 'play';
  pickerIdx = 0;
  updateFocus();
  loadBookmarks(item.id);
};

const updateFocus = (): void => {
  $root.find('.btn').removeClass('focused');
  $root.find('.detail__watchlist').removeClass('focused');
  $root.find('.detail__bookmark-picker').removeClass('focused');

  if (focusArea === 'watchlist') {
    $root.find('.detail__watchlist').addClass('focused');
  } else if (focusArea === 'bookmarks') {
    $root.find('.detail__bookmark-picker').addClass('focused');
  } else {
    $root.find('.btn').eq(0).addClass('focused');
  }
};

const handleKey = (e: JQuery.Event): void => {
  switch (e.keyCode) {
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      if (focusArea === 'bookmarks') {
        focusArea = 'play'; updateFocus();
      } else {
        router.goBack();
      }
      e.preventDefault(); return;
  }

  if (focusArea === 'watchlist') {
    switch (e.keyCode) {
      case TvKey.Down:
        focusArea = 'play'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) {
          toggleWatchlist(currentItem.id).done((resp) => {
            $root.find('.detail__watchlist .icon-check').toggleClass('checked', resp.watching);
          });
        }
        e.preventDefault(); break;
    }
  } else if (focusArea === 'play') {
    switch (e.keyCode) {
      case TvKey.Up:
        focusArea = 'watchlist'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Down:
        focusArea = 'bookmarks'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) { router.navigateMoviePlayer(currentItem.id); }
        e.preventDefault(); break;
    }
  } else if (focusArea === 'bookmarks') {
    switch (e.keyCode) {
      case TvKey.Left:
        if (pickerIdx > 0) { pickerIdx--; renderBookmarks(); }
        e.preventDefault(); break;
      case TvKey.Right:
        if (pickerIdx < allFolders.length - 1) { pickerIdx++; renderBookmarks(); }
        e.preventDefault(); break;
      case TvKey.Up:
        focusArea = 'play'; updateFocus();
        e.preventDefault(); break;
      case TvKey.Enter: {
        const folder = allFolders[pickerIdx];
        if (folder && currentItem) {
          toggleBookmarkItem(currentItem.id, folder.id).done(() => {
            const updated = new Set(itemFolderIds);
            if (updated.has(folder.id)) { updated.delete(folder.id); } else { updated.add(folder.id); }
            itemFolderIds = updated;
            renderBookmarks();
          });
        }
        e.preventDefault(); break;
      }
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

    loadItemWithWatching(params.id!,
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
