import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, Season, WatchingInfoItem } from '../types/api';
import { navigate, goBack } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { renderRatings } from '../utils/templates';
import { formatTimeShort } from '../utils/format';
import { proxyUrl } from '../utils/storage';

var $root = $('#page-serial');
var keys = pageKeys();
var currentItem: Item | null = null;
var watchingInfo: WatchingInfoItem | null = null;

type FocusArea = 'seasons' | 'episodes' | 'play';
var focusArea: FocusArea = 'play';
var selectedSeason = 0;
var focusedEpisode = 0;
var focusedSeasonTab = 0;

var tplDetail = doT.template(
  '<div class="detail">' +
    '<div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>' +
    '<div class="detail__info">' +
      '<div class="detail__title">{{=it.titleRu}}</div>' +
      '{{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}' +
      '<div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>' +
      '<div class="detail__meta">{{=it.genres}}</div>' +
      '{{?it.ratings}}<div class="detail__ratings">{{=it.ratings}}</div>{{?}}' +
      '<div class="detail__plot">{{=it.plot}}</div>' +
      '<div class="detail__actions"><div class="btn" data-action="play">{{=it.playLabel}}</div></div>' +
      '<div class="episodes">' +
        '<div class="episodes__seasons">{{=it.seasonTabs}}</div>' +
        '<div class="episodes__list">{{=it.episodes}}</div>' +
      '</div>' +
    '</div>' +
  '</div>'
);

var tplSeasonTab = doT.template(
  '<div class="episodes__season-tab{{?it.active}} active{{?}}" data-season="{{=it.idx}}">Сезон {{=it.num}}</div>'
);

var tplEpisode = doT.template(
  '<div class="episode" data-ep="{{=it.idx}}">' +
    '<span class="episode__number">{{=it.number}}</span>' +
    '<span class="episode__title">{{=it.title}}</span>' +
    '<span class="episode__status">{{=it.status}}</span>' +
  '</div>'
);

function getEpisodeStatus(seasonNum: number, epNum: number): { time: number; status: number } {
  if (!watchingInfo || !watchingInfo.seasons) return { time: 0, status: -1 };
  for (var i = 0; i < watchingInfo.seasons.length; i++) {
    var ws = watchingInfo.seasons[i];
    if (ws.number === seasonNum) {
      for (var j = 0; j < ws.episodes.length; j++) {
        if (ws.episodes[j].number === epNum) {
          return { time: ws.episodes[j].time, status: ws.episodes[j].status };
        }
      }
    }
  }
  return { time: 0, status: -1 };
}

function findResumeEpisode(): { season: number; episode: number; seasonIdx: number; episodeIdx: number } | null {
  if (!currentItem || !currentItem.seasons) return null;
  for (var i = 0; i < currentItem.seasons.length; i++) {
    var s = currentItem.seasons[i];
    for (var j = 0; j < s.episodes.length; j++) {
      var st = getEpisodeStatus(s.number, s.episodes[j].number);
      if (st.status === 0 || st.status === -1) {
        return { season: s.number, episode: s.episodes[j].number, seasonIdx: i, episodeIdx: j };
      }
    }
  }
  return null;
}

function buildEpisodes(season: Season | undefined): string {
  if (!season) return '';
  var html = '';
  for (var j = 0; j < season.episodes.length; j++) {
    var ep = season.episodes[j];
    var st = getEpisodeStatus(season.number, ep.number);
    var statusText = '';
    if (st.status === 1) statusText = '\u2713';
    else if (st.status === 0 && st.time > 0) statusText = formatTimeShort(st.time);
    html += tplEpisode({ idx: j, number: ep.number, title: ep.title || 'Эпизод ' + ep.number, status: statusText });
  }
  return html;
}

function render(item: Item): void {
  var title = item.title.split(' / ');
  var seasons = item.seasons || [];

  var resumeEp = findResumeEpisode();
  var playLabel = resumeEp ? 'Продолжить S' + resumeEp.season + 'E' + resumeEp.episode : 'Смотреть';

  if (resumeEp) {
    selectedSeason = resumeEp.seasonIdx;
  }

  var ratings = renderRatings(item);

  var seasonTabs = '';
  for (var i = 0; i < seasons.length; i++) {
    seasonTabs += tplSeasonTab({ idx: i, num: seasons[i].number, active: i === selectedSeason });
  }

  $root.html(tplDetail({
    poster: proxyUrl(item.posters.big),
    titleRu: title[0],
    titleEn: title.length > 1 ? title[1] : '',
    year: item.year,
    countries: item.countries.map(function (c) { return c.title; }).join(', '),
    genres: item.genres.map(function (g) { return g.title; }).join(', '),
    ratings: ratings,
    plot: item.plot || '',
    playLabel: playLabel,
    seasonTabs: seasonTabs,
    episodes: buildEpisodes(seasons[selectedSeason])
  }));

  focusedSeasonTab = selectedSeason;
  focusArea = 'play';
  focusedEpisode = resumeEp ? resumeEp.episodeIdx : 0;

  updateFocus();

  if (resumeEp) {
    $root.find('.episode').eq(resumeEp.episodeIdx).addClass('current');
  }
}

