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
import { toggleWatchlist } from '../api/watching';
import { showBookmarkPicker } from '../utils/bookmark-picker';

const $root = $('#page-movie');
const keys = new PageKeys();
const ACTION_COUNT = 3; // play, bookmark, watchlist
let focusedBtn = 0;
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
      {{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}
      {{?it.ratings}}<div class="detail__ratings">{{=it.ratings}}</div>{{?}}
      <div class="detail__actions">{{=it.buttons}}<div class="detail__actions-sep"></div><div class="detail__quick-btn" data-action="bookmark"><span class="icon-check">\u2713</span> Закладки</div><div class="detail__quick-btn{{?it.inWatchlist}} active{{?}}" data-action="watchlist"><span class="icon-check">\u2713</span> Я смотрю</div></div>
      <div class="detail__plot">{{=it.plot}}</div>
    </div>
  </div>
`);

export const tplDetail = (data: {
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

  focusedBtn = 0;
  updateFocus();
};

const allButtons = (): JQuery => $root.find('.btn, .detail__quick-btn');

const updateFocus = (): void => {
  allButtons().removeClass('focused');
  allButtons().eq(focusedBtn).addClass('focused');
};

const handleKey = (e: JQuery.Event): void => {
  switch (e.keyCode) {
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      router.goBack(); e.preventDefault(); return;
    case TvKey.Left:
      if (focusedBtn > 0) { focusedBtn--; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (focusedBtn < ACTION_COUNT - 1) { focusedBtn++; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Enter: {
      const $btn = allButtons().eq(focusedBtn);
      const action = $btn.data('action');
      if (action === 'play' && currentItem) {
        router.navigateMoviePlayer(currentItem.id);
      } else if (action === 'bookmark' && currentItem) {
        showBookmarkPicker(currentItem.id);
      } else if (action === 'watchlist' && currentItem) {
        toggleWatchlist(currentItem.id).done((resp) => {
          $root.find('.detail__quick-btn[data-action="watchlist"]').toggleClass('active', resp.watching);
        });
      }
      e.preventDefault(); break;
    }
  }
};

export const moviePage: Page = {
  mount(params: RouteParams) {
    currentItem = null;
    watchingInfo = null;
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
