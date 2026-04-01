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

const $root = $('#page-movie');
const keys = new PageKeys();
let focusedBtn = 0;
let btnCount = 0;
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
      <div class="detail__actions">{{=it.buttons}}</div>
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
}): string =>
  tplDetailCompiled(data);

function render(item: Item): void {
  let title = item.title.split(' / ');
  let resumeTime = 0;
  if (watchingInfo && watchingInfo.videos && watchingInfo.videos.length > 0) {
    const v = watchingInfo.videos[0];
    if (v.status === 0 && v.time > 0 && v.time < v.duration - 10) { resumeTime = v.time; }
  }

  let buttons = '<div class="btn" data-action="play">' +
    (resumeTime > 0 ? 'Продолжить с ' + formatDuration(resumeTime) : 'Смотреть') + '</div>';
  btnCount = 1;
  if (item.trailer) {
    buttons += '<div class="btn" data-action="trailer">Трейлер</div>';
    btnCount++;
  }

  const ratings = renderRatings(item);

  $root.html(tplDetail({
    poster: storage.proxyPosterUrl(item.posters.big),
    titleRu: title[0],
    titleEn: title.length > 1 ? title[1] : '',
    year: item.year,
    countries: item.countries.map(function (c) { return c.title; }).join(', '),
    genres: item.genres.map(function (g) { return g.title; }).join(', '),
    duration: item.duration ? formatDuration(item.duration.average) : '',
    quality: item.quality,
    ratings: ratings,
    buttons: buttons,
    plot: item.plot || ''
  }));

  focusedBtn = 0;
  updateFocus();
}

function updateFocus(): void {
  $root.find('.btn').removeClass('focused');
  $root.find('.btn').eq(focusedBtn).addClass('focused');
}

function handleKey(e: JQuery.Event): void {
  switch (e.keyCode) {
    case TvKey.Left:
      if (focusedBtn > 0) { focusedBtn--; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (focusedBtn < btnCount - 1) { focusedBtn++; updateFocus(); }
      e.preventDefault(); break;
    case TvKey.Enter:
      const action = $root.find('.btn').eq(focusedBtn).data('action');
      if (action === 'play' && currentItem) {
        const firstVideo = currentItem.videos && currentItem.videos[0];
        router.navigate('player', { id: currentItem.id, video: 1 });
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      router.goBack(); e.preventDefault(); break;
  }
}

export var moviePage: Page = {
  mount: function (params: RouteParams) {
    currentItem = null;
    watchingInfo = null;
    PageUtils.showSpinnerIn($root);
    let id = params.id!;

    loadItemWithWatching(id,
      function (item, watching) {
        currentItem = item;
        watchingInfo = watching;
        render(currentItem);
      },
      function () {
        $root.html('<div class="detail"><div class="detail__info"><div class="detail__title">Ошибка загрузки</div></div></div>');
      }
    );
    keys.bind(handleKey);
  },
  unmount: function () {
    keys.unbind();
    PageUtils.clearPage($root);
    currentItem = null;
    watchingInfo = null;
  }
};
