import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { getWatchingInfo } from '../api/watching';
import { Item, WatchingInfoItem } from '../types/api';
import { navigate, goBack } from '../router';
import { TvKey } from '../utils/platform';

var $root = $('#page-movie');
var keyHandler: ((e: JQuery.Event) => void) | null = null;
var focusedBtn = 0;
var btnCount = 0;
var currentItem: Item | null = null;
var watchingInfo: WatchingInfoItem | null = null;

var tplDetail = doT.template(
  '<div class="detail">' +
    '<div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>' +
    '<div class="detail__info">' +
      '<div class="detail__title">{{=it.titleRu}}</div>' +
      '{{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}' +
      '<div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>' +
      '<div class="detail__meta">{{=it.genres}}</div>' +
      '{{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}' +
      '{{?it.ratings}}<div class="detail__ratings">{{=it.ratings}}</div>{{?}}' +
      '<div class="detail__actions">{{=it.buttons}}</div>' +
      '<div class="detail__plot">{{=it.plot}}</div>' +
    '</div>' +
  '</div>'
);

var tplRating = doT.template(
  '<span class="detail__rating">{{=it.label}} <span class="detail__rating-value">{{=it.value}}</span></span>'
);

function formatDuration(sec: number): string {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + ' ч ' + m + ' мин';
  return m + ' мин';
}

function render(item: Item): void {
  var title = item.title.split(' / ');
  var resumeTime = 0;
  if (watchingInfo && watchingInfo.videos && watchingInfo.videos.length > 0) {
    var v = watchingInfo.videos[0];
    if (v.status === 0 && v.time > 0 && v.time < v.duration - 10) { resumeTime = v.time; }
  }

  var buttons = '<div class="btn" data-action="play">' +
    (resumeTime > 0 ? 'Продолжить с ' + formatDuration(resumeTime) : 'Смотреть') + '</div>';
  btnCount = 1;
  if (item.trailer) {
    buttons += '<div class="btn" data-action="trailer">Трейлер</div>';
    btnCount++;
  }

  var ratings = '';
  if (item.rating) { ratings += tplRating({ label: 'KP', value: item.rating }); }
  if (item.kinopoisk_rating) { ratings += tplRating({ label: 'КиноПоиск', value: item.kinopoisk_rating }); }
  if (item.imdb_rating) { ratings += tplRating({ label: 'IMDb', value: item.imdb_rating }); }

  $root.html(tplDetail({
    poster: item.posters.big,
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
      var action = $root.find('.btn').eq(focusedBtn).data('action');
      if (action === 'play' && currentItem) { navigate('player', { id: currentItem.id, video: 1 }); }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack(); e.preventDefault(); break;
  }
}

export var moviePage: Page = {
  mount: function (params: RouteParams) {
    currentItem = null;
    watchingInfo = null;
    $root.html('<div class="spinner"><div class="spinner__circle"></div></div>');
    var id = params.id!;

    $.when(getItem(id), getWatchingInfo(id)).then(
      function (itemRes: any, watchRes: any) {
        var iData = Array.isArray(itemRes) ? itemRes[0] : itemRes;
        var wData = Array.isArray(watchRes) ? watchRes[0] : watchRes;
        currentItem = iData.item;
        watchingInfo = (wData && wData.item) || null;
        if (currentItem) { render(currentItem); }
      },
      function () {
        $root.html('<div class="detail"><div class="detail__info"><div class="detail__title">Ошибка загрузки</div></div></div>');
      }
    );
    keyHandler = handleKey;
    $(window).on('keydown', keyHandler);
  },
  unmount: function () {
    if (keyHandler) { $(window).off('keydown', keyHandler); keyHandler = null; }
    $root.empty();
    currentItem = null;
    watchingInfo = null;
  }
};
