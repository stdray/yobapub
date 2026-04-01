import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings } from '../utils/templates';
import { formatDuration } from '../utils/format';
import { storage } from '../utils/storage';
import { DetailControls } from '../utils/detail-controls';

const $root = $('#page-movie');
const keys = new PageKeys();
const controls = new DetailControls($root);

type FocusArea = 'bookmarks' | 'watchlist' | 'play';
let focusArea: FocusArea = 'play';
let currentItem: Item | null = null;
let watchingInfo: WatchingInfoItem | null = null;

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>
      <div class="detail__meta">{{=it.genres}}</div>
      {{=it.bookmarksTpl}}
      {{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}
      <div class="detail__ratings">{{=it.ratings}}{{=it.watchlistTpl}}</div>
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
  readonly bookmarksTpl: string;
  readonly watchlistTpl: string;
}): string =>
  tplDetailCompiled(data);

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
    bookmarksTpl: controls.bookmarksTpl(),
    watchlistTpl: controls.watchlistTpl(item.in_watchlist)
  }));

  focusArea = 'play';
  updateFocus();
  controls.loadBookmarks(item.id);
};

const updateFocus = (): void => {
  $root.find('.btn').removeClass('focused');
  $root.find('.detail__watchlist').removeClass('focused');
  $root.find('.detail__bookmark-picker').removeClass('focused');

  if (focusArea === 'bookmarks') {
    $root.find('.detail__bookmark-picker').addClass('focused');
  } else if (focusArea === 'watchlist') {
    $root.find('.detail__watchlist').addClass('focused');
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

  if (focusArea === 'bookmarks') {
    switch (e.keyCode) {
      case TvKey.Left: controls.prevFolder(); e.preventDefault(); break;
      case TvKey.Right: controls.nextFolder(); e.preventDefault(); break;
      case TvKey.Down: focusArea = 'watchlist'; updateFocus(); e.preventDefault(); break;
      case TvKey.Enter: controls.toggleBookmark(); e.preventDefault(); break;
    }
  } else if (focusArea === 'watchlist') {
    switch (e.keyCode) {
      case TvKey.Up: focusArea = 'bookmarks'; updateFocus(); e.preventDefault(); break;
      case TvKey.Down: focusArea = 'play'; updateFocus(); e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) { controls.toggleWatchlist(currentItem.id); }
        e.preventDefault(); break;
    }
  } else if (focusArea === 'play') {
    switch (e.keyCode) {
      case TvKey.Up: focusArea = 'watchlist'; updateFocus(); e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) { router.navigateMoviePlayer(currentItem.id); }
        e.preventDefault(); break;
    }
  }
};

export const moviePage: Page = {
  mount(params: RouteParams) {
    currentItem = null;
    watchingInfo = null;
    controls.reset();
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
