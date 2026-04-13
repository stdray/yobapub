import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, Season, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings, renderPersonnel } from '../utils/templates';
import { formatTimeShort } from '../utils/format';
import { storage } from '../utils/storage';
import { DetailControls } from '../utils/detail-controls';

const $root = $('#page-serial');
const keys = new PageKeys();
const controls = new DetailControls($root);
let currentItem: Item | null = null;
let watchingInfo: WatchingInfoItem | null = null;

type FocusArea = 'bookmarks' | 'watchlist' | 'play' | 'seasons' | 'episodes';
let focusArea: FocusArea = 'play';
let selectedSeason = 0;
let focusedEpisode = 0;
let focusedSeasonTab = 0;

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__left">
      <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
      <div class="detail__ep-preview"></div>
    </div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>
      <div class="detail__meta">{{=it.genres}}</div>
      <div class="detail__ratings">{{=it.bookmarksTpl}}</div>
      <div class="detail__ratings">{{=it.ratings}}{{=it.watchlistTpl}}</div>
      <div class="detail__actions"><div class="btn" data-action="play">{{=it.playLabel}}</div></div>
      <div class="detail__plot">{{=it.plot}}</div>
      {{?it.personnel}}<div class="detail__personnel">{{=it.personnel}}</div>{{?}}
      <div class="episodes">
        <div class="episodes__seasons">{{=it.seasonTabs}}</div>
        <div class="episodes__list">{{=it.episodes}}</div>
      </div>
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
  readonly ratings: string;
  readonly plot: string;
  readonly playLabel: string;
  readonly seasonTabs: string;
  readonly episodes: string;
  readonly bookmarksTpl: string;
  readonly watchlistTpl: string;
  readonly personnel: string;
}): string =>
  tplDetailCompiled(data);

const tplSeasonTabCompiled = doT.template(`
  <div class="episodes__season-tab{{?it.active}} active{{?}}" data-season="{{=it.idx}}">Сезон {{=it.num}}</div>
`);

const tplSeasonTab = (data: { readonly idx: number; readonly num: number; readonly active: boolean }): string =>
  tplSeasonTabCompiled(data);

const tplEpisodeCompiled = doT.template(`
  <div class="episode" data-ep="{{=it.idx}}" data-thumb="{{=it.thumbnail}}">
    <div class="episode__thumb{{?!it.thumbnail}} episode__thumb--empty{{?}}">
      {{?it.thumbnail}}<img src="{{=it.thumbnail}}" alt="" loading="lazy">{{??}}&#9654;{{?}}
    </div>
    <div class="episode__body">
      <span class="episode__number">{{=it.number}}</span>
      <span class="episode__title">{{=it.title}}</span>
      <span class="episode__status">{{=it.status}}</span>
    </div>
  </div>
`);

const tplEpisode = (data: { readonly idx: number; readonly number: number; readonly title: string; readonly status: string; readonly thumbnail: string }): string =>
  tplEpisodeCompiled(data);

const getEpisodeStatus = (seasonNum: number, epNum: number): { time: number; status: number } => {
  if (!watchingInfo || !watchingInfo.seasons) return { time: 0, status: -1 };
  for (let i = 0; i < watchingInfo.seasons.length; i++) {
    const ws = watchingInfo.seasons[i];
    if (ws.number === seasonNum) {
      for (let j = 0; j < ws.episodes.length; j++) {
        if (ws.episodes[j].number === epNum) {
          return { time: ws.episodes[j].time, status: ws.episodes[j].status };
        }
      }
    }
  }
  return { time: 0, status: -1 };
};

const findEpisodeById = (episodeId: number): { seasonIdx: number; episodeIdx: number } | null => {
  if (!currentItem || !currentItem.seasons) return null;
  for (let i = 0; i < currentItem.seasons.length; i++) {
    const s = currentItem.seasons[i];
    for (let j = 0; j < s.episodes.length; j++) {
      if (s.episodes[j].id === episodeId) {
        return { seasonIdx: i, episodeIdx: j };
      }
    }
  }
  return null;
};

const findResumeEpisode = (): { season: number; episode: number; seasonIdx: number; episodeIdx: number } | null => {
  if (!currentItem || !currentItem.seasons) return null;
  for (let i = 0; i < currentItem.seasons.length; i++) {
    const s = currentItem.seasons[i];
    for (let j = 0; j < s.episodes.length; j++) {
      const st = getEpisodeStatus(s.number, s.episodes[j].number);
      if (st.status === 0 || st.status === -1) {
        return { season: s.number, episode: s.episodes[j].number, seasonIdx: i, episodeIdx: j };
      }
    }
  }
  return null;
};

const buildEpisodes = (season: Season | undefined): string => {
  if (!season) return '';
  let html = '';
  for (let j = 0; j < season.episodes.length; j++) {
    const ep = season.episodes[j];
    const st = getEpisodeStatus(season.number, ep.number);
    let statusText = '';
    if (st.status === 1) statusText = '\u2713';
    else if (st.status === 0 && st.time > 0) statusText = formatTimeShort(st.time);
    html += tplEpisode({ idx: j, number: ep.number, title: ep.title || 'Эпизод ' + ep.number, status: statusText, thumbnail: ep.thumbnail ? storage.proxyPosterUrl(ep.thumbnail) : '' });
  }
  return html;
};

