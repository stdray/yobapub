import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, WatchingInfoItem } from '../types/api';
import { navigate, goBack } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';
import { renderRatings } from '../utils/templates';
import { formatDuration } from '../utils/format';
import { proxyPosterUrl } from '../utils/storage';

var $root = $('#page-movie');
var keys = pageKeys();
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

  var ratings = renderRatings(item);

  $root.html(tplDetail({
    poster: proxyPosterUrl(item.posters.big),
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
      if (action === 'play' && currentItem) {
        var firstVideo = currentItem.videos && currentItem.videos[0];
        navigate('player', { id: currentItem.id, video: 1 });
      }
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
    showSpinnerIn($root);
    var id = params.id!;

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
    clearPage($root);
    currentItem = null;
    watchingInfo = null;
  }
};