function updateFocus(): void {
  $root.find('.btn').removeClass('focused');
  $root.find('.episodes__season-tab').removeClass('focused');
  $root.find('.episode').removeClass('focused');

  if (focusArea === 'play') {
    $root.find('.btn').eq(0).addClass('focused');
  } else if (focusArea === 'seasons') {
    $root.find('.episodes__season-tab').eq(focusedSeasonTab).addClass('focused');
  } else if (focusArea === 'episodes') {
    var $eps = $root.find('.episode');
    if ($eps.length > 0) {
      var $ep = $eps.eq(focusedEpisode);
      $ep.addClass('focused');
      scrollIntoView($ep[0], $root.find('.detail__info')[0], 20);
    }
  }
}

function switchSeason(idx: number): void {
  if (!currentItem || !currentItem.seasons) return;
  selectedSeason = idx;
  focusedSeasonTab = idx;
  $root.find('.episodes__season-tab').removeClass('active').eq(idx).addClass('active');
  $root.find('.episodes__list').html(buildEpisodes(currentItem.seasons[idx]));
  focusedEpisode = 0;
  updateFocus();
}

function handleKey(e: JQuery.Event): void {
  var seasons = (currentItem && currentItem.seasons) || [];

  switch (e.keyCode) {
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack(); e.preventDefault(); return;
  }

  if (focusArea === 'play') {
    switch (e.keyCode) {
      case TvKey.Down:
        if (seasons.length > 0) { focusArea = 'seasons'; updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) {
          var resume = findResumeEpisode();
          if (resume) {
            var resumeEpObj = seasons[resume.seasonIdx] && seasons[resume.seasonIdx].episodes[resume.episodeIdx];
            navigate('player', { id: currentItem.id, season: resume.season, episode: resume.episode });
          } else if (seasons.length > 0 && seasons[0].episodes.length > 0) {
            var firstEp = seasons[0].episodes[0];
            navigate('player', { id: currentItem.id, season: seasons[0].number, episode: firstEp.number });
          }
        }
        e.preventDefault(); break;
    }
  } else if (focusArea === 'seasons') {
    switch (e.keyCode) {
      case TvKey.Left:
        if (focusedSeasonTab > 0) { focusedSeasonTab--; switchSeason(focusedSeasonTab); }
        e.preventDefault(); break;
      case TvKey.Right:
        if (focusedSeasonTab < seasons.length - 1) { focusedSeasonTab++; switchSeason(focusedSeasonTab); }
        e.preventDefault(); break;
      case TvKey.Up:
        focusArea = 'play'; updateFocus(); e.preventDefault(); break;
      case TvKey.Down:
        if (seasons[selectedSeason] && seasons[selectedSeason].episodes.length > 0) {
          focusArea = 'episodes'; focusedEpisode = 0; updateFocus();
        }
        e.preventDefault(); break;
      case TvKey.Enter:
        switchSeason(focusedSeasonTab); e.preventDefault(); break;
    }
  } else if (focusArea === 'episodes') {
    var epCount = $root.find('.episode').length;
    switch (e.keyCode) {
      case TvKey.Down:
        if (focusedEpisode < epCount - 1) { focusedEpisode++; updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Up:
        if (focusedEpisode > 0) { focusedEpisode--; updateFocus(); }
        else { focusArea = 'seasons'; updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem && seasons[selectedSeason]) {
          var ep = seasons[selectedSeason].episodes[focusedEpisode];
          if (ep) { navigate('player', { id: currentItem.id, season: seasons[selectedSeason].number, episode: ep.number }); }
        }
        e.preventDefault(); break;
    }
  }
}

export var serialPage: Page = {
  mount: function (params: RouteParams) {
    currentItem = null; watchingInfo = null; selectedSeason = 0;
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
    currentItem = null; watchingInfo = null;
  }
};