const render = (item: Item): void => {
  const title = item.title.split(' / ');
  const seasons = item.seasons || [];

  const resumeEp = findResumeEpisode();
  const playLabel = resumeEp ? 'Продолжить S' + resumeEp.season + 'E' + resumeEp.episode : 'Смотреть';

  if (resumeEp) {
    selectedSeason = resumeEp.seasonIdx;
  }

  let seasonTabs = '';
  for (let i = 0; i < seasons.length; i++) {
    seasonTabs += tplSeasonTab({ idx: i, num: seasons[i].number, active: i === selectedSeason });
  }

  $root.html(tplDetail({
    poster: storage.proxyPosterUrl(item.posters.big),
    titleRu: title[0],
    titleEn: title.length > 1 ? title[1] : '',
    year: item.year,
    countries: item.countries.map((c) => c.title).join(', '),
    genres: item.genres.map((g) => g.title).join(', '),
    ratings: renderRatings(item),
    plot: item.plot || '',
    playLabel: playLabel,
    seasonTabs: seasonTabs,
    episodes: buildEpisodes(seasons[selectedSeason]),
    bookmarksTpl: controls.bookmarksTpl(),
    watchlistTpl: controls.watchlistTpl(item.in_watchlist),
    personnel: renderPersonnel(item)
  }));

  focusedSeasonTab = selectedSeason;
  focusArea = 'play';
  focusedEpisode = resumeEp ? resumeEp.episodeIdx : 0;

  updateFocus();

  if (resumeEp) {
    $root.find('.episode').eq(resumeEp.episodeIdx).addClass('current');
  }

  controls.loadBookmarks(item.id);
};

const updateFocus = (): void => {
  $root.find('.btn').removeClass('focused');
  $root.find('.detail__rating.focusable').removeClass('focused');
  $root.find('.episodes__season-tab').removeClass('focused');
  $root.find('.episode').removeClass('focused');

  const infoEl = $root.find('.detail__info')[0];

  if (focusArea === 'bookmarks') {
    const $el = $root.find('[data-action="bookmark"]');
    $el.addClass('focused');
    if (infoEl) infoEl.scrollTop = 0;
  } else if (focusArea === 'watchlist') {
    const $el = $root.find('[data-action="watchlist"]');
    $el.addClass('focused');
    if (infoEl) infoEl.scrollTop = 0;
  } else if (focusArea === 'play') {
    const $el = $root.find('.btn').eq(0);
    $el.addClass('focused');
    if (infoEl) infoEl.scrollTop = 0;
  } else if (focusArea === 'seasons') {
    const $el = $root.find('.episodes__season-tab').eq(focusedSeasonTab);
    $el.addClass('focused');
    if ($el[0] && infoEl) PageUtils.scrollIntoView($el[0], infoEl, 20);
  } else if (focusArea === 'episodes') {
    const $eps = $root.find('.episode');
    if ($eps.length > 0) {
      const $ep = $eps.eq(focusedEpisode);
      $ep.addClass('focused');
      if (infoEl) PageUtils.scrollIntoView($ep[0], infoEl, 20);
    }
  }

  // обновить превью эпизода под постером
  const $preview = $root.find('.detail__ep-preview');
  if (focusArea === 'episodes') {
    const thumb = $root.find('.episode').eq(focusedEpisode).attr('data-thumb') || '';
    if (thumb) {
      $preview.html('<img src="' + thumb + '" alt="">');
    } else {
      $preview.html('');
    }
  } else {
    $preview.html('');
  }
};

const switchSeason = (idx: number): void => {
  if (!currentItem || !currentItem.seasons) return;
  selectedSeason = idx;
  focusedSeasonTab = idx;
  $root.find('.episodes__season-tab').removeClass('active').eq(idx).addClass('active');
  $root.find('.episodes__list').html(buildEpisodes(currentItem.seasons[idx]));
  focusedEpisode = 0;
  updateFocus();
};

const handleKey = (e: JQuery.Event): void => {
  const seasons = (currentItem && currentItem.seasons) || [];

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
      case TvKey.Down:
        if (seasons.length > 0) { focusArea = 'seasons'; updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (currentItem) {
          const resume = findResumeEpisode();
          if (resume) {
            router.navigateSerialPlayer(currentItem.id, resume.season, resume.episode);
          } else if (seasons.length > 0 && seasons[0].episodes.length > 0) {
            const firstEp = seasons[0].episodes[0];
            router.navigateSerialPlayer(currentItem.id, seasons[0].number, firstEp.number);
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
    const epCount = $root.find('.episode').length;
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
          const ep = seasons[selectedSeason].episodes[focusedEpisode];
          if (ep) { router.navigateSerialPlayer(currentItem.id, seasons[selectedSeason].number, ep.number); }
        }
        e.preventDefault(); break;
    }
  }
};

export const serialPage: Page = {
  mount(params: RouteParams) {
    currentItem = null; watchingInfo = null; selectedSeason = 0;
    controls.reset();
    PageUtils.showSpinnerIn($root);

    const targetEpisodeId = params.episodeId;

    loadItemWithWatching(params.id!,
      (item, watching) => {
        currentItem = item;
        watchingInfo = watching;
        render(currentItem);
        if (targetEpisodeId) {
          const found = findEpisodeById(targetEpisodeId);
          if (found) {
            if (found.seasonIdx !== selectedSeason) {
              switchSeason(found.seasonIdx);
            }
            focusArea = 'episodes';
            focusedEpisode = found.episodeIdx;
            updateFocus();
          }
        }
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
    currentItem = null; watchingInfo = null;
  }
};
